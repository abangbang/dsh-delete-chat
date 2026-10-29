# dsh-delete-chat

**真正删除 DSH 会话。** DeepSeek Harness 只给「归档」——归档把会话从列表里藏起来，日志永远留着。
这个插件补上删除：归档 → 删目录 → 摘记账 → 清缓存，一步到底，带确认和逐项结果。

[English](README.md) | 中文

<p align="center">
  <img src="docs/banner.svg" alt="dsh-delete-chat" width="720">
</p>

---

## 为什么需要它

DSH 的两处官方文档自己写明了缺口：

> 「**不删除会话文件** —— 日志在 `root` 下累积，直到外部移除。seam **无删除接口**。」
> —— `@deepseek-ai/dsh-session-persistence-jsonl`

> 「移除项目会保留其文件夹、文件与会话历史……而**会话删除与文件夹移除是彼此独立且尚未提供的功能**。」
> —— `@deepseek-ai/dsh-workspace`

「删除工作区」只动列表，不动会话；「归档」只隐藏，不动字节。于是 `~/.dsh/sessions` 只增不减——
这个插件是那把剪刀。

## 功能

| | |
|---|---|
| **会话行菜单** | 「⋯」→ 删除会话，垃圾桶图标 + 危险红，悬停淡红底 |
| **跟随语言** | 文案读宿主语言（zh / en），切换后菜单行与已打开的弹窗都即时重渲染 |
| **确认弹窗** | 标题、磁盘占用、目录数；执行后逐项报告结果 |
| **真删** | 归档（停掉在跑的回合）→ 递归删目录 → 原子改写 `workspace.json`（留备份）→ 清投影缓存 |
| **两种布局** | 分项目 `<root>/<project>/session-<uuid>/` 与平铺 `<root>/session-<uuid>/` |
| **命令行兜底** | `dsh-delete-chat --list / --preview / --yes`，界面没挂上也能删 |
| **可选自托管索引** | 仓库自带 format 1 市场索引，加进 DSH 的「索引源」就是一个私有市场 |

## 安装

### 插件市场

宿主 **设置 → 插件 → 发现 → 索引源**，添加：

```
https://cdn.jsdelivr.net/gh/YOUR_GITHUB_USER/dsh-delete-chat@main/market/index.json
```

（索引里的图标是相对路径，jsDelivr 会把整棵仓库当静态站，所以能解析。）

### 命令行

```bash
dsh plugin --profile <你的profile> add https://github.com/YOUR_GITHUB_USER/dsh-delete-chat/archive/refs/heads/main.tar.gz
```

官方桌面端的 profile 归应用自己的插件管理器所有，请用应用内的 **设置 → 插件** 安装。

### 脚本（任意系统）

```bash
node scripts/install.mjs                  # 装进 ~/.dsh/profiles/desktop
node scripts/install.mjs --profile <dir>  # 指定 profile
node scripts/install.mjs --dry-run        # 只打印补丁差异，不写盘
node scripts/install.mjs --uninstall      # 卸载并删掉包副本

./install.sh                              # macOS / Linux 封装
.\install.ps1                             # Windows 封装（支持 -Uninstall / -DryRun）
```

两个封装只翻译开关——安装器本身是一份 Node 脚本，三个系统跑的是同一套代码；它还会清掉改名前的挂载（`dsh-session-delete`），升级过的人不会变成双挂。

### 手动挂载

```bash
git clone https://github.com/YOUR_GITHUB_USER/dsh-delete-chat.git \
  ~/.dsh/profiles/desktop/node_modules/dsh-delete-chat
```

然后在 profile 的 `cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: delete-chat
      name: 'dsh-delete-chat'
```

**装完重启 DSH。** 插件树在启动时组装，客户端 bundle 也在启动时组合并带
`immutable` 缓存头——刷新页面拿到的是旧包，必须重启。

> ⚠️ 不要双挂：用 `dsh plugin add` 装（会读到本包的 `dsh.bundle.patch` 自动插一行）之后，
> 记得删掉手写的那行 `- insert:`。

## 用法

侧栏会话行 → **「⋯」→ 删除会话** → 确认。

弹窗里会先显示磁盘占用，删除后显示：

```
状态        已删除
归档        已归档并停止运行中的工作
删除目录     1 个
释放空间     274.4 KB
工作区记账    移除 3 条引用
投影缓存     1 项
```

### 命令行

```bash
dsh-delete-chat --list                    # 列全部会话（大小 / 归档 / 置顶 / 存活）
dsh-delete-chat --preview session-<uuid>  # 只看，不动
dsh-delete-chat --yes session-<uuid>      # 真删
dsh-delete-chat --home D:\other\.dsh --list
```

不带 `--yes` 只打印预览并以 `1` 退出。

## 工作原理

一次删除，四个动作，顺序固定：

| 步骤 | 动作 | 为什么是这个顺序 |
|---|---|---|
| 1 | `archiveSession(id, { stopActivity: true })` | 立刻从所有分组界面隐藏、停掉在跑的回合、`ArchivedSessionGate` 拦住后续唤醒——文件消失期间不会有东西把行顶回来 |
| 2 | 递归删 `<sessions-root>/…/session-<uuid>/` | 连同 `session.v4.jsonl.zstd` |
| 3 | 改写 `storages/workspace.json` | 摘掉 `sessionIds` / `archivedSessionIds` / `pinnedSessionIds`；写临时文件 + 原子 rename，原件留 `.bak-<时间戳>` |
| 4 | 清 `storages/session_projcache/<id>.*` | 不清会在搜索里留下点不开的记录 |

第 1 步失败不算失败（不在工作区记账里的会话也照删），报告里如实写明。

### 接口

`POST /delete-chat/api/{list,preview,delete}`，走宿主自己的 `connection.requestRejection` 同源围栏。
`sessionId` 必须以 `session-` 开头且只含 `[0-9A-Za-z._-]`——它在到达 `join()`/`rm()` 之前就被校验，
`../`、盘符、分隔符不可能成为路径段。

## 删失败了怎么办

这里没有事务：一次删除要动运行中的宿主、一棵目录树、一个 JSON 存储。报告会说清是哪一环拒绝的，每种失败都有出路。

| 失败在哪 | 弹窗显示 | 实际状态 |
|---|---|---|
| `POST /delete-chat/api/delete` 本身失败 | 进入 `error` 阶段、红框、会话原封不动 | 什么都没写 |
| 某个目录删不掉（文件被占用、权限、OneDrive 同步中） | 状态**部分完成**，红底列路径 + 原因 | 其它路径已删；该行已归档 |
| `workspace.json` 改写失败 | 状态**部分完成**，列出存储路径，`.bak-<时间戳>` 保留 | 文件已删；陈旧引用会在下次启动时被重建时丢掉 |
| 某个投影缓存条目删不掉 | 状态**部分完成**，列出那一条缓存路径 | 会话日志已经没了，只剩一个可丢弃的缓存文件 |

按顺序试这些：

1. **重试**——报告里有失败时，弹窗会多出「重试」按钮。操作是幂等的：再归档一次（无操作）、再删剩下的、再摘一次引用。
2. **复制失败详情**——导出一份机器可读的报告，贴进 issue 正好。
3. **命令行兜底**——弹窗底部直接给出这条命令。**先退出 DSH**：挡住目录的锁通常就是宿主自己的写句柄。
   ```bash
   dsh-delete-chat --yes session-<uuid>
   ```
4. **回滚存储**——每次改写都在旁边留了 `workspace.json.bak-<时间戳>`。
5. **把会话找回来**——如果文件还在（只有目录那步失败），归档是可逆的：取消归档，会话就回到列表。

## 平台支持

| | Windows | macOS | Linux |
|---|---|---|---|
| 插件本体（宿主 + 客户端两半） | ✅ 本地实测 | ✅ CI `macos-latest` | ✅ CI `ubuntu-latest` |
| 安装器（`scripts/install.mjs` + 两个封装） | ✅ 本地实测 | ✅ 同一套测试 | ✅ 同一套测试 |
| 目录被别的进程占着 | 拒绝（`EBUSY`）→ 如实报告 + 给重试 | 直接删掉（POSIX `unlink`） | 直接删掉（POSIX `unlink`） |
| sessions 根经过符号链接（macOS `tmpdir` 的形态） | 不适用 | ✅ 已覆盖 | ✅ 已覆盖 |
| 路径推导 | 盘符根 | POSIX 根 | POSIX 根 |

Windows 与 POSIX 的断言写在同一个文件（`test/platform.test.mjs`）里，且互斥：不属于当前系统的分支会**带原因跳过**，所以一个系统上跑绿不能冒充另一个系统也绿。`npm test` 共 71 项。

用户真正会碰到的平台差异只有第三行：Windows 上被别的进程占着的目录删不掉，插件会报 `EBUSY`、给「重试」、并打印命令行兜底——退出 DSH 后 `dsh-delete-chat --yes <id>`；macOS 和 Linux 上同一次删除直接成功。

## 已知边界

- **不级联**：被删会话的子代理会话、分叉子会话不会跟着删，它们的 `parent_session` 会悬空。
- **附件不动**：`~/.dsh/attachments/v1/objects` 是内容寻址、跨会话共享的，删会话不能连带删对象。
- **内存对象残留**：宿主 `sessions` 服务只暴露 `create`/`get`/`list`，没有 dispose；归档后该对象已不跑
  任何模型步，重启即消失。
- **`workspace.json` 可能被宿主回写一次**：归档集合仍生效（行依旧隐藏），重启后彻底干净。

## 开发

```bash
npm test                 # 30 项：宿主逻辑 / HTTP 信封 / 客户端 bundle 契约
npm run pack             # 产出 release/dsh-delete-chat-<version>.tgz
npm run market-index     # 用当前 HEAD 重新生成 market/index.json
npm run rename-owner --  <github-user> [display-name]   # 一次性替换占位符
```

三条测试都跑在 `mkdtemp` 出来的假 DSH home 与假 ctx 上，不需要 DSH 在跑，也不碰真实数据。

## 许可

[MIT](LICENSE)。收录 ≠ 背书：这是第三方代码，请只安装你信任的来源。
