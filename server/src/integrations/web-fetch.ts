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

function isPrivateV4(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224;
}
/** Expand any IPv6 text form (including "::" and an embedded dotted IPv4 tail) into eight 16-bit groups. */
function v6Groups(ip: string): number[] | null {
  let v = ip.toLowerCase().split('%')[0];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (dotted) {
    if (!net.isIPv4(dotted[1])) return null;
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    v = v.slice(0, -dotted[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const halves = v.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [], tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const g = [...head, ...Array(fill).fill('0'), ...tail].map((x) => parseInt(x, 16));
  return g.length === 8 && g.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? g : null;
}
const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** True for any address that is not an ordinary public internet address (fails closed on anything unrecognised). */
function isPrivate(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, '');
  if (net.isIPv4(ip)) return isPrivateV4(ip);
  if (!net.isIPv6(ip)) return true;
  const g = v6Groups(ip);
  if (!g) return true;
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeros(8) || (zeros(7) && g[7] === 1)) return true;                                   // :: and ::1
  if (zeros(5) && g[5] === 0xffff) return isPrivateV4(v4From(g[6], g[7]));                // IPv4-mapped ::ffff:a.b.c.d
  if (zeros(6)) return true;                                                               // deprecated IPv4-compatible ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] !== 0 || g[3] !== 0 || g[4] !== 0 || g[5] !== 0 ? true : isPrivateV4(v4From(g[6], g[7]));  // NAT64
  if (g[0] === 0x2002) return isPrivateV4(v4From(g[1], g[2]));                             // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true;                                          // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true;                                      // documentation
  if ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00) return true;
  return false;
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
  // IP-literal hosts are connected to directly (no DNS lookup), so they are checked here. IPv6 literals keep their [brackets] in URL.hostname.
  const literal = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(literal) && isPrivate(literal) && !allowPrivate()) throw new FetchRefused('Refused to connect to a private network address.');
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
