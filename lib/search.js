/**
 * Search backends and the parsing that turns their output into the seam's
 * `WebSearchSource` shape.
 *
 * Each engine returns `{ url, title, snippet, publishedAt }` where every field
 * except `url` is optional. Engines are tried in configured order and the run
 * stops as soon as `maxResults` is reached, so the later ones only cost
 * latency when the earlier ones came up short.
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
  /(^|\.)(bing\.com|microsoft\.com|microsofttranslator\.com|msn\.com|so\.com|360\.cn|baidu\.com|google\.[a-z.]+)$/i;

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
 * Collapse results pointing at the same page.
 *
 * Keyed on host + path, so `?utm_source=` and `#fragment` variants of one
 * article do not each take a slot.
 */
export function dedupe(results) {
  const seen = new Set();
  const kept = [];
  for (const result of results) {
    let key;
    try {
      const url = new URL(result.url);
      key = `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`.toLowerCase();
    } catch {
      key = result.url;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(result);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// engines
// ---------------------------------------------------------------------------

/** Pull one XML-ish tag out of an RSS item. */
function tag(item, name) {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(item);
  return match ? decodeEntities(unwrapCdata(match[1])).trim() : '';
}

/**
 * Bing's RSS endpoint. Preferred first: the shape is stable, it needs no
 * scraping, and it does not rotate class names the way the HTML page does.
 * The trade-off is volume — nine-ish items, no pagination.
 */
async function bingRss(query, context) {
  const errors = [];
  for (const host of ['cn.bing.com', 'www.bing.com']) {
    try {
      const url = `https://${host}/search?q=${encodeURIComponent(query)}&format=rss&count=20`;
      const { status, body } = await getText(url, context);
      if (status !== 200) {
        errors.push(`${host}: HTTP ${status}`);
        continue;
      }

      const items = [...body.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
      const results = [];
      for (const item of items) {
        const link = tag(item, 'link');
        if (!isUsableUrl(link)) continue;
        const { text: snippet } = peelDate(tag(item, 'description'));
        results.push({ url: link, title: tag(item, 'title'), snippet });
      }
      if (results.length) return results;
      errors.push(`${host}: no usable items`);
    } catch (error) {
      errors.push(`${host}: ${error.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

/**
 * Bing's HTML page. Second leg: it carries the per-result recency line
 * ("4 天之前") that the RSS feed omits, and it returns more rows.
 */
async function bingHtml(query, context) {
  const errors = [];
  for (const host of ['cn.bing.com', 'www.bing.com']) {
    try {
      const url = `https://${host}/search?q=${encodeURIComponent(query)}&count=20`;
      const { status, body } = await getText(url, context);
      if (status !== 200) {
        errors.push(`${host}: HTTP ${status}`);
        continue;
      }

      const results = [];
      for (const block of body.split(/<li class="b_algo"/).slice(1)) {
        const anchor = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);

        let link = anchor ? decodeEntities(anchor[1]) : '';
        let title = anchor ? stripTags(anchor[2]) : '';

        if (!isUsableUrl(link)) {
          const cite = /<cite[^>]*>([\s\S]*?)<\/cite>/i.exec(block);
          if (cite) {
            const candidate = stripTags(cite[1]).split(/\s|›/)[0];
            if (/^https?:\/\//.test(candidate)) link = candidate;
          }
        }
        if (!isUsableUrl(link)) continue;

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

      if (results.length) return results;
      errors.push(`${host}: no usable rows`);
    } catch (error) {
      errors.push(`${host}: ${error.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

/**
 * 360 Search. Last resort. Its links are `/link?m=...` wrappers that resolve on
 * click rather than here, so results from this engine are only as good as the
 * snippet next to them.
 */
async function so360(query, context) {
  const url = `https://www.so.com/s?q=${encodeURIComponent(query)}`;
  const { status, body } = await getText(url, context);
  if (status !== 200) throw new Error(`HTTP ${status}`);

  const results = [];
  for (const block of body.split(/<li class="res-list"/).slice(1)) {
    const anchor = /<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;

    let link = decodeEntities(anchor[1]);
    if (link.startsWith('//')) link = `https:${link}`;
    else if (link.startsWith('/')) link = `https://www.so.com${link}`;

    const caption =
      /class="res-desc"[^>]*>([\s\S]*?)<\/p>/i.exec(block) ?? /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    const { text: snippet, publishedAt } = peelDate(stripTags(caption ? caption[1] : ''));

    results.push({ url: link, title: stripTags(anchor[2]), snippet, publishedAt });
  }

  if (!results.length) throw new Error('no usable rows');
  return results;
}

/** Registry keyed by the ids accepted in `engines`. */
export const ENGINES = {
  'bing-rss': bingRss,
  'bing-html': bingHtml,
  so360,
};

/** Engine order used when the config does not name one. */
export const DEFAULT_ENGINES = ['bing-rss', 'bing-html', 'so360'];

// ---------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------

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
 * @param {string} [options.proxy]
 * @param {string} [options.userAgent]
 * @param {AbortSignal} [options.signal]
 * @param {(level: string, message: string) => void} [options.log]
 * @returns {Promise<{results: object[], errors: string[]}>}
 */
export async function searchWeb(query, options) {
  const {
    engines,
    maxResults,
    timeoutMs,
    proxy,
    userAgent,
    signal,
    log = () => {},
  } = options;

  const context = { timeoutMs, proxy, userAgent, signal };
  const errors = [];
  let collected = [];

  for (const id of engines) {
    if (signal?.aborted) break;

    const engine = ENGINES[id];
    if (!engine) {
      errors.push(`${id}: unknown engine`);
      continue;
    }

    const startedAt = Date.now();
    try {
      const found = await engine(query, context);
      collected = dedupe([...collected, ...found]);
      log('debug', `${id}: ${found.length} raw, ${collected.length} unique, ${Date.now() - startedAt}ms`);
      if (collected.length >= maxResults) break;
    } catch (error) {
      errors.push(`${id}: ${error.message}`);
      log('debug', `${id}: failed after ${Date.now() - startedAt}ms — ${error.message}`);
    }
  }

  if (!collected.length && errors.length) {
    throw new Error(`every search engine failed — ${errors.join(' | ')}`);
  }

  return { results: collected.slice(0, maxResults), errors };
}
