import type { FastifyInstance } from 'fastify';
import { db } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { buildApp } from '../src/app.js';
import { createUser } from '../src/auth/service.js';
import { ensureDefaultPriceBook } from '../src/modules/pricing/service.js';
import { seedDemoLibrary } from '../src/modules/demo/service.js';
import crypto from 'node:crypto';

export const PW = 'correct horse battery staple';
export const uid = () => crypto.randomUUID();

/** Fresh schema for each test file. */
export async function resetDb() {
  const pool = db();
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  await ensureDefaultPriceBook(pool);
  await seedDemoLibrary(pool);
  return pool;
}

export async function seedUsers() {
  const pool = db();
  const su = await createUser(pool, null, { email: 'jim@example.com', displayName: 'Jim Britt', role: 'super_user', password: PW });
  const admin = await createUser(pool, null, { email: 'dev@example.com', displayName: 'Dev Admin', role: 'admin', password: PW });
  const user = await createUser(pool, null, { email: 'helper@example.com', displayName: 'Helper', role: 'user', password: PW });
  return { su, admin, user };
}

export async function app(): Promise<FastifyInstance> { return buildApp(db()); }

/** Tiny HTTP client over app.inject that keeps a cookie jar and sends the CSRF header. */
export function client(a: FastifyInstance) {
  let cookie = '';
  const call = async (method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const r = await a.inject({ method: method as any, url, payload: payload as any, headers: { 'x-brittvideo': '1', ...(cookie ? { cookie } : {}), ...headers } });
    const set = r.headers['set-cookie'];
    if (set) { const c = (Array.isArray(set) ? set : [set]).map((s) => s.split(';')[0]).join('; '); if (c) cookie = c; }
    let json: any = null; try { json = r.json(); } catch { /* html */ }
    return { status: r.statusCode, json, body: r.body };
  };
  return {
    get: (u: string) => call('GET', u), post: (u: string, p?: unknown, h?: Record<string, string>) => call('POST', u, p ?? {}, h),
    patch: (u: string, p?: unknown) => call('PATCH', u, p ?? {}), put: (u: string, p?: unknown) => call('PUT', u, p ?? {}),
    del: (u: string) => call('DELETE', u),
    login: async (email: string, password = PW) => { const r = await call('POST', '/api/auth/login', { email, password }); if (r.status !== 200) throw new Error('login failed ' + JSON.stringify(r.json)); return r; },
    raw: call,
  };
}
