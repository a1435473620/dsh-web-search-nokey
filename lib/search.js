/**
 * Search backends and the parsing that turns their output into the seam's
 * `WebSearchSource` shape.
 *
 * Each engine returns `{ url, title, snippet, publishedAt }` where every field
 * except `url` is optional. Engines are tried in configured order and the run
 * stops as soon as `maxResults` is reached, so the later ones only cost
 * latency when the earlier ones came up short.
 *
 * Engines are split into `fetch` and `parse` halves on purpose: the parsers are
 * pure functions of the response body, so they can be exercised against saved
 * markup without touching the network.
 *
 * @module dsh-web-search-nokey/search
 */

import { getText } from './http.js';

// ---------------------------------------------------------------------------
// text helpers
// ---------------------------------------------------------------------------

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
};

/** Decode the entity forms the search pages actually emit. */
export function decodeEntities(input) {
  if (!input) return '';
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) =>
      Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : match,
    );
}

/** Flatten markup to a single-spaced text run. */
export function stripTags(input) {
  return decodeEntities(String(input).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const CDATA = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/;

function unwrapCdata(value) {
  const match = CDATA.exec(String(value));
  return match ? match[1] : String(value);
}

// ---------------------------------------------------------------------------
// date extraction
// ---------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Recognise the recency phrasing a result page puts in front of a snippet and
 * convert it to ISO-8601.
 *
 * Only explicit dates are read. Bing's RSS `<pubDate>` is deliberately ignored:
 * it carries the crawl date, which is "today" for most results regardless of
 * when the page was actually written. Passing that through as `publishedAt`
 * would make stale pages look fresh, which is worse than saying nothing.
 *
 * @param {string} text - the raw snippet.
 * @param {Date} [now] - injectable clock, for tests.
 * @returns {{text: string, publishedAt?: string}} snippet with the date peeled off.
 */
export function peelDate(text, now = new Date()) {
  const raw = (text ?? '').trim();

  const relative = /^(\d+)\s*(分钟|小时|天|周|个月|月|年)\s*(?:之前|前)[,，、\s]*/.exec(raw);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const ms =
      unit === '分钟'
        ? amount * MINUTE
        : unit === '小时'
          ? amount * HOUR
          : unit === '天'
            ? amount * DAY
            : unit === '周'
              ? amount * 7 * DAY
              : unit === '年'
                ? amount * 365 * DAY
                : amount * 30 * DAY;
    return {
      text: raw.slice(relative[0].length),
      publishedAt: new Date(now.getTime() - ms).toISOString(),
    };
  }

  const iso = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?[,，、\s]*/.exec(raw);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    if (!Number.isNaN(date.getTime())) {
      return { text: raw.slice(iso[0].length), publishedAt: date.toISOString() };
    }
  }

  return { text: raw };
}

// ---------------------------------------------------------------------------
// URL hygiene
// ---------------------------------------------------------------------------

const SELF_HOSTS =
  /(^|\.)(bing\.com|microsoft\.com|microsofttranslator\.com|msn\.com|so\.com|360\.cn|baidu\.com|sogou\.com|dogedoge\.com|duckduckgo\.com|google\.[a-z.]+|yandex\.[a-z.]+|ya\.ru)$/i;

/** Reject junk the result page offers alongside real hits. */
export function isUsableUrl(raw) {
  if (!raw) return false;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.hostname === 'go.microsoft.com') return false;
  if (/\/ck\/a\/|redirect\?/i.test(url.pathname + url.search)) return false;
  return !SELF_HOSTS.test(url.hostname);
}

/**
 * Query parameters that identify a campaign, not a document.
 *
 * These are stripped before comparison; everything else is kept. Dropping the
 * whole query string — which is what an earlier version did — silently merged
 * every result whose target lived in a parameter, and collapsed 360's
 * `/link?m=...` shells into a single entry.
 */
const TRACKING_PARAMS =
  /^(utm_.*|gclid|fbclid|yclid|msclkid|spm|scm|ref|ref_src|share_token|vd_source|sa|usg|ved|ei|sxsrf|source|from|from_source)$/i;

/** Stable comparison key: host + path + meaningful query. */
export function dedupeKey(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return String(raw).toLowerCase();
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const path = url.pathname.replace(/\/$/, '');
  const query = [...url.searchParams]
    .filter(([key]) => !TRACKING_PARAMS.test(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return `${host}${path}${query ? `?${query}` : ''}`;
}

/**
 * Collapse results pointing at the same page.
 *
 * A fragment or a `utm_source` variant of one article must not take a second
 * slot, but two different documents sharing a path and differing in a real
 * query parameter must survive.
 */
export function dedupe(results) {
  const seen = new Set();
  const kept = [];
  for (const result of results) {
    const key = dedupeKey(result.url);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(result);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// engines
// ---------------------------------------------------------------------------

/**
 * Split a page into result blocks that keep their own opening tag.
 *
 * `String.split` on a container tag drops the attributes — and those attributes
 * are where these engines hide the real URL (`mu`, `data-mdurl`). Matching the
 * openings first and slicing between them keeps them.
 *
 * @param {string} body
 * @param {RegExp} openRe - must be global and match the whole opening tag.
 * @returns {string[]}
 */
export function splitBlocks(body, openRe) {
  const opens = [...body.matchAll(openRe)];
  return opens.map((match, index) => {
    const end = index + 1 < opens.length ? opens[index + 1].index : body.length;
    return body.slice(match.index, end);
  });
}

/** Ad or promotion markers the CN engines put inside the block they sell. */
const AD_MARKER = /广告|品牌推广|赞助搜索|商业推广/;

/** Attribute an engine uses to carry the untracked target of a result. */
function mdurlOf(block) {
  return (
    /\bdata-mdurl="([^"]+)"/i.exec(block)?.[1] ??
    /\bmu="([^"]+)"/i.exec(block)?.[1] ??
    ''
  );
}

/** Pull one XML-ish tag out of an RSS item. */
function tag(item, name) {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(item);
  return match ? decodeEntities(unwrapCdata(match[1])).trim() : '';
}

/**
 * Unwrap a Bing click-tracking link.
 *
 * Bing hands out `bing.com/ck/a?…&u=a1<base64url>` for some results. The two
 * character prefix is a version tag, and the rest decodes to the target — so
 * this needs no request, unlike the older "follow the redirect" approach.
 * (Same trick as the AC-baidu userscript's `handleBingRedirect`.)
 */
export function unwrapBingUrl(href) {
  if (!href) return '';
  const decoded = decodeEntities(href);

  let url;
  try {
    url = new URL(decoded, 'https://www.bing.com');
  } catch {
    return decoded;
  }
  if (!/(^|\.)bing\.com$/i.test(url.hostname)) return decoded;
  if (url.pathname !== '/ck/a' && url.pathname !== '/ck/a/') return decoded;

  const payload = url.searchParams.get('u');
  if (!payload || payload.length < 3) return decoded;

  try {
    const body = payload.slice(2).replace(/-/g, '+').replace(/_/g, '/');
    const padded = body + '='.repeat((4 - (body.length % 4)) % 4);
    const target = Buffer.from(padded, 'base64').toString('utf8');
    if (/^https?:\/\//i.test(target)) return target;
  } catch {
    // A payload that does not decode is left as-is; isUsableUrl then drops it.
  }
  return decoded;
}

/** Parse a Bing RSS feed body. */
export function parseBingRss(body) {
  const items = [...body.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  const results = [];
  for (const item of items) {
    const link = unwrapBingUrl(tag(item, 'link'));
    if (!acceptable(link)) continue;
    const { text: snippet } = peelDate(tag(item, 'description'));
    results.push({ url: link, title: tag(item, 'title'), snippet });
  }
  return results;
}

/** Parse a Bing HTML result page. */
export function parseBingHtml(body) {
  const results = [];
  for (const block of body.split(/<li class="b_algo"/).slice(1)) {
    const anchor = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);

    let link = anchor ? unwrapBingUrl(anchor[1]) : '';
    let title = anchor ? stripTags(anchor[2]) : '';

    if (!isUsableUrl(link)) {
      const cite = /<cite[^>]*>([\s\S]*?)<\/cite>/i.exec(block);
      if (cite) {
        const candidate = stripTags(cite[1]).split(/\s|›/)[0];
        if (/^https?:\/\//.test(candidate)) link = candidate;
      }
    }
    if (!acceptable(link)) continue;

    if (!title) {
      const heading = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(block);
      title = heading ? stripTags(heading[1]) : '';
    }

    const caption =
      /class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block) ??
      /class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block) ??
      /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);

    const { text: snippet, publishedAt } = peelDate(stripTags(caption ? caption[1] : ''));
    results.push({ url: link, title, snippet, publishedAt });
  }
  return results;
}

/**
 * Unwrap a Google redirect link.
 *
 * Google hands out `/url?q=<target>&sa=U...` instead of the target itself, so
 * the query string is the payload, not metadata.
 */
export function unwrapGoogleUrl(href, base = 'https://www.google.com') {
  if (!href) return '';
  const decoded = decodeEntities(href);
  if (!decoded.startsWith('/url?') && !decoded.startsWith('https://www.google.com/url?')) {
    return decoded;
  }
  try {
    const url = new URL(decoded, base);
    return url.searchParams.get('q') ?? url.searchParams.get('url') ?? '';
  } catch {
    return '';
  }
}

/** Pull a snippet out of a Google result block. */
function googleSnippet(block) {
  const match =
    /class="[^"]*(?:VwiC3b|IsZvec|aCOpRe|st)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span)>/i.exec(block);
  return match ? stripTags(match[1]) : '';
}

/**
 * Pick the first anchor in `scope` that carries an `<h3>` title, and turn it
 * into a source. Google puts the heading inside the anchor; the snippet lives
 * in a sibling of the anchor, so it is read from the scope.
 */
function googleHit(scope) {
  const anchor = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]{0,1200}?)<\/a>/gi;
  let match;
  while ((match = anchor.exec(scope))) {
    const heading = /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(match[2]);
    if (!heading) continue;

    const link = unwrapGoogleUrl(match[1]);
    if (!acceptable(link)) continue;

    const { text: snippet, publishedAt } = peelDate(googleSnippet(scope));
    return { url: link, title: stripTags(heading[1]), snippet, publishedAt };
  }
  return null;
}

/**
 * Parse a Google result page.
 *
 * `gbv=1` (the no-JavaScript basic view) is requested by the transport because
 * its markup is stable and server-rendered; this parser also accepts the
 * modern `div.g` shape in case Google ignores the flag.
 */
export function parseGoogle(body) {
  if (/consent\.google\.|Before you continue to Google/i.test(body)) {
    throw blockedError('google consent page — needs a cookie or a different exit node');
  }
  if (/unusual traffic|detected unusual/i.test(body)) {
    throw blockedError('google anti-bot page');
  }

  const results = [];
  for (const block of body.split(/<div class="g[ "]/).slice(1)) {
    const hit = googleHit(block);
    if (hit) results.push(hit);
  }

  // Google serves the basic view without `div.g`, so the anchor scan is the
  // real path most of the time.
  if (!results.length) {
    const wide = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]{0,1200}?)<\/a>/gi;
    let match;
    while ((match = wide.exec(body))) {
      const heading = /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(match[2]);
      if (!heading) continue;
      const link = unwrapGoogleUrl(match[1]);
      if (!acceptable(link)) continue;
      const { text: snippet, publishedAt } = peelDate(googleSnippet(body));
      results.push({ url: link, title: stripTags(heading[1]), snippet, publishedAt });
    }
  }

  const unique = dedupe(results);
  if (!unique.length) throw new Error('no usable rows');
  return unique;
}

/**
 * Parse a Yandex result page.
 *
 * Yandex answers a suspected bot with a SmartCaptcha interstitial and HTTP 200,
 * so an empty parse is indistinguishable from a block unless the page is
 * inspected for it.
 */
export function parseYandex(body) {
  if (/showcaptcha|SmartCaptcha|confirm\?.*captcha/i.test(body)) {
    throw blockedError('yandex captcha — this exit node is flagged');
  }

  const results = [];
  for (const block of body.split(/<li class="serp-item"/).slice(1)) {
    const anchor =
      /<a\b[^>]*class="[^"]*(?:OrganicTitle-Link|organic__url)[^"]*"[^>]*href="([^"]+)"/i.exec(block) ??
      /<a\b[^>]*href="([^"]+)"[^>]*class="[^"]*(?:OrganicTitle-Link|organic__url)[^"]*"/i.exec(block) ??
      /<h2[^>]*>\s*<a\b[^>]*href="([^"]+)"/i.exec(block);
    if (!anchor) continue;

    const link = decodeEntities(anchor[1]);
    if (!acceptable(link)) continue;

    // The title span is nested inside the anchor, and the anchor's own closing
    // tag is not `</span>` — so it is read as its own span, not by reaching
    // forward from the anchor's class attribute.
    const titleSpan =
      /<span[^>]*class="[^"]*OrganicTitleContentSpan[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block);
    const heading = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(block);

    const snippetRaw =
      /<span[^>]*class="[^"]*OrganicTextContentSpan[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block) ??
      /<div[^>]*class="[^"]*OrganicText[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);

    const { text: snippet, publishedAt } = peelDate(stripTags(snippetRaw ? snippetRaw[1] : ''));
    results.push({
      url: link,
      title: stripTags(titleSpan ? titleSpan[1] : heading ? heading[1] : ''),
      snippet,
      publishedAt,
    });
  }

  const unique = dedupe(results);
  if (!unique.length) throw new Error('no usable rows');
  return unique;
}

/**
 * Parse a 360 result page.
 *
 * 360 wraps organic links in `/link?m=<opaque>` shells that answer an anonymous
 * GET with HTTP 400, so the shell is worthless to a fetcher. The real address
 * is carried alongside it in `data-mdurl`, which is what gets lifted out here.
 */
export function parseSo360(body) {
  const results = [];
  for (const block of body.split(/<li class="res-list"/).slice(1)) {
    const anchor = /<h3[^>]*>\s*<a([^>]*)>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;

    const attrs = anchor[1];
    let link =
      /data-mdurl="([^"]+)"/i.exec(attrs)?.[1] ?? /href="([^"]+)"/i.exec(attrs)?.[1] ?? '';
    link = decodeEntities(link);
    if (link.startsWith('//')) link = `https:${link}`;
    else if (link.startsWith('/')) link = `https://www.so.com${link}`;

    // Anything that still points back at so.com is a shell we could not unwrap
    // (the "related searches" row and the AI answer box both land here).
    if (!acceptable(link)) continue;

    const caption =
      /class="res-desc"[^>]*>([\s\S]*?)<\/p>/i.exec(block) ?? /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    const { text: snippet, publishedAt } = peelDate(stripTags(caption ? caption[1] : ''));

    results.push({ url: link, title: stripTags(anchor[2]), snippet, publishedAt });
  }
  if (!results.length) throw new Error('no usable rows');
  return results;
}

// ---------------------------------------------------------------------------
// redirect shells
// ---------------------------------------------------------------------------

/**
 * Known "click me first" wrappers.
 *
 * These are engine self-links, so `isUsableUrl` rejects them — but they are
 * also the only thing some engines hand out, and the target is one HTTP hop
 * away. Keeping them as a distinct concept lets the parser accept them and a
 * later pass either expand them into the real address or drop them.
 */
const SHELL_RULES = [
  { host: /(^|\.)bing\.com$/i, path: /^\/ck\/a\/?$/ },
  { host: /(^|\.)baidu\.com$/i, path: /^\/link$/ },
  { host: /(^|\.)sogou\.com$/i, path: /^\/link$/ },
  { host: /(^|\.)so\.com$/i, path: /^\/link$/ },
  { host: /(^|\.)google\.[a-z.]+$/i, path: /^\/url$/ },
];

/** Is this URL a search engine's own redirect wrapper? */
export function isShellUrl(raw) {
  let url;
  try {
    url = new URL(raw ?? '');
  } catch {
    return false;
  }
  return SHELL_RULES.some((rule) => rule.host.test(url.hostname) && rule.path.test(url.pathname));
}

/** Accept a result URL if it is either directly usable or an expandable shell. */
function acceptable(raw) {
  return isUsableUrl(raw) || isShellUrl(raw);
}

/** Unwrap DuckDuckGo's `/l/?uddg=` wrapper. */
export function unwrapDuckUrl(href) {
  if (!href) return '';
  const decoded = decodeEntities(href);
  let url;
  try {
    url = new URL(decoded, 'https://duckduckgo.com');
  } catch {
    return decoded;
  }
  if (!/(^|\.)duckduckgo\.com$/i.test(url.hostname)) return decoded;
  const target = url.searchParams.get('uddg');
  return target ? decodeURIComponent(target) : decoded;
}

/**
 * Parse a Baidu result page.
 *
 * Baidu often answers a datacenter IP with its security check instead of
 * results; that is a block, not an empty result set. The real address of a
 * result sits in the container's `mu` attribute (the same thing the AC-baidu
 * script reads), so a `/link?url=` shell is only a fallback.
 */
export function parseBaidu(body) {
  if (/百度安全验证|请输入验证码|wappass\.baidu\.com|antispider/i.test(body)) {
    throw blockedError('baidu security check');
  }

  const results = [];
  for (const block of splitBlocks(
    body,
    /<div[^>]*class="[^"]*\bc-container\b[^"]*"[^>]*>/gi,
  )) {
    if (AD_MARKER.test(block)) continue;

    const anchor =
      /<h3[^>]*>[\s\S]{0,200}?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block) ??
      /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;

    const link = decodeEntities(mdurlOf(block) || anchor[1]);
    if (!acceptable(link)) continue;

    const caption = /class="[^"]*content-right[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)
      ?? /<span[^>]*class="[^"]*content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block);
    const { text: snippet, publishedAt } = peelDate(stripTags(caption ? caption[1] : ''));

    results.push({ url: link, title: stripTags(anchor[2]), snippet, publishedAt });
  }

  const unique = dedupe(results);
  if (!unique.length) throw new Error('no usable rows');
  return unique;
}

/**
 * Parse a Sogou result page.
 *
 * Sogou rate-limits hard: a handful of queries in a row gets a short page with
 * no result containers. That reads as "no usable rows" rather than as a block,
 * because there is no captcha marker to key on.
 */
export function parseSogou(body) {
  if (/antispider|seccode|请输入验证码/i.test(body)) {
    throw blockedError('sogou anti-bot page');
  }

  const results = [];
  for (const block of splitBlocks(body, /<div[^>]*class="[^"]*\bvrwrap\b[^"]*"[^>]*>/gi)) {
    if (AD_MARKER.test(block)) continue;

    const anchor =
      /<h3[^>]*>[\s\S]{0,200}?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block) ??
      /<a[^>]*id="sogou_vr_[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;

    let link = decodeEntities(mdurlOf(block) || anchor[1]);
    if (link.startsWith('//')) link = `https:${link}`;
    else if (link.startsWith('/')) link = `https://www.sogou.com${link}`;
    if (!acceptable(link)) continue;

    const caption = /class="[^"]*(?:str_info|space-txt|fz-mid)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p|span)>/i.exec(block);
    const { text: snippet, publishedAt } = peelDate(stripTags(caption ? caption[1] : ''));

    results.push({ url: link, title: stripTags(anchor[2]), snippet, publishedAt });
  }

  const unique = dedupe(results);
  if (!unique.length) throw new Error('no usable rows');
  return unique;
}

/** Parse a DuckDuckGo HTML result page. */
export function parseDuckDuckGo(body) {
  if (/anomaly|unusual traffic|challenge-form/i.test(body)) {
    throw blockedError('duckduckgo anti-bot page');
  }

  const results = [];
  for (const block of splitBlocks(body, /<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>/gi)) {
    const anchor = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;

    const link = unwrapDuckUrl(anchor[1]);
    if (!acceptable(link)) continue;

    const caption = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i.exec(block);
    const { text: snippet, publishedAt } = peelDate(stripTags(caption ? caption[1] : ''));
    results.push({ url: link, title: stripTags(anchor[2]), snippet, publishedAt });
  }

  const unique = dedupe(results);
  if (!unique.length) throw new Error('no usable rows');
  return unique;
}

// ---------------------------------------------------------------------------
// engine registry
// ---------------------------------------------------------------------------

/**
 * Mark an engine failure as "the site refused to serve a robot" rather than
 * "something is broken".
 *
 * The distinction matters to the caller: a captcha or a consent wall means the
 * exit node is the problem and nothing is wrong with the plugin, so it is
 * reported as a skip and the engine is rested for a while instead of being
 * retried on every single query.
 */
function blockedError(message) {
  const error = new Error(message);
  error.blocked = true;
  return error;
}

/**
 * Fetch each host in turn and keep the first parse that yields rows.
 *
 * The wrap-up matters as much as the loop: rebuilding the failure message here
 * preserves the `blocked` flag, so a captcha on both hosts still reaches the
 * caller as "blocked" rather than as a generic fault.
 *
 * @param {string[]} hosts
 * @param {(host: string) => string} buildUrl
 * @param {(body: string) => object[]} parse
 * @param {object} context
 * @returns {Promise<object[]>}
 */
async function tryHosts(hosts, buildUrl, parse, context) {
  const reasons = [];
  let allBlocked = true;

  for (const host of hosts) {
    try {
      const { status, body } = await getText(buildUrl(host), context);
      if (status !== 200) {
        reasons.push(`${host}: HTTP ${status}`);
        allBlocked = false;
        continue;
      }
      const results = parse(body);
      if (results.length) return results;
      reasons.push(`${host}: no usable rows`);
      allBlocked = false;
    } catch (error) {
      reasons.push(`${host}: ${error.message}`);
      if (!error.blocked) allBlocked = false;
    }
  }

  const message = reasons.join(' | ');
  throw allBlocked && reasons.length ? blockedError(message) : new Error(message);
}

/**
 * Bing's RSS endpoint. Preferred first: the shape is stable, it needs no
 * scraping, and it does not rotate class names the way the HTML page does.
 * The trade-off is volume — nine-ish items, no pagination.
 */
async function bingRss(query, context) {
  return tryHosts(
    ['cn.bing.com', 'www.bing.com'],
    (host) => `https://${host}/search?q=${encodeURIComponent(query)}&format=rss&count=20`,
    parseBingRss,
    context,
  );
}

/**
 * Bing's HTML page. Second leg: it carries the per-result recency line
 * ("4 天之前") that the RSS feed omits, and it returns more rows.
 */
async function bingHtml(query, context) {
  return tryHosts(
    ['cn.bing.com', 'www.bing.com'],
    (host) => `https://${host}/search?q=${encodeURIComponent(query)}&count=20`,
    parseBingHtml,
    context,
  );
}

/** Google, when the machine has an exit node that can reach it. */
async function google(query, context) {
  // `gbv=1` asks for the server-rendered no-JS result page.
  return tryHosts(
    ['www.google.com', 'www.google.com.hk'],
    (host) => `https://${host}/search?q=${encodeURIComponent(query)}&num=20&hl=zh-CN&gbv=1`,
    parseGoogle,
    context,
  );
}

/** Yandex. Direct links, but a flagged exit node gets a captcha instead. */
async function yandex(query, context) {
  return tryHosts(
    ['yandex.com', 'yandex.ru'],
    (host) => `https://${host}/search/?text=${encodeURIComponent(query)}&numdoc=20`,
    parseYandex,
    context,
  );
}

/** 360 Search. Last resort, and the only one that needs a shell unwrapped. */
async function so360(query, context) {
  return tryHosts(
    ['www.so.com'],
    (host) => `https://${host}/s?q=${encodeURIComponent(query)}`,
    parseSo360,
    context,
  );
}

/** Baidu. Frequently answers a datacenter IP with its security check. */
async function baidu(query, context) {
  return tryHosts(
    ['www.baidu.com'],
    (host) => `https://${host}/s?wd=${encodeURIComponent(query)}&rn=20`,
    parseBaidu,
    context,
  );
}

/** Sogou. Works, then rate-limits; the failure surfaces as "no usable rows". */
async function sogou(query, context) {
  return tryHosts(
    ['www.sogou.com'],
    (host) => `https://${host}/web?query=${encodeURIComponent(query)}&num=20`,
    parseSogou,
    context,
  );
}

/** DuckDuckGo's no-JS endpoint. Needs an exit node in mainland China. */
async function duckduckgo(query, context) {
  return tryHosts(
    ['html.duckduckgo.com', 'lite.duckduckgo.com'],
    (host) => `https://${host}/html/?q=${encodeURIComponent(query)}`,
    parseDuckDuckGo,
    context,
  );
}

/** Registry keyed by the ids accepted in `engines`. */
export const ENGINES = {
  'bing-rss': bingRss,
  'bing-html': bingHtml,
  google,
  yandex,
  baidu,
  sogou,
  so360,
  duckduckgo,
};

/**
 * Friendly names that expand to other ids.
 *
 * `bing` is one site with two parsing modes; letting people write `bing` keeps
 * the config in the same vocabulary as the sites they are thinking of. `360`,
 * `haosou` and `so` are the same engine under the names it has carried.
 */
export const ENGINE_ALIASES = {
  bing: ['bing-rss', 'bing-html'],
  '360': ['so360'],
  haosou: ['so360'],
  so: ['so360'],
  google: ['google'],
  yandex: ['yandex'],
  baidu: ['baidu'],
  sogou: ['sogou'],
  ddg: ['duckduckgo'],
  duck: ['duckduckgo'],
  duckduckgo: ['duckduckgo'],
};

/** Engine order used when the config does not name one. */
export const DEFAULT_ENGINES = [
  'bing-rss',
  'bing-html',
  'google',
  'yandex',
  'baidu',
  'sogou',
  'duckduckgo',
  'so360',
];

/**
 * Expand an engine list, following aliases and dropping unknown ids.
 *
 * Order is preserved and repeats are removed, so a caller can rely on the
 * first listed engine being tried first.
 *
 * @param {string[]} list
 * @returns {string[]}
 */
export function expandEngines(list) {
  const out = [];
  for (const entry of list) {
    const ids = ENGINE_ALIASES[entry] ?? (Object.hasOwn(ENGINES, entry) ? [entry] : []);
    for (const id of ids) if (!out.includes(id)) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// reachability gate (Google only)
// ---------------------------------------------------------------------------

/**
 * Cached answer to "can this machine reach Google at all".
 *
 * A machine without an exit node pays a DNS/connect timeout on every search
 * otherwise, which is exactly the case this plugin exists to avoid. The probe
 * is a 204 endpoint: no body, no query, nothing to rate-limit.
 */
const reachability = new Map();

/**
 * @param {string} key
 * @param {object} context
 * @returns {Promise<boolean>}
 */
async function reachable(key, context) {
  const now = Date.now();
  const cached = reachability.get(key);
  if (cached && now - cached.at < context.probeTtlMs) return cached.ok;

  try {
    const { status } = await getText(context.probeUrl, {
      ...context,
      timeoutMs: Math.min(context.timeoutMs, 3000),
    });
    // Anything that answers with a status at all proves the route exists; a
    // 403 from a corporate gateway is still a route.
    const ok = status > 0 && status < 500;
    reachability.set(key, { ok, at: now });
    return ok;
  } catch {
    reachability.set(key, { ok: false, at: now });
    return false;
  }
}

/** The endpoint each gated engine is probed against. */
const PROBES = {
  google: 'https://www.google.com/generate_204',
};

/**
 * Engines that recently answered with a captcha or a consent wall.
 *
 * Without this, a blocked engine costs a full timeout on every query — the
 * pages come back HTTP 200, so there is no cheap way to learn it is blocked
 * other than asking once per TTL.
 */
const cooldowns = new Map();

/** Forget cached verdicts. Used by tests. */
export function resetGates() {
  reachability.clear();
  cooldowns.clear();
}

/** Is `id` resting after being blocked? */
export function isCooling(id, probeTtlMs) {
  const at = cooldowns.get(id);
  return at !== undefined && Date.now() - at < probeTtlMs;
}

/**
 * Ask, in the background, whether Google is reachable — so a VPN user does not
 * pay the probe on the first query that needs it.
 *
 * @param {object} options
 * @returns {Promise<boolean>}
 */
export function warmUp(options = {}) {
  return reachable('google', {
    probeUrl: PROBES.google,
    timeoutMs: options.timeoutMs ?? 3000,
    probeTtlMs: options.probeTtlMs ?? 600_000,
    proxy: options.proxy,
    userAgent: options.userAgent,
  }).catch(() => false);
}

// ---------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------

/**
 * Expand redirect shells into their real targets.
 *
 * This is the server-side version of what a "remove redirect" userscript does
 * in the browser, and it matters more for a model than for a person: a model
 * that receives `www.baidu.com/link?url=…` will fetch it, land on an
 * interstitial, and very often on an ad. One extra hop per shell buys real
 * destinations.
 *
 * Shells that do not expand are dropped rather than passed on.
 *
 * @param {object[]} results
 * @param {object} context - transport options plus `max` and `log`.
 * @returns {Promise<object[]>}
 */
export async function resolveShells(results, context) {
  const { max = 5, log = () => {}, ...transport } = context;
  const shells = results.filter((result) => isShellUrl(result.url));
  if (!shells.length) return results;

  const budget = Math.max(0, Number(max));
  const targets = shells.slice(0, budget);
  if (shells.length > targets.length) {
    log('debug', `redirect: expanding ${targets.length}/${shells.length} shells (maxResolve)`);
  }

  await Promise.all(
    targets.map(async (result) => {
      try {
        const { finalUrl } = await getText(result.url, transport);
        if (finalUrl && finalUrl !== result.url && isUsableUrl(finalUrl)) {
          result.url = finalUrl;
        }
      } catch {
        // Left as a shell; filtered out below.
      }
    }),
  );

  return results.filter((result) => !isShellUrl(result.url));
}

/**
 * Run one query across the engine list.
 *
 * Engines degrade rather than abort: a failure is recorded and the next one is
 * tried, because "Bing rate-limited us" should not mean "search is broken".
 * The error only surfaces when every engine failed.
 *
 * @param {string} query
 * @param {object} options
 * @param {string[]} options.engines - engine ids, in fallback order.
 * @param {number} options.maxResults - stop once this many unique results exist.
 * @param {number} options.timeoutMs - per upstream request.
 * @param {number} [options.budgetMs] - wall-clock ceiling for the whole search.
 * @param {'auto'|'on'|'off'} [options.google] - whether to gate Google on reachability.
 * @param {number} [options.probeTtlMs] - how long a reachability verdict stands.
 * @param {boolean} [options.resolveRedirects] - expand engine redirect shells.
 * @param {number} [options.maxResolve] - how many shells to expand per search.
 * @param {string} [options.proxy]
 * @param {string} [options.userAgent]
 * @param {AbortSignal} [options.signal]
 * @param {(level: string, message: string) => void} [options.log]
 * @returns {Promise<{results: object[], errors: string[], skipped: string[]}>}
 */
export async function searchWeb(query, options) {
  const {
    engines,
    maxResults,
    timeoutMs,
    budgetMs = 25_000,
    google: googleMode = 'auto',
    probeTtlMs = 600_000,
    resolveRedirects = true,
    maxResolve = 5,
    proxy,
    userAgent,
    signal,
    log = () => {},
  } = options;

  const deadline = Date.now() + budgetMs;
  const errors = [];
  const skipped = [];
  let collected = [];

  for (const id of engines) {
    if (signal?.aborted) break;

    const engine = ENGINES[id];
    if (!engine) {
      errors.push(`${id}: unknown engine`);
      continue;
    }

    // `'off'` means the caller does not want it; `'on'` means trust the caller.
    if (id === 'google' && googleMode === 'off') {
      skipped.push(`${id}: disabled by config`);
      continue;
    }
    if (id === 'google' && googleMode === 'auto') {
      const ok = await reachable(id, {
        probeUrl: PROBES[id],
        timeoutMs,
        probeTtlMs,
        proxy,
        userAgent,
        signal,
      });
      if (!ok) {
        skipped.push(`${id}: unreachable (no exit node; set google: on to force)`);
        log('debug', 'google: probe failed, skipped');
        continue;
      }
    }

    if (isCooling(id, probeTtlMs)) {
      skipped.push(`${id}: resting after a captcha/consent wall`);
      log('debug', `${id}: still cooling down, skipped`);
      continue;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      skipped.push(`${id}: time budget spent`);
      continue;
    }

    const startedAt = Date.now();
    try {
      const found = await engine(query, {
        timeoutMs: Math.min(timeoutMs, remaining),
        proxy,
        userAgent,
        signal,
      });
      collected = dedupe([...collected, ...found]);
      log('debug', `${id}: ${found.length} raw, ${collected.length} unique, ${Date.now() - startedAt}ms`);
      if (collected.length >= maxResults) break;
    } catch (error) {
      if (error.blocked) {
        // Not a malfunction: the site declined to answer a robot. Rest it and
        // keep the distinction out of the "degraded" warning.
        cooldowns.set(id, Date.now());
        skipped.push(`${id}: ${error.message}`);
        log('debug', `${id}: blocked after ${Date.now() - startedAt}ms — ${error.message}`);
        continue;
      }
      errors.push(`${id}: ${error.message}`);
      log('debug', `${id}: failed after ${Date.now() - startedAt}ms — ${error.message}`);
    }
  }

  if (!collected.length && errors.length) {
    throw new Error(`every search engine failed — ${errors.join(' | ')}`);
  }

  // Expand shells before handing results over: a model given a redirect URL
  // fetches the interstitial, and interstitials are where the ads are.
  if (collected.some((result) => isShellUrl(result.url))) {
    if (resolveRedirects) {
      collected = await resolveShells(collected, {
        max: maxResolve,
        timeoutMs: Math.max(1000, Math.min(timeoutMs, deadline - Date.now())),
        proxy,
        userAgent,
        signal,
        log,
      });
      collected = dedupe(collected);
    } else {
      // Delivering a shell would be worse than delivering nothing.
      collected = collected.filter((result) => !isShellUrl(result.url));
    }
  }

  return { results: collected.slice(0, maxResults), errors, skipped };
}
