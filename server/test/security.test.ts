import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, closeDb } from '../src/db/pool.js';
import { resetDb, seedUsers, app as mkApp, client, PW } from './helpers.js';

let a: FastifyInstance;
let users: Awaited<ReturnType<typeof seedUsers>>;
beforeAll(async () => { await resetDb(); a = await mkApp(); });
afterAll(async () => { await a.close(); await closeDb(); });

describe('first-run setup', () => {
  it('creates the first Super User once, then refuses', async () => {
    const c = client(a);
    expect((await c.get('/api/setup/status')).json.needsFirstUser).toBe(true);
    const r = await c.post('/api/setup/first-user', { email: 'owner@example.com', displayName: 'Owner', password: PW });
    expect(r.status).toBe(200);
    expect(r.json.user.role).toBe('super_user');
    const again = await client(a).post('/api/setup/first-user', { email: 'x@example.com', displayName: 'X', password: PW });
    expect(again.status).toBe(409);
    users = await seedUsers();
  });
});

describe('authentication (R20, V1)', () => {
  it('rejects a wrong password with a plain message and locks after repeated failures', async () => {
    const c = client(a);
    for (let i = 0; i < 5; i++) expect((await c.post('/api/auth/login', { email: 'helper@example.com', password: 'nope-nope-nope' })).status).toBe(401);
    const locked = await c.post('/api/auth/login', { email: 'helper@example.com', password: PW });
    expect(locked.status).toBe(429);
    expect(locked.json.error.message).toMatch(/wait 15 minutes/);
    await db().query(`DELETE FROM login_attempts`);
  });
  it('requires the CSRF header on changes', async () => {
    const r = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'jim@example.com', password: PW } });
    expect(r.statusCode).toBe(403);
  });
  it('blocks every admin API without a session', async () => {
    for (const u of ['/api/clients', '/api/prospects', '/api/users', '/api/command-center', '/api/projects', '/api/pricing', '/api/backups']) {
      expect((await client(a).get(u)).status).toBe(401);
    }
  });
});

describe('permission enforcement on direct requests (W26, W27, Appendix D)', () => {
  it('User cannot manage users, prices, integrations, backups or imports', async () => {
    const c = client(a); await c.login('helper@example.com');
    expect((await c.get('/api/users')).status).toBe(403);
    expect((await c.post('/api/users', { email: 'z@example.com', displayName: 'Z', role: 'super_user', password: PW })).status).toBe(403);
    expect((await c.post('/api/pricing', { changes: { standard_kit: 100 } })).status).toBe(403);
    expect((await c.get('/api/pricing/history')).status).toBe(403);
    expect((await c.put('/api/integrations/secrets/square.access_token', { value: 'x' })).status).toBe(403);
    expect((await c.post('/api/backups')).status).toBe(403);
    expect((await c.post('/api/migration/prototype', { format: 'x' })).status).toBe(403);
    expect((await c.get('/api/audit')).status).toBe(403);
    // …but can do normal work.
    expect((await c.post('/api/prospects', { businessName: 'Helper Prospect', industry: 'dental' })).status).toBe(200);
  });
  it('Admin (developer) cannot change prices or users by default', async () => {
    const c = client(a); await c.login('dev@example.com');
    expect((await c.post('/api/pricing', { changes: { standard_kit: 100 } })).status).toBe(403);
    expect((await c.patch(`/api/users/${users.su.id}`, { role: 'user' })).status).toBe(403);
    expect((await c.get('/api/users')).status).toBe(403);
  });
  it('Super User can grant an Admin a specific permission; ungrantable ones are ignored', async () => {
    const c = client(a); await c.login('jim@example.com');
    const r = await c.patch(`/api/users/${users.admin.id}`, { grants: ['pricing', 'users'] });
    expect(r.status).toBe(200);
    expect(r.json.grants).toEqual(['pricing']);
    expect(r.json.permissions).toContain('pricing');
    expect(r.json.permissions).not.toContain('users');
    await c.patch(`/api/users/${users.admin.id}`, { grants: [] });
  });
  it('time-limited elevation expires on its own (V11)', async () => {
    const c = client(a); await c.login('jim@example.com');
    const r = await c.post(`/api/users/${users.admin.id}/elevate`, { grants: ['backup'], hours: 2 });
    expect(r.json.permissions).toContain('backup');
    await db().query(`UPDATE users SET elevated_until = now() - interval '1 minute' WHERE id=$1`, [users.admin.id]);
    const d = client(a); await d.login('dev@example.com');
    expect((await d.post('/api/backups')).status).toBe(403);
  });
});

describe('Super User protections (V7–V9, W28)', () => {
  it('disabling the developer ends their sessions immediately and keeps their audit history', async () => {
    const dev = client(a); await dev.login('dev@example.com');
    await dev.post('/api/prospects', { businessName: 'Dev Made This', industry: 'attorneys' });
    expect((await dev.get('/api/clients')).status).toBe(200);
    const jim = client(a); await jim.login('jim@example.com');
    expect((await jim.patch(`/api/users/${users.admin.id}`, { status: 'disabled' })).status).toBe(200);
    expect((await dev.get('/api/clients')).status).toBe(401);
    const relogin = await client(a).post('/api/auth/login', { email: 'dev@example.com', password: PW });
    expect(relogin.status).toBe(401);
    expect(relogin.json.error.message).toMatch(/turned off/);
    const hist = (await db().query(`SELECT count(*)::int n FROM audit_events WHERE actor_user_id=$1`, [users.admin.id])).rows[0].n;
    expect(hist).toBeGreaterThan(0);
    await jim.patch(`/api/users/${users.admin.id}`, { status: 'active' });
  });
  it('the last active Super User cannot be demoted or disabled — in the API or directly in the database', async () => {
    const jim = client(a); await jim.login('jim@example.com');
    const owner = (await db().query(`SELECT id FROM users WHERE email='owner@example.com'`)).rows[0];
    await jim.patch(`/api/users/${owner.id}`, { status: 'disabled' }); // leaves Jim as the only active Super User
    const r = await jim.patch(`/api/users/${users.su.id}`, { role: 'admin' });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/at least one active Super User/);
    await expect(db().query(`UPDATE users SET status='disabled' WHERE id=$1`, [users.su.id])).rejects.toThrow(/BV_LAST_SUPER_USER/);
    await expect(db().query(`DELETE FROM users WHERE id=$1`, [users.su.id])).rejects.toThrow(/BV_LAST_SUPER_USER/);
  });
  it('the audit trail cannot be edited or deleted', async () => {
    await expect(db().query(`UPDATE audit_events SET summary='x'`)).rejects.toThrow(/BV_APPEND_ONLY/);
    await expect(db().query(`DELETE FROM audit_events`)).rejects.toThrow(/BV_APPEND_ONLY/);
  });
});

describe('secrets never leave the server (V18, S16, Q17)', () => {
  it('stores credentials encrypted, never returns them, and keeps them out of support reports', async () => {
    const jim = client(a); await jim.login('jim@example.com');
    const secret = 'EAAAl0ngSquareAccessTokenValue1234567890abcdef';
    expect((await jim.put('/api/integrations/secrets/square.access_token', { value: secret })).status).toBe(200);
    const raw = (await db().query(`SELECT ciphertext FROM secrets WHERE name='square.access_token'`)).rows[0].ciphertext;
    expect(raw).not.toContain(secret);
    const list = await jim.get('/api/integrations');
    expect(JSON.stringify(list.json)).not.toContain(secret);
    expect(list.json.secrets.find((s: any) => s.name === 'square.access_token').hint).toBe('…cdef');
    await db().query(`INSERT INTO diagnostic_log (level, area, message) VALUES ('error','test','call failed with token ${secret} and card 4111 1111 1111 1111')`);
    const rep = await jim.post('/api/support/report', { note: `my key is ${secret}` });
    expect(rep.status).toBe(200);
    expect(rep.json.body).not.toContain(secret);
    expect(rep.json.body).not.toContain('4111 1111 1111 1111');
    expect(rep.json.body).toMatch(/App version: 3\.\d+\.\d+/);
    expect(rep.json.body).toMatch(/square\.access_token: set/);
  });
});

describe('plain-language errors (Q11)', () => {
  it('turns a malformed link into a plain "not found", with no technical detail', async () => {
    const jim = client(a); await jim.login('jim@example.com');
    const r = await jim.get('/api/projects/not-a-uuid');
    expect(r.status).toBe(404);
    expect(r.json.error.message).toMatch(/could not be found/);
    expect(r.body).not.toMatch(/uuid|syntax|stack/i);
  });
});
