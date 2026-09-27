import type pg from 'pg';
import os from 'node:os';
import { config } from '../../config.js';
import { APP_VERSION, APP_BUILD_LABEL } from '../../version.js';
import { redactString } from '../../lib/redact.js';
import type { Actor } from '../../auth/permissions.js';
import { runHealthChecks, summarise } from './health.js';
import { secretStatus } from '../integrations/secrets.js';
import { audit } from '../audit/service.js';

/**
 * Plain-language support report (Q14–Q18, Y20). Includes app version, environment, health, integration states,
 * recovery attempts and recent diagnostics — and, by construction, no passwords, tokens, API keys or card data:
 * secrets are never read here (only whether they are set), and every free-text line is passed through redaction.
 */
export async function buildSupportReport(pool: pg.Pool, opts: { actor: Actor; ownerNote?: string; area?: string; trigger?: 'owner_request' | 'automatic' }) {
  const checks = await runHealthChecks(pool);
  const sum = summarise(checks);
  const recovery = (await pool.query(`SELECT at, area, what_happened, outcome, detail FROM recovery_events ORDER BY at DESC LIMIT 20`)).rows;
  const diag = (await pool.query(`SELECT at, level, area, message FROM diagnostic_log WHERE level <> 'info' ORDER BY at DESC LIMIT 40`)).rows;
  const jobs = (await pool.query(`SELECT type, status, attempts, last_error, finished_at FROM jobs WHERE status IN ('failed','dead') ORDER BY created_at DESC LIMIT 20`)).rows;
  const counts = (await pool.query(`SELECT (SELECT count(*) FROM clients)::int clients, (SELECT count(*) FROM projects)::int projects,
     (SELECT count(*) FROM orders)::int orders, (SELECT count(*) FROM prospects)::int prospects`)).rows[0];
  const migrations = (await pool.query(`SELECT name FROM schema_migrations ORDER BY name`)).rows.map((r) => r.name);
  const secrets = await secretStatus(pool);
  const lastBackup = (await pool.query(`SELECT finished_at, verify_status, file_name FROM backups WHERE status='succeeded' ORDER BY finished_at DESC LIMIT 1`)).rows[0];

  const L: string[] = [];
  L.push('BRITTVIDEO SUPPORT REPORT');
  L.push(`Created: ${new Date().toISOString()}`);
  L.push(`App version: ${APP_VERSION} (${APP_BUILD_LABEL})`);
  L.push(`Environment: ${config().APP_ENV}`);
  L.push(`Requested by: ${opts.actor.label}${opts.trigger === 'automatic' ? ' (created automatically after a failed recovery)' : ''}`);
  if (opts.area) L.push(`Area: ${opts.area}`);
  if (opts.ownerNote) L.push(`What the owner noticed: ${redactString(opts.ownerNote).slice(0, 1500)}`);
  L.push('');
  L.push(`SUMMARY: ${sum.headline}. Work saved & protected: ${sum.workSavedAndProtected ? 'YES' : 'NO'}.`);
  L.push('');
  L.push('SYSTEM HEALTH');
  for (const c of checks) L.push(`- ${c.label}: ${c.status.toUpperCase()} — ${c.ownerMessage}${c.detail ? ' [' + redactString(c.detail).slice(0, 300) + ']' : ''}`);
  L.push('');
  L.push('CONNECTIONS (values are never included)');
  for (const s of secrets) L.push(`- ${s.name}: ${s.set ? 'set' : 'not set'}`);
  L.push('');
  L.push(`LAST BACKUP: ${lastBackup ? `${new Date(lastBackup.finished_at).toISOString()} (${lastBackup.verify_status}) ${lastBackup.file_name}` : 'none'}`);
  L.push(`RECORDS: ${counts.clients} clients, ${counts.prospects} prospects, ${counts.orders} orders, ${counts.projects} projects`);
  L.push(`DATABASE VERSION: ${migrations.join(', ')}`);
  L.push(`SERVER: Node ${process.version}, ${os.platform()} ${os.release()}, uptime ${Math.round(process.uptime() / 60)} min`);
  L.push('');
  L.push('RECOVERY ATTEMPTS (newest first)');
  if (!recovery.length) L.push('- none');
  for (const r of recovery) L.push(`- ${new Date(r.at).toISOString()} | ${r.area} | ${r.outcome} | ${redactString(r.what_happened)}${r.detail ? ' | ' + redactString(r.detail).slice(0, 300) : ''}`);
  L.push('');
  L.push('FAILED AUTOMATIC TASKS');
  if (!jobs.length) L.push('- none');
  for (const j of jobs) L.push(`- ${j.type} | ${j.status} after ${j.attempts} tries | ${redactString(j.last_error ?? '')}`);
  L.push('');
  L.push('RECENT WARNINGS AND ERRORS');
  if (!diag.length) L.push('- none');
  for (const d of diag) L.push(`- ${new Date(d.at).toISOString()} | ${d.level} | ${d.area} | ${redactString(d.message)}`);
  L.push('');
  L.push('PRIVACY: This report never contains passwords, payment card data, API keys, access tokens or backup keys.');

  const body = L.join('\n');
  const summary = opts.ownerNote ? `${sum.headline} — "${redactString(opts.ownerNote).slice(0, 120)}"` : sum.headline;
  const rec = (await pool.query(`INSERT INTO support_reports (created_by_label, trigger, summary, body) VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
    [opts.actor.label, opts.trigger ?? 'owner_request', summary, body])).rows[0];
  await audit(pool, opts.actor, 'support.report_created', { type: 'support_report', id: rec.id }, `Support report created: ${summary}`);
  return { id: rec.id, createdAt: rec.created_at, summary, body, supportEmail: config().SUPPORT_EMAIL || null };
}

export async function markReportSent(pool: pg.Pool, actor: Actor, id: string, via: string) {
  await pool.query(`UPDATE support_reports SET sent_at=now(), sent_via=$2 WHERE id=$1`, [id, via.slice(0, 60)]);
  await audit(pool, actor, 'support.report_sent', { type: 'support_report', id }, `Support report sent (${via})`);
}
