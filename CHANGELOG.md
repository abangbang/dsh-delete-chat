# Changelog

本文件记录所有值得注意的改动。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.3.0] — 2026-10-29

### Changed

- **回收站从弹层改成全局面板**：注册 `main`（keyed，key = `delete-chat:trash`）承载页面本体，
  注册 `sidebar.panellist`（同一个 id）提供侧栏「全局面板」列表里的图标行。点这一行等于
  `ctx.layout.selectPanel('delete-chat:trash')`，中间栏整页显示回收站——跟「插件」管理页同一个层级。
- 面板里不再有「关闭」按钮（页面由侧栏切换离开），改为显示回收站根路径；有内容时列表图标带红点。
- 侧栏底部（`sidebar.footer.action`）那一行移除。

## [0.2.1] — 2026-10-29

### Changed

- 侧栏底部那一行改成**紧凑布局**：宽侧栏时是「图标 + 文字 + 角标」的一行，收起成 56px 轨道时退化成
  36×36 的图标格 + 右上角红点数字，跟同排的其它 action 尺寸一致。
- 注册时补上 `label` 节流函数（`registerOptions.label` 的官方形态），让宿主自己投影文字时也能跟随语言。

### Added

- **加载自检**：客户端 bundle 启动时在控制台打印 `[dsh-delete-chat] <build> loaded`，每个席位挂载成功/失败
  各打一行；某个席位挂不上只影响它自己，并留下 `console.error` 痕迹，不再静默消失。
## [0.2.0] — 2026-10-29

### Changed

- **删除会话不再永久删除**：改为**软删除**——归档 → 把目录 `rename` 进 `~/.dsh/session-trash/<project>/<id>/`
  → 摘工作区记账 → 写回收站清单。同卷 rename，瞬时可逆，不复制一个字节；跨卷时退回复制 + 删除（`EXDEV`）。
- 回收站入口改到**侧栏底部的常驻行**（`sidebar.footer.action`），带数量角标；会话行「⋯」里只保留**删除会话**一条。永久删除只存在于回收站面板里。

### Added

- **回收站面板**：筛选（标题 / 目录 / 项目）、多选、全选、已选计数，以及
  **恢复 / 永久删除 / 一键清空**。两个破坏性动作第一次点击只是上膛（按钮变成「确认永久删除 N 项」），
  第二次才真删；结果行给出恢复/删除条数、释放空间和失败数。
- 宿主接口从 `{list,preview,delete}` 扩到 `{trash,trashList,restore,purge,empty}`，
  `delete` 作为一次性永久删除保留给脚本。
- `restore` 把目录搬回原位、重新写 `workspace.json`，并在注册表支持时用 `insertSessionBefore`
  让行立刻回到侧栏（否则下次启动出现）。
- 回收站清单 `session-trash/index.json` 记住标题、cwd、大小、删除时间；列表以目录树为准：
  清单没有的目录也列出，清单有而目录没了的报成 `missing`。
- CLI 补齐 `--trash` / `--trash-list` / `--restore` / `--purge --yes` / `--empty --yes`；
  永久动作不加 `--yes` 一律拒绝。
- `test/trash.test.mjs`：15 项覆盖软删、清单、恢复、批量永久删除、清空、幂等与未知 id。
  客户端测试重写为驱动真实组件（假 React + 扁平化渲染），覆盖两行菜单、软删弹窗、面板筛选、
  多选上膛、恢复、清空、宿主失败上报。

### Fixed

- 面板/弹窗的渲染树里嵌套数组（`rows.map(...)`）不会被文本断言漏掉。
- 恢复时 `workspace.json` 的 `sessionIds` 去重，避免与实时投影插入重复。
## [0.1.0] — 2026-10-29

首个公开发布。

### Added

- 会话行「⋯」菜单新增**删除会话**，破坏性配色：垃圾桶图标 + 危险红，悬停淡红底。
- **界面文案跟随宿主语言**：字典注册进宿主的 locale 服务（命名空间 `deleteChat`，zh/en 键集一致），
  切换语言时菜单行与已打开的弹窗都即时重渲染；宿主没有 locale 服务时按浏览器语言兜底。
- 确认弹窗：显示会话标题、磁盘占用、目录数量；执行后逐项报告归档状态、删除目录数、
  释放空间、工作区记账摘除条数、投影缓存清理数、失败列表。
- 宿主接口 `POST /delete-chat/api/{list,preview,delete}`，走宿主同源围栏，
  `sessionId` 在成为路径段之前过白名单。
- 删除流水线：`archiveSession(stopActivity)` → 递归删目录（兼容平铺与分项目两种布局）
  → 原子改写 `workspace.json`（留 `.bak-<时间戳>`）→ 清 `session_projcache`。
- **跨平台安装器**：`scripts/install.mjs` 一份 Node 实现（幂等、`--dry-run`、会清掉改名前的挂载），
  `install.ps1` / `install.sh` 退化为只翻译开关的薄封装；macOS 不必再照着 README 手改 YAML。
- **平台矩阵**：新增 `test/platform.test.mjs`（路径推导、id 白名单、被占用的目录、符号链接根）
  与 `test/install.test.mjs`（装 / 重装 / 卸载 / 干跑 / 拒绝非 profile 目录）；
  CI 矩阵扩到 ubuntu + macOS + Windows × Node 20/22/24，并真解析 `install.ps1` / `bash -n install.sh`。
- **修正**：sessions 根不是 `.../sessions` 时，`dshHomeOf` 不再猜父目录，改读 `DSH_HOME`（否则会写一份没人加载的 `workspace.json`）。
- 命令行兜底 `dsh-delete-chat` / `bin/delete-chat.mjs`：`--list` / `--preview` / `--yes` / `--home`。
- 结果报告的**状态行如实反映结果**：完整删除 / 部分完成 / 未找到可删除内容，不再一律写「已删除」。
- 失败可恢复：报告里出现失败时，弹窗多出**重试**、**复制失败详情**，并给出该会话的 CLI 兜底命令；投影缓存删不掉也会进失败列表（不再被静默吞掉，也不再谎报已清理）。
- 71 项测试：宿主逻辑、HTTP 信封与围栏、客户端 bundle 契约、菜单外观、语言切换、结果报告、失败恢复、平台矩阵、安装器。
- `scripts/market-index.mjs` 生成 format 1 市场索引；`scripts/pack.mjs` 产出可分发的 `.tgz`。

### Known limitations

- 不级联删除子代理与分叉子会话，它们的 `parent_session` 会悬空。
- 附件是内容寻址、跨会话共享的，删除会话不动附件对象。
- 宿主 `sessions` 服务没有 dispose，删除后内存对象残留到下次重启。
- `workspace.json` 可能被宿主回写一次；归档集合仍生效，重启后彻底干净。
