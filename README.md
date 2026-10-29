# dsh-web-search-nokey

[![GitHub stars](https://img.shields.io/github/stars/a1435473620/dsh-web-search-nokey?style=flat)](https://github.com/a1435473620/dsh-web-search-nokey)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

给 dsh 一个不用 API key 的搜索：七个站点按序兜底，跳转壳先展开成真实地址再交出去。

用 Trae 积分 / WorkBuddy 积分把模型接进 dsh 的人，大概率撞过这个：

```
DeepSeek API error (HTTP 401): Authentication Fails, Your api key: ****1b24 is invalid
```

聊天是好的，`web_search` 一直 401。装完这个插件就好了，不需要任何 key。

- **不用 key** —— 查询直接打公开搜索页，全程不碰 `DEEPSEEK_API_KEY`
- **七个站点** —— Bing / Google / Yandex / 百度 / 搜狗 / DuckDuckGo / 360，按顺序兜底，凑够条数就停
- **给模型真地址** —— 百度搜狗 360 的 `/link?url=`、Bing 的 `/ck/a` 在服务端就展开掉，模型不会落到中间页和广告上
- **直连 200–500ms** —— 不用等满八个引擎，Bing 命中就够了
- **一个依赖都没有** —— 纯 ESM，没有构建步骤，装的时候不跑脚本

[中文](#中文) · [English](#english)

## 中文

### 它修的是什么

dsh 里聊天和搜索不是一条路。聊天走你配置的连接器，搜索是另一个内置模块，只认 `DEEPSEEK_API_KEY`。你用积分跑模型，手里没有那把 key，搜索就永远是死的。

这个插件往 `ctx.web` 注册一个不用凭据的 `WebSearchProvider`，查询直接打公开搜索页，结果按 seam 的 source 格式交回去。

`web_fetch` 本来就没事。它是匿名抓取，压根没有凭据环节。

### 装

```
dsh plugin --profile web add github:a1435473620/dsh-web-search-nokey
```

装完就生效，不用改配置，也不用重启。不是 `npm install -g` —— 这是 dsh 插件，要装进 profile。

卸载：

```
dsh plugin --profile web remove dsh-web-search-nokey
```

### 包里那个 patch 别删

dsh 的搜索后端同一时间只能选一个。不显式指定，它会去数有几个能用的；内置那个后端永远说自己能用，两个一撞就是 `WEB_PROVIDER_AMBIGUOUS`，搜索反而彻底挂掉。

所以包里带了 `cordis.patch.yml`，把 `web.searchProvider` 写死成这个插件。删了它，插件本身还在，选择逻辑就乱了。

### 怎么用

直接用。`web_search` 会路由到这里。

默认八个 id、七个站点，按顺序兜底，条数够了就停：

```
Bing(RSS) → Bing(网页) → Google → Yandex → 百度 → 搜狗 → DuckDuckGo → 360
```

Bing 内部是两条腿；`bing`、`360`、`haosou`、`ddg` 都是别名，配置里写成站点名就行。

直连大约 200ms，返回 8 条带摘要的结果。一次真实调用长这样：

```text
> web_search "cordis plugin lifecycle"

3 条 · 502ms
1. Welcome to Cordis                    https://cordis.com/
2. 全文首发 deepseek harness 背后的秘密…   https://zhuanlan.zhihu.com/p/2071…
3. Cordis 教程 | DeepSeek Harness        https://deepseek-harness.github.io/…
```

### 重定向会先展开

百度、搜狗、360 给的常是 `/link?url=…` 跳转壳，Bing 给的是 `/ck/a?u=…`。这些壳会**先在服务端展开成真实地址**再返回。

理由很实际：把跳转壳丢给模型，模型会去 fetch 它，落到中间页上，而中间页往往就是广告。展开失败的直接丢弃，绝不下发——宁可少一条，也不给一条打不开的。

由 `resolveRedirects`（默认开）和 `maxResolve`（默认 5 条/次）控制。各站点的广告块（带“广告”“品牌推广”标记的）也在解析阶段就跳过。

### Google 与出口节点

Google 默认「有路才用」。插件在后台先探一次 `generate_204`，通了才把它排进这一轮，所以没有出口节点的机器不会为超时付钱。想强制打开就写 `google: on`。

### 配置

一般不用碰。要改就改 profile 里的 `cordis.patch.yml`。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `engines` | `bing-rss, bing-html, google, yandex, baidu, sogou, duckduckgo, so360` | 顺序即兜底顺序；支持 `bing`、`360`、`haosou`、`ddg` 别名 |
| `maxResults` | `8` | 单次上限 |
| `maxPerHost` | `3` | 同一站点最多占几条；`0` 关闭。八个槽位不该被一个论坛占满 |
| `timeoutMs` | `12000` | 单个上游请求超时 |
| `budgetMs` | `25000` | 一次搜索的总时间上限，防止多层超时叠加 |
| `google` | `auto` | `auto` 探测可达性 / `on` 强制 / `off` 关闭 |
| `probeTtlMs` | `600000` | 可达性结论与「验证码冷却」的有效期 |
| `resolveRedirects` | `true` | 展开跳转壳；关掉则直接丢弃壳 |
| `maxResolve` | `5` | 单次最多展开几条壳 |
| `freshness` | 空 | `day`/`week`/`month`/`year`，`7d`、`w` 这类写法也认；空表示不限时间 |
| `locale` | `auto` | `auto` 跟着查询的语言走，再退回 dsh 自己的界面语言；也可写死 `en-US` 之类 |
| `cacheTtlMs` | `300000` | 结果缓存时长；`0` 关闭 |
| `cacheMax` | `100` | 缓存条目上限，超出按最近最少使用淘汰 |
| `proxy` | 空 | 需要代理时填，例如 `http://127.0.0.1:7897` |
| `userAgent` | 桌面 Chrome | 这些搜索页会拦裸客户端 |

`freshness` 只有 Bing、Google、百度、搜狗、DuckDuckGo 认；Yandex 和 360 没有可用的无 JS 参数，宁可传空也不猜一个错的。

环境变量同样这几项，前缀 `DSH_WEB_SEARCH_NOKEY_`。`HTTPS_PROXY` / `HTTP_PROXY` 也认。

### 已知问题

站点是否可用，跟你的出口 IP 关系极大。2026-10 在一台大陆机器上实测：

| 站点 | 状态 |
| --- | --- |
| Bing | 稳，10 条 / 约 200ms |
| 360 | 稳，能解壳，5-6 条 |
| 搜狗 | 第一次能出结果，连着查几次就被限流 |
| 百度 | 基本直接回「百度安全验证」 |
| Yandex | 回 SmartCaptcha（HTTP 200 + 验证码页） |
| Google / DuckDuckGo | 不通，需要出口节点 |
| 多吉（dogedoge） | 站点本身连不上，没接 |

被拦不是故障，所以插件把它记作「跳过」而不是「失败」，不会污染 `degraded` 告警。全部引擎都真失败才抛错。

冷却分两种，因为原因不一样：

- **验证码 / 同意墙**：出口 IP 被烧了，冷却 `probeTtlMs`（默认 10 分钟）
- **429 / 503 限流**：只是问得太快，按响应里的 `Retry-After` 冷却；没给这个头就退到 2 分钟

把两者混成一个「10 分钟」的后果是：一次正常的限流会让引擎静默十分钟，用户看到的是「搜狗怎么突然不能用了」。

其余：

- 多数结果没有日期。Bing RSS 给的是抓取时间不是发布时间，填进去会让旧页面显得很新，所以故意不填。每次抓取的耗时和时间点只进 debug 日志（`fetched in 312ms at 2026-10-29T…`），不塞进结果。
- 同样的查询在 `cacheTtlMs`（默认 5 分钟）内直接吃缓存，不再出网。缓存只存完整成功的答案，降级的那次不存 —— 否则半小时内都拿不到更好的结果。
- 走的是公开搜索页，不是官方接口。调太猛会被限流，这是这套方案的根本限制。
- 搜不到就是空列表；只有全部引擎真失败才抛错。

### 兼容性

dsh 0.1.5-rc.2、`web` profile、Windows 上实测过。Node 22 和 24 都跑过。

想确认某个站点在你这条网络上到底通不通，在仓库里跑 `npm run live`（可只测一个：`npm run live google`）。它会逐个引擎打真实请求，打印条数、耗时和自链数量——`BLOCK` 表示吃到验证码，`FAIL` 表示真连不上。Google 和 Yandex 的解析逻辑，只能在能连到它们的机器上用这条命令验。

如果这个插件帮你把搜索救回来了，点个 star 让下一个撞 401 的人也能搜到它：https://github.com/a1435473620/dsh-web-search-nokey

这是这个仓库唯一想要的回报。别提 issue 说谢谢，把 issue 留给真问题。


## English

### What it fixes

Chat and search take different paths in dsh. Chat goes through whatever connector you configured. Search is a separate built-in module that only accepts `DEEPSEEK_API_KEY`. On credits-based setups (Trae, WorkBuddy) that key never exists, so `web_search` returns 401 forever while chat keeps working:

```
DeepSeek API error (HTTP 401): Authentication Fails, Your api key: ****1b24 is invalid
```

This plugin registers a credential-free `WebSearchProvider` on `ctx.web`. Queries hit public result pages and come back in the seam's own source shape.

`web_fetch` was never broken — anonymous fetcher, no credential step.

### Install

```
dsh plugin --profile web add github:a1435473620/dsh-web-search-nokey
```

Takes effect immediately. Not `npm install -g`: this is a dsh plugin and belongs in the profile.

Remove:

```
dsh plugin --profile web remove dsh-web-search-nokey
```

### Don't delete the patch

dsh allows exactly one search backend at a time. If you don't name one, it counts usable candidates — and the built-in provider always claims it is. Two candidates means `WEB_PROVIDER_AMBIGUOUS`, and search stops working entirely.

`cordis.patch.yml` pins `web.searchProvider` to this plugin. That file is load-bearing.

### Usage

Just use it. `web_search` routes here.

Eight ids over seven sites, in fallback order, stopping once there are enough
results:

```
Bing(RSS) → Bing(HTML) → Google → Yandex → Baidu → Sogou → DuckDuckGo → 360
```

Bing has two legs; `bing`, `360`, `haosou` and `ddg` are aliases, so config can
be written in site names rather than ids.

Roughly 200ms per query, eight results with snippets. One real call looks like this:

```text
> web_search "cordis plugin lifecycle"

3 results · 502ms
1. Welcome to Cordis                    https://cordis.com/
2. 全文首发 deepseek harness 背后的秘密…   https://zhuanlan.zhihu.com/p/2071…
3. Cordis 教程 | DeepSeek Harness        https://deepseek-harness.github.io/…
```

### Redirects are expanded first

Baidu, Sogou and 360 mostly hand out `/link?url=…` shells; Bing hands out
`/ck/a?u=…`. Those are expanded into the real address **server-side, before the
result is returned**.

The reason is practical: give a model a redirect shell and it will fetch the
shell, land on an interstitial, and interstitials are where the ads are. Shells
that fail to expand are dropped, never passed on — one result short beats one
result that cannot be opened. `resolveRedirects` (default true) and `maxResolve`
(default 5) control it, and each engine's ad blocks (marked 广告 / 品牌推广 inside
the block) are skipped during parsing.

### Google and exit nodes

Google is "only if there is a route" by default. The plugin probes
`generate_204` in the background and schedules Google only when that answers, so
a machine without an exit node never pays for timeouts. `google: on` forces it.

### Configuration

Edit the profile's `cordis.patch.yml` if you need to. Most people won't.

| Field | Default | Notes |
| --- | --- | --- |
| `engines` | `bing-rss, bing-html, google, yandex, baidu, sogou, duckduckgo, so360` | Order is fallback order; `bing`, `360`, `haosou`, `ddg` are aliases |
| `maxResults` | `8` | Per-query cap |
| `maxPerHost` | `3` | Rows one site may contribute; `0` disables the cap |
| `timeoutMs` | `12000` | Per upstream request |
| `budgetMs` | `25000` | Wall-clock ceiling for one search |
| `google` | `auto` | `auto` probes reachability, `on` forces, `off` disables |
| `probeTtlMs` | `600000` | How long a reachability verdict and a captcha cooldown stand |
| `resolveRedirects` | `true` | Expand shells; off means discard them |
| `maxResolve` | `5` | Shells expanded per search |
| `freshness` | empty | `day`/`week`/`month`/`year`; empty means any time |
| `locale` | `auto` | `auto` follows the query's script, then the language dsh runs in |
| `cacheTtlMs` | `300000` | Result cache TTL; `0` turns the cache off |
| `cacheMax` | `100` | Cache entries, evicted least-recently-used first |
| `proxy` | empty | e.g. `http://127.0.0.1:7897` |
| `userAgent` | desktop Chrome | These pages turn away bare clients |

`freshness` is honoured by Bing, Google, Baidu, Sogou and DuckDuckGo. Yandex and 360 have no documented no-JS parameter for it, so they get nothing rather than a guess.

Environment variables override the same fields with the `DSH_WEB_SEARCH_NOKEY_` prefix. `HTTPS_PROXY` / `HTTP_PROXY` are honoured too.

### Known issues

Whether a site works depends heavily on your exit IP. Measured in October 2026
from a machine in mainland China:

| Site | State |
| --- | --- |
| Bing | solid, 10 rows, ~200ms |
| 360 | solid, shells unwrapped, 5-6 rows |
| Sogou | first query works, then rate-limits |
| Baidu | answers with its security check |
| Yandex | SmartCaptcha (HTTP 200 with a captcha page) |
| Google / DuckDuckGo | unreachable without an exit node |
| dogedoge | the site itself does not answer; not wired up |

A block is not a malfunction, so it is recorded as a skip and the engine rests
instead of raising `degraded` noise. The two reasons rest for different spans,
because they are different problems:

- **Captcha / consent wall** — the exit IP is burned; rests for `probeTtlMs`
  (ten minutes by default).
- **429 / 503** — merely too fast; rests for whatever `Retry-After` asked for,
  falling back to two minutes.

Collapsing those into one ten-minute window means a routine rate limit silently
takes an engine out for ten minutes, which reads as "Sogou just stopped working".

The error only surfaces when every engine genuinely failed.

Also:

- Most results have no date. Bing's RSS carries crawl time, not publish time; writing that through would make stale pages look fresh, so it's left out. When a fetch happened, and how long it took, goes to the debug log (`fetched in 312ms at 2026-10-29T…`) rather than onto the results.
- An identical query inside `cacheTtlMs` (five minutes by default) is served from cache without touching the network. Only a clean answer is cached — a degraded one is not, or a bad minute would stick for the whole TTL.
- Public result pages, not an official API. Heavy use gets rate-limited — that is the fundamental limit of this approach.
- An empty result set is an empty list; only a total failure throws.

### Compatibility

Tested on dsh 0.1.5-rc.2, `web` profile, Windows, Node 24 and 22.

To find out whether a given site is reachable on your network, run `npm run live` in the repo (or `npm run live google` for one engine). It hits each engine for real and prints row count, latency and self-link count — `BLOCK` means a captcha, `FAIL` means it genuinely did not connect. The Google and Yandex parsers can only be verified this way on a machine that can reach them.

If this got your search working again, a star is what helps the next person who hits the same 401 find it: [star this repo](https://github.com/a1435473620/dsh-web-search-nokey).

## License

MIT
