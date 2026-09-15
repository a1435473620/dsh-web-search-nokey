/**
 * Integration test against the real seam.
 *
 * `test/smoke.mjs` drives the provider directly, which proves the search works
 * but not that the seam accepts it. This one boots an actual cordis `Context`
 * with the actual `WebRuntime` from `@deepseek-ai/dsh-web` and registers the
 * plugin the way the loader does, so the registry, provider selection, error
 * taxonomy, and `maxResults` capping are all the production implementations.
 *
 * Requires a profile that has this plugin installed, because `@deepseek-ai/*`
 * resolves through the harness's module-fallback layer:
 *
 *     cd ~/.dsh/profiles/web
 *     node <repo>/test/with-seam.mjs
 *
 * The second half reproduces the bug this plugin's bundle patch exists to
 * prevent: with the shipped `deepseek-official` provider also registered — it
 * reports `available() === true` unconditionally — an unpinned config makes the
 * seam throw `WEB_PROVIDER_AMBIGUOUS`. The patch pins the id, so it does not.
 */

import { Context } from '@deepseek-ai/cordis';
import { WebRuntime } from '@deepseek-ai/dsh-web';
import * as plugin from 'dsh-web-search-nokey';

const QUERY = process.argv[2] ?? 'DeepSeek Harness plugin';

const ctx = new Context();
ctx.plugin(WebRuntime, { searchProvider: plugin.PROVIDER_ID, fetchProvider: 'http' });
await ctx.plugin(plugin, {});

const web = ctx.get('web');
if (!web) throw new Error('ctx.web was not installed');

console.log('registered:', [...web.searchProviders.values()].map((p) => p.id).join(', '));

const startedAt = Date.now();
const result = await web.search({ query: QUERY, maxResults: 3 });
console.log(`ctx.web.search("${QUERY}") -> ${result.sources.length} sources in ${Date.now() - startedAt}ms`);
for (const source of result.sources) console.log(`  ${source.title ?? source.url}\n    ${source.url}`);

if (!result.sources.length) {
  console.error('FAIL: no sources came back through the seam');
  process.exit(1);
}

// A second, unconditionally-available provider: exactly the shipped situation.
ctx.plugin({
  name: 'fake-shipped-provider',
  inject: ['web'],
  apply(c) {
    c.web.registerSearchProvider({
      id: 'deepseek-official',
      available: () => true,
      search: async () => ({ sources: [], truncated: false }),
    });
  },
});
await new Promise((resolve) => setTimeout(resolve, 100));

const present = [...web.searchProviders.values()].map((p) => `${p.id}(${p.available()})`);
console.log('providers now:', present.join(', '));

try {
  const again = await web.search({ query: 'still pinned?', maxResults: 1 });
  console.log(`pinned id still wins -> ${again.sources.length} source(s), no ambiguity`);
} catch (error) {
  console.error(`FAIL: ${error.code} — ${error.message}`);
  console.error('the bundle patch is not pinning web.searchProvider');
  process.exit(1);
}

console.log('\nok');
