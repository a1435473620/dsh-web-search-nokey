# dsh-web-search-nokey

[中文](README.md) · **English**

A web search backend for dsh that needs no API key.

---

## What this fixes

If you're running dsh on credits — Trae credits, WorkBuddy credits, whichever — `web_search` probably looks like this:

```
DeepSeek API error (HTTP 401): Authentication Fails, Your api key: ****1b24 is invalid
```

Chat is fine; only search is broken. In dsh, chat and search are two unrelated paths. Chat goes through your connector. Search is a separate built-in module that accepts one credential and one only: `DEEPSEEK_API_KEY`.

No key, no search.

This plugin swaps the search backend for public search engines. No key anywhere.

---

## Install

```bash
dsh plugin --profile web add github:a1435473620/dsh-web-search-nokey
```

Once it's on npm, the short name works too:

```bash
dsh plugin --profile web add dsh-web-search-nokey
```

It takes effect right away. Nothing to configure, nothing to restart.

Not `npm install -g`: this is a dsh plugin and belongs in the profile.

To remove:

```bash
dsh plugin --profile web remove dsh-web-search-nokey
```

---

## Why there's a patch in the box

dsh allows exactly one search backend at a time. If you don't name one, it counts how many are usable — and the built-in one always claims it is. Two candidates means `WEB_PROVIDER_AMBIGUOUS`, and search stops working entirely.

That's what `cordis.patch.yml` is for: it names the backend. **Don't delete it.**

---

## Usage

Just use it — the `web_search` tool routes here.

Three backends in fallback order, stopping once there are enough results: Bing's RSS feed, Bing's HTML page, then 360. Roughly 200ms per query, eight results with snippets.

---

## Configuration

Edit the profile's `cordis.patch.yml` if you need to. Most people won't.

| Field | Default | Notes |
| --- | --- | --- |
| `engines` | `bing-rss, bing-html, so360` | Order is fallback order |
| `maxResults` | `8` | Per-query cap |
| `timeoutMs` | `12000` | Per upstream request |
| `proxy` | empty | Set it if you're behind one, e.g. `http://127.0.0.1:7897` |
| `userAgent` | desktop Chrome | These pages turn away bare clients |

Environment variables override the same fields, prefixed `DSH_WEB_SEARCH_NOKEY_`. `HTTPS_PROXY` is honoured too.

---

## Known issues

- **Most results have no date.** Bing's RSS gives a crawl time, not a publish time. Passing it through would make old pages look new, so it's left out.
- **Bing's RSS returns about nine items**, hence the second backend.
- **The 360 backend returns redirect links** that only resolve on click. It's a fallback.
- **These are public result pages, not an official API.** Heavy use may get rate-limited; failures show up in the log as `engine=xxx failed` and it moves on to the next backend.
- **An empty result set returns an empty list**, not an error.

---

## Compatibility

Tested on dsh 0.1.5-rc.2, `web` profile, Windows, Node 24 and 22.

---

## License

MIT
