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
