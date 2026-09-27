import pg from 'pg';
import { config } from '../config.js';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

let pool: pg.Pool | null = null;

// Keep integers/bigints as numbers where safe (counts, bytes) and dates as JS Dates.
pg.types.setTypeParser(20, (v) => Number(v));

export function db(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: config().DATABASE_URL, max: 10 });
    pool.on('error', () => { /* surfaced by health checks; never crash on idle-client errors */ });
  }
  return pool;
}

export async function closeDb() {
  if (pool) { await pool.end(); pool = null; }
}

/** Run fn inside a transaction; rolls back on any error. */
export async function tx<T>(fn: (t: Tx) => Promise<T>, q: pg.Pool = db()): Promise<T> {
  const client = await q.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function one<T = any>(q: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await q.query(sql, params);
  return (r.rows[0] as T) ?? null;
}
export async function many<T = any>(q: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await q.query(sql, params);
  return r.rows as T[];
}
