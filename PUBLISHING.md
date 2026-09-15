# 发布指引 / Publishing

怎么把这个仓库推到公开 GitHub，并让各个 DSH 插件市场收录它。

How to get this repository onto public GitHub so the DSH marketplaces pick it up.

---

## 短版 / The short version

所有 DSH 插件市场（dsh.market、dsh-plugin.org、dsh.so、dshpluginhub.ai、awesome-dsh-plugin……）**共用同一套发现机制：GitHub 仓库加 `dsh-plugin` topic，定时任务每日扫描。**

没有人工投稿，没有审核费，没有必须填的表单。**唯一必须做对的一步就是加 topic。**

Every DSH marketplace uses the same mechanism: a public GitHub repo carrying the `dsh-plugin` topic, swept daily by a crawler. No submission, no fee. The topic is the one step that matters.

---

## 第 0 步：替换占位符 / Step 0 — replace the placeholders

**这个仓库已经填好了**（owner 是 `a1435473620`，没有残留占位符）。这一节是给 fork 或改名的人用的。

占位符一共 7 处：`package.json` 4 处、`README.md` 1 处、`README.en.md` 1 处、`LICENSE` 1 处。有一个脚本一次改完：

```bash
node <path-to>/prepare-push.mjs <你的GitHub用户名>
```

Windows 上直接双击 `PREPARE-PUSH.cmd` 也行，会提示你输入用户名。

不改的话 README 里的安装命令是坏的，而市场扫描器会检查"README 里有可复制的安装命令"这一条。

`PUBLISHING.md` 本身不参与替换 —— 它就是讲这件事的，里面的占位符是示例。

Already done in this repo. The script is for forks and renames. Until it runs, the install command in the README is broken and the crawler's "README contains a copyable install command" check fails.

---

## 第 1 步：建仓库推上去 / Step 1 — create and push

本地已经 `git init` 过并提交好了（`main` 分支）。

先在 <https://github.com/new> 建一个**空的公开仓库**，名字 `dsh-web-search-nokey`。
**不要勾选** README / .gitignore / LICENSE —— 本地已经有了，勾了会冲突。

### 用 TortoiseGit

1. 打开 `D:\BugBounty\_work\dsh-web-search-nokey`，在文件夹空白处右键
2. **TortoiseGit → 设置（Settings）→ Git → 远端（Remote）**
   - 名称：`origin`
   - URL：`https://github.com/<你的用户名>/dsh-web-search-nokey.git`
   - 保存
3. 回到文件夹右键 → **TortoiseGit → 推送（Push）**
   - 远端选 `origin`，本地分支 `main`
   - 确定
4. 首次会弹 GitHub 认证，登录一次即可

（也可以在推送对话框里点远端下拉框旁边的"管理…"直接加远端，效果一样。）

### 用命令行

```bash
git remote add origin https://github.com/<你的用户名>/dsh-web-search-nokey.git
git push -u origin main
```

> 推送慢或失败，先确认代理在跑（`netstat -ano | findstr :7897`），再
> `git config --global http.proxy http://127.0.0.1:7897`（用完记得 `--unset`）。

---

## 第 2 步：加 topic / Step 2 — add the topic

**TortoiseGit 做不了这步，必须在 GitHub 网页上操作。**

进仓库页面 → 右侧 **About** 旁边的齿轮 → **Topics**，填：

```
dsh-plugin
deepseek-harness
web-search
no-api-key
trae
workbuddy
```

`dsh-plugin` 是必须的那个，其余只是分类线索。**漏了它，仓库再规范也不会被任何市场扫到。**

This one has no shortcut. It is the only thing the crawlers look at.

---

## 第 3 步：等扫描 / Step 3 — wait

- 各市场抓取任务每天跑一遍，首次收录一般 24 小时内
- 新收录状态是 **unconfirmed**；社区手动验过兼容性才变 **verified**
- 之后 stars、更新时间、README 自动同步，不用重新提交

想确认收没收到，直接在各市场站内搜 `dsh-web-search-nokey`。

---

## 可选：发到 npm / Optional — publish to npm

不发也能装（`github:` 规格就够）。发 npm 的好处是安装命令更短、有版本号可锁。

包名 `dsh-web-search-nokey` 在 npm 上**没被占用**（已查，返回 404）。

```bash
npm login            # 浏览器登录一次，之后本机就有凭据了
npm publish --access public
```

发完之后安装命令从

```bash
dsh plugin --profile web add github:<user>/dsh-web-search-nokey
```

变成

```bash
dsh plugin --profile web add dsh-web-search-nokey
```

注意：**不是 `npm install -g`**。这是 dsh 的插件，要装进 profile 才有用，`dsh plugin` 会转发给 pnpm 装到 `<DSH_HOME>/profiles/web/`。

需要重新发布时，先改 `package.json` 的 `version` 再 `npm publish` —— npm 不允许覆盖已发布的版本号。

Note this is a dsh plugin, not a global CLI: `npm install -g` does nothing useful. `dsh plugin` forwards to pnpm and installs into the profile.

---

## 关于中英文 / About the two languages

**GitHub 没有 README 语言切换器这个功能。** 官方文档里关于多 README 只说了一句：它按 `.github` → 根目录 → `docs` 的顺序挑一个渲染，其余的一律不管。通篇没有 locale / 多语言 / 切换的任何说法。

所以你在别人仓库看到的「中文 · English」，都是**作者手写的一行链接**，不是 GitHub 给的 UI。

写法就一种，抄这个：

```markdown
[中文](#中文) · [English](#english)

## 中文

……中文内容……

## English

……English content……
```

要点：

- **一个 README.md 装两种语言**，分两个 `##` 区块，顶部一行锚点互跳。不是两份文件，也不是段落交替
- 锚点就是标题本身：`## 中文` → `#中文`，`## English` → `#english`
- 好处是只有一份文件要维护，而且读者挑完语言能线性读完，不用来回跳
- **共享的部分（比如 License）放在两个区块外面**，别抄两遍

GitHub has no README language switcher. The line people see on other repos is hand-written anchor links. One file, two `##` blocks, a link line at the top — that is the whole mechanism.

---

## 扫描器会看的四件事 / What the crawler checks

- [x] 仓库公开
- [ ] **Topics 含 `dsh-plugin`** ← 只有这步要你操作
- [x] README 里有可复制的安装命令
- [x] 模块导出 `apply(ctx)`
- [x] 没有 `prepare` / `postinstall` 脚本 —— 纯 JS，装的时候不跑构建

最后一条是有用的。有些市场用 `pnpm add --ignore-scripts` 装，碰到需要跑构建脚本的插件会拒绝一键安装、要你逐字审脚本再手动同意。这个包没有构建步骤，所以是干净的一键安装项。

---

## 改完插件代码之后 / After editing the plugin

**必须重新打包再重装**，否则跑的还是旧的那份 —— profile 里装的不是符号链接，是 tarball 解包出来的副本。

```bash
npx pnpm pack
dsh plugin --profile web add ./dsh-web-search-nokey-1.0.0.tgz
```

别用 `link:` 图省事：pnpm 在 Windows 上把它按"相对项目目录"解释，会造出指向 `<profile>/D:/...` 的坏符号链接。

---

## 发布前自查 / Before you push

```bash
npm run smoke                                            # 模块契约 + 补丁一致性 + 一次联网真查

cd ~/.dsh/profiles/web                                   # 需要已安装本插件
node <repo>/test/with-seam.mjs                           # 真实 ctx.web 选择
node <repo>/test/with-tool-layer.mjs                     # 真实 web_search 工具

npx pnpm pack                                            # 看 files 白名单
```
