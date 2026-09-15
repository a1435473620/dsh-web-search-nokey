# dsh-web-search-nokey

给 DeepSeek Harness（dsh）加一个**不需要任何 API key** 的搜索后端。

English: [README.en.md](README.en.md)

---

## 这是在解决什么

如果你的 dsh 聊天模型是从积分通道接进来的 —— Trae 的积分、WorkBuddy 的积分，或者别的什么连接器 —— 你大概见过这一幕：

```
DeepSeek API error (HTTP 401): Authentication Fails, Your api key: ****1b24 is invalid

The web search request used endpoint "https://api.deepseek.com/anthropic/v1/messages".
Search endpoint configuration is separate from chat.
```

聊天好得很，只有 `web_search` 挂。原因不复杂，但很反直觉：**dsh 的聊天和搜索是两条完全独立的链路。**

|          | 聊天                       | 搜索                                       |
| -------- | -------------------------- | ------------------------------------------ |
| 走谁     | 你的连接器插件             | `@deepseek-ai/dsh-web-search-deepseek`     |
| 端点     | 连接器自己的服务           | `https://api.deepseek.com/anthropic/v1` + `/messages` |
| 凭据来源 | 连接器的授权               | **只有 `DEEPSEEK_API_KEY`**                |

搜索那个 provider 是内置的，它只认一把钥匙。它自己的源码里还专门留了句注释，说明连 base URL 都不复用：

> This is NOT the chat-completions base (`https://api.deepseek.com`) `@deepseek-ai/dsh-llm-deepseek` uses, so this provider does NOT reuse `$DEEPSEEK_BASE_URL` — only the API key is shared.

所以：**只要手里没有一把有效的 DeepSeek key，官方搜索后端就是死的**，跟聊天顺不顺没关系。

两条出路 —— 弄把 key，或者换掉搜索后端。这个插件是第二条。

顺带一提，`web_fetch` 没被这件事波及。`dsh-web-fetch-http` 是匿名公开抓取器，源码里写着 `No credentials to check — an anonymous public fetcher is always usable`，它压根没有凭据这个环节。挂的只有 `web_search`。

---

## 它做什么

注册一个 `WebSearchProvider` 进 `ctx.web`，直接查公开搜索结果页，把结果整理成 seam 自己的 `WebSearchSource` 形状。

三个后端，按顺序降级，凑够条数就停：

| 后端        | 说明                                                         |
| ----------- | ------------------------------------------------------------ |
| `bing-rss`  | 首选。`&format=rss` 拿结构化 XML，不依赖 HTML 类名，改版也不怕。代价是条数少，通常 9 条左右 |
| `bing-html`  | 补条数。顺便能拿到结果页上的"3 天之前"这类时间行，RSS 没有    |
| `so360`     | 兜底。国内直连稳定                                           |

几条实现上的取舍：

- **引擎失败不中止**，记下来换下一个。"Bing 限流了"不该等于"搜索坏了"。只有全挂了才报错，报错里带上每个引擎的失败原因。
- **按 host + path 去重**，`?utm_source=` 和 `#anchor` 不会各占一个位置。
- **不编造日期。** Bing RSS 的 `<pubDate>` 是抓取日期不是发布日期，绝大多数结果都显示"今天"。把它当 `publishedAt` 传下去会让旧页面看着像新的，比不传更糟。所以只有结果页明确写了日期才填，其余留空。
- **不抓页面正文。** 那是 `web_fetch` 的活。这里只返回标题、链接和摘要。

实测（本机，直连，无代理）：

```
engines : bing-rss -> bing-html -> so360
took    : 200ms
sources : 8   truncated=false
```

---

## 安装

```bash
dsh plugin --profile web add github:YOUR-GITHUB-USERNAME/dsh-web-search-nokey
```

装完直接生效，不用改任何配置文件，也不用重启 —— `dsh plugin` 会把声明了 `dsh.bundle.patch` 的依赖自动追加进 profile 的 `dsh.profile.bundles`，位置排在 `@deepseek-ai/dsh-web-app` 之后，所以补丁层天然压过内置配置。

想确认装对了：

```bash
dsh --profile web --dump-config | grep -A4 "id: web$"
```

应该看到：

```yaml
# == @deepseek-ai/dsh-base, patched by dsh-web-search-nokey
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: dsh-web-search-nokey
    fetchProvider: http
```

卸载：

```bash
dsh plugin --profile web remove dsh-web-search-nokey
```

---

## 兼容性

| 项 | 值 |
| --- | --- |
| dsh | 在 `0.1.5-rc.2`（web profile）上实测 |
| Node | `^22.19.0 \|\| >=24.0.0`（跟 dsh 自己一致），实测 Node 24.19.0 与 22.22.2 |
| profile | `web`。`desktop` 也能装，同一套 bundle 机制 |
| 平台 | 实测 Windows。代码里没有平台相关分支 |

`apply(ctx)` 的签名是稳定的，但 dsh 还在 preview，`ctx` 上挂的能力会变。如果哪天 `ctx.web` 的接口动了，这个插件会以插件加载失败的形式报出来，不会静默降级。

---

## 为什么要打那个 patch

这一段是这个插件跟同类的真正差别，值得单独说。

dsh 的 provider 选择规则是这样的（`@deepseek-ai/dsh-web` 源码）：

```
未配置 id + 恰好一个可用 provider  → 用它
未配置 id + 多个可用 provider      → WEB_PROVIDER_AMBIGUOUS
配置了 id                          → 只用它
```

关键在于：内置的 `deepseek-official` 的 `available()` **永远返回 true**。

```js
available() {
  const options = this.resolveOptions();
  return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== void 0)
    && URL.canParse(options.baseURL)
    && isPositiveInteger(options.maxTokens)
    && isPositiveInteger(options.maxUses);
}
```

`resolveApiKey` 是个恒存在的闭包，所以 `||` 右半边永远是 true。它「有没有 key」这件事在 `available()` 里根本检测不出来 —— 一个没有 key 的部署里，它照样宣称自己可用。

于是：**一个只注册自己 provider、不去配置里写死 id 的插件，会让本来好用的搜索直接变成 AMBIGUOUS。** 装了比不装还糟。

这个插件的做法是在 `cordis.patch.yml` 里把 id 钉死：

```yaml
- id: web
  config:
    searchProvider: dsh-web-search-nokey
    fetchProvider: http
```

两个坑写在这里供参考：

1. **patch 是整块替换 `config`，不是合并。** 所以 `fetchProvider: http` 必须一起重写，漏了的话 fetch 就没有 provider 了。
2. **没有禁用 `web-search-deepseek`。** id 钉死之后它就已经是死代码了，留着的好处是你哪天弄到有效的 DeepSeek key，改这一行就能切回去。想要干净树的话，在 `cordis.patch.yml` 里加上 `- id: web-search-deepseek\n  disabled: true` 即可。

`test/with-seam.mjs` 里有专门复现这个坑的用例：注册完本插件后，再塞一个恒可用的 `deepseek-official` 进去，确认仍然选中本插件、没有歧义。

---

## 配置

都写在 profile 的 `cordis.patch.yml` 里，条目 `config` 下：

```yaml
- insert:
    - id: dsh-web-search-nokey
      name: dsh-web-search-nokey
      config:
        engines: [bing-rss, bing-html, so360]
        maxResults: 8
        timeoutMs: 12000
        proxy: http://127.0.0.1:7897
        userAgent: Mozilla/5.0 ...
```

| 字段        | 默认                          | 说明                                                   |
| ----------- | ----------------------------- | ------------------------------------------------------ |
| `engines`   | `[bing-rss, bing-html, so360]` | 顺序即降级顺序。填了不认识的 id 会被忽略；全都不认识则回退到默认值 |
| `maxResults` | `8`                          | 单次上限。seam 自己也会按请求再截一次                  |
| `timeoutMs` | `12000`                       | 单个上游请求超时                                        |
| `proxy`     | 空                            | HTTP 代理。留空时依次读 `HTTPS_PROXY` / `HTTP_PROXY`   |
| `userAgent` | 桌面版 Chrome UA              | 这些搜索页会拦裸客户端                                  |

环境变量可以覆盖同样几项，前缀 `DSH_WEB_SEARCH_NOKEY_`：`ENGINES`、`MAX_RESULTS`、`TIMEOUT_MS`、`PROXY`。代理这种通常属于环境事实而不是 profile 决策，所以两条路都留了。

Node 的 `fetch` 不读 `HTTP_PROXY`，所以代理是自己用 `net` + `tls` 手搓的 CONNECT 隧道实现的，没有额外依赖。

---

## 验证

```bash
npm run smoke                          # 直连 provider，含联网真查
node test/smoke.mjs "你的查询词"

cd ~/.dsh/profiles/web                 # 跑真实 seam 集成测试，需要已安装本插件
node <repo>/test/with-seam.mjs
```

`test/with-seam.mjs` 用的是真实 cordis `Context` 和真实 `WebRuntime`，走的是生产代码路径：

```
registered: dsh-web-search-nokey
ctx.web.search("DeepSeek Harness plugin") -> 3 sources in 216ms
providers now: dsh-web-search-nokey(true), deepseek-official(true)
pinned id still wins -> 1 source(s), no ambiguity
```

`test/smoke.mjs` 还会检查代码和 `cordis.patch.yml` 是否一致 —— 单边改名在加载期是静默的，只会在运行时表现为 `WEB_PROVIDER_CONFIGURED_MISSING`，很难查。

---

## 已知限制

- **日期大多为空。** 见上面的取舍。想要日期就得接受假日期，这里选的是不要。
- **Bing RSS 通常只给 9 条。** 所以要 `bing-html` 补第二条腿。
- **`so360` 的链接是 `/link?m=` 跳转壳**，真实落地页要点一下才出来。它只作兜底，主力结果不靠它。
- **这些是公开搜索页，不是官方 API。** 高频调用可能被限流。真被限了 `engines` 里换个国内引擎排前面即可。日志里会记 `engine=xxx failed`。
- **没有结果时返回空列表，不报错。** 搜不到是正常结果。
- **不缓存。** 每次调用都实打实发请求。
- 只在 Windows / Node 24 和 Node 22 上测过。代码里没有平台相关分支，但这是实测范围。

---

## 不做的事

- 不抓网页正文 —— `web_fetch` 已经干了，而且干得比这里好。
- 不生成答案或摘要 —— `content` 字段留空。Provider 生成的"答案"没有可信度，seam 的类型注释里也是这么建议的。
- 不要 key，也不要账号。这是全部意义所在。

---

## 许可

MIT，见 [LICENSE](LICENSE)。
