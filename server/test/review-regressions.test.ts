/**
 * Regression tests for every confirmed finding of the independent review (2026-09-27).
 * Each test failed (or would have failed) against the code before the fix.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { db, closeDb } from '../src/db/pool.js';
import { config } from '../src/config.js';
import { resetDb, seedUsers, app as mkApp, client, uid, PW, publicSignup } from './helpers.js';
import { sceneHash } from '../src/modules/projects/service.js';
import { createBackup, restoreBackup } from '../src/modules/backup/service.js';
import { putObject } from '../src/integrations/storage.js';

let a: FastifyInstance;
beforeAll(async () => { await resetDb(); await seedUsers(); a = await mkApp(); });
afterAll(async () => { await a.close(); await closeDb(); });
const jim = async () => { const c = client(a); await c.login('jim@example.com'); return c; };
const sale = async (c: any, name: string) => (await c.post('/api/sales', { saleKey: uid(), channel: 'manual', package: 'standard', business: { businessName: name, industry: 'dental' }, agreement: { accepted: true, name: 'X' } })).json;

describe('#1 payments are exactly-once per ORDER, not per click', () => {
  it('six simultaneous payment attempts with different keys charge once', async () => {
    const c = await jim(); const s = await sale(c, 'Concurrent Pay Dental');
    const rs = await Promise.all(Array.from({ length: 6 }, () => c.post(`/api/orders/${s.orderId}/pay`, { attemptKey: uid(), provider: 'test', testOutcome: 'approve' })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const paid = (await db().query(`SELECT count(*)::int n FROM payments WHERE order_id=$1 AND status='paid'`, [s.orderId])).rows[0].n;
    expect(paid).toBe(1);
  });
  it('an unfinished attempt is resumed with the same provider key (crash between charge and record)', async () => {
    const c = await jim(); const s = await sale(c, 'Resume Pay Dental');
    // Simulate: an attempt was recorded as pending, then the process died before the result was stored.
    await db().query(`INSERT INTO payments (order_id, provider, mode, idempotency_key, amount_cents, status) VALUES ($1,'test','test',$2,59700,'pending')`, [s.orderId, `pay:${s.orderId}:1`]);
    const r = await c.post(`/api/orders/${s.orderId}/pay`, { attemptKey: uid(), provider: 'test', testOutcome: 'approve' });
    expect(r.json.status).toBe('paid');
    const rows = (await db().query(`SELECT idempotency_key, status FROM payments WHERE order_id=$1`, [s.orderId])).rows;
    expect(rows).toEqual([{ idempotency_key: `pay:${s.orderId}:1`, status: 'paid' }]);
  });
  it('the database refuses a second paid payment for one order', async () => {
    const o = (await db().query(`SELECT order_id FROM payments WHERE status='paid' LIMIT 1`)).rows[0];
    await expect(db().query(`INSERT INTO payments (order_id, provider, mode, idempotency_key, amount_cents, status) VALUES ($1,'test','test',$2,1,'paid')`, [o.order_id, uid()])).rejects.toThrow(/payments_one_paid_per_order/);
  });
  it('a manual payment and a card payment cannot both succeed', async () => {
    const c = await jim(); const s = await sale(c, 'Mixed Pay Dental');
    const [m, p] = await Promise.all([
      c.post(`/api/orders/${s.orderId}/manual-payment`, { attemptKey: uid(), amountCents: 59700, note: 'Check #7' }),
      c.post(`/api/orders/${s.orderId}/pay`, { attemptKey: uid(), provider: 'test', testOutcome: 'approve' })]);
    expect([m.status, p.status]).toEqual([200, 200]);
    expect((await db().query(`SELECT count(*)::int n FROM payments WHERE order_id=$1 AND status='paid'`, [s.orderId])).rows[0].n).toBe(1);
  });
});

describe('#2 autosave never reports "saved" for a refused write', () => {
  it('a stale or unaware write is a conflict and does not overwrite newer work', async () => {
    const c = await jim();
    const first = await c.put('/api/drafts/test-form', { payload: { v: 'tab A' }, baseRevision: null });
    expect(first.json.conflict).toBe(false);
    await c.put('/api/drafts/test-form', { payload: { v: 'tab A newer' }, baseRevision: first.json.revision });
    const unaware = await c.put('/api/drafts/test-form', { payload: { v: 'tab B' }, baseRevision: null });
    expect(unaware.json.conflict).toBe(true);
    const stale = await c.put('/api/drafts/test-form', { payload: { v: 'tab B' }, baseRevision: first.json.revision });
    expect(stale.json.conflict).toBe(true);
    expect((await c.get('/api/drafts/test-form')).json.draft.payload.v).toBe('tab A newer');
  });
});

describe('#3 partial updates never erase fields', () => {
  it('PATCH with only some fields keeps the rest', async () => {
    const c = await jim();
    const p = (await c.post('/api/prospects', { businessName: 'Keep Fields Law', industry: 'attorneys', websiteUrl: 'kf.example', email: 'a@kf.example', phone: '505-1', privateNotes: 'keep me' })).json.prospect;
    const r = await c.patch(`/api/prospects/${p.id}`, { contactName: 'Ann' });
    expect(r.status).toBe(200);
    expect([r.json.email, r.json.phone, r.json.website_url, r.json.private_notes, r.json.contact_name]).toEqual(['a@kf.example', '505-1', 'https://kf.example', 'keep me', 'Ann']);
    const s = await sale(c, 'Keep Fields Client');
    await db().query(`UPDATE clients SET email='x@y.example', phone='1' WHERE id=$1`, [s.clientId]);
    const u = await c.patch(`/api/clients/${s.clientId}`, { contactName: 'Bo' });
    expect([u.json.email, u.json.phone]).toEqual(['x@y.example', '1']);
  });
});

describe('#4 an approval applies only to the exact content the owner saw', () => {
  it('refuses when the content changed after the page was opened, and when no version is given', async () => {
    const c = await jim(); const s = await sale(c, 'Stale Approve Dental');
    const d = (await db().query(`SELECT id FROM deliverables WHERE project_id=$1 AND kind='email'`, [s.projectId])).rows[0];
    const sc = { name: 'One', start_s: 0, end_s: 5, image_ref: null, visual: 'v', narration: 'Words the owner read' };
    const row = (await db().query(`INSERT INTO scenes (deliverable_id, position, name, start_s, end_s, visual, narration, content_hash) VALUES ($1,1,$2,$3,$4,$5,$6,$7) RETURNING id, content_hash`,
      [d.id, sc.name, sc.start_s, sc.end_s, sc.visual, sc.narration, sceneHash(sc)])).rows[0];
    const seen = row.content_hash;
    await c.patch(`/api/projects/${s.projectId}/scenes/${row.id}`, { narration: 'Words changed in another tab' });
    const r = await c.post(`/api/projects/${s.projectId}/approve`, { type: 'scene', id: row.id, expectedHash: seen });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/changed since you opened it/);
    expect((await c.post(`/api/projects/${s.projectId}/approve`, { type: 'scene', id: row.id })).status).toBe(400);
  });
});

describe('#5 unlocking a demo-locked iPad is rate-limited', () => {
  it('after 5 wrong passwords the session is signed out completely', async () => {
    const c = await jim();
    await c.post('/api/demo/sessions', { channel: 'ipad_in_person', business: { businessName: 'Guessing Game Dental', industry: 'dental' } });
    for (let i = 0; i < 4; i++) expect((await c.post('/api/auth/unlock', { password: 'guess ' + i + ' xxxxxx' })).status).toBe(401);
    const fifth = await c.post('/api/auth/unlock', { password: 'guess 5 xxxxxx' });
    expect(fifth.json.error.message).toMatch(/signed out/);
    expect((await c.post('/api/auth/unlock', { password: PW })).status).toBe(401);   // correct password no longer helps
    await db().query(`DELETE FROM login_attempts`);
  });
});

describe('#6 restore is atomic and includes media', () => {
  it('a failing restore leaves the database exactly as it was', async () => {
    const pool = db();
    const b = await createBackup(pool, 'manual');
    const before = (await pool.query(`SELECT count(*)::int n FROM clients`)).rows[0].n;
    // Corrupt the restore by pointing it at a missing binary directory is not realistic; instead use a backup whose
    // decrypted dump is valid but restore into a target that rejects it (read-only transaction).
    const url = process.env.DATABASE_URL!;
    await pool.query(`ALTER DATABASE brittvideo_test SET default_transaction_read_only = on`);
    try { await expect(restoreBackup(b.file, { pool, url }, { skipPreRestoreBackup: true })).rejects.toThrow(); }
    finally { await pool.query(`ALTER DATABASE brittvideo_test SET default_transaction_read_only = off`); }
    expect((await pool.query(`SELECT count(*)::int n FROM clients`)).rows[0].n).toBe(before);
  });
  it('media files are backed up encrypted and restored if lost', async () => {
    const pool = db();
    const obj = putObject(Buffer.from('fake image bytes ' + uid()), 'png');
    await createBackup(pool, 'manual');
    const enc = path.join(config().BACKUP_DIR, obj.key + '.enc');
    expect(fs.existsSync(enc)).toBe(true);
    expect(fs.readFileSync(enc).includes(Buffer.from('fake image bytes'))).toBe(false);
    fs.unlinkSync(path.join(config().STORAGE_DIR, obj.key));
    const b = await createBackup(pool, 'manual');
    const r = await restoreBackup(b.file, { pool, url: process.env.DATABASE_URL! }, { skipPreRestoreBackup: true });
    expect(r.mediaRestored).toBeGreaterThanOrEqual(1);
    expect(fs.readFileSync(path.join(config().STORAGE_DIR, obj.key)).toString()).toMatch(/^fake image bytes/);
  });
});

describe('#7 the stored agreement is exactly what the prospect read', () => {
  it('refuses the signup if prices changed after the agreement was shown', async () => {
    const c = await jim();
    const s = await c.post('/api/demo/sessions', { channel: 'mac_zoom', business: { businessName: 'Terms Race Dental', industry: 'dental' } });
    const token = s.json.url.split('/').pop();
    const shown = (await client(a).get(`/api/public/demo/s/${token}/terms?package=standard`)).json;
    await c.post('/api/pricing', { changes: { standard_kit: 69700 } });
    const r = await client(a).post(`/api/public/demo/s/${token}/signup`, { saleKey: uid(), package: 'standard', agreementAccepted: true, agreementName: 'T', email: 't@t.example', termsSha256: shown.sha256 });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/read it again/);
    const ok = await publicSignup(a, 's', token, { saleKey: uid(), package: 'standard', agreementAccepted: true, agreementName: 'T', email: 't@t.example' });
    expect(ok.status).toBe(200);
    const text = (await db().query(`SELECT terms_text FROM agreements WHERE order_id=$1`, [ok.json.orderId])).rows[0].terms_text;
    expect(text).toMatch(/\$697 one-time/);
    await c.post('/api/pricing', { changes: { standard_kit: 59700 } });
  });
});

describe('#8/#9/#11 races and locked-session gaps', () => {
  it('two Super Users cannot demote each other at the same moment', async () => {
    const c = await jim();
    const other = (await c.post('/api/users', { email: 'su2@example.com', displayName: 'Second SU', role: 'super_user', password: PW })).json;
    const me = (await c.get('/api/auth/me')).json.user;
    const c2 = client(a); await c2.login('su2@example.com');
    const rs = await Promise.all([c.patch(`/api/users/${other.id}`, { role: 'admin' }), c2.patch(`/api/users/${me.id}`, { role: 'admin' })]);
    const active = (await db().query(`SELECT count(*)::int n FROM users WHERE role='super_user' AND status='active'`)).rows[0].n;
    expect(active).toBeGreaterThanOrEqual(1);
    expect(rs.some((r) => r.status === 200)).toBe(true);
  });
  it('support reports, report marking and media are unavailable while the demo lock is on', async () => {
    const c = client(a); await c.login('jim@example.com').catch(async () => { /* Jim may have been demoted above */ });
    const su = (await db().query(`SELECT email FROM users WHERE role='super_user' AND status='active' LIMIT 1`)).rows[0].email;
    const d = client(a); await d.login(su);
    await d.post('/api/demo/sessions', { channel: 'ipad_in_person', business: { businessName: 'Lock Gap Dental', industry: 'dental' } });
    expect((await d.post('/api/support/report', { note: 'x' })).status).toBe(423);
    expect((await d.post('/api/support/report/00000000-0000-0000-0000-000000000000/sent', { via: 'x' })).status).toBe(423);
    const obj = putObject(Buffer.from('img'), 'png');
    await db().query(`INSERT INTO assets (title, source_type, storage_key, mime) VALUES ('x','library_upload',$1,'image/png')`, [obj.key]);
    const r = await d.raw('GET', '/' + obj.key);
    expect(r.status).toBe(403);
  });
  it('first-run setup can only ever create one Super User, even with simultaneous requests', async () => {
    await resetDb();
    const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => client(a).post('/api/setup/first-user', { email: `owner${i}@example.com`, displayName: 'Owner', password: PW })));
    expect(rs.filter((r) => r.status === 200).length).toBe(1);
    expect((await db().query(`SELECT count(*)::int n FROM users`)).rows[0].n).toBe(1);
  });
});
