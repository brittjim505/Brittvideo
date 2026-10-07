import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { db, closeDb } from '../src/db/pool.js';
import { resetDb, seedUsers, app as mkApp, client, uid } from './helpers.js';
import { sceneHash } from '../src/modules/projects/service.js';
import { createBackup, restoreBackup, readBackup } from '../src/modules/backup/service.js';
import { importPrototypeExport, prototypeFingerprint } from '../src/modules/migration/importer.js';
import { systemActor } from '../src/auth/permissions.js';
import { enqueue, registerJob, runOneJob } from '../src/jobs/queue.js';
import { migrate, pendingMigrations } from '../src/db/migrate.js';

let a: FastifyInstance;
let projectId = '';
beforeAll(async () => { await resetDb(); await seedUsers(); a = await mkApp(); });
afterAll(async () => { await a.close(); await closeDb(); });
const jim = async () => { const c = client(a); await c.login('jim@example.com'); return c; };

async function addScenes(pid: string) {
  const dels = (await db().query(`SELECT id, kind FROM deliverables WHERE project_id=$1 ORDER BY position`, [pid])).rows;
  const counts: Record<string, number> = { website: 12, social_a: 6, social_b: 6, thank_you: 6, email: 3 };
  for (const d of dels) for (let i = 0; i < counts[d.kind]; i++) {
    const s = { name: `${d.kind} ${i + 1}`, start_s: i * 5, end_s: i * 5 + 5, image_ref: { title: 'Entrance' }, visual: 'Slow push-in', narration: `Line ${i + 1}` };
    await db().query(`INSERT INTO scenes (deliverable_id, position, name, start_s, end_s, image_ref, visual, narration, content_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [d.id, i + 1, s.name, s.start_s, s.end_s, JSON.stringify(s.image_ref), s.visual, s.narration, sceneHash(s)]);
  }
}

describe('approval integrity (K8–K10, W6, W7, Y5, Y6)', () => {
  it('Complete Video Kit cannot be approved while even one scene approval is missing', async () => {
    const c = await jim();
    const sale = await c.post('/api/sales', { saleKey: uid(), channel: 'manual', package: 'standard', business: { businessName: 'Gate Test Dental', industry: 'dental' }, agreement: { accepted: true, name: 'G' } });
    projectId = sale.json.projectId;
    await addScenes(projectId);
    const p = await c.get(`/api/projects/${projectId}`);
    const scenes = p.json.scenes;
    for (const s of scenes.slice(0, -1)) await c.post(`/api/projects/${projectId}/approve`, { type: 'scene', id: s.id, expectedHash: s.content_hash });
    const st = (await c.get(`/api/projects/${projectId}`)).json.status;
    expect(st.allComponentsApproved).toBe(false);
    expect(st.deliverables.find((d: any) => d.kind === 'email').approvedCount).toBe(2);
    const kit = await c.post(`/api/projects/${projectId}/approve`, { type: 'kit', expectedHash: st.compositeHash });
    expect(kit.status).toBe(409);
    expect(kit.json.error.message).toMatch(/Email Video \(2\/3\)/);
    expect(st.completeVideoKitApproved).toBe(false);
  });

  it('approving the last scene enables final approval; the kit gate is calculated, not stored', async () => {
    const c = await jim();
    const last = (await c.get(`/api/projects/${projectId}`)).json.scenes.at(-1);
    await c.post(`/api/projects/${projectId}/approve`, { type: 'scene', id: last.id, expectedHash: last.content_hash });
    const st = (await c.get(`/api/projects/${projectId}`)).json.status;
    const r = await c.post(`/api/projects/${projectId}/approve`, { type: 'kit', expectedHash: st.compositeHash });
    expect(r.status).toBe(200);
    expect(r.json.completeVideoKitApproved).toBe(true);
    expect((await db().query(`SELECT status FROM production_records WHERE project_id=$1`, [projectId])).rows[0].status).toBe('approved');
  });

  it('a material edit invalidates exactly that scene and the final approval; nothing else', async () => {
    const c = await jim();
    const p = (await c.get(`/api/projects/${projectId}`)).json;
    const target = p.scenes.find((s: any) => s.name === 'social_a 3');
    const r = await c.patch(`/api/projects/${projectId}/scenes/${target.id}`, { narration: 'A different promise' });
    expect(r.json.completeVideoKitApproved).toBe(false);
    const sa = r.json.deliverables.find((d: any) => d.kind === 'social_a');
    expect(sa.approvedCount).toBe(5);
    expect(sa.scenes.find((s: any) => s.id === target.id).wasApprovedEarlier).toBe(true);
    expect(r.json.deliverables.filter((d: any) => d.kind !== 'social_a').every((d: any) => d.complete)).toBe(true);
    const detail = (await c.get(`/api/projects/${projectId}`)).json;
    expect(detail.production.status).toBe('needs_reapproval');
    expect(detail.invalidations[0].reason).toMatch(/social_a 3/);
    // A no-op "edit" (same words) changes nothing.
    const same = await c.patch(`/api/projects/${projectId}/scenes/${target.id}`, { narration: 'A different promise' });
    expect(same.json.deliverables.find((d: any) => d.kind === 'social_a').approvedCount).toBe(5);
  });

  it('restoring a checkpoint brings back approved content — and its approval — but never fabricates one (Q6)', async () => {
    const c = await jim();
    const cps = (await c.get(`/api/projects/${projectId}/checkpoints`)).json;
    const approvedCp = cps.find((x: any) => x.stage === 'kit_approved');
    expect(approvedCp).toBeTruthy();
    const approvalsBefore = (await db().query(`SELECT count(*)::int n FROM approvals WHERE project_id=$1`, [projectId])).rows[0].n;
    const r = await c.post(`/api/projects/${projectId}/checkpoints/${approvedCp.id}/restore`);
    expect(r.status).toBe(200);
    expect(r.json.allComponentsApproved).toBe(true);           // the exact approved words are back → their approval is valid again
    expect(r.json.completeVideoKitApproved).toBe(true);
    const approvalsAfter = (await db().query(`SELECT count(*)::int n FROM approvals WHERE project_id=$1`, [projectId])).rows[0].n;
    expect(approvalsAfter).toBe(approvalsBefore);               // no approval row was invented
    expect((await c.get(`/api/projects/${projectId}/checkpoints`)).json[0].stage).toBe('before_restore');
    // Restoring the brand-new "created" checkpoint (no scenes) must NOT leave anything approved.
    const created = cps.find((x: any) => x.stage === 'created');
    const r2 = await c.post(`/api/projects/${projectId}/checkpoints/${created.id}/restore`);
    expect(r2.json.completeVideoKitApproved).toBe(false);
    expect(r2.json.allComponentsApproved).toBe(false);
    await expect(db().query(`DELETE FROM approvals`)).rejects.toThrow(/BV_APPEND_ONLY/);
  });
});

describe('backup and restore (Q20, Q23, Q24, W30)', () => {
  it('a backup is encrypted, verified, and restores into an empty database with identical records', async () => {
    const pool = db();
    const b = await createBackup(pool, 'manual');
    const raw = fs.readFileSync(b.file);
    expect(raw.includes(Buffer.from('Gate Test Dental'))).toBe(false);            // encrypted at rest
    expect(readBackup(b.file).header.appVersion).toMatch(/^3\./);
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query('DROP DATABASE IF EXISTS brittvideo_test_restore').catch(() => {});
    await admin.query('CREATE DATABASE brittvideo_test_restore');
    await admin.end();
    const url = process.env.DATABASE_URL!.replace(/\/[^/]+$/, '/brittvideo_test_restore');
    const target = new pg.Pool({ connectionString: url });
    try {
      const r = await restoreBackup(b.file, { pool: target, url });
      expect(r.preRestoreBackup).toBeNull();
      for (const t of ['clients', 'orders', 'order_lines', 'projects', 'scenes', 'approvals', 'audit_events', 'users']) {
        const x = (await pool.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
        const y = (await target.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
        expect({ t, n: y }).toEqual({ t, n: x });
      }
      // Guards survive restore (triggers restored too).
      await expect(target.query(`DELETE FROM audit_events`)).rejects.toThrow(/BV_APPEND_ONLY/);
    } finally { await target.end(); }
  });

  it('refuses a tampered backup file', async () => {
    const b = await createBackup(db(), 'manual');
    const buf = fs.readFileSync(b.file); buf[buf.length - 10] ^= 0xff; fs.writeFileSync(b.file + '.bad', buf);
    expect(() => readBackup(b.file + '.bad')).toThrow();
  });

  it('restoring an older backup never re-subscribes a client or resurrects a permanently deleted image', async () => {
    const pool = db(); const c = await jim();
    const cl = (await pool.query(`SELECT id FROM clients WHERE business_name='Gate Test Dental'`)).rows[0];
    await pool.query(`INSERT INTO assets (title, source_type, status, sha256) VALUES ('Old logo','library_upload','available','abc')`);
    const older = await createBackup(pool, 'manual');                           // client subscribed, image present
    await c.post(`/api/clients/${cl.id}/marketing`, { status: 'unsubscribed', reason: 'Unsubscribe link' });
    await pool.query(`UPDATE assets SET status='permanently_deleted', storage_key=NULL WHERE title='Old logo'`);
    const url = process.env.DATABASE_URL!;
    const r = await restoreBackup(older.file, { pool, url });
    expect(r.preRestoreBackup).toMatch(/pre_restore/);
    expect(r.protectedStateReapplied).toBe(2);
    expect((await pool.query(`SELECT status FROM marketing_preferences WHERE client_id=$1`, [cl.id])).rows[0].status).toBe('unsubscribed');
    expect((await pool.query(`SELECT status FROM assets WHERE title='Old logo'`)).rows[0].status).toBe('permanently_deleted');
    await expect(pool.query(`UPDATE assets SET status='available' WHERE title='Old logo'`)).rejects.toThrow(/BV_DELETED_MEANS_DELETED/);
  });
});

describe('database upgrades (Y22, Y23)', () => {
  it('refuses to run if an applied migration file was edited', async () => {
    await db().query(`UPDATE schema_migrations SET checksum='tampered' WHERE name='0001_core.sql'`);
    await expect(pendingMigrations(db())).rejects.toThrow(/changed after it was applied/);
  });
  it('re-running the upgrade on a database with data changes nothing', async () => {
    const files = (await import('../src/db/migrate.js')).listMigrationFiles();
    await db().query(`UPDATE schema_migrations SET checksum=$1 WHERE name='0001_core.sql'`, [files[0].checksum]);
    const before = (await db().query(`SELECT count(*)::int n FROM clients`)).rows[0].n;
    const r = await migrate(db(), { backup: async () => { throw new Error('should not back up when nothing is pending'); } });
    expect(r.applied).toEqual([]);
    expect((await db().query(`SELECT count(*)::int n FROM clients`)).rows[0].n).toBe(before);
  });
});

describe('prototype data import (R21, R22, Migration checklist)', () => {
  const file = fs.readFileSync(new URL('./fixtures/prototype_export.json', import.meta.url), 'utf8');
  it('imports prospects, clients, projects, approvals, quick videos and images — and only verified final approvals', async () => {
    const s = await importPrototypeExport(db(), systemActor('test import'), file);
    expect(s.alreadyImported).toBe(false);
    expect(s.prospects).toBeGreaterThanOrEqual(2);      // Morada, Rio Grande Plumbing (Smile Dental became a client)
    expect(s.clients).toBe(1);
    expect(s.projects).toBe(2);
    expect(s.quickVideos).toBe(1);
    expect(s.images).toBe(1);
    expect(s.kitApprovalsCarried).toBe(1);
    const morada = (await db().query(`SELECT p.id FROM projects p JOIN prospects pr ON pr.id=p.prospect_id WHERE pr.business_name LIKE 'Morada%' AND p.kind='video_kit'`)).rows[0];
    const c = await jim();
    const st = (await c.get(`/api/projects/${morada.id}`)).json;
    expect(st.status.completeVideoKitApproved).toBe(true);
    expect(st.production.status).toBe('package_downloaded');
    expect(st.deliverables.find((d: any) => d.kind === 'website').duration_s).toBe(60);
    // Jim's edit and his library image choice came across.
    expect(st.scenes.some((x: any) => x.narration === 'Edited narration by Jim for scene 2.')).toBe(true);
    expect(st.scenes.some((x: any) => x.image_ref?.assetId)).toBe(true);
    // Rio Grande: 30-second kit, newer protected checkpoint used (2 scenes approved), OTHER → Plumbing.
    const rio = (await db().query(`SELECT p.id, pr.business_type FROM projects p JOIN prospects pr ON pr.id=p.prospect_id WHERE pr.business_name='Rio Grande Plumbing' AND p.kind='video_kit'`)).rows[0];
    expect(rio.business_type).toBe('Not specified (imported from prototype)');
    const rs = (await c.get(`/api/projects/${rio.id}`)).json;
    expect(rs.deliverables.find((d: any) => d.kind === 'website').duration_s).toBe(30);
    expect(rs.status.deliverables.find((d: any) => d.kind === 'website').approvedCount).toBe(2);
    expect(rs.status.completeVideoKitApproved).toBe(false);
    expect(s.notes.join(' ')).toMatch(/newer automatically-protected work/);
    const q = (await db().query(`SELECT settings FROM projects WHERE kind='quick_video'`)).rows[0];
    expect(q.settings.purpose).toBe('Review Request');
    expect(q.settings.customer).toBe('Maria');
    // Private notes stay private and intact.
    expect((await db().query(`SELECT private_notes FROM prospects WHERE business_name='Rio Grande Plumbing'`)).rows[0].private_notes).toBe('private note for Rio Grande Plumbing');
  });

  it('importing the same file again changes nothing', async () => {
    const n = (await db().query(`SELECT count(*)::int n FROM projects`)).rows[0].n;
    const s = await importPrototypeExport(db(), systemActor('test import'), file);
    expect(s.alreadyImported).toBe(true);
    expect((await db().query(`SELECT count(*)::int n FROM projects`)).rows[0].n).toBe(n);
  });

  it('does not carry a final approval whose fingerprint no longer matches', async () => {
    const doc = JSON.parse(file);
    const projs = JSON.parse(doc.keys['brittvideo-v2-projects']);
    const pid = Object.keys(projs).find((k) => projs[k].clientName?.startsWith('Morada'))!;
    expect(prototypeFingerprint(pid, projs[pid].sceneState, projs[pid].approvals, projs[pid].scripts))
      .toBe(JSON.parse(doc.keys['brittvideo-v21107-final-approvals'])[pid].fingerprint);
    await resetDb(); await seedUsers();
    projs[pid].sceneState[0].narration = 'Changed after final approval';
    doc.keys['brittvideo-v2-projects'] = JSON.stringify(projs);
    const s = await importPrototypeExport(db(), systemActor('test import'), JSON.stringify(doc));
    expect(s.kitApprovalsCarried).toBe(0);
    expect(s.notes.join(' ')).toMatch(/NOT carried over/);
    const pr = (await db().query(`SELECT r.status FROM production_records r JOIN projects p ON p.id=r.project_id WHERE p.legacy_ref=$1`, ['proto:' + pid])).rows[0];
    expect(pr.status).toBe('needs_reapproval');
  });

  it('rejects files that are not a BrittVideo export', async () => {
    await expect(importPrototypeExport(db(), systemActor('t'), '{"hello":1}')).rejects.toThrow(/EXPORT ALL DATA/);
  });
});

describe('automatic jobs (Q13–Q15, "safe to run twice")', () => {
  it('deduplicates, retries, and escalates to a support report when a job keeps failing', async () => {
    const pool = db();
    let runs = 0;
    registerJob('test.flaky', 'Flaky test task', async () => { runs++; throw new Error('provider timeout token=abc123secretvalue'); });
    const id1 = await enqueue(pool, 'test.flaky', {}, { dedupeKey: 'flaky-1', maxAttempts: 2 });
    const id2 = await enqueue(pool, 'test.flaky', {}, { dedupeKey: 'flaky-1', maxAttempts: 2 });
    expect(id1).toBeTruthy(); expect(id2).toBeNull();
    await runOneJob(pool);
    await pool.query(`UPDATE jobs SET run_at=now() WHERE id=$1`, [id1]);
    await runOneJob(pool);
    expect(runs).toBe(2);
    const j = (await pool.query(`SELECT status, last_error FROM jobs WHERE id=$1`, [id1])).rows[0];
    expect(j.status).toBe('dead');
    const rec = (await pool.query(`SELECT outcome, what_happened FROM recovery_events ORDER BY at DESC LIMIT 1`)).rows[0];
    expect(rec.outcome).toBe('support_needed');
    expect(rec.what_happened).toMatch(/Flaky test task/);
    const rep = (await pool.query(`SELECT body, trigger FROM support_reports ORDER BY created_at DESC LIMIT 1`)).rows[0];
    expect(rep.trigger).toBe('automatic');
    expect(rep.body).toMatch(/Flaky test task/);
    expect(rep.body).not.toContain('abc123secretvalue');
  });

  it('a job that fails once then succeeds is reported as recovered automatically', async () => {
    const pool = db(); let n = 0;
    registerJob('test.once', 'Retry-once task', async () => { if (n++ === 0) throw new Error('temporary'); });
    const id = await enqueue(pool, 'test.once', {}, { dedupeKey: 'once-1' });
    await runOneJob(pool); await pool.query(`UPDATE jobs SET run_at=now() WHERE id=$1`, [id]); await runOneJob(pool);
    expect((await pool.query(`SELECT status FROM jobs WHERE id=$1`, [id])).rows[0].status).toBe('succeeded');
    expect((await pool.query(`SELECT outcome FROM recovery_events WHERE what_happened LIKE '%Retry-once%'`)).rows[0].outcome).toBe('recovered_automatically');
  });
});
