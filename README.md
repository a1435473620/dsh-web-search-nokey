# dsh-web-search-nokey

[![GitHub stars](https://img.shields.io/github/stars/a1435473620/dsh-web-search-nokey?style=flat)](https://github.com/a1435473620/dsh-web-search-nokey)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

dsh-web-search-nokey 是 dsh 的搜索插件：不使用 API key，查询公开搜索页，七个站点按固定顺序兜底，结果里的跳转链接先展开成真实地址再返回。

典型场景：用 Trae 或 WorkBuddy 积分把模型接入 dsh 后，聊天正常，而 `web_search` 返回 401——搜索模块只接受 `DEEPSEEK_API_KEY`，积分接入不提供该 key。

```
DeepSeek API error (HTTP 401): Authentication Fails, Your api key: ****1b24 is invalid
```

- 七个站点按固定顺序兜底：Bing、Google、Yandex、百度、搜狗、DuckDuckGo、360；凑够条数即停止。
- 各站点的跳转链接在服务端展开为真实地址，模型不会拿到中间页。
- 带广告标记的结果块在解析阶段剔除。
- 直连约 200–500 ms；Bing 命中即返回，不必等后面的引擎。
- 纯 ESM，无依赖，安装时不执行脚本。

[中文](#中文) · [English](#english)

## 中文

### 解决的问题

dsh 中聊天与搜索走不同的路径：聊天经过所配置的连接器，搜索是另一个内置模块，只接受 `DEEPSEEK_API_KEY`。使用积分接入时没有这个 key，搜索请求返回 401，聊天不受影响。

这个插件为 dsh 注册一个无凭据的搜索后端，查询公开搜索页，结果按 dsh 的搜索结果格式返回。

`web_fetch` 不受影响：它本身就是匿名抓取，没有凭据环节。

### 安装

```
dsh plugin --profile web add github:a1435473620/dsh-web-search-nokey
```

安装后立即生效，无需修改配置或重启。它不是 `npm install -g`：这是 dsh 插件，需要装入 profile。

卸载：

```
dsh plugin --profile web remove dsh-web-search-nokey
```

### cordis.patch.yml 的作用

dsh 的搜索后端同一时间只允许一个生效。未显式指定时，框架会统计可用的后端数量；内置后端始终报告自身可用，两个后端同时注册时会产生 `WEB_PROVIDER_AMBIGUOUS`，搜索不可用。

因此包内附带 `cordis.patch.yml`，将 `web.searchProvider` 固定为本插件。删除该文件后插件仍会加载，但后端选择不再确定。

### 怎么用

安装后无需额外配置，`web_search` 会自动路由到本插件。

默认八个 id、七个站点，按顺序兜底，条数够了就停：

```
Bing(RSS) → Bing(网页) → Google → Yandex → 百度 → 搜狗 → DuckDuckGo → 360
```

Bing 包含两个子引擎（RSS 与网页版）；`bing`、`360`、`haosou`、`ddg` 是别名，配置中可直接写站点名。

直连大约 200ms，返回 8 条带摘要的结果。一次真实调用长这样：

```text
> web_search "cordis plugin lifecycle"

3 条 · 502ms
1. Welcome to Cordis                    https://cordis.com/
2. 全文首发 deepseek harness 背后的秘密…   https://zhuanlan.zhihu.com/p/2071…
3. Cordis 教程 | DeepSeek Harness        https://deepseek-harness.github.io/…
```

### 跳转链接的展开

百度、搜狗、360 与 Bing 返回的结果链接多为跳转壳。这些链接会在服务端展开为真实地址后再返回。

模型收到跳转壳后会去请求它，得到的是中间页，而中间页通常是广告。展开失败的条目会被丢弃，避免返回无法打开的链接。

由 `resolveRedirects`（默认开）和 `maxResolve`（默认 5 条/次）控制。各站点的广告块（带“广告”“品牌推广”标记的）也在解析阶段跳过。

### Google 与出口节点

Google 默认按可达性启用：插件在后台进行一次可达性探测，成功时才将其加入本轮引擎序列，没有出口节点的机器因此不会产生探测超时。需要强制启用时设为 `google: on`。

### 配置

通常无需修改；需要调整时编辑 profile 里的 `cordis.patch.yml`。

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

`freshness` 只有 Bing、Google、百度、搜狗、DuckDuckGo 支持；Yandex 和 360 没有可用的无 JS 参数，因此不向它们传递该参数。

环境变量同样这几项，前缀 `DSH_WEB_SEARCH_NOKEY_`。`HTTPS_PROXY` / `HTTP_PROXY` 也认。

### 已知问题

站点可用性与出口 IP 相关。2026-10 在一台大陆机器上实测：

| 站点 | 状态 |
| --- | --- |
| Bing | 稳，10 条 / 约 200ms |
| 360 | 稳，能解壳，5-6 条 |
| 搜狗 | 第一次能出结果，连着查几次就被限流 |
| 百度 | 基本直接回「百度安全验证」 |
| Yandex | 回 SmartCaptcha（HTTP 200 + 验证码页） |
| Google / DuckDuckGo | 不通，需要出口节点 |
| 多吉（dogedoge） | 站点无法访问，未接入 |

被拦不是故障，所以插件把它记作「跳过」而不是「失败」，不会触发 `degraded` 告警。只有全部引擎都失败才抛出错误。

冷却分两种，因为原因不一样：

- **验证码 / 同意墙**：出口 IP 已被标记，冷却 `probeTtlMs`（默认 10 分钟）
- **429 / 503 限流**：请求频率过高，按响应指示的时长冷却；未提供时退到 2 分钟

若把两者合并成一个 10 分钟窗口，一次常规限流也会让引擎停用十分钟，表现与引擎损坏相同。

其余：

- 多数结果没有日期：Bing RSS 提供的是抓取时间而非发布时间，写入会使旧页面显示为最新，因此不填充。抓取耗时与时间点只记录在 debug 日志（`fetched in 312ms at 2026-10-29T…`）中，不写入结果。
- 相同的查询在 `cacheTtlMs`（默认 5 分钟）内直接命中缓存，不发起网络请求。缓存只保存完整成功的结果；降级结果不写入缓存，否则在剩余时间内会持续返回较差的结果。
- 数据来源是公开搜索页而非官方接口，高频调用会被限流，这是该方案的固有限制。
- 没有结果时返回空列表；只有全部引擎都失败才抛出错误。

### 兼容性

dsh 0.1.5-rc.2、`web` profile、Windows 上实测过。Node 22 和 24 都跑过。

想确认某个站点在你这条网络上到底通不通，在仓库里跑 `npm run live`（可只测一个：`npm run live google`）。它会逐个引擎打真实请求，打印条数、耗时和自链数量——`BLOCK` 表示吃到验证码，`FAIL` 表示真连不上。Google 和 Yandex 的解析逻辑，只能在能连到它们的机器上用这条命令验。

如果这个插件帮你把搜索救回来了，点个 star 让下一个撞 401 的人也能搜到它：https://github.com/a1435473620/dsh-web-search-nokey

这是本仓库唯一的回报请求；issue 请留给实际问题。


## English

dsh-web-search-nokey is a search plugin for dsh. It uses no API key: queries go to public search pages, seven engines fall back in a fixed order, and redirect links in results are expanded to real URLs before anything is returned.

The problem it solves is narrow. In dsh, chat and search take different paths: chat runs through whichever connector you configured, while search is a separate module that only accepts `DEEPSEEK_API_KEY`. On credits-based setups (Trae, WorkBuddy) that key does not exist, so `web_search` returns 401 while chat keeps working:

```
DeepSeek API error (HTTP 401): Authentication Fails, Your api key: ****1b24 is invalid
```

The plugin registers a credential-free search provider with dsh. `web_fetch` is not affected: it is an anonymous fetcher with no credential step.

### Install

```
dsh plugin --profile web add github:a1435473620/dsh-web-search-nokey
```

It takes effect immediately, with no configuration change or restart. It is not `npm install -g`: this is a dsh plugin and belongs in the profile.

Remove:

```
dsh plugin --profile web remove dsh-web-search-nokey
```

### What cordis.patch.yml does

dsh allows one active search backend at a time. When none is configured, dsh counts the usable candidates; the built-in provider always reports itself as usable, so two registered backends produce `WEB_PROVIDER_AMBIGUOUS` and search fails.

`cordis.patch.yml` in the package pins `web.searchProvider` to this plugin. If the file is removed, the plugin still loads, but backend selection is no longer determined.

### Usage

No extra configuration is needed after install; `web_search` routes to this provider.

Eight ids over seven sites, in fallback order, stopping once there are enough
results:

```
Bing(RSS) → Bing(HTML) → Google → Yandex → Baidu → Sogou → DuckDuckGo → 360
```

Bing has two sub-engines (RSS and HTML); `bing`, `360`, `haosou` and `ddg` are aliases, so config can
be written in site names rather than ids.

Roughly 200ms per query, eight results with snippets. One real call looks like this:

```text
> web_search "cordis plugin lifecycle"

3 results · 502ms
1. Welcome to Cordis                    https://cordis.com/
2. 全文首发 deepseek harness 背后的秘密…   https://zhuanlan.zhihu.com/p/2071…
3. Cordis 教程 | DeepSeek Harness        https://deepseek-harness.github.io/…
```

### Redirect handling

Results from Baidu, Sogou, 360 and Bing mostly come as redirect shells. These are expanded into the real address server-side before the result is returned.

A model that receives a redirect shell will fetch it and land on an interstitial,
which is where the ads are. Shells that fail to expand are dropped, so no
unopenable link is returned. `resolveRedirects` (default true) and `maxResolve`
(default 5) control it, and each engine's ad blocks (marked 广告 / 品牌推广 inside
the block) are skipped during parsing.

### Google and exit nodes

Google is enabled based on reachability by default: the plugin performs a
reachability probe in the background and schedules Google only when the probe
answers, so machines without an exit node produce no probe timeout. `google: on`
forces it.

### Configuration

Edit the profile's `cordis.patch.yml` if a field needs changing.

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

`freshness` is honoured by Bing, Google, Baidu, Sogou and DuckDuckGo; Yandex and 360 do not support the parameter, so none is sent for them.

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
| dogedoge | the site does not respond; not integrated |

A block is not a malfunction, so it is recorded as a skip and the engine rests
instead of raising `degraded` noise. The two reasons rest for different spans,
because they are different problems:

- **Captcha / consent wall** — the exit IP has been flagged; rests for `probeTtlMs`
  (ten minutes by default).
- **429 / 503** — the request rate was too high; rests for the duration the
  response specifies, falling back to two minutes.

Collapsing those into one ten-minute window means a routine rate limit silently
takes an engine out for ten minutes, which reads as "Sogou just stopped working".

The error only surfaces when every engine genuinely failed.

Also:

- Most results have no date. Bing's RSS carries crawl time, not publish time; writing that through would make stale pages look fresh, so it's left out. When a fetch happened, and how long it took, goes to the debug log (`fetched in 312ms at 2026-10-29T…`) rather than onto the results.
- An identical query inside `cacheTtlMs` (five minutes by default) is served from cache without touching the network. Only a clean answer is cached — a degraded one is not, or a bad minute would stick for the whole TTL.
- Public result pages, not an official API. Heavy use gets rate-limited; this is an inherent limit of using public result pages.
- An empty result set is an empty list; only a total failure throws.

### Compatibility

Tested on dsh 0.1.5-rc.2, `web` profile, Windows, Node 24 and 22.

To find out whether a given site is reachable on your network, run `npm run live` in the repo (or `npm run live google` for one engine). It hits each engine for real and prints row count, latency and self-link count — `BLOCK` means a captcha, `FAIL` means it genuinely did not connect. The Google and Yandex parsers can only be verified this way on a machine that can reach them.

If this got your search working again, a star is what helps the next person who hits the same 401 find it: [star this repo](https://github.com/a1435473620/dsh-web-search-nokey).

## License

MIT
