# Changelog

本文件记录所有值得注意的改动。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

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
- 命令行兜底 `dsh-delete-chat` / `bin/delete-chat.mjs`：`--list` / `--preview` / `--yes` / `--home`。
- 结果报告的**状态行如实反映结果**：完整删除 / 部分完成 / 未找到可删除内容，不再一律写「已删除」。
- 失败可恢复：报告里出现失败时，弹窗多出**重试**、**复制失败详情**，并给出该会话的 CLI 兜底命令；投影缓存删不掉也会进失败列表（不再被静默吞掉，也不再谎报已清理）。
- 44 项测试：宿主逻辑、HTTP 信封与围栏、客户端 bundle 契约、菜单外观、语言切换、结果报告、失败恢复。
- `scripts/market-index.mjs` 生成 format 1 市场索引；`scripts/pack.mjs` 产出可分发的 `.tgz`。

### Known limitations

- 不级联删除子代理与分叉子会话，它们的 `parent_session` 会悬空。
- 附件是内容寻址、跨会话共享的，删除会话不动附件对象。
- 宿主 `sessions` 服务没有 dispose，删除后内存对象残留到下次重启。
- `workspace.json` 可能被宿主回写一次；归档集合仍生效，重启后彻底干净。
