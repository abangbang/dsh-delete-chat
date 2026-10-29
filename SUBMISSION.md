# 发布与上架

三条独立的通道，可以只走一条，也可以全走。

---

## 0. 先换掉占位符

仓库里所有 `abangbang` / `abangbang` 由一条命令统一替换：

```bash
npm run rename-owner --  <你的GitHub用户名> "<显示名>"
```

它会改掉 `package.json` 的 `repository` / `homepage` / `bugs` / `author` / `dsh.install`、
两个 README、`market/index.json`、`SUBMISSION.md` 和 `LICENSE`。跑完 `git diff` 确认一遍。

---

## 1. 推到 GitHub

```bash
git init -b main
git add -A
git commit -m "feat: dsh-delete-chat 0.1.0"
git remote add origin https://github.com/<user>/dsh-delete-chat.git
git push -u origin main
```

推完重新生成索引（索引里钉的是 40 位 commit，必须指到真实提交）：

```bash
npm run market-index      # 写 market/index.json
git add market/index.json
git commit -m "chore: pin market index to HEAD"
git push
```

仓库设置里打开 **Issues**（`package.json` 的 `bugs` 指向它）。`docs/banner.svg` 不需要任何构建，
GitHub 会直接渲染。

---

## 2. 通道 A：自托管索引源（最快，无需任何人批准）

索引 `market/index.json` 是宿主认可的 **format 1** 格式，用 jsDelivr 直接读 GitHub 就行：

```
https://cdn.jsdelivr.net/gh/<user>/dsh-delete-chat@main/market/index.json
```

在宿主里 **设置 → 插件 → 发现 → 索引源** 添加这一行，插件立刻出现在发现页，带图标、
中英标题、双语描述、分类与 `destructive` 标签。

> 索引里的 `icon` 写的是相对路径 `../icon.svg`，解析基准是索引自身 URL，所以必须用能吃整个
> 仓库的静态源（jsDelivr / GitHub Pages）。换成只暴露单个文件的源，图标会 404。
>
> 也可以用 GitHub Pages 托管：Settings → Pages → Source: `main` / `/docs`，然后把索引放进
> `docs/`；或者保持 `market/` 并选 root。

**发行新版本时**：改 `package.json` 的 `version` → `npm run market-index` → 提交推送。
索引里 `publishTimestamp` 和 `source.commit` 都会跟着更新。

---

## 3. 通道 B：收录进社区市场（awesome-dsh-plugin）

[dsh-market](https://github.com/dsh-market/dsh-market) 的插件列表来自精选列表
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)——想让插件出现在
公共市场，去那边提 PR，**不要往 dsh-market 仓库提插件条目**。列表数据只有 `data/plugins/*.yml`，
两个 README 由脚本生成，**不要手工编辑 README**。

规则全文见 [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)。
一个 PR 只加一个文件，文件名叫 `data/plugins/<owner>__<repo>.yml`：

```yaml
url: https://github.com/<user>/dsh-delete-chat
name: <user>/dsh-delete-chat
category: session
icon: https://raw.githubusercontent.com/<user>/dsh-delete-chat/main/assets/icon-180.png
description:
  en: 'Real session deletion for DSH: "Delete chat" in a session row moves its directory into ~/.dsh/session-trash, a Trash page in the sidebar lists, filters, restores and permanently deletes from there, and a CLI exposes the same verbs without the GUI.'
  zh: '给 DSH 补上真正的会话删除：「⋯」菜单里的 Delete chat 把目录移进 ~/.dsh/session-trash，侧栏回收站页面负责筛选、恢复与永久删除，另有 CLI 做同样的事。'
# 可选：发了 GitHub Release 之后再填，资产名必须不带版本号
# tarball: https://github.com/<user>/dsh-delete-chat/releases/latest/download/dsh-delete-chat.tgz
```

提交前逐条自查（CI 会查的形式项在前，维护者会读的在后）：

| 项 | 本仓库状态 |
|---|---|
| `package.json` 声明 `dsh.bundle`（不只是 `dsh.client`） | ✅ `bundle.patch` → `cordis.patch.yml` |
| 仓库创建满 1 天 | ⏳ 由 CI 自动复检，**不要重开 PR**，时间到会自己变绿 |
| 仓库加了 `dsh-plugin` topic | ⬜ 需在仓库页 About 里手动加 |
| 描述属实、不带营销词、以句号结尾 | ✅ 逐条对过代码 |
| 分类贴合功能 | ✅ `session`（会话管理） |
| 可选：`screenshots.json` 声明截图 | ✅ 仓库根目录，指向 `docs/screenshots/*.png` |
| 可选：GitHub 托管的位图图标 | ✅ `assets/icon-180.png`（`icon.svg` 不被接受） |
| 可选：`tarball` 指向 Release 资产 | ⏳ 先发 Release，再按需补这一行 |

流程：

```bash
# 1. fork + clone（或用 Desktop\awesome-dsh-plugin 这份现成的 clone）
git clone https://github.com/<user>/awesome-dsh-plugin.git
cd awesome-dsh-plugin
git checkout -b add-dsh-delete-chat

# 2. 只加这一个文件，扩展名必须是 .yml，位置必须正好是 data/plugins/ 一层
cat > data/plugins/<user>__dsh-delete-chat.yml <<'YAML'
…上面那段 YAML…
YAML

# 3. 只提交这个文件。README 不要动，main 上会自动重新生成
git add data/plugins/<user>__dsh-delete-chat.yml
git commit -m "Add <user>/dsh-delete-chat"
git push -u origin add-dsh-delete-chat
```

然后在 GitHub 上发 PR。PR 描述：

```markdown
### 新增插件：dsh-delete-chat

- 仓库：https://github.com/<user>/dsh-delete-chat
- 用途：给 DSH 补上真正的会话删除——会话行「⋯」里的 Delete chat 把目录 rename 进
  `~/.dsh/session-trash`，侧栏回收站页面可筛选、恢复、永久删除、清空，
  每个动作先确认再落盘，并逐项报告结果；另有 CLI 走同一套逻辑。
- 插件类型：host + client（`dsh.bundle.patch` + `dsh.client`）
- 目标宿主：`dshTarget` 0.2.1-rc.2
- 安装：`dsh plugin add github:<user>/dsh-delete-chat`
- 许可：MIT，纯 ESM，无二进制
```

几个已知的坑，别踩：

- **不要手工编辑 `README.md` / `README.zh.md`**。它们由 `data/plugins/*.yml` 生成，PR 里带了不匹配的生成结果会被 `READMEs match data/plugins` 挡下；改条目只改你自己的 yml。
- **只动自己那一条**。PR 若顺手改了别人的条目，gate 会把被改动的每一个条目列出来让你解释。
- 文件位置/扩展名错了会被静默忽略（`readEntries()` 只 glob `data/plugins/*.yml`），CI 有专门的检查会喊住你。
- 描述里出现 `: `（冒号加空格）必须加引号，否则 YAML 解析失败。
- 仓库年龄不够时 gate 会红，但 `regate.yml` 每 6 小时自己重跑，**不需要推空提交、不需要重开 PR**。
- 被打 `held: author` 标签不等于拒绝：把修改推到同一分支，留一条评论说明改了什么，然后等人复评。

---

## 4. 通道 C：发布到 npm

包名 `dsh-delete-chat` 目前未被占用（提交前用 `npm view dsh-delete-chat version` 确认；
被占用就改成 `@<user>/dsh-delete-chat`，同时改 `name` 与索引）。

```bash
npm login
npm publish            # publishConfig.access 已是 public
```

发布后把索引切成 npm 源（索引的 `source` 只接受 `npm` 或 `git`）：

```bash
npm run market-index --  --source npm
git add market/index.json && git commit -m "chore: market index → npm" && git push
```

npm 源的好处是更新检测走得通（市场按 npm 版本比对），tarball 安装没法自动更新。

---

## 5. 发 GitHub Release（可选，但推荐）

```bash
npm run pack           # 产出 release/dsh-delete-chat-0.1.0.tgz（自带 sha256）
```

打 tag 推上去，`.github/workflows/release.yml` 会自动打包并把 `.tgz` 挂到 Release：

```bash
git tag v0.1.0
git push origin v0.1.0
```

Release 附件可以直接喂给 `dsh plugin add <url>`，不依赖 npm 也不需要索引。
