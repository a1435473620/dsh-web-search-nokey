/**
 * Smoke test — run with `npm run smoke`, or `node test/smoke.mjs "your query"`.
 *
 * Covers the three things that actually break a provider plugin:
 *   1. the module contract (`name` / `inject` / `apply` registering one provider),
 *   2. the bundle patch agreeing with the code (a rename on one side only is
 *      silent at load time and shows up as WEB_PROVIDER_CONFIGURED_MISSING),
 *   3. a live query coming back in the seam's source shape.
 *
 * No test framework: adding one would mean a devDependency and a build step for
 * a package that is otherwise three files of plain ESM.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as plugin from '../lib/index.js';

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

console.log('\nmodule contract');
check('exports name / inject / apply', () => {
  assert.equal(typeof plugin.name, 'string');
  assert.deepEqual(plugin.inject, ['web']);
  assert.equal(typeof plugin.apply, 'function');
});

console.log('\nregistration');
let registered = null;
const fakeContext = {
  logger: { debug: () => {}, warn: () => {} },
  web: {
    registerSearchProvider(provider) {
      registered = provider;
      return () => {};
    },
  },
};
check('apply() registers exactly one provider', () => {
  plugin.apply(fakeContext, {});
  assert.ok(registered, 'registerSearchProvider was never called');
  assert.equal(registered.id, plugin.PROVIDER_ID);
});

check('available() is true without touching the network', () => {
  assert.equal(registered.available(), true);
});

check('an unknown engine list falls back to the defaults', () => {
  plugin.apply(fakeContext, { engines: ['nope', 'also-nope'] });
  assert.deepEqual(registered.resolveConfig().engines, plugin.DEFAULTS.engines);
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
const startedAt = Date.now();
const result = await registered.search({ query: QUERY, maxResults: 8 });
const elapsed = Date.now() - startedAt;

console.log(`  engines : ${registered.resolveConfig().engines.join(' -> ')}`);
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
    assert.doesNotMatch(new URL(source.url).hostname, /(^|\.)(bing\.com|so\.com|microsoft\.com)$/i);
  }
});
check('publishedAt, when present, is ISO-8601', () => {
  for (const source of result.sources) {
    if (!source.publishedAt) continue;
    assert.ok(!Number.isNaN(Date.parse(source.publishedAt)), `bad date: ${source.publishedAt}`);
  }
});
check('sources are deduped', () => {
  const keys = result.sources.map((s) => {
    const url = new URL(s.url);
    return `${url.hostname}${url.pathname}`.toLowerCase();
  });
  assert.equal(new Set(keys).size, keys.length);
});

console.log('\nerror paths');
await assert.rejects(
  () => registered.search({ query: '   ' }),
  (error) => {
    check('empty query is refused with a coded error', () => assert.equal(error.code, 'WEB_PROVIDER_ERROR'));
    return true;
  },
);

const preAborted = AbortSignal.abort();
await assert.rejects(
  () => registered.search({ query: 'anything' }, preAborted),
  (error) => {
    check('a pre-aborted signal yields WEB_ABORTED', () => assert.equal(error.code, 'WEB_ABORTED'));
    return true;
  },
);

console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
