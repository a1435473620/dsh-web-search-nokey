/**
 * Smoke test — run with `npm run smoke`, or `node test/smoke.mjs "your query"`.
 *
 * Covers the things that actually break a provider plugin:
 *   1. the module contract (`name` / `inject` / `apply` registering one provider),
 *   2. the bundle patch agreeing with the code (a rename on one side only is
 *      silent at load time and shows up as WEB_PROVIDER_CONFIGURED_MISSING),
 *   3. config handling — aliases, fallbacks, the Google gate,
 *   4. a live query coming back in the seam's source shape.
 *
 * No test framework: adding one would mean a devDependency and a build step for
 * a package that is otherwise four files of plain ESM.
 *
 * Each check builds its own provider instead of sharing a `registered`
 * variable. An earlier version reused one, so the "unknown engines fall back"
 * check silently replaced the provider the live query then ran against — which
 * made the live leg ignore its own config and always report Bing's results.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as plugin from '../lib/index.js';
import { dedupe, dedupeKey, expandEngines, ENGINE_ALIASES, ENGINES } from '../lib/search.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const QUERY = process.argv[2] ?? 'DeepSeek Harness plugin';

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${label}\n        ${error.message}`);
  }
};

/** Register into a throwaway context and hand back the provider. */
function registerWith(config = {}, logger = { debug() {}, warn() {} }) {
  let provider = null;
  plugin.apply(
    { logger, web: { registerSearchProvider: (p) => ((provider = p), () => {}) } },
    config,
  );
  assert.ok(provider, 'registerSearchProvider was never called');
  return provider;
}

console.log('\nmodule contract');
check('exports name / inject / apply', () => {
  assert.equal(typeof plugin.name, 'string');
  assert.deepEqual(plugin.inject, ['web']);
  assert.equal(typeof plugin.apply, 'function');
});

check('has no default export', () => {
  // The loader normalizes module shapes with `exports = exports.default ?? exports`,
  // so a default export shadows the namespace. A bare `apply` carries no `inject`,
  // and the plugin then dies on its first service access with
  // `cannot get property "web" without inject` — taking the entire plugin tree
  // down, so `dsh web` will not start at all. Both shipped providers next to this
  // one export zero defaults, for the same reason.
  assert.ok(!('default' in plugin), 'remove `export default` from lib/index.js');
});

console.log('\nregistration');
check('apply() registers exactly one provider', () => {
  assert.equal(registerWith({}).id, plugin.PROVIDER_ID);
});

check('available() is true without touching the network', () => {
  assert.equal(registerWith({}).available(), true);
});

console.log('\nconfig');
check('an unknown engine list falls back to the defaults', () => {
  assert.deepEqual(registerWith({ engines: ['nope', 'also-nope'] }).resolveConfig().engines, [
    ...plugin.DEFAULTS.engines,
  ]);
});

check('`bing` expands to both Bing legs', () => {
  assert.deepEqual(expandEngines(['bing']), ['bing-rss', 'bing-html']);
});

check('`360` expands to so360', () => {
  assert.deepEqual(expandEngines(['360']), ['so360']);
});

check('every alias target is a real engine', () => {
  for (const [alias, ids] of Object.entries(ENGINE_ALIASES)) {
    for (const id of ids) {
      assert.ok(Object.hasOwn(ENGINES, id), `alias ${alias} -> unknown engine ${id}`);
    }
  }
});

check('requested order is preserved and repeats collapse', () => {
  assert.deepEqual(expandEngines(['so360', 'bing', 'so360']), ['so360', 'bing-rss', 'bing-html']);
});

check('google defaults to auto', () => {
  assert.equal(registerWith({}).resolveConfig().google, 'auto');
});

check('an unknown google mode falls back to auto', () => {
  assert.equal(registerWith({ google: 'maybe' }).resolveConfig().google, 'auto');
});

check('google: off is honoured', () => {
  assert.equal(registerWith({ google: 'off' }).resolveConfig().google, 'off');
});

check('budget and probe TTL take positive integers only', () => {
  const config = registerWith({ budgetMs: -1, probeTtlMs: 'abc' }).resolveConfig();
  assert.equal(config.budgetMs, plugin.DEFAULTS.budgetMs);
  assert.equal(config.probeTtlMs, plugin.DEFAULTS.probeTtlMs);
});

check('redirect expansion is on by default', () => {
  assert.equal(registerWith({}).resolveConfig().resolveRedirects, true);
});

check('redirect expansion can be switched off by name or number', () => {
  for (const value of ['off', '0', 'false', false]) {
    assert.equal(registerWith({ resolveRedirects: value }).resolveConfig().resolveRedirects, false);
  }
});

check('maxResolve takes positive integers only', () => {
  assert.equal(registerWith({ maxResolve: 0 }).resolveConfig().maxResolve, plugin.DEFAULTS.maxResolve);
});

console.log('\ndedupe keys');
check('a tracking parameter does not make a second slot', () => {
  assert.equal(
    dedupeKey('https://example.com/a?utm_source=x'),
    dedupeKey('https://example.com/a/'),
  );
});

check('a real query parameter keeps two documents apart', () => {
  assert.notEqual(
    dedupeKey('https://example.com/item?id=1'),
    dedupeKey('https://example.com/item?id=2'),
  );
});

check('360-style shells with distinct payloads are not merged', () => {
  const merged = dedupe([
    { url: 'https://www.so.com/link?m=AAA', title: 'A' },
    { url: 'https://www.so.com/link?m=BBB', title: 'B' },
    { url: 'https://www.so.com/link?m=CCC', title: 'C' },
  ]);
  assert.equal(merged.length, 3, 'query payloads must survive dedupe');
});

console.log('\nbundle patch agrees with the code');
const patch = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8');
const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));

check('pins web.searchProvider to this provider', () => {
  const pinned = /^\s*searchProvider:\s*(\S+)\s*$/m.exec(patch);
  assert.ok(pinned, 'cordis.patch.yml has no searchProvider line');
  assert.equal(pinned[1], plugin.PROVIDER_ID);
});

check('restates fetchProvider alongside it', () => {
  assert.match(
    patch,
    /^\s*fetchProvider:\s*http\s*$/m,
    'a patch replaces the whole config object, so fetchProvider must be restated',
  );
});

check('inserts the package by its own name', () => {
  assert.match(patch, new RegExp(`name:\\s*${manifest.name}\\b`));
});

check('package.json declares the bundle patch', () => {
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
});

console.log(`\nlive search — "${QUERY}"`);
const live = registerWith({});
const config = live.resolveConfig();
const startedAt = Date.now();
const result = await live.search({ query: QUERY, maxResults: 8 });
const elapsed = Date.now() - startedAt;

console.log(`  engines : ${config.engines.join(' -> ')}`);
console.log(`  google  : ${config.google}`);
console.log(`  took    : ${elapsed}ms`);
console.log(`  sources : ${result.sources.length}  truncated=${result.truncated}`);
console.log('');

for (const [index, source] of result.sources.entries()) {
  console.log(`  ${index + 1}. ${source.title ?? source.url}`);
  console.log(`     ${source.url}`);
  if (source.publishedAt) console.log(`     published: ${source.publishedAt}`);
  if (source.snippet) console.log(`     ${source.snippet.slice(0, 130)}${source.snippet.length > 130 ? '…' : ''}`);
}

check('returned at least one source', () => assert.ok(result.sources.length > 0));
check('every source has an absolute http(s) url', () => {
  for (const source of result.sources) {
    assert.match(source.url, /^https?:\/\//, `bad url: ${source.url}`);
  }
});
check('no source leaked a search-engine self-link', () => {
  for (const source of result.sources) {
    assert.doesNotMatch(
      new URL(source.url).hostname,
      /(^|\.)(bing\.com|so\.com|microsoft\.com|google\.[a-z.]+|yandex\.[a-z.]+)$/i,
    );
  }
});
check('no source leaked a 360 redirect shell', () => {
  for (const source of result.sources) {
    assert.doesNotMatch(source.url, /\/link\?m=/, `shell left in place: ${source.url}`);
  }
});
check('publishedAt, when present, is ISO-8601', () => {
  for (const source of result.sources) {
    if (!source.publishedAt) continue;
    assert.ok(!Number.isNaN(Date.parse(source.publishedAt)), `bad date: ${source.publishedAt}`);
  }
});
check('sources are deduped', () => {
  const keys = result.sources.map((s) => dedupeKey(s.url));
  assert.equal(new Set(keys).size, keys.length);
});
check('the search stayed inside its time budget', () => {
  assert.ok(elapsed < config.budgetMs, `${elapsed}ms exceeded budget ${config.budgetMs}ms`);
});

console.log('\nerror paths');
const blank = registerWith({});
await assert.rejects(
  () => blank.search({ query: '   ' }),
  (error) => {
    check('empty query is refused with a coded error', () => assert.equal(error.code, 'WEB_PROVIDER_ERROR'));
    return true;
  },
);

const preAborted = AbortSignal.abort();
await assert.rejects(
  () => blank.search({ query: 'anything' }, preAborted),
  (error) => {
    check('a pre-aborted signal yields WEB_ABORTED', () => assert.equal(error.code, 'WEB_ABORTED'));
    return true;
  },
);

console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
