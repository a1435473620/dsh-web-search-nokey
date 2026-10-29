/**
 * Parser tests — run with `npm run test:parsers`.
 *
 * These pin the parsing half of each engine against markup, with no network.
 * The fixtures for Bing and 360 are captured from live responses; the Google
 * and Yandex ones are hand-written from their documented shapes, because
 * neither is reachable from a plain connection in mainland China. When those
 * two start failing in `test/live-engines.mjs`, this is the file to update.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  isShellUrl,
  isUsableUrl,
  parseBaidu,
  parseBingHtml,
  parseBingRss,
  parseDuckDuckGo,
  parseGoogle,
  parseSo360,
  parseSogou,
  parseYandex,
  unwrapBingUrl,
  unwrapDuckUrl,
  unwrapGoogleUrl,
} from '../lib/search.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFile(join(HERE, 'fixtures', name), 'utf8');

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

/** Every result must be fetchable as-is: absolute, http(s), not the engine. */
function assertClean(results, engineHost) {
  assert.ok(results.length > 0, 'parsed nothing');
  for (const result of results) {
    assert.match(result.url, /^https?:\/\//, `not absolute: ${result.url}`);
    assert.doesNotMatch(new URL(result.url).hostname, engineHost, `self link: ${result.url}`);
  }
}

console.log('\nbing-rss');
const rss = parseBingRss(await fixture('bing-rss.xml'));
check('parses items out of a real feed', () => assertClean(rss, /bing\.com$/i));
check('every item carries a title', () => {
  for (const result of rss) assert.ok(result.title, `missing title: ${result.url}`);
});

console.log('\nbing-html');
const bingHtml = parseBingHtml(await fixture('bing-html.html'));
check('parses blocks out of a real page', () => assertClean(bingHtml, /bing\.com$/i));
check('snippets are text, not markup', () => {
  for (const result of bingHtml) assert.doesNotMatch(result.snippet ?? '', /<[a-z]/i);
});

console.log('\nbing click tracker');
const bingTarget = 'https://example.net/bing-real-target?page=2';
const bingPayload = 'a1' + Buffer.from(bingTarget).toString('base64url');

check('decodes /ck/a?u=a1… without a request', () => {
  assert.equal(
    unwrapBingUrl(`https://www.bing.com/ck/a?!&&p=abc123&u=${bingPayload}&ntb=1`),
    bingTarget,
  );
});

check('leaves an ordinary link alone', () => {
  assert.equal(unwrapBingUrl('https://example.net/plain'), 'https://example.net/plain');
});

check('an undecodable payload falls back to the original href', () => {
  const href = 'https://www.bing.com/ck/a?u=a1@@@';
  assert.equal(unwrapBingUrl(href), href);
  // …and the self-link filter then drops it rather than shipping a dead link.
  assert.equal(isUsableUrl(href), false);
});

check('parseBingHtml applies the unwrap', () => {
  const block = `<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=${bingPayload}">Tracked hit</a></h2><p class="b_lineclamp">snippet</p></li>`;
  const parsed = parseBingHtml(block);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].url, bingTarget);
});

console.log('\nbaidu');
const baidu = parseBaidu(await fixture('baidu.html'));
check('reads the real address from the container mu attribute', () => {
  assert.equal(baidu[0].url, 'https://example.com/baidu-real');
  assert.match(baidu[0].title, /带 mu/);
});
check('a block without mu is kept as a resolvable shell', () => {
  assert.equal(baidu.length, 2, `expected 2 rows, got ${baidu.length}`);
  assert.ok(isShellUrl(baidu[1].url), baidu[1].url);
});
check('the ad block is dropped', () => {
  for (const result of baidu) assert.doesNotMatch(result.url, /ads\.example\.com/);
});
check('a security check is reported as blocked', () => {
  assert.throws(
    () => parseBaidu('<html><title>百度安全验证</title></html>'),
    (error) => error.blocked === true,
  );
});

console.log('\nsogou');
const sogou = parseSogou(await fixture('sogou.html'));
check('data-mdurl wins over the /link shell', () => {
  const withMd = sogou.find((result) => /sogou-real/.test(result.url));
  assert.ok(withMd, 'no row carried the mdurl target');
});
check('a relative /link href becomes an absolute shell', () => {
  const shell = sogou.find((result) => isShellUrl(result.url));
  assert.ok(shell, 'shell row disappeared');
  assert.match(shell.url, /^https:\/\/www\.sogou\.com\/link/);
});
check('the ad block is dropped', () => {
  for (const result of sogou) assert.doesNotMatch(result.url, /ads\.example\.com/);
});

console.log('\nduckduckgo');
const duck = parseDuckDuckGo(await fixture('duckduckgo.html'));
check('unwraps the uddg parameter', () => {
  assert.equal(duck[0].url, 'https://example.com/ddg-real');
});
check('leaves a direct link alone', () => {
  assert.equal(duck[1].url, 'https://example.net/ddg-direct');
});

check('unwrapDuckUrl ignores a non-DDG host', () => {
  assert.equal(unwrapDuckUrl('https://example.com/x'), 'https://example.com/x');
});

console.log('\nso360');
const so = parseSo360(await fixture('so360.html'));
check('lifts the real url out of the /link shell', () => assertClean(so, /so\.com$/i));
check('no redirect shell survives', () => {
  for (const result of so) assert.doesNotMatch(result.url, /\/link\?m=/, result.url);
});
check('the related-search and AI boxes are dropped', () => {
  // The fixture holds five blocks; two of them are boxes, not organic hits.
  assert.equal(so.length, 3, `expected 3 organic rows, got ${so.length}`);
});

console.log('\ngoogle');
check('unwraps /url?q= without keeping the tracking params', () => {
  assert.equal(
    unwrapGoogleUrl('/url?q=https://example.com/a&amp;sa=U&amp;ved=xyz'),
    'https://example.com/a',
  );
});

check('leaves a direct href alone', () => {
  assert.equal(unwrapGoogleUrl('https://example.com/b'), 'https://example.com/b');
});

const googleSynthetic = `
<div class="g"><a href="/url?q=https://example.com/article&amp;sa=U&amp;ved=abc"><h3 class="LC20lb">Example article</h3></a>
<div class="VwiC3b">A snippet about the example.</div></div>
<div class="g"><a href="/url?q=https://example.org/second&amp;sa=U"><h3>Second hit</h3></a>
<div class="VwiC3b">Another snippet.</div></div>`;

const g = parseGoogle(googleSynthetic);
check('parses div.g blocks', () => assertClean(g, /google\.[a-z.]+$/i));
check('titles and snippets come through', () => {
  assert.equal(g[0].title, 'Example article');
  assert.match(g[0].snippet, /snippet about the example/);
});

check('a consent wall is reported as blocked, not as empty', () => {
  assert.throws(
    () => parseGoogle('<html><title>Before you continue to Google</title></html>'),
    (error) => error.blocked === true,
  );
});

console.log('\nyandex');
const yandexSynthetic = `
<li class="serp-item"><div class="organic">
<h2 class="OrganicTitle-Link"><a class="OrganicTitle-Link Link_theme_normal" href="https://example.org/yandex-hit"><span class="OrganicTitleContentSpan">Yandex hit</span></a></h2>
<div class="OrganicText"><span class="OrganicTextContentSpan">Сниппет результата.</span></div>
</div></li>`;

const y = parseYandex(yandexSynthetic);
check('parses serp-item blocks', () => assertClean(y, /yandex\.[a-z.]+$|ya\.ru$/i));
check('reads the nested title span, not the anchor class', () => {
  assert.equal(y[0].title, 'Yandex hit');
});

check('a captcha page is reported as blocked', () => {
  assert.throws(
    () => parseYandex('<html><meta name="SmartCaptcha"></html>'),
    (error) => error.blocked === true,
  );
});

console.log('\nself-link filter');
check('engine hosts are never delivered as results', () => {
  for (const url of [
    'https://www.so.com/link?m=x',
    'https://cn.bing.com/search?q=x',
    'https://www.google.com/search?q=x',
    'https://yandex.com/search/?text=x',
    'https://www.baidu.com/s?wd=x',
    'https://www.sogou.com/web?query=x',
  ]) {
    assert.equal(isUsableUrl(url), false, `accepted ${url}`);
  }
});

check('known shells are shells, not usable links', () => {
  for (const url of [
    'https://www.baidu.com/link?url=x',
    'https://www.sogou.com/link?url=x',
    'https://www.so.com/link?m=x',
    'https://www.bing.com/ck/a?u=a1x',
    'https://www.google.com/url?q=x',
  ]) {
    assert.ok(isShellUrl(url), `not recognised: ${url}`);
    assert.equal(isUsableUrl(url), false, `shell leaked as usable: ${url}`);
  }
  assert.equal(isShellUrl('https://example.com/a'), false);
});

console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
