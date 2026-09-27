import crypto from 'node:crypto';

function key(b64: string): Buffer {
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('Encryption keys must be 32 bytes, base64-encoded (see .env.example).');
  return k;
}

/** AES-256-GCM. Output: base64(iv[12] | tag[16] | ciphertext). */
export function encrypt(plain: string | Buffer, keyB64: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(keyB64), iv);
  const data = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}
export function decrypt(b64: string, keyB64: string): Buffer {
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(keyB64), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}

/** Password hashing with scrypt (no native dependencies). Format: scrypt$N$r$p$salt$hash */
const N = 32768, R = 8, P = 1, LEN = 64;
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await new Promise<Buffer>((res, rej) =>
    crypto.scrypt(pw, salt, LEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 }, (e, k) => (e ? rej(e) : res(k))));
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const got = await new Promise<Buffer>((res, rej) =>
    crypto.scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2 }, (e, k) => (e ? rej(e) : res(k))));
  return crypto.timingSafeEqual(expected, got);
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters. A short sentence you will remember works well.';
  if (/^(.)\1+$/.test(pw)) return 'That password is too easy to guess.';
  return null;
}
