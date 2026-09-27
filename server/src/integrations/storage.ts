import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Media storage adapter (R6, Y17). Local disk now; an S3-compatible adapter can replace it without touching callers.
 * Keys are content-addressed, so storing the same file twice is harmless.
 */
export interface StoredObject { key: string; sha256: string; bytes: number }

export function putObject(data: Buffer, ext: string): StoredObject {
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  const key = `media/${sha.slice(0, 2)}/${sha}.${ext.replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin'}`;
  const full = path.join(config().STORAGE_DIR, key);
  if (!fs.existsSync(full)) { fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, data); }
  return { key, sha256: sha, bytes: data.length };
}

export function objectPath(key: string): string | null {
  if (!/^media\/[0-9a-f]{2}\/[0-9a-f]{64}\.[a-z0-9]{1,5}$/i.test(key)) return null;   // no path traversal
  const full = path.join(config().STORAGE_DIR, key);
  return fs.existsSync(full) ? full : null;
}

export function deleteObject(key: string) { const p = objectPath(key); if (p) fs.unlinkSync(p); }
