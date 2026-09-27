import type pg from 'pg';
import { OwnerError } from './errors.js';
import { contentHash } from './util.js';

/**
 * Run `fn` at most once per (scope, key). Replays the stored result on retry (Q8, Q9, M15).
 * - Same key + same request → same stored response (no second side effect).
 * - Same key + different request → refused (protects against accidental key reuse).
 * - A crashed earlier attempt (in_progress older than staleMs) may be retried; `fn` must itself check external state.
 */
export async function once<T>(pool: pg.Pool, scope: string, key: string, request: unknown, fn: () => Promise<T>, staleMs = 120_000): Promise<{ result: T; replayed: boolean }> {
  if (!key || key.length < 8 || key.length > 200) throw new OwnerError('This request is missing its safety key. Please refresh the page and try again.', 400, 'idempotency_key');
  const reqHash = contentHash(request);
  const ins = await pool.query(
    `INSERT INTO idempotency_keys (scope, key, request_hash, status) VALUES ($1,$2,$3,'in_progress')
     ON CONFLICT (scope, key) DO NOTHING RETURNING key`, [scope, key, reqHash]);
  if (!ins.rowCount) {
    const row = (await pool.query(`SELECT * FROM idempotency_keys WHERE scope=$1 AND key=$2`, [scope, key])).rows[0];
    if (row.request_hash !== reqHash) throw new OwnerError('This form was already submitted with different details. Please refresh and start again.', 409, 'idempotency_mismatch');
    if (row.status === 'completed') return { result: row.response as T, replayed: true };
    const age = Date.now() - new Date(row.created_at).getTime();
    if (row.status === 'in_progress' && age < staleMs) throw new OwnerError('This is already being processed. Please wait a moment — nothing will be duplicated.', 409, 'in_progress');
    await pool.query(`UPDATE idempotency_keys SET status='in_progress', created_at=now() WHERE scope=$1 AND key=$2`, [scope, key]);
  }
  try {
    const result = await fn();
    await pool.query(`UPDATE idempotency_keys SET status='completed', response=$3, completed_at=now() WHERE scope=$1 AND key=$2`,
      [scope, key, JSON.stringify(result ?? null)]);
    return { result, replayed: false };
  } catch (e) {
    await pool.query(`UPDATE idempotency_keys SET status='failed' WHERE scope=$1 AND key=$2`, [scope, key]);
    throw e;
  }
}
