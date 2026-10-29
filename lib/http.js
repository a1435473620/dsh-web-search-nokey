/**
 * A minimal HTTP client, written against node:http / node:https directly.
 *
 * Why not global fetch:
 *   - Node's fetch ignores HTTP_PROXY / HTTPS_PROXY. Anything behind a proxy
 *     needs a hand-rolled CONNECT tunnel, which fetch gives no hook for.
 *   - `redirect: 'error'` would refuse the legitimate redirects these search
 *     endpoints issue, and `follow` has no hop limit to clamp.
 * Both are solved here in about a hundred lines with no dependencies.
 *
 * Three things this layer owns so the engines do not have to:
 *   - decoding, including pages that are not utf-8 (see `decodeBody`);
 *   - one retry for a connection that died mid-flight (see `retryable`);
 *   - handing the response headers back, so `Retry-After` survives as far as
 *     `tryHosts` in search.js.
 *
 * @module dsh-web-search-nokey/http
 */

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { URL } from 'node:url';

/** Look like an ordinary desktop browser; the endpoints below block bare clients. */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MAX_HOPS = 5;
const MAX_BODY_BYTES = 6 * 1024 * 1024;

/**
 * Failures worth a second try: the connection died, or the peer never answered.
 * A refused CONNECT and a body that blew the size cap are deliberately absent —
 * repeating those spends the time budget twice for the same answer.
 */
const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
]);

const RETRYABLE_TEXT = /socket hang up|premature close|timed out after|connection reset/i;

/**
 * @param {Error & {code?: string}} error
 * @returns {boolean}
 */
export function retryable(error) {
  if (!error) return false;
  if (error.name === 'AbortError' || error.code === 'ABORT_ERR') return false;
  if (error.code && RETRYABLE_CODES.has(error.code)) return true;
  return RETRYABLE_TEXT.test(String(error.message ?? ''));
}

/**
 * Build an agent that tunnels requests through an HTTP proxy via CONNECT.
 * One agent per protocol, cached by the caller.
 *
 * @param {string} proxyUrl - e.g. `http://127.0.0.1:7897`.
 * @param {boolean} forHttps - whether the tunnel target speaks TLS.
 * @returns {http.Agent|https.Agent}
 */
export function createProxyAgent(proxyUrl, forHttps) {
  const p = new URL(proxyUrl);
  const proxyPort = Number(p.port || (p.protocol === 'https:' ? 443 : 80));
  const Agent = forHttps ? https.Agent : http.Agent;

  return new Agent({
    keepAlive: false,
    createConnection(options, callback) {
      const socket = net.connect(proxyPort, p.hostname, () => {
        const target = `${options.host}:${options.port}`;
        socket.write(
          `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Connection: keep-alive\r\n\r\n`,
        );
      });

      let head = '';
      const onData = (chunk) => {
        head += chunk.toString('latin1');
        if (!head.includes('\r\n\r\n')) return;
        socket.removeListener('data', onData);

        if (!/^HTTP\/1\.[01] 200/.test(head)) {
          callback(new Error(`proxy CONNECT refused: ${head.split('\r\n')[0]}`));
          return;
        }
        if (!forHttps) {
          callback(null, socket);
          return;
        }

        const secured = tls.connect({ socket, servername: options.host });
        secured.once('secureConnect', () => callback(null, secured));
        secured.once('error', callback);
      };

      socket.on('data', onData);
      socket.once('error', callback);
    },
  });
}

/**
 * Labels that mean "a GB-family page" under another name. `gb2312` is a subset
 * of `gbk`, and browsers have always treated the label as `gbk`.
 */
const CHARSET_ALIASES = {
  gb2312: 'gbk',
  'gb_2312-80': 'gbk',
  'x-gbk': 'gbk',
  cp936: 'gbk',
  'euc-cn': 'gbk',
};

/** How much of the body the `<meta charset>` scan is allowed to read. */
const META_SNIFF_BYTES = 4096;

/**
 * Find the page's charset: the HTTP header first, the `<meta>` declaration
 * second, nothing third.
 *
 * The header wins when present, but these result pages are often served as bare
 * `text/html` with no charset at all — hence the sniff. The scan reads bytes as
 * latin1 so offsets stay one byte per character and a multi-byte decode can
 * never split a declaration in half.
 *
 * @param {object} headers - response headers, lower-cased by node.
 * @param {Buffer} buffer
 * @returns {string|null}
 */
export function charsetOf(headers, buffer) {
  const contentType = String(headers?.['content-type'] ?? '');
  let label = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1];

  if (!label) {
    const head = buffer.subarray(0, META_SNIFF_BYTES).toString('latin1');
    label =
      /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1] ??
      /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([\w.:-]+)/i.exec(head)?.[1];
  }

  return label ? label.trim().toLowerCase() : null;
}

/**
 * Decode a response body using its declared charset, falling back to utf-8.
 *
 * Baidu has served GBK for most of its life and still does on some edges.
 * Decoding those as utf-8 does not throw — it produces mojibake, every parser
 * then reports "no usable rows", and the log reads like a block. That is the
 * worst failure shape available, so it is handled here rather than there.
 *
 * @param {Buffer} buffer
 * @param {object} headers
 * @returns {string}
 */
export function decodeBody(buffer, headers) {
  const label = charsetOf(headers, buffer);
  if (!label || label === 'utf-8' || label === 'utf8') return buffer.toString('utf8');

  const normalized = CHARSET_ALIASES[label] ?? label;
  try {
    return new TextDecoder(normalized).decode(buffer);
  } catch {
    // An unknown label is the page guessing, not a fact. utf-8 is the safer
    // second guess, and being wrong here costs one engine's rows, not the search.
    return buffer.toString('utf8');
  }
}

/**
 * One GET, following redirects, with no retry of its own.
 *
 * @param {string} targetUrl
 * @param {object} options
 * @returns {Promise<{status: number, body: string, finalUrl: string, headers: object}>}
 */
function requestOnce(targetUrl, options) {
  const {
    timeoutMs = 12000,
    signal,
    proxy,
    userAgent = DEFAULT_USER_AGENT,
    acceptLanguage = 'zh-CN,zh;q=0.9,en;q=0.8',
    hops = 0,
  } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }

    let url;
    try {
      url = new URL(targetUrl);
    } catch {
      reject(new Error(`not a URL: ${targetUrl}`));
      return;
    }

    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const port = url.port || (isHttps ? 443 : 80);

    const request = transport.request(
      {
        method: 'GET',
        host: url.hostname,
        port,
        path: url.pathname + url.search,
        headers: {
          'user-agent': userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': acceptLanguage,
          'cache-control': 'no-cache',
        },
        agent: proxy ? createProxyAgent(proxy, isHttps) : undefined,
        timeout: timeoutMs,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;

        if ([301, 302, 303, 307, 308].includes(status) && location) {
          response.resume();
          if (hops >= MAX_HOPS) {
            reject(new Error(`too many redirects starting at ${targetUrl}`));
            return;
          }
          // A redirect is a fresh request, so it gets a fresh retry budget.
          resolve(
            getText(new URL(location, targetUrl).toString(), { ...options, hops: hops + 1 }),
          );
          return;
        }

        const chunks = [];
        let total = 0;
        response.on('data', (chunk) => {
          total += chunk.length;
          if (total > MAX_BODY_BYTES) {
            request.destroy(new Error('response body too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            status,
            body: decodeBody(body, response.headers),
            finalUrl: targetUrl,
            headers: response.headers,
          });
        });
      },
    );

    const onAbort = () => {
      const error = signal.reason ?? new Error('aborted');
      if (error && typeof error === 'object' && !error.name) error.name = 'AbortError';
      request.destroy(error);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    request.on('close', () => signal?.removeEventListener('abort', onAbort));
    request.on('timeout', () => request.destroy(new Error(`timed out after ${timeoutMs}ms`)));
    request.on('error', reject);
    request.end();
  });
}

/** Jittered pause before attempt `n + 1`: 120–300ms, growing a little. */
function backoff(n, signal) {
  const delay = 120 + Math.floor(Math.random() * 180) + (n - 1) * 120;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * GET a URL and decode the body as text, following redirects and retrying a
 * connection that died mid-flight.
 *
 * @param {string} targetUrl - absolute http(s) URL.
 * @param {object} [options]
 * @param {number} [options.timeoutMs=12000] - per-attempt socket timeout.
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @param {string} [options.proxy] - HTTP proxy URL; omit for a direct connection.
 * @param {string} [options.userAgent] - override the default UA.
 * @param {string} [options.acceptLanguage] - override the default Accept-Language.
 * @param {number} [options.retries=1] - extra attempts after a transport failure.
 * @param {number} [options.hops] - internal redirect counter.
 * @returns {Promise<{status: number, body: string, finalUrl: string, headers: object}>}
 */
export function getText(targetUrl, options = {}) {
  return withRetry(targetUrl, options, 1);
}

/**
 * @param {string} targetUrl
 * @param {object} options
 * @param {number} n - which attempt this is, 1-based.
 */
async function withRetry(targetUrl, options, n) {
  try {
    return await requestOnce(targetUrl, options);
  } catch (error) {
    const extra = Number.isInteger(options.retries) ? Math.max(0, options.retries) : 1;
    if (n >= 1 + extra || options.signal?.aborted || !retryable(error)) throw error;
    await backoff(n, options.signal);
    return withRetry(targetUrl, options, n + 1);
  }
}
