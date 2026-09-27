import os from 'node:os';
import type pg from 'pg';
import { logDiagnostic, recordRecovery } from '../modules/support/diagnostics.js';
import { buildSupportReport } from '../modules/support/report.js';
import { systemActor } from '../auth/permissions.js';

/**
 * Postgres-backed job queue. Jobs are claimed with FOR UPDATE SKIP LOCKED, retried with backoff, and deduplicated by
 * dedupe_key — so a job enqueued twice, or run on two workers, happens once. Every handler must be safe to run twice
 * (INTEGRATIONS_AND_AUTOMATION.md). After the final failed attempt the job is 'dead', a recovery event is recorded and
 * a support report is created automatically (Q13–Q15).
 */
export type Handler = (payload: any, ctx: { pool: pg.Pool; jobId: string; attempt: number }) => Promise<void>;
const handlers = new Map<string, { fn: Handler; label: string }>();

export function registerJob(type: string, label: string, fn: Handler) { handlers.set(type, { fn, label }); }

export async function enqueue(pool: pg.Pool | pg.PoolClient, type: string, payload: unknown = {}, opts: { dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {}) {
  const r = await (pool as pg.Pool).query(`INSERT INTO jobs (type, payload, dedupe_key, run_at, max_attempts) VALUES ($1,$2,$3,coalesce($4, now()),$5)
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`, [type, JSON.stringify(payload), opts.dedupeKey ?? null, opts.runAt ?? null, opts.maxAttempts ?? 5]);
  return r.rows[0]?.id ?? null;
}

const workerId = `${os.hostname()}:${process.pid}`;

/** Claim and run one ready job. Returns false when nothing is ready. */
export async function runOneJob(pool: pg.Pool): Promise<boolean> {
  // Reclaim jobs whose worker died mid-run (safe because handlers are idempotent).
  await pool.query(`UPDATE jobs SET status='queued', locked_at=NULL, locked_by=NULL WHERE status='running' AND locked_at < now() - interval '15 minutes'`);
  const c = await pool.connect();
  let job: any;
  try {
    await c.query('BEGIN');
    job = (await c.query(`SELECT * FROM jobs WHERE status IN ('queued','failed') AND run_at <= now() ORDER BY run_at LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
    if (!job) { await c.query('COMMIT'); return false; }
    await c.query(`UPDATE jobs SET status='running', attempts=attempts+1, locked_at=now(), locked_by=$2 WHERE id=$1`, [job.id, workerId]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }

  const h = handlers.get(job.type);
  const attempt = job.attempts + 1;
  try {
    if (!h) throw new Error(`No handler for job type ${job.type}`);
    await h.fn(job.payload, { pool, jobId: job.id, attempt });
    await pool.query(`UPDATE jobs SET status='succeeded', finished_at=now(), last_error=NULL, locked_at=NULL WHERE id=$1`, [job.id]);
    if (attempt > 1) await recordRecovery(pool, 'automatic tasks', `"${h.label}" succeeded after ${attempt} tries.`, 'recovered_automatically');
  } catch (e: any) {
    const dead = attempt >= job.max_attempts;
    const backoffMin = Math.min(60, 2 ** attempt);
    await pool.query(`UPDATE jobs SET status=$2, last_error=$3, locked_at=NULL, run_at=now() + ($4 || ' minutes')::interval, finished_at=CASE WHEN $2='dead' THEN now() END WHERE id=$1`,
      [job.id, dead ? 'dead' : 'failed', String(e?.message ?? e).slice(0, 500), String(backoffMin)]);
    await logDiagnostic(pool, dead ? 'error' : 'warn', 'jobs', `${job.type} attempt ${attempt} failed`, { error: String(e?.message ?? e) });
    if (dead) {
      await recordRecovery(pool, 'automatic tasks', `"${h?.label ?? job.type}" could not finish after ${attempt} tries.`, 'support_needed', String(e?.message ?? e));
      await buildSupportReport(pool, { actor: systemActor(), trigger: 'automatic', area: h?.label ?? job.type }).catch(() => {});
    }
  }
  return true;
}

let timer: NodeJS.Timeout | null = null;
export function startWorker(pool: pg.Pool, everyMs = 5000, onTick?: () => Promise<void>) {
  const tick = async () => {
    try { if (onTick) await onTick(); while (await runOneJob(pool)) { /* drain */ } }
    catch (e: any) { await logDiagnostic(pool, 'error', 'jobs', 'Job worker error', { error: e.message }); }
    finally { timer = setTimeout(tick, everyMs); }
  };
  timer = setTimeout(tick, 1000);
}
export function stopWorker() { if (timer) clearTimeout(timer); timer = null; }
