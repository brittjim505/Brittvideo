import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, closeDb } from '../src/db/pool.js';
import { resetDb, seedUsers, app as mkApp, client, uid, publicSignup } from './helpers.js';

let a: FastifyInstance;
beforeAll(async () => { await resetDb(); await seedUsers(); a = await mkApp(); });
afterAll(async () => { await a.close(); await closeDb(); });
const count = async (t: string) => (await db().query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;

describe('prospects (B2, B3, K2)', () => {
  it('never creates a duplicate prospect and keeps the actual business type for OTHER', async () => {
    const c = client(a); await c.login('jim@example.com');
    const one = await c.post('/api/prospects', { businessName: 'Rio Grande Plumbing', websiteUrl: 'www.RGplumbing.example/', industry: 'other', businessType: 'Plumbing' });
    const two = await c.post('/api/prospects', { businessName: ' rio grande plumbing ', websiteUrl: 'https://rgplumbing.example', industry: 'other', businessType: 'Plumbing' });
    expect(one.json.created).toBe(true);
    expect(two.json.created).toBe(false);
    expect(two.json.prospect.id).toBe(one.json.prospect.id);
    const bad = await c.post('/api/prospects', { businessName: 'Mystery Co', industry: 'other' });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toMatch(/type of business/);
  });
});

describe('in-person iPad demo → sale → client + order + project (W20, W23, Delta)', () => {
  let demoUrl = ''; let prospectId = ''; let orderId = '';
  const jim = () => { const c = client(a); return c.login('jim@example.com').then(() => c); };

  it('starts a prospect-safe demo and locks the owner session on the iPad', async () => {
    const c = await jim();
    await c.post('/api/prospects', { businessName: 'Sunrise Senior Living', websiteUrl: 'sunrise.example', industry: 'senior_care', contactName: 'Pat', privateNotes: 'SECRET: they pay competitor $400/mo' });
    const p = (await c.get('/api/prospects')).json.find((x: any) => x.business_name === 'Sunrise Senior Living');
    prospectId = p.id;
    const s = await c.post('/api/demo/sessions', { channel: 'ipad_in_person', prospectId });
    expect(s.status).toBe(200);
    demoUrl = s.json.url;
    expect(demoUrl).toMatch(/^\/demo\/s\/[A-Za-z0-9_-]{43}$/);
    // The owner's admin session is now locked until the password is entered (a prospect holds the iPad).
    const locked = await c.get('/api/clients');
    expect(locked.status).toBe(423);
    expect((await c.post('/api/auth/unlock', { password: 'wrong password!!' })).status).toBe(401);
    expect((await c.post('/api/auth/unlock', { password: 'correct horse battery staple' })).status).toBe(200);
    expect((await c.get('/api/clients')).status).toBe(200);
  });

  it('shows the prospect only prospect-safe information (V13, Y15)', async () => {
    const c = await jim();
    await c.post('/api/prospects', { businessName: 'Other Private Client Co', industry: 'dental' });
    const s = await c.post('/api/demo/sessions', { channel: 'ipad_in_person', prospectId });
    demoUrl = s.json.url;
    expect((await c.get('/api/prospects')).status).toBe(423);   // the iPad stays locked while the prospect uses it
    const token = demoUrl.split('/').pop();
    const v = await client(a).get(`/api/public/demo/s/${token}`);
    expect(v.status).toBe(200);
    const text = JSON.stringify(v.json);
    expect(v.json.business.name).toBe('Sunrise Senior Living');
    expect(v.json.packages.map((p: any) => p.priceText)).toEqual(['$597 one-time', '$997 + $149/month']);
    for (const leak of ['SECRET', '$400', 'Other Private Client', 'private_notes', 'jim@example.com', 'price_book', 'override', 'Pat']) expect(text).not.toContain(leak);
    expect(v.json.library.length).toBeGreaterThan(0);
    expect(v.json.library.every((i: any) => !('permission_evidence' in i))).toBe(true);
  });

  it('Become a Client creates client, order, agreement, Premier membership and project in one step — with no re-entry', async () => {
    const token = demoUrl.split('/').pop();
    const saleKey = uid();
    const before = { clients: await count('clients'), orders: await count('orders'), projects: await count('projects') };
    const r = await publicSignup(a, 's', token!, {
      saleKey, package: 'premier', contactName: 'Pat Lee', email: 'pat@sunrise.example', phone: '505-555-0100', agreementAccepted: true, agreementName: 'Pat Lee' });
    expect(r.status).toBe(200);
    orderId = r.json.orderId;
    expect(r.json.businessName).toBe('Sunrise Senior Living');
    expect(r.json.dueTodayCents).toBe(99700);
    expect(r.json.monthlyCents).toBe(14900);
    expect(await count('clients')).toBe(before.clients + 1);
    expect(await count('orders')).toBe(before.orders + 1);
    expect(await count('projects')).toBe(before.projects + 1);
    const client_ = (await db().query(`SELECT c.* FROM clients c JOIN orders o ON o.client_id=c.id WHERE o.id=$1`, [orderId])).rows[0];
    expect(client_.industry).toBe('senior_care');                       // carried from the demo, not re-typed
    expect(client_.website_url).toBe('https://sunrise.example');
    expect(client_.source_prospect_id).toBe(prospectId);
    const ag = (await db().query(`SELECT * FROM agreements WHERE order_id=$1`, [orderId])).rows[0];
    expect(ag.terms_text).toMatch(/\$997 one-time \+ \$149 per month/);
    expect(ag.terms_sha256).toHaveLength(64);
    const m = (await db().query(`SELECT * FROM premier_memberships WHERE order_id=$1`, [orderId])).rows[0];
    expect(m.status).toBe('pending_start');
    expect(m.monthly_price_cents).toBe(14900);
    // Retrying the exact same submission (double-tap, network retry) changes nothing.
    const again = await publicSignup(a, 's', token!, {
      saleKey, package: 'premier', contactName: 'Pat Lee', email: 'pat@sunrise.example', phone: '505-555-0100', agreementAccepted: true, agreementName: 'Pat Lee' });
    expect(again.json.orderId).toBe(orderId);
    // A fresh form on the same demo returns the same order — one sale per demo.
    const third = await publicSignup(a, 's', token!, {
      saleKey: uid(), package: 'standard', contactName: 'Pat Lee', email: 'pat@sunrise.example', agreementAccepted: true, agreementName: 'Pat Lee' });
    expect(third.json.orderId).toBe(orderId);
    expect(await count('orders')).toBe(before.orders + 1);
    expect(await count('projects')).toBe(before.projects + 1);
  });

  it('many simultaneous submissions still create exactly one order and project (Q9)', async () => {
    const c = await jim();
    const s = await c.post('/api/demo/sessions', { channel: 'mac_zoom', business: { businessName: 'Parallel Dental', industry: 'dental', websiteUrl: 'pd.example' } });
    const token = s.json.url.split('/').pop();
    const before = await count('orders');
    const body = { package: 'standard', agreementAccepted: true, agreementName: 'Dr P', email: 'p@pd.example' };
    const rs = await Promise.all(Array.from({ length: 6 }, () => publicSignup(a, 's', token!, { ...body, saleKey: uid() })));
    const ok = rs.filter((r) => r.status === 200);
    expect(ok.length).toBeGreaterThan(0);
    expect(new Set(ok.map((r) => r.json.orderId)).size).toBe(1);
    expect(await count('orders')).toBe(before + 1);
  });

  it('declined card then approved card: one payment succeeds, Premier starts, never double-charged (M14, M15, W22)', async () => {
    const token = demoUrl.split('/').pop();
    const decline = await client(a).post(`/api/public/demo/s/${token}/pay`, { attemptKey: uid(), testOutcome: 'decline' });
    expect(decline.json.status).toBe('payment_failed');
    const key = uid();
    const ok = await client(a).post(`/api/public/demo/s/${token}/pay`, { attemptKey: key, testOutcome: 'approve' });
    expect(ok.json.status).toBe('paid');
    const replay = await client(a).post(`/api/public/demo/s/${token}/pay`, { attemptKey: key, testOutcome: 'approve' });
    expect(replay.json.status).toBe('paid');
    const another = await client(a).post(`/api/public/demo/s/${token}/pay`, { attemptKey: uid(), testOutcome: 'approve' });
    expect(another.json.status).toBe('paid');
    const paid = (await db().query(`SELECT count(*)::int n FROM payments WHERE order_id=$1 AND status='paid'`, [orderId])).rows[0].n;
    expect(paid).toBe(1);
    const m = (await db().query(`SELECT * FROM premier_memberships WHERE order_id=$1`, [orderId])).rows[0];
    expect(m.status).toBe('active');
    expect(m.started_at).not.toBeNull();
    expect((await db().query(`SELECT card FROM (SELECT row_to_json(p)::text card FROM payments p) x WHERE card ~ '\\d{13,}'`)).rowCount).toBe(0);
  });

  it('shows on the Mac as "New Client — Ready to Start" (I1, W23)', async () => {
    const c = await jim();
    const cc = await c.get('/api/command-center');
    expect(cc.status).toBe(200);
    expect(cc.json.newClients.map((x: any) => x.business_name)).toContain('Sunrise Senior Living');
    expect(cc.json.awaitingPayment.map((x: any) => x.business_name)).toContain('Parallel Dental');
    const proj = (await c.get('/api/projects')).json.find((p: any) => p.business_name === 'Sunrise Senior Living');
    const detail = await c.get(`/api/projects/${proj.id}`);
    expect(detail.json.deliverables.map((d: any) => [d.kind, d.duration_s, d.formats])).toEqual([
      ['website', 60, ['16x9']], ['social_a', 30, ['16x9', '9x16', '1x1']], ['social_b', 30, ['16x9', '9x16', '1x1']], ['email', 15, ['16x9']]]);
    expect(detail.json.status.completeVideoKitApproved).toBe(false);   // no false green on a brand-new project
  });
});

describe('demo links (G1, V15, W25 attack test)', () => {
  it('denies guessed, altered, expired and disabled links identically, and scopes orders to their own demo', async () => {
    const c = client(a); await c.login('jim@example.com');
    const l = await c.post('/api/demo/links', { business: { businessName: 'Link Law', industry: 'attorneys', websiteUrl: 'linklaw.example' }, days: 7 });
    expect(l.status).toBe(200);
    const token = l.json.url.split('/').pop();
    expect((await client(a).get(`/api/public/demo/l/${token}`)).status).toBe(200);
    const altered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    for (const u of [`/api/public/demo/l/${altered}`, `/api/public/demo/s/${token}`, `/api/public/demo/l/../../clients`, `/api/public/demo/l/${'x'.repeat(43)}`, `/api/public/demo/x/${token}`]) {
      const r = await client(a).get(u);
      expect([404, 400]).toContain(r.status);
      expect(JSON.stringify(r.json ?? {})).not.toMatch(/Sunrise|Link Law/);
    }
    // This link has no signup yet — it must not reveal another demo's order.
    expect((await client(a).get(`/api/public/demo/l/${token}/order`)).status).toBe(404);
    // The demo token grants nothing on the admin API.
    expect((await client(a).get('/api/clients')).status).toBe(401);
    // Expire it, then disable it: both give the same generic answer.
    await db().query(`UPDATE demo_links SET expires_at=now() - interval '1 minute' WHERE id=$1`, [l.json.id]);
    const exp = await client(a).get(`/api/public/demo/l/${token}`);
    expect(exp.status).toBe(404);
    expect(exp.json.error.message).toMatch(/no longer available/);
    await db().query(`UPDATE demo_links SET expires_at=now() + interval '1 day' WHERE id=$1`, [l.json.id]);
    await c.post(`/api/demo/links/${l.json.id}/disable`);
    expect((await client(a).get(`/api/public/demo/l/${token}`)).json.error.message).toMatch(/no longer available/);
    // Only the hash of the token is stored.
    expect((await db().query(`SELECT count(*)::int n FROM demo_links WHERE token_hash=$1`, [token])).rows[0].n).toBe(0);
  });
});

describe('pricing (M2–M8, W21)', () => {
  it('a price change affects new sales only; historical prices are immutable', async () => {
    const c = client(a); await c.login('jim@example.com');
    const old = (await db().query(`SELECT l.* FROM order_lines l WHERE item_code='premier_kit' LIMIT 1`)).rows[0];
    const r = await c.post('/api/pricing', { changes: { premier_kit: 109700 }, note: 'Test increase' });
    expect(r.status).toBe(200);
    const after = (await db().query(`SELECT * FROM order_lines WHERE id=$1`, [old.id])).rows[0];
    expect(after.list_price_cents).toBe(99700);
    expect(after.sold_price_cents).toBe(99700);
    await expect(db().query(`UPDATE order_lines SET sold_price_cents=1 WHERE id=$1`, [old.id])).rejects.toThrow(/BV_APPEND_ONLY/);
    await expect(db().query(`UPDATE price_book_versions SET items='{}'`)).rejects.toThrow(/BV_APPEND_ONLY/);
    const pub = await c.get('/api/pricing');
    expect(pub.json.packages.find((p: any) => p.code === 'premier').priceText).toBe('$1,097 + $149/month');
    await c.post('/api/pricing', { changes: { premier_kit: 99700 }, note: 'Back to confirmed price' });
  });

  it('owner can override one deal with a reason (list vs agreed vs sold kept); a prospect never can', async () => {
    const c = client(a); await c.login('jim@example.com');
    const r = await c.post('/api/sales', { saleKey: uid(), channel: 'manual', package: 'standard',
      business: { businessName: 'Discount Dental', industry: 'dental', websiteUrl: 'dd.example' },
      overrides: { standard_kit: { agreedCents: 49700, reason: 'Referral from Sunrise' } }, agreement: { accepted: true, name: 'Dr D' } });
    expect(r.status).toBe(200);
    const line = (await db().query(`SELECT * FROM order_lines WHERE order_id=$1`, [r.json.orderId])).rows[0];
    expect([line.list_price_cents, line.agreed_price_cents, line.sold_price_cents, line.override_reason]).toEqual([59700, 49700, 49700, 'Referral from Sunrise']);
    // Helper (no revenue permission) cannot set a price.
    const h = client(a); await h.login('helper@example.com');
    const blocked = await h.post('/api/sales', { saleKey: uid(), channel: 'manual', package: 'standard', business: { businessName: 'Cheap Co', industry: 'dental' },
      overrides: { standard_kit: { agreedCents: 100 } }, agreement: { accepted: true, name: 'X' } });
    expect(blocked.status).toBe(403);
    // Helper sees orders but not amounts.
    const cl = await h.get(`/api/clients/${r.json.clientId}`);
    expect(JSON.stringify(cl.json.orders)).not.toMatch(/49700|59700/);
  });

  it('a returning client buys more work without a duplicate client record (M18, K2)', async () => {
    const c = client(a); await c.login('jim@example.com');
    const existing = (await db().query(`SELECT id FROM clients WHERE business_name='Discount Dental'`)).rows[0];
    const n = await count('clients');
    const r = await c.post('/api/sales', { saleKey: uid(), channel: 'manual', package: 'standard', clientId: existing.id,
      business: { businessName: 'Discount Dental', industry: 'dental' }, agreement: { accepted: true, name: 'Dr D' } });
    expect(r.status).toBe(200);
    expect(r.json.clientId).toBe(existing.id);
    expect(await count('clients')).toBe(n);
    // A second sale typed by hand with the same name + website also reuses the record.
    const r2 = await c.post('/api/sales', { saleKey: uid(), channel: 'manual', package: 'standard',
      business: { businessName: 'DISCOUNT DENTAL', websiteUrl: 'https://www.dd.example/', industry: 'dental' }, agreement: { accepted: true, name: 'Dr D' } });
    expect(r2.json.clientId).toBe(existing.id);
  });

  it('records a manual payment only for the full amount, once', async () => {
    const c = client(a); await c.login('jim@example.com');
    const o = (await db().query(`SELECT id FROM orders WHERE status='pending_payment' ORDER BY created_at LIMIT 1`)).rows[0];
    const wrong = await c.post(`/api/orders/${o.id}/manual-payment`, { attemptKey: uid(), amountCents: 100, note: 'Check #1' });
    expect(wrong.status).toBe(400);
    const due = (await c.get(`/api/orders/${o.id}`)).json.dueTodayCents;
    const ok = await c.post(`/api/orders/${o.id}/manual-payment`, { attemptKey: uid(), amountCents: due, note: 'Check #1042' });
    expect(ok.json.status).toBe('paid');
    const again = await c.post(`/api/orders/${o.id}/manual-payment`, { attemptKey: uid(), amountCents: due, note: 'Check #1042' });
    expect(again.json.alreadyPaid).toBe(true);
  });
});

describe('marketing preference (O4–O8, V22)', () => {
  it('unsubscribe survives new sales and projects, and can only be reversed with the client\'s own request', async () => {
    const c = client(a); await c.login('jim@example.com');
    const cl = (await db().query(`SELECT id FROM clients WHERE business_name='Discount Dental'`)).rows[0];
    expect((await c.post(`/api/clients/${cl.id}/marketing`, { status: 'unsubscribed', reason: 'Clicked unsubscribe' })).status).toBe(200);
    await c.post('/api/sales', { saleKey: uid(), channel: 'manual', package: 'standard', clientId: cl.id, business: { businessName: 'Discount Dental', industry: 'dental' }, agreement: { accepted: true, name: 'Dr D' } });
    expect((await c.get(`/api/clients/${cl.id}`)).json.client.marketing_status).toBe('unsubscribed');
    const refused = await c.post(`/api/clients/${cl.id}/marketing`, { status: 'active', reason: 'Owner thinks they would like it' });
    expect(refused.status).toBe(409);
    await expect(db().query(`UPDATE marketing_preferences SET status='active' WHERE client_id=$1`, [cl.id])).rejects.toThrow(/BV_UNSUBSCRIBE_PROTECTED/);
    const ok = await c.post(`/api/clients/${cl.id}/marketing`, { status: 'active', reason: 'Client asked', resubscribeEvidence: 'Client emailed 10/2 asking for updates' });
    expect(ok.status).toBe(200);
    const hist = (await c.get(`/api/clients/${cl.id}`)).json.marketingHistory;
    expect(hist.map((h: any) => h.to_status).slice(0, 2)).toEqual(['active', 'unsubscribed']);
  });
});
