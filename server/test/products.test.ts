import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, closeDb } from '../src/db/pool.js';
import { resetDb, seedUsers, app as mkApp, client, uid } from './helpers.js';
import { ensureDefaultPriceBook, DEFAULT_PACKAGES } from '../src/modules/pricing/service.js';
import { termsText } from '../src/modules/sales/terms.js';

// Products confirmed by the owner on 2026-10-07: Standard = 5 videos, Premier = same 5 + membership, One-Off Video $197.
let a: FastifyInstance;
beforeAll(async () => { await resetDb(); await seedUsers(); a = await mkApp(); });
afterAll(async () => { await a.close(); await closeDb(); });
const jim = async () => { const c = client(a); await c.login('jim@example.com'); return c; };
const sale = (c: any, name: string, pkg: string, extra: any = {}) => c.post('/api/sales', { saleKey: uid(), channel: 'manual', package: pkg,
  business: { businessName: name, industry: 'dental' }, agreement: { accepted: true, name: 'Dr T' }, ...extra });

describe('the three products', () => {
  it('prices and package contents: Standard $597, Premier $997 + $149/month, One-Off Video $197', async () => {
    const c = await jim();
    const p = (await c.get('/api/pricing')).json;
    const byCode = Object.fromEntries(p.packages.map((x: any) => [x.code, x]));
    expect(byCode.standard.priceText).toBe('$597 one-time');
    expect(byCode.premier.priceText).toBe('$997 + $149/month');
    expect(byCode.quick_video.priceText).toBe('$197 one-time');
    expect(byCode.quick_video.label).toBe('One-Off Video');
    expect(byCode.standard.includes.join(' ')).toMatch(/up to 90 seconds.*landscape, square or portrait/);
    expect(byCode.standard.includes.join(' ')).toMatch(/one portrait \(9:16\) and one landscape \(16:9\)/);
    expect(byCode.standard.includes.join(' ')).toMatch(/thank-you video/i);
    expect(byCode.premier.includes).toEqual(expect.arrayContaining(byCode.standard.includes));
  });

  it('a Standard sale gets the five videos; the build writes all five, with a claim-free Thank-You Video', async () => {
    const c = await jim();
    const s = await sale(c, 'Five Video Dental', 'standard');
    const pid = s.json.projectId;
    let d = (await c.get(`/api/projects/${pid}`)).json;
    expect(d.deliverables.map((x: any) => x.label)).toEqual(['Website Video', 'Social Portrait', 'Social Landscape', 'Thank-You Video', 'Email Video']);
    await c.post(`/api/projects/${pid}/facts`, { text: 'Our team welcomes new patients every weekday morning.' });
    const r = await c.post(`/api/projects/${pid}/build`, { story: 'New Patient Experience', tone: 'Friendly', websiteSecs: 60, websiteFormat: '9x16', platform: 'HeyGen' });
    expect(r.status).toBe(200);
    const st = r.json.status.deliverables;
    expect(st.map((x: any) => [x.kind, x.formats, x.sceneCount])).toEqual([
      ['website', ['9x16'], 12], ['social_a', ['9x16'], 6], ['social_b', ['16x9'], 6], ['thank_you', ['16x9'], 6], ['email', ['16x9'], 3]]);
    d = (await c.get(`/api/projects/${pid}`)).json;
    const ty = d.deliverables.find((x: any) => x.kind === 'thank_you');
    const tyScenes = d.scenes.filter((x: any) => x.deliverable_id === ty.id);
    expect(tyScenes[0].narration).toBe('Thank you for choosing Five Video Dental.');
    expect(tyScenes.every((x: any) => (x.fact_ids ?? []).length === 0)).toBe(true);   // no business claims
    expect(JSON.stringify(tyScenes)).not.toMatch(/weekday/);
  });

  it('an older four-video project is brought up to five videos when it is built again', async () => {
    const c = await jim();
    const s = await sale(c, 'Older Kit Dental', 'standard');
    const pid = s.json.projectId;
    // Make it look like a project created before 2026-10-07.
    await db().query(`DELETE FROM deliverables WHERE project_id=$1 AND kind='thank_you'`, [pid]);
    await db().query(`UPDATE deliverables SET label='Social A', formats='{16x9,9x16,1x1}' WHERE project_id=$1 AND kind='social_a'`, [pid]);
    await c.post(`/api/projects/${pid}/facts`, { text: 'Gentle care for the whole family in a calm, modern office.' });
    const r = await c.post(`/api/projects/${pid}/build`, { story: 'Office Tour', tone: 'Friendly', websiteSecs: 30, platform: 'HeyGen' });
    expect(r.status).toBe(200);
    expect(r.json.status.deliverables.map((x: any) => [x.label, x.formats])).toEqual([
      ['Website Video', ['16x9']], ['Social Portrait', ['9x16']], ['Social Landscape', ['16x9']], ['Thank-You Video', ['16x9']], ['Email Video', ['16x9']]]);
  });

  it('a One-Off Video sale: $197 order, one waiting project, and building the Quick Video fills that same project', async () => {
    const c = await jim();
    const s = await sale(c, 'One Off Plumbing', 'quick_video');
    expect(s.status, JSON.stringify(s.json)).toBe(200);
    expect(s.json.dueTodayCents).toBe(19700);
    const pid = s.json.projectId;
    const projRes = await c.get(`/api/projects/${pid}`); const proj = projRes.json; expect(projRes.status, JSON.stringify(proj) + ' ' + JSON.stringify(s.json)).toBe(200);
    expect(proj.project.kind).toBe('quick_video');
    expect(proj.project.title).toBe('One Off Plumbing — One-Off Video');
    expect(proj.deliverables.length).toBe(0);
    const agreement = (await db().query(`SELECT terms_text FROM agreements a JOIN orders o ON o.id=a.order_id WHERE o.id=$1`, [s.json.orderId])).rows[0].terms_text;
    expect(agreement).toMatch(/One-Off Video Service Agreement/); expect(agreement).toMatch(/one custom video/);

    const q = await c.post('/api/quick-videos', { clientId: s.json.clientId, purpose: 'Thank You After Service', delivery: 'Email', lengthSecs: 30, customer: 'Rosa' });
    expect(q.status).toBe(200);
    expect(q.json.projectId).toBe(pid);                          // same project — no duplicate
    const after = (await c.get(`/api/projects/${pid}`)).json;
    expect(after.deliverables.length).toBe(1);
    expect(after.project.title).toMatch(/Quick Video: Thank You After Service/);
    // A second Quick Video for the same client is a new project (the paid one is now used).
    const q2 = await c.post('/api/quick-videos', { clientId: s.json.clientId, purpose: 'Review Request', delivery: 'Email', lengthSecs: 30 });
    expect(q2.json.projectId).not.toBe(pid);
  });

  it('agreement text: each product says what it includes', () => {
    expect(termsText('standard', '$597 one-time')).toMatch(/five custom videos/);
    expect(termsText('premier', '$997 one-time + $149 per month')).toMatch(/one fresh custom video each quarter/);
    expect(termsText('quick_video', '$197 one-time')).not.toMatch(/five custom videos/);
  });

  it('the demo shows all three products, and a prospect can sign up for a One-Off Video', async () => {
    const c = await jim();
    const pr = (await c.post('/api/prospects', { businessName: 'Demo One Off Dental', industry: 'dental' })).json;
    const prospectId = pr.id ?? pr.prospect?.id;
    const link = await c.post('/api/demo/links', { prospectId, days: 7, allowSignup: true });
    const url: string = link.json.url ?? link.json.link;
    const token = url.split('/').pop()!;
    const pub = client(a);
    const view = await pub.get(`/api/public/demo/l/${token}`);
    expect(view.json.packages.map((p: any) => p.label)).toEqual(['Standard', 'Premier', 'One-Off Video']);
    const t = await pub.get(`/api/public/demo/l/${token}/terms?package=quick_video`);
    expect(t.json.package).toBe('quick_video');
    expect(t.json.text).toMatch(/\$197 one-time/);
  });

  it('an existing price book from before the One-Off product is upgraded once, keeping the owner\'s prices', async () => {
    const pool = db();
    const cur = (await pool.query(`SELECT * FROM price_book_versions ORDER BY version_no DESC LIMIT 1`)).rows[0];
    const oldPackages = { standard: DEFAULT_PACKAGES.standard, premier: DEFAULT_PACKAGES.premier };
    const oldItems = { ...cur.items, standard_kit: { ...cur.items.standard_kit, amount_cents: 64700 }, quick_video: { label: 'Quick Video', billing: 'one_time', amount_cents: null } };
    await pool.query(`INSERT INTO price_book_versions (version_no, items, packages, note) VALUES ($1,$2,$3,'old')`, [cur.version_no + 1, JSON.stringify(oldItems), JSON.stringify(oldPackages)]);
    await ensureDefaultPriceBook(pool);
    await ensureDefaultPriceBook(pool);   // second start: nothing more
    const rows = (await pool.query(`SELECT * FROM price_book_versions ORDER BY version_no DESC`)).rows;
    expect(rows[0].version_no).toBe(cur.version_no + 2);
    expect(rows[0].items.standard_kit.amount_cents).toBe(64700);     // owner's own price kept
    expect(rows[0].items.quick_video.amount_cents).toBe(19700);
    expect(Object.keys(rows[0].packages).sort()).toEqual(['premier', 'quick_video', 'standard']);
  });

  it('review fixes: a cancelled One-Off sale is never filled; restoring a saved version brings back the Website Video shape', async () => {
    const c = await jim();
    const s = await sale(c, 'Cancelled One Off', 'quick_video');
    await db().query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [s.json.orderId]);
    const q = await c.post('/api/quick-videos', { clientId: s.json.clientId, purpose: 'Seasonal', delivery: 'Email', lengthSecs: 15 });
    expect(q.json.projectId).not.toBe(s.json.projectId);
    expect((await c.get(`/api/projects/${s.json.projectId}`)).json.deliverables.length).toBe(0);

    const k = await sale(c, 'Shape Restore Dental', 'standard');
    const pid = k.json.projectId;
    await c.post(`/api/projects/${pid}/facts`, { text: 'Friendly care for families in a calm and modern office.' });
    await c.post(`/api/projects/${pid}/build`, { story: 'Office Tour', tone: 'Friendly', websiteSecs: 30, websiteFormat: '1x1', platform: 'HeyGen' });
    await c.post(`/api/projects/${pid}/build`, { story: 'Office Tour', tone: 'Friendly', websiteSecs: 30, websiteFormat: '9x16', platform: 'HeyGen' });
    const cps = (await db().query(`SELECT id FROM checkpoints WHERE project_id=$1 AND stage='before_rebuild' ORDER BY created_at DESC LIMIT 1`, [pid])).rows;
    await c.post(`/api/projects/${pid}/checkpoints/${cps[0].id}/restore`);
    const web = (await c.get(`/api/projects/${pid}`)).json.deliverables.find((x: any) => x.kind === 'website');
    expect(web.formats).toEqual(['1x1']);
    expect(web.script_text).toMatch(/1:1/);
  });
});
