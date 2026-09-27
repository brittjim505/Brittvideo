import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { config } from '../config.js';

/**
 * Safe fetching of public websites (website analysis). Protections:
 * - http/https only, standard ports only;
 * - every resolved IP is checked at connect time (also defeats DNS rebinding): private, loopback, link-local,
 *   carrier-grade NAT, multicast and cloud-metadata addresses are refused;
 * - size and time limits; at most 4 redirects, each re-checked.
 * Non-live environments may allow private addresses for tests only (config ALLOW_PRIVATE_FETCH).
 */
export class FetchRefused extends Error {}

function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

const allowPrivate = () => !config().isLive && process.env.ALLOW_PRIVATE_FETCH === 'true';

function guardedLookup(hostname: string, options: any, cb: any) {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return cb(err);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((x) => isPrivate(x.address));
    if (bad && !allowPrivate()) return cb(new FetchRefused(`Refused to connect to a private network address (${hostname}).`));
    if (options && options.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}

export interface FetchResult { url: string; status: number; contentType: string; body: Buffer }

export async function safeFetch(rawUrl: string, opts: { maxBytes?: number; timeoutMs?: number; accept?: string } = {}, redirects = 0): Promise<FetchResult> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new FetchRefused('That website address is not valid.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new FetchRefused('Only http and https websites can be analyzed.');
  if (u.port && !['80', '443'].includes(u.port) && !allowPrivate()) throw new FetchRefused('Only standard web ports are allowed.');
  if (u.username || u.password) throw new FetchRefused('Website addresses with passwords are not allowed.');
  if (net.isIP(u.hostname) && isPrivate(u.hostname) && !allowPrivate()) throw new FetchRefused('Refused to connect to a private network address.');
  const maxBytes = opts.maxBytes ?? 3_000_000, timeoutMs = opts.timeoutMs ?? 12_000;
  const mod = u.protocol === 'https:' ? https : http;
  const res = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = mod.request(u, {
      method: 'GET', lookup: guardedLookup as any, timeout: timeoutMs,
      headers: { 'User-Agent': 'BrittVideoBot/1.0 (website analysis for a video proposal)', Accept: opts.accept ?? 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5' },
    }, (r) => {
      const chunks: Buffer[] = []; let size = 0;
      r.on('data', (c: Buffer) => { size += c.length; if (size > maxBytes) { req.destroy(new FetchRefused('The page or file is too large.')); return; } chunks.push(c); });
      r.on('end', () => resolve({ status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(chunks) }));
      r.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new FetchRefused('The website took too long to answer.')));
    req.on('error', reject);
    req.end();
  });
  if (res.status >= 300 && res.status < 400 && res.headers.location) {
    if (redirects >= 4) throw new FetchRefused('The website redirected too many times.');
    return safeFetch(new URL(res.headers.location, u).toString(), opts, redirects + 1);
  }
  return { url: u.toString(), status: res.status, contentType: String(res.headers['content-type'] ?? ''), body: res.body };
}

export const _test = { isPrivate };
