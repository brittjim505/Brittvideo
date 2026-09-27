import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { sha256 } from '../lib/util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../migrations');

export interface MigrationResult { applied: string[]; alreadyApplied: number; backupFile?: string | null }

export function listMigrationFiles(dir = MIGRATIONS_DIR) {
  return fs.readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()
    .map((f) => { const sql = fs.readFileSync(path.join(dir, f), 'utf8'); return { name: f, sql, checksum: sha256(sql) }; });
}

export async function pendingMigrations(pool: pg.Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Map((await pool.query('SELECT name, checksum FROM schema_migrations')).rows.map((r) => [r.name, r.checksum]));
  const files = listMigrationFiles();
  for (const f of files) {
    const c = applied.get(f.name);
    if (c && c !== f.checksum) {
      throw new Error(`Migration ${f.name} was changed after it was applied. BrittVideo will not start, to protect your data. (Developer: add a new migration instead of editing an old one.)`);
    }
  }
  return { files: files.filter((f) => !applied.has(f.name)), appliedCount: applied.size };
}

async function databaseHasBusinessData(pool: pg.Pool) {
  const r = await pool.query(`SELECT to_regclass('public.users') IS NOT NULL AS has`);
  if (!r.rows[0].has) return false;
  const c = await pool.query('SELECT count(*)::int AS n FROM users');
  return c.rows[0].n > 0;
}

/**
 * Apply pending migrations, each in its own transaction.
 * If the database already holds business data, a verified backup is taken first (the rollback path, Y22/Y23).
 */
export async function migrate(pool: pg.Pool, opts: { backup?: (reason: 'pre_migration') => Promise<string | null> } = {}): Promise<MigrationResult> {
  const { files, appliedCount } = await pendingMigrations(pool);
  if (!files.length) return { applied: [], alreadyApplied: appliedCount };
  let backupFile: string | null = null;
  if (opts.backup && (await databaseHasBusinessData(pool))) backupFile = await opts.backup('pre_migration');
  const applied: string[] = [];
  for (const f of files) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(f.sql);
      await c.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1,$2)', [f.name, f.checksum]);
      await c.query('COMMIT');
      applied.push(f.name);
    } catch (e: any) {
      await c.query('ROLLBACK').catch(() => {});
      throw new Error(`Database upgrade step ${f.name} failed and was rolled back; your data was not changed by it. ${backupFile ? 'A backup was taken just before: ' + path.basename(backupFile) + '. ' : ''}Details: ${e.message}`);
    } finally { c.release(); }
  }
  return { applied, alreadyApplied: appliedCount, backupFile };
}
