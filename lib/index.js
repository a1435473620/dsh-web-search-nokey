/**
 * dsh-web-search-nokey — a keyless web search provider for the DeepSeek
 * Harness `ctx.web` seam.
 *
 * Registers one `WebSearchProvider`. No API key, no account, no external
 * search service: queries go straight to public result pages and come back in
 * the seam's own source shape.
 *
 * The bundle's `cordis.patch.yml` pins `web.searchProvider` to this provider's
 * id. That is not decoration — without it, registering a second usable provider
 * makes the seam throw `WEB_PROVIDER_AMBIGUOUS`, because the shipped
 * `deepseek-official` provider reports itself available unconditionally.
 *
 * @module dsh-web-search-nokey
 */

import {
  DEFAULT_ENGINES,
  expandEngines,
  normalizeFreshness,
  searchWeb,
  warmUp,
} from './search.js';
import { DEFAULT_USER_AGENT } from './http.js';

/** Cordis plugin name, used in loader diagnostics. */
export const name = 'dsh-web-search-nokey';

/** The seam this provider registers into. */
export const inject = ['web'];

/** Stable provider id. `cordis.patch.yml` pins `web.searchProvider` to this. */
export const PROVIDER_ID = 'dsh-web-search-nokey';

/** Compiled-in defaults; every one is overridable from the entry's `config`. */
export const DEFAULTS = Object.freeze({
  engines: DEFAULT_ENGINES,
  maxResults: 8,
  timeoutMs: 12_000,
  budgetMs: 25_000,
  probeTtlMs: 600_000,
  google: 'auto',
  resolveRedirects: true,
  maxResolve: 5,
  maxPerHost: 3,
  freshness: '',
  locale: 'auto',
  cacheTtlMs: 300_000,
  cacheMax: 100,
  proxy: '',
  userAgent: DEFAULT_USER_AGENT,
});

/** `google` accepts these three; anything else falls back to `auto`. */
const GOOGLE_MODES = new Set(['auto', 'on', 'off']);

/** Environment override prefix for the fields below. */
export const ENV_PREFIX = 'DSH_WEB_SEARCH_NOKEY_';

/**
 * Resolve the seam's `WebError` when the profile exposes it, and fall back to a
 * plain coded `Error` when it does not.
 *
 * Plugins live in the profile's `node_modules`, where `@deepseek-ai/*` is
 * resolved through the harness's module-fallback layer rather than a declared
 * dependency. That layer is present at runtime but absent when the module is
 * imported by a bare test runner, so the import is treated as optional. The
 * seam documents its error codes as an open vocabulary that consumers must
 * tolerate, so a coded `Error` behaves identically at the call site.
 */
let WebErrorClass = null;
try {
  ({ WebError: WebErrorClass } = await import('@deepseek-ai/dsh-web'));
} catch {
  WebErrorClass = null;
}

function webError(message, code, options) {
  if (WebErrorClass) return new WebErrorClass(message, code, options);
  const error = new Error(message, options);
  error.name = 'WebError';
  error.code = code;
  return error;
}

function parseEngines(value) {
  const list = Array.isArray(value)
    ? value
    : String(value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
  // Aliases (`bing` -> both legs, `360` -> so360) expand here; unknown ids drop.
  return expandEngines(list);
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Same, but 0 is meaningful here: `cacheTtlMs: 0` switches the cache off. */
function nonNegativeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/** `auto` is the sentinel for "work it out per query". */
function localeSetting(value) {
  const text = String(value ?? '').trim();
  if (!text || text.toLowerCase() === 'auto') return DEFAULTS.locale;
  return text;
}

/**
 * The script a query is written in, or `''` for a Latin one.
 *
 * Enough to tell "this query is not in the harness's language" without pulling
 * in a language-detection dependency. Ordered so the smaller scripts are tested
 * first: kana before Han, because Japanese is largely Han.
 *
 * @param {string} text
 * @returns {string}
 */
export function scriptOf(text) {
  const value = String(text ?? '');
  if (/[\u3040-\u30ff]/.test(value)) return 'ja';
  if (/[\uac00-\ud7af]/.test(value)) return 'ko';
  if (/[\u4e00-\u9fff]/.test(value)) return 'zh';
  if (/[\u0400-\u04ff]/.test(value)) return 'ru';
  if (/[\u0600-\u06ff]/.test(value)) return 'ar';
  if (/[\u0590-\u05ff]/.test(value)) return 'he';
  if (/[\u0e00-\u0e7f]/.test(value)) return 'th';
  return '';
}

/** The locale to ask for when a script needs one and no harness language helps. */
const SCRIPT_LOCALE = {
  zh: 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
  ru: 'ru-RU',
  ar: 'ar-SA',
  he: 'he-IL',
  th: 'th-TH',
};

/**
 * The language dsh itself is running in.
 *
 * `Intl.DateTimeFormat().resolvedOptions().locale` is the runtime's own idea of
 * the user's language — on a Chinese Windows it answers `zh-CN`, on an English
 * one `en-US`. It is the closest thing to "what language is the harness in"
 * that a plugin can read without a settings dependency, and it needs no file
 * access or extra service in `inject`.
 *
 * @returns {string}
 */
export function harnessLocale() {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale || '';
  } catch {
    return '';
  }
}

/**
 * Which language to search in.
 *
 * Order, and the reasoning behind it:
 *
 *   1. **An explicit `locale`** — the operator decided; never overridden.
 *   2. **The query's script, when it disagrees with the harness.** Someone
 *      running dsh in Chinese who pastes a Russian question wants Russian
 *      pages, and sending `zh-CN` there quietly guarantees the wrong ones.
 *   3. **The harness's own language** — this is the "match whatever dsh speaks"
 *      half. Same-script queries inherit it, so a Chinese harness searching in
 *      Chinese keeps `zh-CN` rather than being downgraded to a generic `zh`.
 *   4. **`en`** — the only defensible last resort.
 *
 * @param {string} setting - the resolved `locale` config, `auto` or a tag.
 * @param {string} [query]
 * @returns {string}
 */
export function resolveLocale(setting, query = '') {
  if (setting && setting !== 'auto') return setting;

  const harness = harnessLocale();
  const script = scriptOf(query);
  const harnessLang = String(harness).toLowerCase().split(/[-_]/)[0];
  if (script && harnessLang !== script) return SCRIPT_LOCALE[script] ?? harness;
  return harness || 'en';
}

function googleMode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  return GOOGLE_MODES.has(mode) ? mode : DEFAULTS.google;
}

/** Accept the spellings people actually type in a YAML file or a shell. */
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const text = String(value).trim().toLowerCase();
  if (TRUTHY.has(text)) return true;
  if (FALSY.has(text)) return false;
  return fallback;
}

/**
 * Merge the entry config, the plugin's environment variables, and the
 * defaults into the settings one search runs with.
 *
 * Env vars exist because a proxy in particular is usually an environment fact
 * rather than a per-profile decision.
 */
export function resolveConfig(config = {}) {
  const env = process.env;
  // An all-unknown engine list falls back to the defaults rather than leaving
  // the provider with nothing to run and `available() === false`.
  const requested = parseEngines(config.engines ?? env[`${ENV_PREFIX}ENGINES`]);

  return {
    engines: requested.length ? requested : DEFAULTS.engines,
    maxResults: positiveInt(
      config.maxResults ?? env[`${ENV_PREFIX}MAX_RESULTS`],
      DEFAULTS.maxResults,
    ),
    timeoutMs: positiveInt(
      config.timeoutMs ?? env[`${ENV_PREFIX}TIMEOUT_MS`],
      DEFAULTS.timeoutMs,
    ),
    budgetMs: positiveInt(
      config.budgetMs ?? env[`${ENV_PREFIX}BUDGET_MS`],
      DEFAULTS.budgetMs,
    ),
    probeTtlMs: positiveInt(
      config.probeTtlMs ?? env[`${ENV_PREFIX}PROBE_TTL_MS`],
      DEFAULTS.probeTtlMs,
    ),
    google: googleMode(config.google ?? env[`${ENV_PREFIX}GOOGLE`]),
    resolveRedirects: bool(
      config.resolveRedirects ?? env[`${ENV_PREFIX}RESOLVE`],
      DEFAULTS.resolveRedirects,
    ),
    maxResolve: positiveInt(
      config.maxResolve ?? env[`${ENV_PREFIX}MAX_RESOLVE`],
      DEFAULTS.maxResolve,
    ),
    maxPerHost: nonNegativeInt(
      config.maxPerHost ?? env[`${ENV_PREFIX}MAX_PER_HOST`],
      DEFAULTS.maxPerHost,
    ),
    freshness: normalizeFreshness(config.freshness ?? env[`${ENV_PREFIX}FRESHNESS`]),
    locale: localeSetting(config.locale ?? env[`${ENV_PREFIX}LOCALE`]),
    cacheTtlMs: nonNegativeInt(
      config.cacheTtlMs ?? env[`${ENV_PREFIX}CACHE_TTL_MS`],
      DEFAULTS.cacheTtlMs,
    ),
    cacheMax: positiveInt(
      config.cacheMax ?? env[`${ENV_PREFIX}CACHE_MAX`],
      DEFAULTS.cacheMax,
    ),
    proxy:
      config.proxy ||
      env[`${ENV_PREFIX}PROXY`] ||
      env.HTTPS_PROXY ||
      env.https_proxy ||
      env.HTTP_PROXY ||
      env.http_proxy ||
      DEFAULTS.proxy,
    userAgent: config.userAgent || DEFAULTS.userAgent,
  };
}

/**
 * Trim a value into a field-presence-preserving patch.
 *
 * `WebSearchSource` marks `title`, `snippet`, and `publishedAt` optional, and
 * "forcing adapters to invent them would make the seam lie". So empty values
 * are dropped rather than written as empty strings.
 */
function optional(field, value) {
  return value ? { [field]: value } : {};
}

/** The provider registered with `ctx.web`. */
export class KeylessSearchProvider {
  /** @type {string} */
  id = PROVIDER_ID;

  /**
   * @param {() => ReturnType<typeof resolveConfig>} resolveConfig - thunk, so a
   *   config edit applies to the next search without re-registering.
   * @param {{debug?: Function, warn?: Function}} [logger]
   */
  constructor(resolveConfig, logger = {}) {
    this.resolveConfig = resolveConfig;
    this.logger = logger;
  }

  /**
   * Cheap local check, no network calls — the contract requires that.
   * There is nothing to authenticate, so this only guards against a config
   * that would leave no engine to run.
   */
  available() {
    return this.resolveConfig().engines.length > 0;
  }

  /**
   * Run one search.
   *
   * @param {{query: string, maxResults?: number}} request
   * @param {AbortSignal} [signal]
   * @returns {Promise<{sources: object[], truncated: boolean}>}
   */
  async search(request, signal) {
    const config = this.resolveConfig();
    const query = String(request?.query ?? '').trim();

    if (!query) {
      throw webError('web search called with an empty query', 'WEB_PROVIDER_ERROR');
    }
    if (signal?.aborted) {
      throw webError('search aborted', 'WEB_ABORTED', { cause: signal.reason });
    }

    // The seam caps the result too; capping here as well avoids fetching rows
    // that are about to be dropped.
    const limit = Math.min(positiveInt(request?.maxResults, config.maxResults), config.maxResults);

    const log = (level, message) => {
      const sink = this.logger?.[level] ?? this.logger?.debug;
      if (typeof sink === 'function') {
        try {
          sink.call(this.logger, `[${PROVIDER_ID}] ${message}`);
        } catch {
          // a logger that throws must not take the search down with it
        }
      }
    };

    // Which language to ask for is per query: `auto` reads the query's script
    // and falls back to whatever language dsh itself is running in.
    const locale = resolveLocale(config.locale, query);

    let outcome;
    try {
      outcome = await searchWeb(query, { ...config, locale, maxResults: limit, signal, log });
    } catch (error) {
      if (signal?.aborted) {
        throw webError('search aborted', 'WEB_ABORTED', { cause: signal.reason ?? error });
      }
      throw webError(
        `${error.message}\n\nEngines tried, in order: ${config.engines.join(', ')}. ` +
          'Set `engines` in this plugin\'s cordis.patch.yml entry, or put a proxy in ' +
          '`proxy` / HTTPS_PROXY if the network blocks these hosts. If Google is ' +
          "configured but was skipped, `google: on` forces it past the reachability probe.",
        'WEB_PROVIDER_ERROR',
        { cause: error },
      );
    }

    if (outcome.errors.length) {
      log('warn', `degraded: ${outcome.errors.join(' | ')}`);
    }
    if (outcome.skipped?.length) {
      log('debug', `skipped: ${outcome.skipped.join(' | ')}`);
    }

    const sources = outcome.results.map((result) => ({
      url: result.url,
      ...optional('title', result.title),
      ...optional('snippet', result.snippet),
      ...optional('publishedAt', result.publishedAt),
    }));

    log('debug', `"${query}" -> ${sources.length} sources`);

    // The when-of-it: a cached answer states how old it is, a fresh one states
    // when it was pulled. Both are debug-level, so a quiet profile pays nothing.
    if (outcome.cached) {
      log(
        'debug',
        `served from cache: ${Math.round((outcome.ageMs ?? 0) / 1000)}s old, fetched ${outcome.fetchedAt}`,
      );
    } else if (outcome.fetchedAt) {
      log('debug', `fetched in ${outcome.elapsedMs}ms at ${outcome.fetchedAt} (${locale})`);
    }

    // The seam owns truncation and sets `truncated` itself.
    return { sources, truncated: false };
  }
}

/**
 * Register the provider.
 *
 * Everything a plugin needs is a named export: `name`, `inject`, `apply`.
 *
 * There must be no `export default` here. The loader normalizes module shapes
 * with `exports = exports.default ?? exports`, so a default export wins over the
 * namespace — and a bare `apply` function carries neither `inject` nor `name`.
 * The failure is confusing rather than obvious: the plugin still runs, then dies
 * on the first service access with `cannot get property "web" without inject`,
 * taking the whole plugin tree down with it. Both shipped providers next to this
 * one have zero default exports, for the same reason.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config] - the entry's `config` block.
 */
export function apply(ctx, config) {
  const provider = new KeylessSearchProvider(() => resolveConfig(config), ctx.logger ?? {});
  ctx.web.registerSearchProvider(provider);
  ctx.logger?.debug?.(
    `[${PROVIDER_ID}] registered; engines=${provider.resolveConfig().engines.join(',')}`,
  );

  // Ask about Google once, in the background, so a machine behind an exit node
  // has the verdict cached before the first query needs it — and a machine
  // without one never pays the probe inside a search.
  const settings = provider.resolveConfig();
  if (settings.google !== 'off' && settings.engines.includes('google')) {
    void warmUp({
      proxy: settings.proxy,
      userAgent: settings.userAgent,
      timeoutMs: Math.min(settings.timeoutMs, 3000),
      probeTtlMs: settings.probeTtlMs,
    });
  }
}
