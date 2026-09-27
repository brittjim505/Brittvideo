import fs from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { config } from '../../config.js';
import { paymentAdapters } from '../../integrations/payment.js';
import { readSecret } from '../integrations/secrets.js';

export type HealthStatus = 'normal' | 'recovered' | 'not_configured' | 'attention' | 'support_needed';
export interface ComponentHealth { component: string; label: string; status: HealthStatus; ownerMessage: string; detail?: string }

/**
 * System Health (Q7, Q12, L2, L17, R24, T21, U28). Each check produces an owner-facing sentence.
 * "Work Saved & Protected" is only claimed when saving works, storage has room, and a verified backup is recent.
 */
export async function runHealthChecks(pool: pg.Pool): Promise<ComponentHealth[]> {
  const out: ComponentHealth[] = [];
  // 1. Database — can we read AND write?
  try {
    await pool.query(`SELECT 1`);
    await pool.query(`INSERT INTO health_checks (component, status, owner_message) VALUES ('database.selftest','normal','write test')`);
    out.push({ component: 'database', label: 'Saving your work', status: 'normal', ownerMessage: 'Your work is being saved.' });
  } catch (e: any) {
    out.push({ component: 'database', label: 'Saving your work', status: 'support_needed', ownerMessage: 'BrittVideo cannot save right now. Keep this screen open; your unsaved changes are held on this device. Use GET SUPPORT.', detail: e.message });
  }
  // 2. Storage — room for media and backups.
  try {
    const dir = config().STORAGE_DIR; fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.bv-write-test'); fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe);
    const st = fs.statfsSync(dir); const freeGb = (st.bavail * st.bsize) / 1e9;
    out.push(freeGb < 1
      ? { component: 'storage', label: 'Storage', status: 'attention', ownerMessage: `Storage is nearly full (${freeGb.toFixed(1)} GB free). Storage Cleanup is recommended.` }
      : { component: 'storage', label: 'Storage', status: 'normal', ownerMessage: `Storage healthy (${freeGb.toFixed(0)} GB free).` });
  } catch (e: any) {
    out.push({ component: 'storage', label: 'Storage', status: 'support_needed', ownerMessage: 'BrittVideo cannot write files right now. Use GET SUPPORT.', detail: e.message });
  }
  // 3. Backups — a verified backup within the last 26 hours.
  try {
    const b = (await pool.query(`SELECT finished_at, verify_status FROM backups WHERE status='succeeded' AND verify_status='passed' ORDER BY finished_at DESC LIMIT 1`)).rows[0];
    const failedSince = (await pool.query(`SELECT count(*)::int n FROM backups WHERE status='failed' AND started_at > coalesce($1, 'epoch'::timestamptz)`, [b?.finished_at ?? null])).rows[0].n;
    const ageH = b ? (Date.now() - new Date(b.finished_at).getTime()) / 3600_000 : Infinity;
    if (!b) out.push({ component: 'backup', label: 'Backups', status: 'attention', ownerMessage: 'No backup has been made yet. BrittVideo makes one automatically each night; you can also make one now in System Health.' });
    else if (ageH > 26) out.push({ component: 'backup', label: 'Backups', status: failedSince ? 'support_needed' : 'attention', ownerMessage: `The last good backup is ${Math.round(ageH)} hours old.${failedSince ? ' Recent backup attempts failed — use GET SUPPORT.' : ''}` });
    else out.push({ component: 'backup', label: 'Backups', status: 'normal', ownerMessage: `Last backup checked ${Math.max(1, Math.round(ageH))} hour(s) ago.` });
  } catch (e: any) { out.push({ component: 'backup', label: 'Backups', status: 'attention', ownerMessage: 'Backup status could not be read.', detail: e.message }); }
  // 4. Background jobs.
  try {
    const dead = (await pool.query(`SELECT count(*)::int n FROM jobs WHERE status='dead' AND finished_at > now() - interval '7 days'`)).rows[0].n;
    const stuck = (await pool.query(`SELECT count(*)::int n FROM jobs WHERE status='running' AND locked_at < now() - interval '30 minutes'`)).rows[0].n;
    out.push(dead || stuck
      ? { component: 'jobs', label: 'Automatic tasks', status: 'support_needed', ownerMessage: `${dead + stuck} automatic task(s) could not finish after several tries. Support has what it needs in the report.` }
      : { component: 'jobs', label: 'Automatic tasks', status: 'normal', ownerMessage: 'Automatic tasks are running normally.' });
  } catch (e: any) { out.push({ component: 'jobs', label: 'Automatic tasks', status: 'attention', ownerMessage: 'Automatic task status could not be read.', detail: e.message }); }
  // 5. Integrations (S15). Not yet connected is a calm state, not an error.
  try {
    const ads = paymentAdapters({ accessToken: await readSecret(pool, 'square.access_token').catch(() => null), locationId: await readSecret(pool, 'square.location_id').catch(() => null) });
    const sq = await ads.square!.health();
    out.push({ component: 'square', label: 'Square payments', status: sq.status, ownerMessage: sq.message });
  } catch (e: any) { out.push({ component: 'square', label: 'Square payments', status: 'attention', ownerMessage: 'Square status could not be checked.', detail: e.message }); }
  out.push({ component: 'video_provider', label: 'AI video production', status: 'not_configured', ownerMessage: 'Video provider connection arrives in Phase 4. Production kits can still be downloaded.' });
  out.push({ component: 'vimeo', label: 'Vimeo hosting', status: 'not_configured', ownerMessage: 'Vimeo hosting and reports arrive in Phase 5.' });
  out.push({ component: 'communications', label: 'Email & text messages', status: 'not_configured', ownerMessage: 'Automatic customer messages arrive in Phase 6. Nothing is sent to customers yet.' });
  // 6. Recent unexpected errors.
  try {
    const errs = (await pool.query(`SELECT count(*)::int n FROM diagnostic_log WHERE level='error' AND at > now() - interval '1 hour'`)).rows[0].n;
    const open = (await pool.query(`SELECT count(*)::int n FROM recovery_events WHERE outcome<>'recovered_automatically' AND resolved_at IS NULL`)).rows[0].n;
    out.push(open
      ? { component: 'recovery', label: 'Problems needing attention', status: 'attention', ownerMessage: `${open} problem(s) need attention. Open System Health for plain-language details.` }
      : { component: 'recovery', label: 'Problems needing attention', status: errs ? 'recovered' : 'normal', ownerMessage: errs ? 'A few problems happened recently and were handled automatically.' : 'No problems.' });
  } catch { /* covered by database check */ }

  try {
    for (const c of out) await pool.query(`INSERT INTO health_checks (component, status, owner_message, detail) VALUES ($1,$2,$3,$4)`, [c.component, c.status, c.ownerMessage, c.detail ?? null]);
    await pool.query(`DELETE FROM health_checks WHERE checked_at < now() - interval '30 days'`);
  } catch { /* the database check already reports this */ }
  return out;
}

export function summarise(checks: ComponentHealth[]) {
  const by = (c: string) => checks.find((x) => x.component === c);
  const workProtected = by('database')?.status === 'normal' && by('storage')?.status === 'normal' && by('backup')?.status === 'normal';
  const worst = checks.some((c) => c.status === 'support_needed') ? 'support_needed' : checks.some((c) => c.status === 'attention') ? 'attention' : 'normal';
  return {
    workSavedAndProtected: workProtected,
    systemsNormal: worst === 'normal',
    overall: worst,
    headline: worst === 'support_needed' ? 'Support needed — use GET SUPPORT' : worst === 'attention' ? 'Something needs your attention' : 'Systems Normal',
  };
}
