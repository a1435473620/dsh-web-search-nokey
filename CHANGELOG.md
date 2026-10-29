# Changelog

## 1.1.0

Five engines added, redirect shells expanded server-side, and three defects that
let the old fallback chain look healthier than it was.

Added:

- `google`, reached through `gbv=1` (the server-rendered no-JS result page) so
  `/url?q=` can be unwrapped without a headless browser. Gated by a reachability
  probe: `google: auto` (default) sends one `generate_204` in the background at
  load time and only schedules Google when it answers, so a machine without an
  exit node pays nothing. `google: on` forces it, `google: off` drops it.
- `yandex`, with SmartCaptcha detection — Yandex answers a flagged IP with HTTP
  200 and a captcha page, which an empty parse cannot tell apart from "no
  results".
- `baidu`, `sogou` and `duckduckgo`, all detecting their own block pages
  (Baidu's security check, Sogou's anti-spider page, DuckDuckGo's anomaly page).
  Baidu reads the real address from the container's `mu` attribute — the same
  attribute the AC-baidu userscript reads; DuckDuckGo unwraps `uddg`.
- **Redirect expansion.** Baidu, Sogou and 360 hand out `/link?url=…` shells;
  Bing hands out `/ck/a?u=…`. Shells are now expanded into the real address
  before the result is returned, because a model given an interstitial will
  fetch the interstitial — and interstitials are where the ads are. Shells that
  fail to expand are dropped rather than passed on. `resolveRedirects` (default
  true) and `maxResolve` (default 5) control it.
- Ad blocks are skipped per engine rather than returned as results: Baidu and
  Sogou mark them with 广告/品牌推广 inside the block they sell.
- `bing` and `360` as aliases, since `bing` is one site with two parsing legs.
- `budgetMs` (default 25s) as a ceiling for the whole search. Without it the
  worst case was three engines × two hosts × 12s = 60s.
- `test/parsers.mjs` — offline parser tests against captured and hand-written
  markup, plus `test/live-engines.mjs` for per-engine checks on a network that
  can reach them.
- Bing's `bing.com/ck/a?u=a1<base64url>` click trackers are decoded in place
  instead of being dropped to the `<cite>` fallback. The trick (strip the
  two-character prefix, base64url-decode the rest) comes from the AC-baidu
  userscript's `handleBingRedirect`.

Fixed:

- **Dedupe dropped the query string.** Keyed on host + path only, so 360's
  `/link?m=<payload>` shells all collapsed into one row — six results in, two
  out. The key now keeps meaningful parameters and strips only tracking ones.
- **360 returned links that could not be fetched.** The `/link?m=` shells answer
  an anonymous GET with HTTP 400. The real address sits next to them in
  `data-mdurl`, which is now preferred; blocks that cannot be unwrapped (the
  related-search row, the AI answer box) are dropped. Six raw rows now yield
  five fetchable ones, where before they yielded two shells.
- **The smoke test's live leg ignored its own config.** Its "unknown engines
  fall back" check reassigned the shared `registered` variable, so the live
  query always ran against default engines and the "no self-link" assertion
  could never observe the 360 backend. Each check now builds its own provider.
- A captcha or consent wall is no longer reported as a failure. It is a skip,
  and the engine rests for `probeTtlMs` instead of being retried every query.

## 1.0.0

First release.

Written because the harness's built-in search provider only accepts `DEEPSEEK_API_KEY`,
which is not one of the things a credits-based setup — Trae credits, WorkBuddy credits —
ever has. Chat runs fine; `web_search` returns 401 forever.

What's here:

- One `WebSearchProvider` registered with `ctx.web`, no API key, no account, no
  external search service.
- Three backends with ordered fallback and per-host deduplication: `bing-rss`,
  `bing-html`, `so360`. Around 200ms for a full eight results over a direct
  connection.
- A bundle patch that pins `web.searchProvider` to this plugin. Without it,
  registering a second provider against a harness whose built-in provider reports
  itself unconditionally available produces `WEB_PROVIDER_AMBIGUOUS` — the plugin
  would break search for anyone who already had it working.
- Dependency-free HTTP with a hand-rolled CONNECT tunnel, because Node's `fetch`
  ignores `HTTP_PROXY` and these endpoints issue redirects a plain client refuses.
- `test/smoke.mjs` for the module contract, the patch/code agreement, and a live
  query; `test/with-seam.mjs` for the real cordis `Context` plus the real
  `WebRuntime`, including the ambiguity regression.

Earlier prototype, not released: a standalone HTTP server that spoke the
Anthropic Messages protocol and impersonated the DeepSeek endpoint, with the
harness pointed at it via `settings.yaml`. It worked, but it needed its own
process, its own port, and an autostart entry, and it edited a config file the
harness considers user-owned. Registering into the seam directly removes all
four. There is nothing left of it here except the engine parsing.
