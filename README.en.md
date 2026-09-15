# dsh-web-search-nokey

A keyless web search backend for DeepSeek Harness (dsh).

中文: [README.md](README.md)

---

## The problem

If your dsh chat model comes in over a credits connector — Trae credits, WorkBuddy credits, whatever — you have probably seen this:

```
DeepSeek API error (HTTP 401): Authentication Fails, Your api key: ****1b24 is invalid

The web search request used endpoint "https://api.deepseek.com/anthropic/v1/messages".
Search endpoint configuration is separate from chat.
```

Chat works. `web_search` does not. The reason is unintuitive: **chat and search are two unrelated pipelines in dsh.**

|                 | Chat                          | Search                                     |
| --------------- | ----------------------------- | ------------------------------------------ |
| Implemented by  | your connector plugin         | `@deepseek-ai/dsh-web-search-deepseek`     |
| Endpoint        | the connector's own service   | `https://api.deepseek.com/anthropic/v1` + `/messages` |
| Credential      | the connector's authorization | **`DEEPSEEK_API_KEY` only**                |

The search provider ships with the harness and accepts exactly one key. Its own source is explicit that it will not even reuse the base URL:

> This is NOT the chat-completions base (`https://api.deepseek.com`) `@deepseek-ai/dsh-llm-deepseek` uses, so this provider does NOT reuse `$DEEPSEEK_BASE_URL` — only the API key is shared.

So: **without a working DeepSeek key, the built-in search provider is dead**, no matter how well chat is doing.

Either get a key, or replace the provider. This plugin is the second option.

`web_fetch` is not affected, incidentally. `dsh-web-fetch-http` is an anonymous public fetcher — its source reads `No credentials to check — an anonymous public fetcher is always usable`. There is no credential step in it at all. Only `web_search` breaks.

---

## What it does

Registers one `WebSearchProvider` with `ctx.web`, queries public result pages directly, and returns them in the seam's own `WebSearchSource` shape.

Three backends, tried in order, stopping once the result count is met:

| Backend     | Notes                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `bing-rss`  | First choice. `&format=rss` yields structured XML, so no scraping and no class-name churn. Costs volume — usually nine-ish items |
| `bing-html`  | Fills the shortfall, and carries the "3 days ago" recency line the feed omits                        |
| `so360`     | Last resort. Reliable over a direct connection from mainland China                                   |

Design decisions worth knowing:

- **A failing engine degrades, it does not abort.** "Bing rate-limited us" must not mean "search is broken". The error only surfaces when every engine failed, and it names each engine's reason.
- **Deduplication is by host + path**, so `?utm_source=` and `#anchor` variants of one page do not each take a slot.
- **No invented dates.** Bing's RSS `<pubDate>` is a crawl date, so most results claim "today". Passing that through as `publishedAt` makes stale pages look fresh — worse than saying nothing. Dates appear only when the result page states one.
- **No page fetching.** That is `web_fetch`'s job. You get titles, URLs, and snippets.

Measured locally, direct connection, no proxy:

```
engines : bing-rss -> bing-html -> so360
took    : 200ms
sources : 8   truncated=false
```

---

## Install

```bash
dsh plugin --profile web add github:YOU/dsh-web-search-nokey
```

It takes effect immediately. No config to edit, no restart: `dsh plugin` appends any dependency declaring `dsh.bundle.patch` to the profile's `dsh.profile.bundles`, positioned after `@deepseek-ai/dsh-web-app`, so the patch layer wins over the built-in configuration by construction.

Confirm it landed:

```bash
dsh --profile web --dump-config | grep -A4 "id: web$"
```

You want to see:

```yaml
# == @deepseek-ai/dsh-base, patched by dsh-web-search-nokey
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: dsh-web-search-nokey
    fetchProvider: http
```

Remove it with:

```bash
dsh plugin --profile web remove dsh-web-search-nokey
```

---

## Why the bundle patch is not optional

This is where the plugin differs from most of its neighbours, so it deserves its own section.

Provider selection in `@deepseek-ai/dsh-web` works like this:

```
no id configured + exactly one usable provider -> use it
no id configured + several usable providers    -> WEB_PROVIDER_AMBIGUOUS
id configured                                  -> use it
```

The catch: the shipped `deepseek-official` provider's `available()` **always returns true**.

```js
available() {
  const options = this.resolveOptions();
  return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== void 0)
    && URL.canParse(options.baseURL)
    && isPositiveInteger(options.maxTokens)
    && isPositiveInteger(options.maxUses);
}
```

`resolveApiKey` is a closure that always exists, so the right half of that `||` is permanently true. Whether a key is actually present is simply not detectable from `available()` — a deployment with no key still reports itself usable.

Consequence: **a plugin that only registers its own provider, without pinning the id in config, turns working search into `WEB_PROVIDER_AMBIGUOUS`.** Installing it makes things worse than not installing it.

This plugin pins the id in `cordis.patch.yml`:

```yaml
- id: web
  config:
    searchProvider: dsh-web-search-nokey
    fetchProvider: http
```

Two traps worth writing down:

1. **A patch replaces the whole `config` object; it does not merge.** `fetchProvider: http` therefore has to be restated — omit it and fetch has no provider at all.
2. **`web-search-deepseek` is deliberately left enabled.** Once the id is pinned that row is dead code, and leaving it means that if you ever obtain a working DeepSeek key you can switch back by editing one line. For a tidier tree, add `- id: web-search-deepseek` / `disabled: true` to `cordis.patch.yml`.

`test/with-seam.mjs` reproduces the trap on purpose: it registers this plugin, then adds an unconditionally-available `deepseek-official`, and asserts this plugin is still selected with no ambiguity.

---

## Configuration

All of it lives in the profile's `cordis.patch.yml`, under the entry's `config`:

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

| Field        | Default                       | Meaning                                                                |
| ------------ | ----------------------------- | ---------------------------------------------------------------------- |
| `engines`    | `[bing-rss, bing-html, so360]` | Order is fallback order. Unknown ids are dropped; an all-unknown list reverts to the defaults |
| `maxResults` | `8`                           | Per-search bound. The seam applies the request's own cap on top         |
| `timeoutMs`  | `12000`                       | Per upstream request                                                    |
| `proxy`      | empty                         | HTTP proxy. When empty, `HTTPS_PROXY` / `HTTP_PROXY` are consulted      |
| `userAgent`  | desktop Chrome UA             | These result pages turn away bare clients                               |

Environment variables override the same set, prefixed `DSH_WEB_SEARCH_NOKEY_`: `ENGINES`, `MAX_RESULTS`, `TIMEOUT_MS`, `PROXY`. A proxy is usually an environment fact rather than a per-profile decision, so both routes exist.

Node's `fetch` ignores `HTTP_PROXY`, so proxying is a hand-rolled CONNECT tunnel over `net` + `tls`. No dependencies.

---

## Verifying

```bash
npm run smoke                          # provider-level, includes a live query
node test/smoke.mjs "your query"

cd ~/.dsh/profiles/web                 # real-seam integration; plugin must be installed
node <repo>/test/with-seam.mjs
```

`test/with-seam.mjs` uses a real cordis `Context` and the real `WebRuntime`, so the registry, selection, error taxonomy, and result capping are all production code:

```
registered: dsh-web-search-nokey
ctx.web.search("DeepSeek Harness plugin") -> 3 sources in 216ms
providers now: dsh-web-search-nokey(true), deepseek-official(true)
pinned id still wins -> 1 source(s), no ambiguity
```

`test/smoke.mjs` also cross-checks the code against `cordis.patch.yml`. A rename applied on one side only is silent at load time and surfaces later as `WEB_PROVIDER_CONFIGURED_MISSING`, which is a miserable thing to track down.

---

## Known limitations

- **Most results carry no date.** See the reasoning above — the alternative was fabricating them.
- **Bing's RSS endpoint returns about nine items.** Hence the second leg.
- **`so360` links are `/link?m=` wrappers** that resolve on click rather than here. It is a fallback only; the primary results never come from it.
- **These are public result pages, not an official API.** Heavy use may get rate-limited. If it happens, reorder `engines` to lead with a domestic engine — failures are recorded in the log as `engine=xxx failed`.
- **An empty result set returns an empty list, not an error.** Finding nothing is a legitimate outcome.
- **No caching.** Every call issues real requests.
- **Tested on Windows with Node 24 and Node 22 only.** There is no platform-specific code, but that is the honest scope of what has been run.

---

## What it deliberately does not do

- Fetch page bodies — `web_fetch` already does that, and better.
- Generate an answer or summary — `content` stays empty. Provider-generated "answers" carry no trust, which is what the seam's own type comments recommend.
- Ask for a key or an account. That is the entire point.

---

## License

MIT — see [LICENSE](LICENSE).
