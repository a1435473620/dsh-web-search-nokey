# 发布指引 / Publishing

这份文档只讲一件事：怎么把这个仓库推到公开 GitHub，并让它被各个 DSH 插件市场收录。

This file covers one thing: getting this repository onto public GitHub so the DSH plugin
marketplaces pick it up.

---

## 先说结论 / The short version

所有 DSH 插件市场（dsh.market、dsh-plugin.org、dsh.so、dshpluginhub.ai、awesome-dsh-plugin ……）
**都用同一套发现机制：GitHub 仓库的 `dsh-plugin` topic，由定时任务每日扫描。**

没有人工投稿，没有审核费，没有需要提交的表单（个别站点有个 Submit 页，但那只是给扫描器补一个提示）。

**唯一必须做对的一步就是加 topic。** 漏了它，仓库再规范也不会被任何市场识别。

Every DSH marketplace uses the same discovery mechanism: a public GitHub repository carrying
the `dsh-plugin` topic, swept by a scheduled crawler. There is no manual submission and no fee.
Adding the topic is the one step that actually matters.

---

## 第 0 步：替换三处占位符 / Step 0 — replace the three placeholders

仓库里有三处 `YOUR-GITHUB-USERNAME` / `<COPYRIGHT HOLDER>` 需要换成你自己的：

There are three placeholders to replace:

| 文件              | 内容                                                  |
| ----------------- | ----------------------------------------------------- |
| `package.json`    | `author`、`repository.url`、`homepage`、`bugs.url`    |
| `README.md`       | 安装命令里的 `github:YOUR-GITHUB-USERNAME/...`         |
| `README.en.md`    | 同上                                                   |
| `LICENSE`         | `Copyright (c) 2026 <COPYRIGHT HOLDER>`                |

一次改完：

```bash
# 把 OWNER 换成你的 GitHub 用户名
OWNER=your-github-name

sed -i "s/YOUR-GITHUB-USERNAME/$OWNER/g" package.json README.md README.en.md
sed -i "s/<COPYRIGHT HOLDER>/$OWNER/" LICENSE

grep -rn "YOUR-GITHUB-USERNAME\|COPYRIGHT HOLDER" . --exclude-dir=.git   # 应该没有任何输出
```

---

## 第 1 步：建仓库并推上去 / Step 1 — create and push

本地已经初始化好并提交了（`main` 分支，一个 commit）。

### 路线 A：装了 `gh`

```bash
gh repo create dsh-web-search-nokey --public --source=. --push --description "Keyless web search provider for DeepSeek Harness — for credits-based setups where web_search otherwise 401s forever"
gh repo edit --add-topic dsh-plugin --add-topic deepseek-harness --add-topic web-search --add-topic no-api-key
```

### 路线 B：网页建库

1. 打开 <https://github.com/new>
2. 仓库名 `dsh-web-search-nokey`，**Public**，**不要**勾选任何初始化选项（README/.gitignore/LICENSE 都不要，本地已经有了）
3. 按页面提示推上去：

```bash
git remote add origin https://github.com/<你的用户名>/dsh-web-search-nokey.git
git push -u origin main
```

4. 建完仓库后在仓库页面右侧 **About** 旁的齿轮里，**Topics** 填入：

```
dsh-plugin
deepseek-harness
web-search
no-api-key
trae
workbuddy
```

**`dsh-plugin` 是必须的那个，一个都不能少。** 其余是给人看的分类线索。

> 推送慢或失败的话，先确认代理在跑（`netstat -ano | findstr :7897`），再
> `git config --global http.proxy http://127.0.0.1:7897`（用完记得 `--unset`）。

---

## 第 2 步：等扫描 / Step 2 — wait for the sweep

加完 topic 之后：

- 各市场的抓取任务每天跑一遍（多数是 GitHub Actions）
- 首次收录通常 24 小时内；dsh.market 首页写着"每日自动扫描 GitHub 生态"
- 新收录状态是 **unconfirmed**（自动发现、未经人工核验）。社区手动验过兼容性和可用性之后才变 **verified**
- 之后 stars / 最后更新时间 / README 都会自动同步，**不需要重新提交**

想验证有没有被收，直接在各市场站内搜包名 `dsh-web-search-nokey`。

---

## 扫描器会看的四件事 / What the crawler checks

对照这个仓库逐条确认过：

- [x] 仓库公开
- [ ] **Topics 含 `dsh-plugin`** ← 只有这一步需要你操作
- [x] README 里有可复制的安装命令（`dsh plugin --profile web add github:...`）
- [x] 模块导出 `apply(ctx)` 插件入口（`lib/index.js`）
- [x] 无 `prepare` / `postinstall` 生命周期脚本 —— 纯 JS，安装时不执行任何构建

最后一条值得说一句。有些市场用 `pnpm add --ignore-scripts` 安装，遇到需要跑构建脚本的插件会拒绝一键安装、要你逐个逐字审脚本再手动同意。这个包没有构建步骤（没有 TypeScript、没有打包器），所以它是干净的一键安装项。

---

## 可选：发到 npm / Optional — publish to npm

不必需。`github:` 规格已经能装。发 npm 的好处是安装命令更短、有版本号可锁。

```bash
npm publish --access public
```

之后安装变成：

```bash
dsh plugin --profile web add dsh-web-search-nokey
```

发之前确认 `package.json` 的 `repository` / `homepage` 已填对，npm 页面上会显示。

---

## 发布前自查 / Pre-publish checklist

```bash
npm run smoke                          # 模块契约 + 补丁一致性 + 一次联网真查
cd ~/.dsh/profiles/web && node <repo>/test/with-seam.mjs   # 真实 seam 集成
npx pnpm pack                          # 检查 files 白名单，确认 tgz 里该有的都在
git status                             # 应为 clean
```

README 是别人决定装不装的唯一依据。这个仓库的中英文 README 里已经写了：装完会发生什么、真实耗时数据、补丁为什么必须存在、以及一堆已知限制 —— 市场页面只展示仓库 description 和 README，所以这部分直接决定收录后的转化。
