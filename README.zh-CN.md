# dsh-delete-chat

[![ci](https://github.com/abangbang/dsh-delete-chat/actions/workflows/ci.yml/badge.svg)](https://github.com/abangbang/dsh-delete-chat/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![dsh](https://img.shields.io/badge/dsh-0.2.1--rc.2-555)

**删掉一个 DSH 会话，而不把它弄丢。**

DeepSeek Harness 只有「归档」：会话从列表消失，日志永远留在磁盘上。这个插件补上真正的删除，
但先给一层安全网——目录被**移进** `~/.dsh/session-trash`，侧栏多出一页回收站，只有你点了
「永久删除」并经二次确认，文件才会真的 unlink。

中文 | [English](README.md)

<p align="center">
  <img src="docs/banner.svg" alt="dsh-delete-chat" width="720">
</p>

## 为什么需要它

DSH 自己的两个包就把这个缺口写在了文档里：

> 「**不删除会话文件** —— 日志在 `root` 下累积，直到外部移除。seam **无删除接口**。」
> —— `@deepseek-ai/dsh-session-persistence-jsonl`

> 「移除项目会保留其文件夹、文件与会话历史……而**会话删除与文件夹移除是彼此独立且尚未提供的功能**。」
> —— `@deepseek-ai/dsh-workspace`

「删除工作区」只动列表，「归档」只做隐藏，于是 `~/.dsh/sessions` 只增不减。这个插件就是那把剪刀。

## 能做什么

| | |
|---|---|
| **软删除** | 会话行「⋯」→ 删除会话，把目录 `rename` 进 `~/.dsh/session-trash`。同卷移动，瞬时、原子、不复制一个字节 |
| **回收站是一整页** | 侧栏「全局面板」多一行「🗄 回收站 · 3」，点开是中间栏的整页（和「插件」管理页同级）：筛选、多选、恢复、永久删除、一键清空 |
| **每个动作都二次确认** | 恢复 / 永久删除 / 清空各弹一个确认框，写明条数、将释放的空间、是否可逆；点确认才动磁盘 |
| **每行都有详情** | 大小、回收站里的绝对路径、最后对话时间、删除时间（`YYYY-MM-DD HH:mm:ss`） |
| **不容易误删** | 「永久删除」只存在于回收站里，其它入口一律是可逆的软删除 |
| **跟随语言** | 文案读宿主语言（zh / en），菜单行、弹窗、整页都即时重渲染 |
| **两种布局** | 分项目 `<root>/<project>/session-<uuid>/` 与平铺 `<root>/session-<uuid>/` |
| **命令行** | `--trash` / `--trash-list` / `--restore` / `--purge --yes` / `--empty --yes`，界面没挂上也能用 |
| **自托管索引** | 自带 format 1 市场索引，加进 DSH 的「索引源」就是你的私有市场 |

## 安装

在 DSH 里直接说：

> 帮我安装 https://github.com/abangbang/dsh-delete-chat

装完**重启 DSH** 生效——插件树在启动时组装，客户端 bundle 也在启动时组合并带 `immutable` 缓存头，
刷新页面拿不到新的。

## 用法

### 删除

会话行 → **「⋯」→ 删除会话** → 确认。行从列表消失、在跑的回合被停，目录移进回收站：

```
状态      已移入回收站
占用空间   274.4 KB
```

什么都不会丢：这是一次 rename，在你动手之前一直可逆。

### 回收站

侧栏「全局面板」（工作区列表上方那排，`aria-label="全局面板"`）里多一行 **🗄 回收站 · 3**：

- 数量跟着这一行的文字色走，**0 时不显示**，超过 99 显示 `99+`；删完一条会话，数字立刻跟着变；
- 收起成 56px 轨道时省掉名称，只留图标和数量；
- 点开是**整页**，列出每个被删的会话：

```
alpha 会话
  大小        2.0 KB
  文件位置    ~/.dsh/session-trash/--proj--/session-…
  最后对话    2026-10-27 17:08:07      ← 日志文件的 mtime，rename 会保留
  删除时间    2026-10-29 09:02:03
```

这一页上的操作：

- **筛选**：按标题、目录或项目名实时过滤；
- **多选**：单条勾选或全选，底部显示已选数量；
- **恢复**：目录搬回原位 → 重新记账 → 取消归档；
- **永久删除 / 清空回收站**：只存在于这一页，而且都要过二次确认（写明条数、将释放的空间、无法恢复）。

恢复的确认按钮是琥珀色，只有删除类才是红色——颜色在这里是语义，不是装饰。

## 工作原理

### 移入回收站

| 步骤 | 动作 | 为什么是这个顺序 |
|---|---|---|
| 1 | `archiveSession(id, { stopActivity: true })` | 立刻从所有界面隐藏、停掉在跑的回合、`ArchivedSessionGate` 拦住后续唤醒 |
| 2 | `rename` `<sessions-root>/…/session-<uuid>/` → `<home>/session-trash/<project>/session-<uuid>/` | 同卷所以瞬时原子；根在另一个卷时退回复制 + 删除（`EXDEV`） |
| 3 | 改写 `storages/workspace.json` | 从 `sessionIds` 摘掉，侧栏行不会自己冒回来；旁边留 `.bak-<时间戳>` |
| 4 | 更新 `<home>/session-trash/index.json` | 记住标题、cwd、大小、最后活动时间、删除时间，不用解一帧 zstd |

### 回收站的布局

```
~/.dsh/
├── sessions/                      # 活着的会话
│   └── <project>/session-<uuid>/
└── session-trash/                 # 你删掉的一切
    ├── index.json                 # 标题、cwd、大小、时间
    └── <project>/session-<uuid>/  # 目录原样保留
```

**目录树才是真相**：清单里没有的目录也会被列出（标题先用 id），清单里有而目录没了的行会被报成
`missing`，而不是假装还在。

恢复会把第 2–3 步反过来，并在注册表支持时用 `insertSessionBefore` 让行立刻回到侧栏。永久删除
——只能从回收站里发起——才真正 unlink 目录、删清单行、清投影缓存。

## 删失败了怎么办

| 失败在哪 | 你会看到 | 实际状态 |
|---|---|---|
| 宿主调用本身失败 | 弹窗进入 `error` 阶段、红框 | 什么都没写 |
| 目录搬不动（Windows 上被别的进程占着） | 弹窗报错带 `EBUSY`/`EPERM` | 归档已经生效；目录还在 sessions 根里，取消归档就回来了 |
| 搬成功了但 `workspace.json` 改写失败 | 回收站里有这条，侧栏可能还留着 | 文件在回收站里安全；恢复它，或手动清掉那条陈旧引用 |
| 永久删除 unlink 失败 | 页面列出路径 + 原因，并显示「N 项失败」 | 其它选中项已删；失败那条仍在列表里 |
| 恢复搬不回去 | 「N 项失败」带路径 | 目录还在回收站，没有半途而废的中间态 |

按顺序试：

1. **恢复**——回收站里的任何一条都能一键回来，这就是它的意义。
2. **重试**——弹窗和页面都是幂等的：排除原因（关掉占用、退出同步盘）后再点一次。
3. **命令行兜底**——先退出 DSH，占住目录的锁通常就是宿主自己的句柄。`dsh-delete-chat --trash | --restore | --purge --yes`。
4. **回滚存储**——每次改写都在旁边留了 `workspace.json.bak-<时间戳>`。

## 已知边界

- **回收站不是系统回收站**：它在 `<DSH home>/session-trash`，手动删掉这个目录等于绕过所有确认的永久删除。
- **恢复可能要重启**：注册表暴露 `insertSessionBefore` 时行会立刻回来；没有这个动作时目录已经恢复，行要等下次启动。
- **不级联**：被删会话的子代理与分叉子会话各自独立存在，它们的 `parent_session` 会悬空。
- **附件不动**：`~/.dsh/attachments/v1/objects` 是内容寻址、跨会话共享的，软删和永久删都不动别的会话还在引用的对象。
- **内存对象残留**：`sessions` 服务只暴露 `create`/`get`/`list`，被移入回收站的会话对象要到重启才消失；归档期间它不跑任何模型步。

## 许可

[MIT](LICENSE)。收录 ≠ 背书：这是第三方代码，请只安装你信任的来源。
