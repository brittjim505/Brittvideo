import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import type pg from 'pg';
import { config } from '../../config.js';
import { APP_VERSION } from '../../version.js';

/**
 * Encrypted, checksummed PostgreSQL backups (Q20, Q21, V21, W30).
 * File layout: "BVBACKUP1\n" + JSON header line + "\n" + iv(12) + tag(16) + AES-256-GCM(pg_dump custom format).
 * Sync is not backup: these files are independent point-in-time copies. Copy BACKUP_DIR off-site (see docs).
 */
const MAGIC = 'BVBACKUP1\n';

function bin(name: string) { const d = config().PG_BIN_DIR; return d ? path.join(d, name) : name; }

function run(cmd: string, args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = []; const err: Buffer[] = [];
    p.stdout.on('data', (d) => out.push(d)); p.stderr.on('data', (d) => err.push(d));
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve(Buffer.concat(out))
      : reject(new Error(`${path.basename(cmd)} failed: ${Buffer.concat(err).toString().slice(0, 500)}`)));
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

function keyBuf() { return Buffer.from(config().BACKUP_ENCRYPTION_KEY, 'base64'); }

export interface BackupHeader { app: 'BrittVideo'; appVersion: string; env: string; createdAt: string; kind: string; dumpSha256: string; database: string }

export async function createBackup(pool: pg.Pool, kind: 'scheduled' | 'manual' | 'pre_migration' | 'pre_restore' | 'pre_import', databaseUrl = config().DATABASE_URL) {
  const hasTable = (await pool.query(`SELECT to_regclass('public.backups') IS NOT NULL AS has`)).rows[0].has;
  const rec = hasTable ? (await pool.query(`INSERT INTO backups (kind, status) VALUES ($1,'running') RETURNING id`, [kind])).rows[0] : null;
  try {
    fs.mkdirSync(config().BACKUP_DIR, { recursive: true });
    const dump = await run(bin('pg_dump'), ['--format=custom', '--no-owner', '--no-privileges', databaseUrl]);
    const dumpSha = crypto.createHash('sha256').update(dump).digest('hex');
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', keyBuf(), iv);
    const enc = Buffer.concat([c.update(dump), c.final()]);
    const header: BackupHeader = { app: 'BrittVideo', appVersion: APP_VERSION, env: config().APP_ENV, createdAt: new Date().toISOString(), kind, dumpSha256: dumpSha, database: databaseUrl.split('/').pop()!.split('?')[0] };
    const stamp = header.createdAt.replace(/[:.]/g, '-');
    const file = path.join(config().BACKUP_DIR, `brittvideo-${header.env}-${stamp}-${kind}.bvbackup`);
    const body = Buffer.concat([Buffer.from(MAGIC + JSON.stringify(header) + '\n'), iv, c.getAuthTag(), enc]);
    fs.writeFileSync(file, body, { mode: 0o600 });
    const fileSha = crypto.createHash('sha256').update(body).digest('hex');
    // Verify immediately: the file must decrypt and match the dump checksum (a backup that cannot be read is not a backup).
    const verified = readBackup(file).dump.equals(dump);
    if (rec) await pool.query(
      `UPDATE backups SET status='succeeded', file_name=$2, bytes=$3, sha256=$4, finished_at=now(), verified_at=now(),
         verify_status=$5, owner_message=$6 WHERE id=$1`,
      [rec.id, path.basename(file), body.length, fileSha, verified ? 'passed' : 'failed',
        verified ? 'Backup created and checked.' : 'Backup file could not be verified.']);
    if (!verified) throw new Error('Backup verification failed');
    const media = backupMedia();
    return { file, bytes: body.length, sha256: fileSha, header, media };
  } catch (e: any) {
    if (rec) await pool.query(`UPDATE backups SET status='failed', finished_at=now(), owner_message=$2 WHERE id=$1`,
      [rec.id, 'The backup could not be completed. BrittVideo will try again and alert support if it keeps failing.']);
    throw e;
  }
}

export function readBackup(file: string): { header: BackupHeader; dump: Buffer } {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, MAGIC.length).toString() !== MAGIC) throw new Error('This is not a BrittVideo backup file.');
  const nl = buf.indexOf(0x0a, MAGIC.length);
  const header = JSON.parse(buf.subarray(MAGIC.length, nl).toString()) as BackupHeader;
  const rest = buf.subarray(nl + 1);
  const d = crypto.createDecipheriv('aes-256-gcm', keyBuf(), rest.subarray(0, 12));
  d.setAuthTag(rest.subarray(12, 28));
  const dump = Buffer.concat([d.update(rest.subarray(28)), d.final()]);
  const sha = crypto.createHash('sha256').update(dump).digest('hex');
  if (sha !== header.dumpSha256) throw new Error('Backup contents do not match their checksum.');
  return { header, dump };
}

/** Snapshot of protected state that a restore must never undo (Q23, Q24, V22). */
async function protectedState(pool: pg.Pool) {
  const unsub = (await pool.query(`SELECT client_id, changed_at, changed_by, reason FROM marketing_preferences WHERE status='unsubscribed'`)).rows;
  const tomb = (await pool.query(`SELECT id, sha256 FROM assets WHERE status='permanently_deleted'`)).rows;
  return { unsub, tomb };
}

/**
 * Restore a backup into the database at `targetUrl`.
 * A pre-restore backup of the target is taken first. Unsubscribes and permanent deletions that exist in the current
 * database are re-applied after the restore, so a restore can never re-subscribe a client or resurrect a deleted asset.
 */
export async function restoreBackup(file: string, target: { pool: pg.Pool; url: string }, opts: { skipPreRestoreBackup?: boolean } = {}) {
  const { header, dump } = readBackup(file);
  let preRestore: string | null = null;
  let keep = { unsub: [] as any[], tomb: [] as any[] };
  const hasSchema = (await target.pool.query(`SELECT to_regclass('public.users') IS NOT NULL AS has`)).rows[0].has;
  if (hasSchema) {
    keep = await protectedState(target.pool);
    if (!opts.skipPreRestoreBackup) preRestore = (await createBackup(target.pool, 'pre_restore', target.url)).file;
  }
  // Atomic restore: the drop and the full reload run in ONE transaction. If anything fails, the target database is
  // left exactly as it was (never empty or half-restored).
  const script = await run(bin('pg_restore'), ['--no-owner', '--no-privileges', '-f', '-'], dump);
  const wrapped = Buffer.concat([Buffer.from('DROP SCHEMA public CASCADE;\nCREATE SCHEMA public;\n'), script]);
  await run(bin('psql'), ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-d', target.url, '-f', '-'], wrapped);
  let reapplied = 0;
  for (const u of keep.unsub) {
    const r = await target.pool.query(
      `UPDATE marketing_preferences SET status='unsubscribed', changed_at=$2, changed_by=$3, reason=$4
         WHERE client_id=$1 AND status<>'unsubscribed'`, [u.client_id, u.changed_at, u.changed_by, u.reason]);
    reapplied += r.rowCount ?? 0;
  }
  for (const t of keep.tomb) {
    const r = await target.pool.query(`UPDATE assets SET status='permanently_deleted', storage_key=NULL WHERE id=$1 AND status<>'permanently_deleted'`, [t.id]);
    reapplied += r.rowCount ?? 0;
  }
  const mediaRestored = restoreMedia();
  return { header, preRestoreBackup: preRestore, protectedStateReapplied: reapplied, mediaRestored };
}

/**
 * Media (images and, later, videos) is backed up as an encrypted, content-addressed mirror next to the database
 * backups: each file is copied once, so nightly runs are cheap. Restoring puts back any missing file.
 */
export function backupMedia(): { copied: number; total: number } {
  const src = path.join(config().STORAGE_DIR, 'media');
  const dst = path.join(config().BACKUP_DIR, 'media');
  if (!fs.existsSync(src)) return { copied: 0, total: 0 };
  let copied = 0, total = 0;
  for (const sub of fs.readdirSync(src)) for (const f of fs.readdirSync(path.join(src, sub))) {
    total++;
    const out = path.join(dst, sub, f + '.enc');
    if (fs.existsSync(out)) continue;
    const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', keyBuf(), iv);
    const enc = Buffer.concat([c.update(fs.readFileSync(path.join(src, sub, f))), c.final()]);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.concat([iv, c.getAuthTag(), enc]), { mode: 0o600 });
    copied++;
  }
  return { copied, total };
}

export function restoreMedia(): number {
  const src = path.join(config().BACKUP_DIR, 'media'); const dst = path.join(config().STORAGE_DIR, 'media');
  if (!fs.existsSync(src)) return 0;
  let restored = 0;
  for (const sub of fs.readdirSync(src)) for (const f of fs.readdirSync(path.join(src, sub))) {
    const out = path.join(dst, sub, f.replace(/\.enc$/, ''));
    if (fs.existsSync(out)) continue;
    const buf = fs.readFileSync(path.join(src, sub, f));
    const d = crypto.createDecipheriv('aes-256-gcm', keyBuf(), buf.subarray(0, 12)); d.setAuthTag(buf.subarray(12, 28));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.concat([d.update(buf.subarray(28)), d.final()]));
    restored++;
  }
  return restored;
}

export function listBackupFiles() {
  const dir = config().BACKUP_DIR;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.bvbackup')).sort().reverse()
    .map((f) => ({ file: path.join(dir, f), name: f, bytes: fs.statSync(path.join(dir, f)).size }));
}

/** Remove scheduled backups older than the retention period; never removes the newest 7 or pre-migration/pre-restore ones. */
export function pruneBackups(now = Date.now()) {
  const days = config().BACKUP_RETENTION_DAYS;
  const files = listBackupFiles().filter((f) => f.name.includes('-scheduled.'));
  let removed = 0;
  files.slice(7).forEach((f) => {
    if (now - fs.statSync(f.file).mtimeMs > days * 86400_000) { fs.unlinkSync(f.file); removed++; }
  });
  return removed;
}
