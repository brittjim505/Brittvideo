import type pg from 'pg';
import { registerJob, enqueue } from './queue.js';
import { createBackup, pruneBackups } from '../modules/backup/service.js';
import { runHealthChecks } from '../modules/support/health.js';

/** Registers scheduled jobs. Dedupe keys make each period's job unique, so ticking twice never double-runs. */
export function registerScheduledJobs() {
  registerJob('backup.nightly', 'Nightly backup', async (_p, { pool }) => { await createBackup(pool, 'scheduled'); pruneBackups(); });
  registerJob('health.check', 'System health check', async (_p, { pool }) => { await runHealthChecks(pool); });
  registerJob('maintenance.cleanup', 'Routine cleanup', async (_p, { pool }) => {
    await pool.query(`DELETE FROM sessions WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days'`);
    await pool.query(`DELETE FROM login_attempts WHERE at < now() - interval '90 days'`);
    await pool.query(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '90 days' AND status='completed'`);
    await pool.query(`DELETE FROM diagnostic_log WHERE at < now() - interval '180 days'`);
    await pool.query(`UPDATE demo_sessions SET ended_at=expires_at WHERE ended_at IS NULL AND expires_at < now()`);
  });
}

/** Called every worker tick: enqueue whatever is due (idempotent via dedupe keys). */
export async function scheduleDue(pool: pg.Pool, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  // Nightly backup: first tick after 09:00 UTC (~3 a.m. Mountain), or immediately if no backup exists for today.
  if (now.getUTCHours() >= 9) await enqueue(pool, 'backup.nightly', {}, { dedupeKey: `backup.nightly:${day}` });
  const tenMin = Math.floor(now.getTime() / 600_000);
  await enqueue(pool, 'health.check', {}, { dedupeKey: `health.check:${tenMin}`, maxAttempts: 2 });
  await enqueue(pool, 'maintenance.cleanup', {}, { dedupeKey: `maintenance.cleanup:${day}` });
}
