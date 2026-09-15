# 发布指引 / Publishing

怎么把这个仓库推到公开 GitHub，让它被各个 DSH 插件市场收录。

How to get this repository onto public GitHub so the DSH marketplaces pick it up.

---

## 短版 / The short version

所有 DSH 插件市场（dsh.market、dsh-plugin.org、dsh.so、dshpluginhub.ai、awesome-dsh-plugin……）**共用同一套发现机制：GitHub 仓库加 `dsh-plugin` topic，定时任务每日扫描。**

没有人工投稿，没有审核费，没有必须填的表单。

**唯一必须做对的一步就是加 topic。** 漏了它，仓库再规范也不会被任何市场识别。

Every DSH marketplace uses the same mechanism: a public GitHub repo carrying the `dsh-plugin` topic, swept daily by a crawler. No submission, no fee. The topic is the one step that matters.

---

## 第 0 步：替换占位符 / Step 0 — replace the placeholders

四处的 `YOUR-GITHUB-USERNAME` / `<COPYRIGHT HOLDER>` 要换成你自己。

There are four to replace.

| 文件 | 内容 |
| --- | --- |
| `package.json` | `author`、`repository.url`、`homepage`、`bugs.url` |
| `README.md` | 安装命令里的 `github:YOUR-GITHUB-USERNAME/...` |
| `LICENSE` | `Copyright (c) 2026 <COPYRIGHT HOLDER>` |

```bash
# 换成你的 GitHub 用户名
OWNER=your-github-name

sed -i "s/YOUR-GITHUB-USERNAME/$OWNER/g" package.json README.md
sed -i "s/<COPYRIGHT HOLDER>/$OWNER/" LICENSE

grep -rn "YOUR-GITHUB-USERNAME\|COPYRIGHT HOLDER" . --exclude-dir=.git   # 应该没有输出
```

---

## 第 1 步：建仓库推上去 / Step 1 — create and push

本地已经 `git init` 并提交好了（`main` 分支）。

### 装了 `gh`

```bash
gh repo create dsh-web-search-nokey --public --source=. --push \
  --description "Keyless web search for DeepSeek Harness — for credits-based setups where web_search otherwise 401s forever"

gh repo edit --add-topic dsh-plugin --add-topic deepseek-harness \
  --add-topic web-search --add-topic no-api-key
```

### 用网页

1. 打开 <https://github.com/new>
2. 仓库名 `dsh-web-search-nokey`，**Public**，**不要**勾任何初始化选项（本地已经有 README/LICENSE 了）
3. 然后：

```bash
git remote add origin https://github.com/<你的用户名>/dsh-web-search-nokey.git
git push -u origin main
```

4. 进仓库页面，右侧 **About** 旁边的齿轮 → **Topics**，填：

```
dsh-plugin
deepseek-harness
web-search
no-api-key
trae
workbuddy
```

**`dsh-plugin` 是必须的那个。** 其余只是给人看的分类线索。

> 推送慢或失败，先确认代理在跑（`netstat -ano | findstr :7897`），再
> `git config --global http.proxy http://127.0.0.1:7897`（用完 `--unset`）。

---

## 第 2 步：等扫描 / Step 2 — wait for the sweep

- 各市场的抓取任务每天跑一遍
- 首次收录一般 24 小时内
- 新收录状态是 **unconfirmed**；社区手动验过兼容性才变 **verified**
- 之后 stars、更新时间、README 都会自动同步，不用重新提交

想确认收没收到，直接在各市场站内搜 `dsh-web-search-nokey`。

---

## 扫描器会看的四件事 / What the crawler checks

- [x] 仓库公开
- [ ] **Topics 含 `dsh-plugin`** ← 只有这步要你操作
- [x] README 里有可复制的安装命令
- [x] 模块导出 `apply(ctx)`
- [x] 没有 `prepare` / `postinstall` 脚本 —— 纯 JS，装的时候不跑任何构建

最后一条是有用的。有些市场用 `pnpm add --ignore-scripts` 装，碰到需要跑构建脚本的插件会拒绝一键安装、要你逐字审脚本再手动同意。这个包没有构建步骤，所以是干净的一键安装项。

Worth knowing: some markets install with `pnpm add --ignore-scripts` and refuse one-click install for plugins that need a build script. This package has no build step, so it installs cleanly.

---

## 可选：发 npm / Optional — publish to npm

不必需，`github:` 规格已经能装。发 npm 只是安装命令更短。

```bash
npm publish --access public
```

之后安装命令变成 `dsh plugin --profile web add dsh-web-search-nokey`。

---

## 发布前自查 / Before you push

```bash
npm run smoke                                                # 模块契约 + 补丁一致性 + 一次联网真查
cd ~/.dsh/profiles/web && node <repo>/test/with-seam.mjs     # 真实 seam 集成
npx pnpm pack                                                # 看 files 白名单，确认 tgz 内容
```

**另外，改完插件源码后记得重装**，否则跑的还是旧的那份：

```bash
cd <repo> && npx pnpm pack
dsh plugin --profile web add ./dsh-web-search-nokey-1.0.0.tgz
```

这一点很关键：插件是从 tarball 解包装进 profile 的，改源码不会自动同步。想省事就改成 `link:`——但 pnpm 的 `link:` 在 Windows 上会把路径按相对目录解释，造出坏链接，不建议。

The installed copy is extracted from a tarball, so editing the source does nothing until you repack and reinstall. Do not reach for `link:` as a shortcut — on Windows pnpm resolves it relative to the project directory and creates a broken symlink.
