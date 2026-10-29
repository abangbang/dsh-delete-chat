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
| **软删除** | 会话行「⋯」→ 删除会话，把目录移进 `~/.dsh/session-trash`——同卷 rename，不复制、不丢字节 |
| **回收站是一个全局面板** | 侧栏「全局面板」列表里的那一行依次是「图标 · 回收站 · 数量」；点开是整页：筛选、多选、恢复、永久删除、一键清空 |
| **二次确认弹窗** | 恢复 / 永久删除 / 清空回收站各开一个弹窗，写明条数与将释放的空间，确认才执行 |
| **每条都有详情** | 大小、文件位置、最后对话时间、删除时间，一行四栏 |
| **跟随语言** | 文案读宿主语言（zh / en），菜单行、弹窗、面板都即时重渲染 |
| **两种布局** | 分项目 `<root>/<project>/session-<uuid>/` 与平铺 `<root>/session-<uuid>/` |
| **命令行** | `--trash` / `--trash-list` / `--restore` / `--purge --yes` / `--empty --yes`，界面没挂上也能用 |
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

**删除**——会话行 → **「⋯」→ 删除会话** → 确认。行从列表消失、在跑的回合被停，目录移进回收站：

```
状态      已移入回收站
占用空间   274.4 KB
```

什么都不会丢：这是一次 rename，在你动手之前一直可逆。

**回收站**——侧栏「全局面板」（工作区列表上方那排，`aria-label="全局面板"`）里多一行 **🗄 回收站 · 3**——这一行自己画图标、名称和数量（数量不带自己的颜色，跟着这一行的文字色走；数量为 0 时只显示名称，超过 99 显示 `99+`，收起成 56px 轨道时省掉名称）。删完一条会话，这个数字会立刻跟着变，不用刷新。点开是**整页**（跟「插件」管理页同级），列出每个被删的会话，带大小、位置、最后对话与删除时间：

- **筛选**：按标题、目录或项目名过滤；
- **多选**：单条勾选或全选，底部显示已选数量；
- **恢复**：目录搬回原位、重新记账、取消归档；
- **二次确认**：恢复、永久删除、清空回收站都会先弹一个确认框，写明「几项 / 共多少 KB / 无法恢复」，点确认才真的动磁盘。恢复的确认按钮是**琥珀色**，只有删除类才是红色。

每行都带详情：

```
alpha 会话
  大小        2.0 KB
  文件位置    ~/.dsh/session-trash/--proj--/session-…
  最后对话    2026-10-27 17:08:07      ← 日志文件的 mtime，rename 会保留
  删除时间    2026-10-29 09:02:03
```

### 命令行

```bash
dsh-delete-chat --list                     # 磁盘上的会话 + 回收站数量
dsh-delete-chat --trash-list               # 回收站里有什么
dsh-delete-chat --trash session-<uuid>     # 软删除
dsh-delete-chat --restore session-<uuid>   # 恢复
dsh-delete-chat --purge session-<uuid> --yes
dsh-delete-chat --empty --yes
dsh-delete-chat --preview session-<uuid>
```

永久删除不加 `--yes` 会拒绝执行；软删除不需要，因为它可逆。

## 工作原理

### 移入回收站

| 步骤 | 动作 | 为什么是这个顺序 |
|---|---|---|
| 1 | `archiveSession(id, { stopActivity: true })` | 立刻从所有界面隐藏、停掉在跑的回合、`ArchivedSessionGate` 拦住后续唤醒 |
| 2 | `rename` `<sessions-root>/…/session-<uuid>/` → `<home>/session-trash/<project>/session-<uuid>/` | 同卷所以是瞬时原子操作；根在另一个卷时退回复制 + 删除（`EXDEV`） |
| 3 | 改写 `storages/workspace.json` | 从 `sessionIds` 摘掉，侧栏行不会自己冒回来；留 `.bak-<时间戳>` |
| 4 | 追加 `<home>/session-trash/index.json` | 记住标题、cwd、大小、删除时间，不用解一帧 zstd |

### 回收站的布局

```
~/.dsh/
├── sessions/                      # 活着的会话
│   └── <project>/session-<uuid>/
└── session-trash/                 # 你删掉的一切
    ├── index.json                 # 标题、cwd、大小、时间
    └── <project>/session-<uuid>/  # 目录原样保留
```

目录树才是真相：清单里没有的目录也会被列出（标题先用 id），清单里有但目录没了的行会被报成 missing，而不是假装还在。

恢复会把第 2–3 步反过来，并在注册表支持时用 `insertSessionBefore` 让行立刻回到侧栏。永久删除——只能从回收站里发起——才真正 unlink 目录、删清单行、清投影缓存。

### 为什么这一行自己画

宿主渲染「全局面板」的行时是 `[glyph][title]` 两段：`glyph` 由 `sidebar.panellist` 的占位者决定，`title` 由宿主用注册时的 `label` 投影。也就是说，「名称之后」的位置不归占位者管，只能靠 `label` 变出来。

所以这一行把**图标、名称、数量**全都画在 glyph 里，再用一条只作用于本行的样式规则把这些隐藏掉宿主重复渲染的那个 `title`：

```css
button[aria-label="回收站"] > span[aria-hidden="true"] + span,
button[aria-label="Trash"]   > span[aria-hidden="true"] + span { display: none !important }
```

选择器只锚在两样自己控制的东西上——注册时给的确切 `aria-label`，以及宿主加在 glyph 上的 `aria-hidden`——所以不会误伤别的行；`aria-label` 本身保留，读屏和轨道模式的 tooltip 仍然是「回收站」。

### 接口

`POST /delete-chat/api/{trash,trashList,restore,purge,empty}`，外加 `{list,preview,delete}`（`delete` 是一次性永久删除，留给脚本）。全部走宿主自己的 `connection.requestRejection` 同源围栏，`sessionId` 在到达 `join()`/`rm()` 之前就过白名单。

## 删失败了怎么办

| 失败在哪 | 你会看到 | 实际状态 |
|---|---|---|
| 宿主调用本身失败 | 弹窗进入 `error` 阶段、红框 | 什么都没写 |
| 目录搬不动（Windows 上被别的进程占着） | 弹窗报错带 `EBUSY`/`EPERM` | 归档已经生效；目录还在 sessions 根里，取消归档就回来了 |
| 搬成功了但 `workspace.json` 改写失败 | 回收站里有这条，侧栏可能还留着 | 文件在回收站里安全；恢复它，或手动清掉那条陈旧引用 |
| 永久删除 unlink 失败 | 面板列出路径 + 原因，并显示「N 项失败」 | 其它选中项已删；失败那条仍在列表里 |
| 恢复搬不回去 | 「N 项失败」带路径 | 目录还在回收站，没有半途而废的中间态 |

按顺序试：

1. **恢复**——回收站里的任何一条都能一键回来，这就是它的意义。
2. **重试**——弹窗和面板都是幂等的：排除原因（关掉占用、退出同步盘）后再点一次。
3. **命令行兜底**——先退出 DSH，占住目录的锁通常就是宿主自己的句柄。`dsh-delete-chat --trash | --restore | --purge --yes`。
4. **回滚存储**——每次改写都在旁边留了 `workspace.json.bak-<时间戳>`。

## 平台支持

| | Windows | macOS | Linux |
|---|---|---|---|
| 插件本体（宿主 + 客户端两半） | ✅ 本地实测 | ✅ CI `macos-latest` | ✅ CI `ubuntu-latest` |
| 安装器（`scripts/install.mjs` + 两个封装） | ✅ 本地实测 | ✅ 同一套测试 | ✅ 同一套测试 |
| 目录被别的进程占着 | 拒绝（`EBUSY`）→ 如实报告 + 给兜底命令 | 直接搬走（POSIX `unlink`） | 直接搬走（POSIX `unlink`） |
| sessions 根经过符号链接（macOS `tmpdir` 的形态） | 不适用 | ✅ 已覆盖 | ✅ 已覆盖 |
| 路径推导 | 盘符根 | POSIX 根 | POSIX 根 |

Windows 与 POSIX 的断言写在同一个文件（`test/platform.test.mjs`）里，且互斥：不属于当前系统的分支会**带原因跳过**，所以一个系统上跑绿不能冒充另一个系统也绿。`npm test` 共 80 项。

用户真正会碰到的平台差异只有第三行：Windows 上被别的进程占着的目录搬不动，弹窗会报 `EBUSY`，兜底命令是退出 DSH 后 `dsh-delete-chat --trash <id>`；macOS 和 Linux 上同一次搬动直接成功。

## 已知边界

- **回收站不是系统回收站**：它在 `<DSH home>/session-trash`，手动删掉这个目录等于绕过所有确认的永久删除。
- **恢复可能要重启**：注册表暴露 `insertSessionBefore` 时行会立刻回来；没有这个动作时目录已经恢复，行要等下次启动才出现。
- **不级联**：被删会话的子代理与分叉子会话各自独立存在，它们的 `parent_session` 会悬空。
- **附件不动**：`~/.dsh/attachments/v1/objects` 是内容寻址、跨会话共享的，软删和永久删都不动别的会话还在引用的对象。
- **内存对象残留**：`sessions` 服务只暴露 `create`/`get`/`list`，所以被移入回收站的会话对象要到重启才消失；归档期间它不跑任何模型步。

## 开发

```bash
npm test                 # 80 项：宿主逻辑、回收站、HTTP、客户端、平台矩阵、安装器
npm run pack             # release/dsh-delete-chat-<version>.tgz
npm run market-index     # 用当前 HEAD 重新生成 market/index.json
npm run rename-owner --  <github-user> [display-name]
```

所有测试都跑在 `mkdtemp` 出来的假 DSH home 与假 ctx 上，不需要 DSH 在跑，也不碰真实数据。客户端那套用假 React 真渲染组件，断言读的是用户能看到的文字。

## 许可

[MIT](LICENSE)。收录 ≠ 背书：这是第三方代码，请只安装你信任的来源。
