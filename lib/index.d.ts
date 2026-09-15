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
export type EngineId = 'bing-rss' | 'bing-html' | 'so360';

/** The entry `config` block. Every field is optional. */
export interface NokeySearchConfig {
  /** Fallback order. Defaults to `['bing-rss', 'bing-html', 'so360']`. */
  engines?: EngineId[] | string;
  /** Upper bound per search. Defaults to 8. The seam caps the result too. */
  maxResults?: number;
  /** Per upstream request, milliseconds. Defaults to 12000. */
  timeoutMs?: number;
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
  readonly proxy: '';
  readonly userAgent: string;
};

/** Environment override prefix: `DSH_WEB_SEARCH_NOKEY_ENGINES`, `_MAX_RESULTS`, `_TIMEOUT_MS`, `_PROXY`. */
export declare const ENV_PREFIX: 'DSH_WEB_SEARCH_NOKEY_';

/** Resolve the entry config, the environment, and the defaults into one settings object. */
export declare function resolveConfig(config?: NokeySearchConfig): Required<{
  engines: EngineId[];
  maxResults: number;
  timeoutMs: number;
  proxy: string;
  userAgent: string;
}>;

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
export default apply;
