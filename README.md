# dsh-web-search-nokey

给 dsh 一个不用 API key 的搜索。

用 Trae 积分 / WorkBuddy 积分把模型接进 dsh 的人，大概率撞过这个：

```
DeepSeek API error (HTTP 401): Authentication Fails, Your api key: ****1b24 is invalid
```

聊天是好的，`web_search` 一直 401。装完这个插件就好了，不需要任何 key。

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

三个后端按顺序兜底，条数够了就停：Bing RSS → Bing 网页 → 360。直连大约 200ms，返回 8 条带摘要的结果。

### 配置

一般不用碰。要改就改 profile 里的 `cordis.patch.yml`。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `engines` | `bing-rss, bing-html, so360` | 顺序即兜底顺序 |
| `maxResults` | `8` | 单次上限 |
| `timeoutMs` | `12000` | 单个上游请求超时 |
| `proxy` | 空 | 需要代理时填，例如 `http://127.0.0.1:7897` |
| `userAgent` | 桌面 Chrome | 这些搜索页会拦裸客户端 |

环境变量同样这几项，前缀 `DSH_WEB_SEARCH_NOKEY_`。`HTTPS_PROXY` / `HTTP_PROXY` 也认。

### 已知问题

- 多数结果没有日期。Bing RSS 给的是抓取时间不是发布时间，填进去会让旧页面显得很新，所以故意不填。
- Bing RSS 一般只回 9 条，所以才需要第二个后端补。
- 360 的链接是跳转壳，点一下才到真实页面。它只是兜底。
- 走的是公开搜索页，不是官方接口。调太猛可能被限流；日志里会记 `engine=xxx failed`，然后自动换下一个后端。
- 搜不到就是空列表，不报错。

### 兼容性

dsh 0.1.5-rc.2、`web` profile、Windows 上实测过。Node 22 和 24 都跑过。

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

Three backends in fallback order, stopping once there are enough results: Bing RSS → Bing HTML → 360. Roughly 200ms per query, eight results with snippets.

### Configuration

Edit the profile's `cordis.patch.yml` if you need to. Most people won't.

| Field | Default | Notes |
| --- | --- | --- |
| `engines` | `bing-rss, bing-html, so360` | Order is fallback order |
| `maxResults` | `8` | Per-query cap |
| `timeoutMs` | `12000` | Per upstream request |
| `proxy` | empty | e.g. `http://127.0.0.1:7897` |
| `userAgent` | desktop Chrome | These pages turn away bare clients |

Environment variables override the same fields with the `DSH_WEB_SEARCH_NOKEY_` prefix. `HTTPS_PROXY` / `HTTP_PROXY` are honoured too.

### Known issues

- Most results have no date. Bing's RSS carries crawl time, not publish time; writing that through would make stale pages look fresh, so it's left out.
- Bing RSS returns about nine items, which is why the second backend exists.
- The 360 backend returns redirect links that only resolve on click. It's a fallback.
- Public result pages, not an official API. Heavy use may get rate-limited; failures log as `engine=xxx failed` and the next backend is tried.
- An empty result set is an empty list, not an error.

### Compatibility

Tested on dsh 0.1.5-rc.2, `web` profile, Windows, Node 24 and 22.

## License

MIT

如果这个插件帮你把搜索救回来了，顺手点个 star：https://github.com/a1435473620/dsh-web-search-nokey
