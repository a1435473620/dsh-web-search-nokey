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

### 先看这个：`npm publish` 现在会 403

直接 `npm publish` 大概率返回：

```
npm error code E403
npm error 403 Forbidden - PUT https://registry.npmjs.org/<pkg>
npm error  Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

**这不是你的包有问题，是 npm 的强制策略**：发布必须满足 2FA。`npm login` 登录成功也没用 —— 交互式登录不会带 `bypass 2fa` 声明。

### 第 0 步：先查账号到底开没开 2FA

**这一步别跳。** 大概率你的账号根本没开 2FA，那样后面两条路都走不通，`--otp` 填任何值都没用（没有 2FA 就没有 OTP 可言）。

```bash
npm profile get
```

看这一行：

```
two-factor auth: disabled        ← 没开，先去开
two-factor auth: auth-only       ← 开了，--otp 可用
two-factor auth: auth-and-writes ← 开了，--otp 可用
```

**判断依据**：如果 `--otp` 填了值仍然返回 `E403`（而不是 `EOTP`），基本就是这个原因 —— npm 的 `otplease` 走了 OTP 流程但 registry 在策略层直接拒绝；如果真是验证码错，报的会是 `EOTP` 并提示你重输。

**先开 2FA**：<https://www.npmjs.com/settings/你的用户名/profile> → **Two-Factor Authentication** → **Enable 2FA**。
启用时选 **Authenticator app（TOTP）**，用 Google Authenticator / 1Password / Authy 扫二维码。

> **不要只绑安全密钥（WebAuthn）。** `--otp=` 需要一个人手能输的六位数字，硬件密钥产生不了这个码 —— 只绑硬件密钥的账号在终端里无法满足 2FA，只能走路线 B。
>
> 顺便把 recovery codes 存好。

开完之后，两条路选一条：

**路线 A：发布时带 OTP**（最简单，每次输一次码）

```bash
npm publish --access public --otp=你认证器App上当前的六位码
```

> 注意 `--otp=` 后面是**真实动态码**，不是 `123456` 这种示例数字。通常 30 秒一变，过期了重取一个。

> 注意：**WebAuthn 安全密钥不行**。`--otp` 要的是一个能手输的六位数字，硬件密钥产生不了这个码。账号只绑了安全钥匙的话，终端里没法满足 2FA，只能走路线 B。

**路线 B：Granular Access Token + 勾选 Bypass 2FA**（一次配好，之后免 OTP）

1. 直接开这个地址（比点菜单快）：
   <https://www.npmjs.com/settings/你的用户名/tokens/granular-access-tokens/new>
   或者：头像 → **Access Tokens** → **Generate New Token** → **Granular Access Token**
2. 填：

| 字段 | 填什么 |
| --- | --- |
| Token name | 随便，比如 `publish-dsh-web-search-nokey` |
| Description | 可选 |
| **Bypass two-factor authentication (2FA)** | **必须勾上** ← 默认是**不勾**的，忘了勾就会继续报 E403/EOTP |
| Allowed IP ranges | 留空（除非你固定在某个 IP 段发布） |
| **Packages and scopes → Permissions** | **`Read and write (publish and stage)`** |
| **Packages and scopes → Select Packages** | 见下面那条，**首次发布只能选 `All Packages`** |
| Organizations | 个人包不用管 |
| Expiration | 按需，比如 90 天 |

3. **Packages and scopes 这块在页面中部**，是两级控件：
   - 上面一个 **Permissions** 下拉（`No access` / `Read-only` / `Read and write (publish and stage)` / `Read and write (stage only)`）
   - 下面 **Select Packages** 二选一：**All Packages** 或 **Only select packages and scopes**；选后者会**再出现一个下拉菜单**，从里面挑具体包

   > **首次发布注意**：那个下拉菜单列的是**你账号已经有权限的包**。本包还没发布过（查过 registry，404），所以它**不在列表里**——你没法选中它。这种情况选 **`All Packages`**。等包发布过之后，如果你在意权限收窄，可以再建一个只限定到本包的 token。
   >
   > 另外 token 必须限定到你实际要发的包：用限定给 A 包的 token 去发 B 包，返回的 403 和 2FA 那个长得一模一样，极难排查。

4. 生成后**立刻复制**（只显示一次，`npm_` 开头），然后：

```bash
npm config set //registry.npmjs.org/:_authToken "刚复制的token"
npm publish --access public
```

> **首次发布其实更推荐路线 A。** Granular token 是为 CI 自动化设计的，首次发一个新包时它有上面那些"包还不存在"的边角情况；`--otp` 一个参数就绕过去了，不用跟 token 作用域纠缠。

**另外**：npm 已经公告，bypass-2FA token 的**直接发布能力将在 2027 年 1 月移除**，官方替代方案是基于 OIDC 的 trusted publishing（从 CI 发）。个人偶尔发一版的话，现在用哪种都行。

### 发完

安装命令从

```bash
dsh plugin --profile web add github:a1435473620/dsh-web-search-nokey
```

变成

```bash
dsh plugin --profile web add dsh-web-search-nokey
```

注意：**不是 `npm install -g`**。这是 dsh 的插件，要装进 profile 才有用，`dsh plugin` 会转发给 pnpm 装到 `<DSH_HOME>/profiles/web/`。

需要重新发布时，先改 `package.json` 的 `version` 再发 —— npm 不允许覆盖已发布的版本号。

npm now refuses to publish without 2FA. `npm login` alone is not enough — an interactive session carries no "bypass 2fa" claim. Either enable TOTP and pass `--otp=`, or create a Granular Access Token with the **Bypass 2FA** box ticked (it is unchecked by default) scoped to this package with Read and write.

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
