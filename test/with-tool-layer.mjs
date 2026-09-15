/**
 * Close the last gap: the model-facing `web_search` tool.
 *
 * Already verified — the plugin loads (real boot), the provider registers and is
 * selected (real Context + real WebRuntime), and search returns live results.
 * What sits in between is `dsh-tool-web`: it registers `web_search` and calls
 * `ctx.web.search()`. That is stock code, but "should work" is not "returns
 * results", so this composes the real services and invokes the real tool.
 *
 * Run from the profile directory so `@deepseek-ai/*` resolves:
 *     cd ~/.dsh/profiles/web && node <repo>/test/with-tool-layer.mjs
 */

import { Context } from '@deepseek-ai/cordis';
import { WebRuntime } from '@deepseek-ai/dsh-web';
import * as toolWeb from '@deepseek-ai/dsh-tool-web';
import * as plugin from 'dsh-web-search-nokey';

const load = async (pkg) => {
  try {
    return await import(pkg);
  } catch (error) {
    console.log(`  无法加载 ${pkg} — ${error.code ?? error.message}`);
    return null;
  }
};

const ctx = new Context();

const mount = async (label, mod, config) => {
  if (!mod) {
    console.log(`  跳过  ${label}（模块不可用）`);
    return false;
  }
  try {
    // `apply`-only modules need the namespace; classes are passed through.
    await ctx.plugin(mod.default ?? mod, config);
    console.log(`  ok    ${label}`);
    return true;
  } catch (error) {
    console.log(`  FAIL  ${label}: ${error.message}`);
    return false;
  }
};

console.log('组装服务：');
const sp = await load('@deepseek-ai/dsh-system-prompt');
await mount('systemPrompt', sp ?? Object, {});
const tools = await load('@deepseek-ai/dsh-tools');
// dsh-tools exports the runtime as both a named and a default export; prefer the
// namespace so `unwrapExports` semantics match the loader.
await mount('tools', tools, {});
await mount('web', { default: WebRuntime, ...Object(WebRuntime) }, {
  searchProvider: plugin.PROVIDER_ID,
  fetchProvider: 'http',
});
await mount('tool-web', toolWeb, { fetch: true, searchTimeoutMs: 60000 });
await mount('dsh-web-search-nokey', plugin, {});

console.log('\n服务可见性：');
for (const name of ['systemPrompt', 'tools', 'web']) {
  const instance = ctx.get(name);
  console.log(`  ${name.padEnd(14)} : ${instance ? '已装载' : '未装载'}`);
}

const toolsService = ctx.get('tools');
if (!toolsService) {
  console.log('\nctx.tools 未装载，工具层无法验证。跳过。');
  process.exit(0);
}

const proto = Object.getPrototypeOf(toolsService);
console.log('\nctx.tools 方法 :', Object.getOwnPropertyNames(proto)
  .filter((n) => typeof toolsService[n] === 'function').join(', '));

const search = toolsService.get?.('web_search') ?? toolsService.resolve?.('web_search');
if (!search) {
  console.log('未取到 web_search 工具。跳过。');
  process.exit(0);
}

const execute = search.execute ?? search.run ?? search.handler;
if (typeof execute !== 'function') {
  console.log('工具无可识别的执行方法。跳过。');
  process.exit(0);
}

const startedAt = Date.now();
// The tool signature is `execute(args, exec)`; `exec.signal` is read for
// cancellation, so a bare call needs an execution context supplied.
// `web_search` also takes `queries` — an array, since the tool fans out.
const raw = await execute.call(search, { queries: ['DeepSeek Harness 插件'] }, {
  signal: AbortSignal.timeout(60_000),
});
console.log(`\nweb_search 执行完成，${Date.now() - startedAt}ms\n`);
console.log('──────── 模型将看到的内容 ────────');
console.log((typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)).slice(0, 2500));
