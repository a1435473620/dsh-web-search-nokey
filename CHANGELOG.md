# Changelog

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
