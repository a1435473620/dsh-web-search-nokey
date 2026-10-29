/**
 * Live engine check — run with `npm run live`, on a machine whose network can
 * actually reach the engine you want to verify.
 *
 * It exists because the Google and Yandex parsers cannot be validated against
 * real markup from a plain mainland-China connection: Google is unreachable and
 * Yandex answers with a captcha. Everything else here is verified against live
 * responses in `test/parsers.mjs`.
 *
 *   node test/live-engines.mjs              # every engine
 *   node test/live-engines.mjs google       # just one
 *   HTTPS_PROXY=http://127.0.0.1:7897 node test/live-engines.mjs
 */

import { ENGINES } from '../lib/search.js';
import { getText } from '../lib/http.js';

const wanted = process.argv.slice(2).filter((entry) => !entry.startsWith('-'));
const ids = wanted.length ? wanted : Object.keys(ENGINES);
const proxy = process.env.DSH_WEB_SEARCH_NOKEY_PROXY || process.env.HTTPS_PROXY || '';

console.log(`proxy : ${proxy || '(direct)'}`);
console.log(`engine: ${ids.join(', ')}\n`);

let bad = 0;
for (const id of ids) {
  const engine = ENGINES[id];
  if (!engine) {
    console.log(`FAIL  ${id}: not a known engine (${Object.keys(ENGINES).join(', ')})`);
    bad += 1;
    continue;
  }

  const startedAt = Date.now();
  try {
    const results = await engine('DeepSeek Harness plugin', { timeoutMs: 15000, proxy });
    const elapsed = Date.now() - startedAt;
    const selfLink = results.filter((r) => /(^|\.)(bing|so|google|yandex)\.[a-z.]+$/i.test(new URL(r.url).hostname));
    const withTitle = results.filter((r) => r.title).length;
    const withSnippet = results.filter((r) => r.snippet).length;
    const withDate = results.filter((r) => r.publishedAt).length;

    console.log(
      `OK    ${id.padEnd(9)} ${String(results.length).padStart(2)} 条 ${String(elapsed).padStart(5)}ms` +
        `  标题=${withTitle} 摘要=${withSnippet} 日期=${withDate} 自链=${selfLink.length}`,
    );
    for (const result of results.slice(0, 3)) {
      console.log(`        ${(result.title || '(无标题)').slice(0, 46)}`);
      console.log(`        ${result.url.slice(0, 96)}`);
    }
    if (selfLink.length) {
      console.log('      ^ 自链不会被交付，但说明解壳没生效');
      bad += 1;
    }
  } catch (error) {
    const tag = error.blocked ? 'BLOCK' : 'FAIL ';
    console.log(`${tag} ${id.padEnd(9)} ${String(Date.now() - startedAt).padStart(5)}ms  ${error.message.slice(0, 130)}`);
    bad += 1;
  }
  console.log('');
}

console.log(bad ? `${bad} 个引擎有问题\n` : '全部引擎正常\n');
process.exit(bad ? 1 : 0);
