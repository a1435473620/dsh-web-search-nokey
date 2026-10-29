/**
 * Type surface for dsh-web-search-nokey.
 *
 * Deliberately declared locally instead of imported from `@deepseek-ai/dsh-web`
 * and `@deepseek-ai/cordis`: those resolve inside a running profile through the
 * harness's module fallback, not from a declared dependency, so importing them
 * here would make `tsc` fail for anyone type-checking the package on its own.
 * The shapes below mirror the seam's published interfaces.
 */

/** Lower bound on what a search backend is asked for. Mirrors `WebSearchRequest`. */
export interface SearchRequest {
  readonly query: string;
  readonly maxResults?: number;
}

/** One citeable result. Mirrors `WebSearchSource`. */
export interface SearchSource {
  readonly url: string;
  readonly title?: string;
  readonly snippet?: string;
  /** ISO-8601. Only set when the result page states a date explicitly. */
  readonly publishedAt?: string;
}

/** Mirrors `WebSearchResult`. */
export interface SearchResult {
  readonly content?: string;
  readonly sources: readonly SearchSource[];
  readonly truncated: boolean;
}

/** Mirrors `WebSearchProvider`. */
export interface SearchProvider {
  readonly id: string;
  available(): boolean;
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult>;
}

/** Engine ids accepted in `engines`. */
export type EngineId =
  | 'bing-rss'
  | 'bing-html'
  | 'google'
  | 'yandex'
  | 'baidu'
  | 'sogou'
  | 'duckduckgo'
  | 'so360';

/** Friendly names accepted in `engines`, expanded to ids. */
export type EngineAlias = 'bing' | '360' | 'so' | 'haosou' | 'ddg' | 'duck';

/** How Google is treated. `auto` gates it on a reachability probe. */
export type GoogleMode = 'auto' | 'on' | 'off';

/** How far back a search may reach. Empty means "no restriction". */
export type Freshness = '' | 'day' | 'week' | 'month' | 'year';

/** The entry `config` block. Every field is optional. */
export interface NokeySearchConfig {
  /**
   * Fallback order. Defaults to
   * `['bing-rss', 'bing-html', 'google', 'yandex', 'baidu', 'sogou', 'duckduckgo', 'so360']`.
   * `bing` expands to both Bing legs; `360`, `haosou` and `so` to `so360`.
   */
  engines?: EngineId[] | EngineAlias[] | string;
  /** Upper bound per search. Defaults to 8. The seam caps the result too. */
  maxResults?: number;
  /** Per upstream request, milliseconds. Defaults to 12000. */
  timeoutMs?: number;
  /** Wall-clock ceiling for one search across all engines. Defaults to 25000. */
  budgetMs?: number;
  /** How long a Google reachability verdict is trusted. Defaults to 600000. */
  probeTtlMs?: number;
  /** `auto` (default) skips Google when unreachable; `on` always tries it. */
  google?: GoogleMode;
  /**
   * Expand `baidu.com/link`, `sogou.com/link`, `bing.com/ck/a` and friends into
   * the real address. Defaults to true; shells that do not expand are dropped.
   */
  resolveRedirects?: boolean;
  /** How many shells to expand per search. Defaults to 5. */
  maxResolve?: number;
  /**
   * How many results one site may contribute, so eight rows are eight sources
   * rather than eight pages from one forum. Defaults to 3; 0 disables the cap.
   */
  maxPerHost?: number;
  /**
   * Restrict results to a recent window. Defaults to `''` (no restriction);
   * `7d`, `w` and `week` are all accepted for `week`.
   */
  freshness?: Freshness | string;
  /**
   * BCP-47 tag used for `Accept-Language` and each engine's language
   * parameter. Defaults to `auto`: the query's script decides, falling back to
   * the language dsh itself runs in. `auto` never needs to be written out.
   */
  locale?: string;
  /** Result cache TTL in milliseconds. Defaults to 300000; 0 disables it. */
  cacheTtlMs?: number;
  /** Cache entry ceiling, evicted least-recently-used first. Defaults to 100. */
  cacheMax?: number;
  /** HTTP proxy, e.g. `http://127.0.0.1:7897`. Falls back to `HTTPS_PROXY`. */
  proxy?: string;
  /** Override the default desktop Chrome user agent. */
  userAgent?: string;
}

export declare const name: 'dsh-web-search-nokey';
export declare const inject: readonly ['web'];
export declare const PROVIDER_ID: 'dsh-web-search-nokey';

export declare const DEFAULTS: {
  readonly engines: readonly EngineId[];
  readonly maxResults: 8;
  readonly timeoutMs: 12000;
  readonly budgetMs: 25000;
  readonly probeTtlMs: 600000;
  readonly google: 'auto';
  readonly resolveRedirects: true;
  readonly maxResolve: 5;
  readonly maxPerHost: 3;
  readonly freshness: '';
  readonly locale: 'auto';
  readonly cacheTtlMs: 300000;
  readonly cacheMax: 100;
  readonly proxy: '';
  readonly userAgent: string;
};

/** Environment override prefix: `DSH_WEB_SEARCH_NOKEY_ENGINES`, `_MAX_RESULTS`, `_TIMEOUT_MS`, `_BUDGET_MS`, `_PROBE_TTL_MS`, `_GOOGLE`, `_RESOLVE`, `_MAX_RESOLVE`, `_MAX_PER_HOST`, `_FRESHNESS`, `_LOCALE`, `_CACHE_TTL_MS`, `_CACHE_MAX`, `_PROXY`. */
export declare const ENV_PREFIX: 'DSH_WEB_SEARCH_NOKEY_';

/** Resolve the entry config, the environment, and the defaults into one settings object. */
export declare function resolveConfig(config?: NokeySearchConfig): Required<{
  engines: EngineId[];
  maxResults: number;
  timeoutMs: number;
  budgetMs: number;
  probeTtlMs: number;
  google: GoogleMode;
  resolveRedirects: boolean;
  maxResolve: number;
  maxPerHost: number;
  freshness: Freshness;
  locale: string;
  cacheTtlMs: number;
  cacheMax: number;
  proxy: string;
  userAgent: string;
}>;

/** The script a query is written in, or `''` for a Latin one. */
export declare function scriptOf(text: string): '' | 'zh' | 'ja' | 'ko' | 'ru' | 'ar' | 'he' | 'th';

/** The locale the runtime itself is running in, e.g. `zh-CN`. */
export declare function harnessLocale(): string;

/** Which language to search in, given the config setting and the query. */
export declare function resolveLocale(setting: string, query?: string): string;

export declare class KeylessSearchProvider implements SearchProvider {
  readonly id: 'dsh-web-search-nokey';
  constructor(
    resolveConfig: () => ReturnType<typeof resolveConfig>,
    logger?: { debug?: (message: string) => void; warn?: (message: string) => void },
  );
  available(): boolean;
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult>;
}

/** Minimal structural stand-in for the cordis `Context`, so this file needs no cordis import. */
export interface MinimalContext {
  readonly web: { registerSearchProvider(provider: SearchProvider): () => void };
  readonly logger?: { debug?: (message: string) => void; warn?: (message: string) => void };
}

export declare function apply(ctx: MinimalContext, config?: NokeySearchConfig): void;
