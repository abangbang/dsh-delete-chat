# 发布与上架

三条独立的通道，可以只走一条，也可以全走。

---

## 0. 先换掉占位符

仓库里所有 `YOUR_GITHUB_USER` / `YOUR_NAME` 由一条命令统一替换：

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

[dshmarket](https://github.com/dsh-market/dshmarket) 的插件列表来自精选列表
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)——想让插件出现在
公共市场，去那边提 PR，**不要往 dshmarket 仓库提插件条目**。站点与市场会自动收录，通常一天内生效。

提 PR 时：

1. fork `awesome-dsh-plugin`，在插件列表里加一条，**格式照抄相邻条目**（不要自创格式）；
2. 一条 PR 只加一个插件；
3. PR 描述写清：插件名、一句话用途、仓库地址、支持的 DSH 版本（本包 `dshTarget` 是 `0.2.1-rc.2`）。

PR 描述模板：

```markdown
### 新增插件：dsh-delete-chat

- 仓库：https://github.com/<user>/dsh-delete-chat
- 用途：给 DSH 补上真正的会话删除（归档 → 删目录 → 摘工作区记账 → 清投影缓存），
  会话行「⋯」菜单里的破坏性操作，带确认与逐项结果报告。
- 插件类型：host + client（`dsh.bundle.patch` + `dsh.client`）
- 目标宿主：dshTarget 0.2.1-rc.2（engines.dsh >=0.2.0-0）
- 安装：`dsh plugin add https://github.com/<user>/dsh-delete-chat/archive/refs/heads/main.tar.gz`
- 许可：MIT
- 是否含可执行二进制：否，纯 ESM
```

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
