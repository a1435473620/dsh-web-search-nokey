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
 * GET a URL and decode the body as UTF-8 text, following redirects.
 *
 * @param {string} targetUrl - absolute http(s) URL.
 * @param {object} [options]
 * @param {number} [options.timeoutMs=12000] - per-attempt socket timeout.
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @param {string} [options.proxy] - HTTP proxy URL; omit for a direct connection.
 * @param {string} [options.userAgent] - override the default UA.
 * @param {number} [options.hops] - internal redirect counter.
 * @returns {Promise<{status: number, body: string, finalUrl: string}>}
 */
export function getText(targetUrl, options = {}) {
  const {
    timeoutMs = 12000,
    signal,
    proxy,
    userAgent = DEFAULT_USER_AGENT,
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
    } catch (error) {
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
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
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
          resolve({
            status,
            body: Buffer.concat(chunks).toString('utf8'),
            finalUrl: targetUrl,
          });
        });
      },
    );

    const onAbort = () => request.destroy(signal.reason ?? new Error('aborted'));
    signal?.addEventListener('abort', onAbort, { once: true });

    request.on('close', () => signal?.removeEventListener('abort', onAbort));
    request.on('timeout', () => request.destroy(new Error(`timed out after ${timeoutMs}ms`)));
    request.on('error', reject);
    request.end();
  });
}
