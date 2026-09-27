import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { db, closeDb } from '../src/db/pool.js';
import { resetDb, seedUsers, app as mkApp, client, uid } from './helpers.js';
import { _test as fetchTest, safeFetch } from '../src/integrations/web-fetch.js';
import { templateWriter, claudeWriter, phrases } from '../src/modules/builder/writer.js';
import { quickNarration } from '../src/modules/builder/templates.js';

// ---- A fake dental practice website (home + services page + images) ----
const img = (seed: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), crypto.createHash('sha512').update(seed).digest(), crypto.randomBytes(20_000)]);
const IMAGES: Record<string, Buffer> = { '/img/front-desk.jpg': img('desk'), '/img/smiling-patient.jpg': img('smile'), '/img/treatment-room.jpg': img('room'), '/img/icon.jpg': Buffer.alloc(500) };
const HOME = `<!doctype html><html><head><title>Sunrise Family Dental</title>
<meta name="description" content="Sunrise Family Dental provides gentle family dental care in Albuquerque for patients of every age."></head>
<body><nav><a href="/">Home</a><a href="/services">Our Services</a><a href="/privacy">Privacy</a></nav>
<h1>Welcome</h1><p>Our team has cared for Albuquerque families since 1998, with a relaxed office where patients feel at ease.</p>
<p>We accept most dental insurance plans and offer same-day emergency visits for patients in pain.</p>
<p>Click here to subscribe to our newsletter for the latest news.</p>
<img src="/img/front-desk.jpg" alt="Friendly front desk team"><img src="/img/smiling-patient.jpg" alt="Smiling patient after cleaning"><img src="/img/icon.jpg" alt="icon">
<footer><p>Copyright 2026 Sunrise Family Dental. All rights reserved.</p></footer></body></html>`;
const SERVICES = `<html><head><title>Services</title></head><body><ul>
<li>Cleanings and exams that keep your whole family's teeth healthy and strong.</li>
<li>Cosmetic whitening and veneers for a brighter, confident smile you will love.</li>
<li>Dental implants that replace missing teeth with a natural look and feel.</li></ul>
<img src="/img/treatment-room.jpg" alt="Modern treatment room"></body></html>`;
let site: http.Server; let base = '';
let a: FastifyInstance; let projectId = '';
const jim = async () => { const c = client(a); await c.login('jim@example.com'); return c; };

beforeAll(async () => {
  site = http.createServer((req, res) => {
    const u = req.url ?? '/';
    if (u === '/' ) { res.setHeader('content-type', 'text/html'); return res.end(HOME); }
    if (u === '/services') { res.setHeader('content-type', 'text/html'); return res.end(SERVICES); }
    if (IMAGES[u]) { res.setHeader('content-type', 'image/jpeg'); return res.end(IMAGES[u]); }
    res.statusCode = 404; res.end('nope');
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(site.address() as any).port}`;
  await resetDb(); await seedUsers(); a = await mkApp();
});
afterAll(async () => { site.close(); await a.close(); await closeDb(); });

describe('safe website fetching', () => {
  it('recognises private and metadata addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) expect(fetchTest.isPrivate(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700::1111']) expect(fetchTest.isPrivate(ip)).toBe(false);
  });
  it('refuses private addresses when the test allowance is off, and non-web schemes always', async () => {
    process.env.ALLOW_PRIVATE_FETCH = 'false';
    try { await expect(safeFetch(base + '/')).rejects.toThrow(/private network|standard web ports/); await expect(safeFetch('http://127.0.0.1/')).rejects.toThrow(/private network/); }
    finally { process.env.ALLOW_PRIVATE_FETCH = 'true'; }
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow(/Only http and https/);
    await expect(safeFetch('http://user:pw@example.com/')).rejects.toThrow(/passwords/);
  });
});

describe('website analysis (K3, S8): grounded facts and images', () => {
  it('reads the site, keeps statements with their source page, drops boilerplate, and collects real images', async () => {
    const c = await jim();
    const sale = await c.post('/api/sales', { saleKey: uid(), channel: 'manual', package: 'standard',
      business: { businessName: 'Sunrise Family Dental', industry: 'dental', websiteUrl: base }, agreement: { accepted: true, name: 'Dr S' } });
    projectId = sale.json.projectId;
    const r = await c.post(`/api/projects/${projectId}/analyze`);
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('succeeded');
    expect(r.json.ownerMessage).toMatch(/Review them — only what you keep is used/);
    const b = (await c.get(`/api/projects/${projectId}/builder`)).json;
    const texts = b.facts.map((f: any) => f.text);
    expect(texts.some((t: string) => /since 1998/.test(t))).toBe(true);
    expect(texts.some((t: string) => /implants/.test(t))).toBe(true);                   // from the linked Services page
    expect(texts.some((t: string) => /newsletter|Copyright|rights reserved/i.test(t))).toBe(false);
    for (const f of b.facts) { expect(f.source_url).toMatch(/^http:\/\/127\.0\.0\.1/); expect(HOME + SERVICES).toContain(f.text.slice(0, 40)); }
    expect(b.images.length).toBe(3);                                                        // tiny icon skipped
    expect(b.images.map((i: any) => i.title).sort()).toEqual(['Friendly front desk team', 'Modern treatment room', 'Smiling patient after cleaning']);
    expect(b.images.every((i: any) => /confirm the client's permission/.test(i.rightsNote))).toBe(true);
    expect(b.project.status).toBe('in_progress');
  });

  it('explains a failure plainly and lets the owner continue by hand', async () => {
    const c = await jim();
    const sale = await c.post('/api/sales', { saleKey: uid(), channel: 'manual', package: 'standard',
      business: { businessName: 'Offline Law', industry: 'attorneys', websiteUrl: 'http://127.0.0.1:1/' }, agreement: { accepted: true, name: 'A' } });
    const r = await c.post(`/api/projects/${sale.json.projectId}/analyze`);
    expect(r.json.status).toBe('failed');
    expect(r.json.ownerMessage).toMatch(/couldn't read .* You can still continue: add facts yourself/);
    expect((await c.post(`/api/projects/${sale.json.projectId}/facts`, { text: 'Offline Law has helped injured workers for 20 years.' })).status).toBe(200);
    const build = await c.post(`/api/projects/${sale.json.projectId}/build`, { story: 'Client Journey', tone: 'Professional', websiteSecs: 30, platform: 'HeyGen' });
    expect(build.status).toBe(200);
  });
});

describe('building the four videos (W5, K14)', () => {
  it('uses only kept facts and allowed images; right scene counts; every narration traces to a fact', async () => {
    const c = await jim();
    let b = (await c.get(`/api/projects/${projectId}/builder`)).json;
    const dropped = b.facts.find((f: any) => /insurance/.test(f.text));
    await c.patch(`/api/projects/${projectId}/facts/${dropped.id}`, { selected: false });
    const dnu = b.images.find((i: any) => /treatment room/i.test(i.title));
    await c.patch(`/api/images/${dnu.id}`, { status: 'do_not_use' });
    const r = await c.post(`/api/projects/${projectId}/build`, { story: 'New Patient Experience', tone: 'Friendly', websiteSecs: 60, platform: 'HeyGen' });
    expect(r.status).toBe(200);
    expect(r.json.writtenBy).toBe('templates');
    b = (await c.get(`/api/projects/${projectId}/builder`)).json;
    const count = (k: string) => b.status.deliverables.find((d: any) => d.kind === k).sceneCount;
    expect([count('website'), count('social_a'), count('social_b'), count('email')]).toEqual([12, 6, 6, 3]);
    const kept = b.facts.filter((f: any) => f.selected);
    for (const s of b.scenes) {
      expect(s.narration).not.toMatch(/insurance/);                                         // dropped fact never used
      expect(s.image_ref?.assetId).not.toBe(dnu.id);                                        // Do Not Use never used (T4)
      if (s.fact_ids.length) {
        const spoken = s.narration.replace(/^Welcome to Sunrise Family Dental\.\s*/, '').replace(/[.!?]$/, '').toLowerCase();
        const sources = kept.filter((f: any) => s.fact_ids.includes(f.id)).map((f: any) => f.text.toLowerCase());
        expect(sources.some((t: string) => t.includes(spoken.slice(0, 30)))).toBe(true);
      }
    }
    expect(b.status.completeVideoKitApproved).toBe(false);
  });

  it('120-second website = 24 scenes; lengths outside 30/60/90/120 are refused', async () => {
    const c = await jim();
    const r = await c.post(`/api/projects/${projectId}/build`, { story: 'Office Tour', tone: 'Friendly', websiteSecs: 120, platform: 'HeyGen' });
    expect(r.json.status.deliverables.find((d: any) => d.kind === 'website').sceneCount).toBe(24);
    expect((await c.post(`/api/projects/${projectId}/build`, { story: 'Office Tour', tone: 'Friendly', websiteSecs: 45, platform: 'HeyGen' })).status).toBe(400);
    expect((await c.post(`/api/projects/${projectId}/build`, { story: 'Made Up Story', tone: 'Friendly', websiteSecs: 60, platform: 'HeyGen' })).status).toBe(400);
    await c.post(`/api/projects/${projectId}/build`, { story: 'New Patient Experience', tone: 'Friendly', websiteSecs: 60, platform: 'HeyGen' });
  });

  it('rebuilding over approved work needs confirmation and records the lost approvals', async () => {
    const c = await jim();
    const b = (await c.get(`/api/projects/${projectId}/builder`)).json;
    const s = b.scenes[0];
    await c.post(`/api/projects/${projectId}/approve`, { type: 'scene', id: s.id, expectedHash: s.content_hash });
    const r = await c.post(`/api/projects/${projectId}/build`, { story: 'New Patient Experience', tone: 'Friendly', websiteSecs: 60, platform: 'HeyGen' });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/BUILD AGAIN/);
    const ok = await c.post(`/api/projects/${projectId}/build`, { story: 'New Patient Experience', tone: 'Friendly', websiteSecs: 60, platform: 'HeyGen', confirmReplaceApproved: true });
    expect(ok.status).toBe(200);
    expect((await db().query(`SELECT count(*)::int n FROM approval_invalidations WHERE project_id=$1 AND new_hash='rebuilt'`, [projectId])).rows[0].n).toBe(1);
  });

  it('changing a scene image refuses Do Not Use images and invalidates an approval', async () => {
    const c = await jim();
    let b = (await c.get(`/api/projects/${projectId}/builder`)).json;
    const s = b.scenes[1];
    await c.post(`/api/projects/${projectId}/approve`, { type: 'scene', id: s.id, expectedHash: s.content_hash });
    const dnu = b.images.find((i: any) => /treatment room/i.test(i.title));
    expect((await c.put(`/api/projects/${projectId}/scenes/${s.id}/image`, { assetId: dnu.id })).status).toBe(409);
    const other = b.images.find((i: any) => i.id !== dnu.id && i.id !== s.image_ref?.assetId);
    const r = await c.put(`/api/projects/${projectId}/scenes/${s.id}/image`, { assetId: other.id });
    expect(r.json.deliverables.find((d: any) => d.kind === 'website').scenes.find((x: any) => x.id === s.id).wasApprovedEarlier).toBe(true);
  });
});

describe('approval → download → delivery (W16, N7, N9, N11, T15)', () => {
  it('downloads only after the Complete Video Kit is approved, with clean names and all formats', async () => {
    const c = await jim();
    expect((await c.raw('GET', `/api/projects/${projectId}/download/kit`)).status).toBe(409);
    let b = (await c.get(`/api/projects/${projectId}/builder`)).json;
    for (const d of b.status.deliverables) {
      const items = b.scenes.filter((s: any) => s.deliverable_id === d.id).map((s: any) => ({ id: s.id, expectedHash: s.content_hash }));
      await c.post(`/api/projects/${projectId}/approve-many`, { items });
    }
    b = (await c.get(`/api/projects/${projectId}/builder`)).json;
    expect(b.status.readyForFinalApproval).toBe(true);
    expect((await c.post(`/api/projects/${projectId}/delivery`, { method: 'Email' })).status).toBe(409);        // not approved yet
    await c.post(`/api/projects/${projectId}/approve`, { type: 'kit', expectedHash: b.status.compositeHash });
    expect((await c.post(`/api/projects/${projectId}/delivery`, { method: 'Email' })).json.error.message).toMatch(/Download the approved Complete Video Kit first/);
    const r = await a.inject({ method: 'GET', url: `/api/projects/${projectId}/download/kit`, headers: { cookie: (await loginCookie()) } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/Sunrise_Family_Dental_BrittVideo_Complete_Kit\.zip/);
    const names = zipNames(r.rawPayload);
    for (const n of ['00_READ_ME.txt', 'Sunrise_Family_Dental_Website_60sec.txt', 'Sunrise_Family_Dental_Social_A_30sec_16x9_Landscape.txt', 'Sunrise_Family_Dental_Social_A_30sec_9x16_Vertical.txt',
      'Sunrise_Family_Dental_Social_A_30sec_1x1_Square.txt', 'Sunrise_Family_Dental_Social_B_30sec_1x1_Square.txt', 'Sunrise_Family_Dental_Email_15sec.txt', 'Sunrise_Family_Dental_Image_Sources.txt']) expect(names).toContain(n);
    expect(names.some((n) => /^images\/\d\d_.*\.jpg$/.test(n))).toBe(true);
    expect(r.rawPayload.toString('latin1')).toContain('SOURCE: http://127.0.0.1');                // grounding travels with the kit
    const d = await c.post(`/api/projects/${projectId}/delivery`, { method: 'Emailed download link', reference: 'Sent to office manager' });
    expect(d.status).toBe(200);
    const detail = (await c.get(`/api/projects/${projectId}/builder`)).json;
    expect(detail.project.status).toBe('delivered');
    expect(detail.deliveries[0].method).toBe('Emailed download link');
    const used = detail.scenes.find((s: any) => s.image_ref?.assetId).image_ref.assetId;
    expect((await db().query(`SELECT protection_class FROM assets WHERE id=$1`, [used])).rows[0].protection_class).toBe('delivered');
    await expect(db().query(`DELETE FROM delivery_records`)).rejects.toThrow(/BV_APPEND_ONLY/);
  });
});

async function loginCookie() {
  const r = await a.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-brittvideo': '1' }, payload: { email: 'jim@example.com', password: 'correct horse battery staple' } });
  return String(r.headers['set-cookie']).split(';')[0];
}
function zipNames(buf: Buffer) {
  const out: string[] = []; let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18), n = buf.readUInt16LE(i + 26), crc = buf.readUInt32LE(i + 14);
    const name = buf.subarray(i + 30, i + 30 + n).toString(); const data = buf.subarray(i + 30 + n, i + 30 + n + size);
    expect(zlib.crc32(data) >>> 0).toBe(crc);
    out.push(name); i += 30 + n + size;
  }
  return out;
}

describe('Quick Video and standalone Email Video (K12, K13, K15, W9, W10)', () => {
  it('supports all 8 purposes and 15/30/60/90/120 seconds, and refuses anything else', async () => {
    const c = await jim();
    const cl = (await db().query(`SELECT id FROM clients WHERE business_name='Sunrise Family Dental'`)).rows[0];
    const purposes = ['Thank You After Service', 'Follow-Up / Check-In', 'Review Request', 'Referral Request', 'Promotion', 'Announcement', 'Seasonal', 'Email Video'];
    for (const [i, purpose] of purposes.entries()) {
      const secs = [15, 30, 60, 90, 120][i % 5];
      const r = await c.post('/api/quick-videos', { clientId: cl.id, purpose, delivery: 'Email', lengthSecs: secs, customer: 'Maria', promotionDetails: purpose === 'Promotion' ? 'Free whitening with any new-patient exam in October.' : undefined });
      expect(r.status).toBe(200);
      const p = (await c.get(`/api/projects/${r.json.projectId}`)).json;
      expect(p.project.kind).toBe(purpose === 'Email Video' ? 'email_video' : 'quick_video');
      expect(p.deliverables[0].duration_s).toBe(secs);
      expect(p.deliverables[0].script_text).toContain('Hi Maria');
    }
    expect((await c.post('/api/quick-videos', { clientId: cl.id, purpose: 'Review Request', delivery: 'Email', lengthSecs: 45 })).status).toBe(400);
    expect((await c.post('/api/quick-videos', { clientId: cl.id, purpose: 'Promotion', delivery: 'Email', lengthSecs: 15 })).json.error.message).toMatch(/Promotion \/ Offer Details/);
  });
  it('narration length fits the chosen time (15 s ≈ 27 words, 120 s ≈ 235)', () => {
    const w = (s: string) => s.split(/\s+/).length;
    expect(w(quickNarration('Thank You After Service', 'Sunrise', 'Maria', '', '', '', 15))).toBeLessThanOrEqual(40);
    expect(w(quickNarration('Thank You After Service', 'Sunrise', 'Maria', '', '', '', 120))).toBeGreaterThan(150);
  });
  it('an approved Quick Video script downloads with a clean name; unapproved does not', async () => {
    const c = await jim();
    const pid = (await db().query(`SELECT id FROM projects WHERE kind='email_video' LIMIT 1`)).rows[0].id;
    const p = (await c.get(`/api/projects/${pid}`)).json; const d = p.deliverables[0];
    expect((await c.raw('GET', `/api/projects/${pid}/download/script/${d.id}`)).status).toBe(409);
    await c.post(`/api/projects/${pid}/approve`, { type: 'script', id: d.id, expectedHash: d.script_hash });
    const r = await c.raw('GET', `/api/projects/${pid}/download/script/${d.id}`);
    expect(r.status).toBe(200);
    expect(r.body).toContain('STANDALONE EMAIL VIDEO');
  });
});

describe('Image Library (T3–T14)', () => {
  const png = () => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), crypto.randomBytes(3000)]).toString('base64');
  it('upload, duplicate detection, in-use protection, Recently Deleted, permanent delete with tombstone', async () => {
    const c = await jim();
    const data = png();
    const up = await c.post('/api/images', { dataBase64: data, mime: 'image/png', title: 'Waiting room', category: 'Dentist' });
    expect(up.status).toBe(200);
    const dup = await c.post('/api/images', { dataBase64: data, mime: 'image/png', title: 'Waiting room copy' });
    expect(dup.json.duplicateOf.id).toBe(up.json.asset.id);
    expect((await c.get('/api/images?view=duplicates')).json.length).toBe(2);
    expect((await c.post('/api/images', { dataBase64: data, mime: 'image/gif' })).status).toBe(400);
    // in-use image: delete needs confirmation
    const used = (await db().query(`SELECT (s.image_ref->>'assetId') id FROM scenes s WHERE s.image_ref ? 'assetId' LIMIT 1`)).rows[0].id;
    const refused = await c.post('/api/images/delete', { ids: [used] });
    expect(refused.status).toBe(409);
    expect(refused.json.error.message).toMatch(/used in a project/);
    // plain delete → Recently Deleted → restore
    await c.post('/api/images/delete', { ids: [dup.json.asset.id] });
    expect((await c.get('/api/images?view=recently_deleted')).json.map((x: any) => x.id)).toContain(dup.json.asset.id);
    await c.post('/api/images/restore', { ids: [dup.json.asset.id] });
    expect((await c.get('/api/images?view=recently_deleted')).json.length).toBe(0);
    // A User cannot permanently delete; the Super User can; then the same picture can never come back.
    await c.post('/api/images/delete', { ids: [up.json.asset.id, dup.json.asset.id] });
    const h = client(a); await h.login('helper@example.com');
    expect((await h.post('/api/images/purge', { ids: [up.json.asset.id] })).status).toBe(403);
    expect((await c.post('/api/images/purge', { ids: [up.json.asset.id, dup.json.asset.id] })).json.purged).toBe(2);
    const again = await c.post('/api/images', { dataBase64: data, mime: 'image/png', title: 'Sneaking back' });
    expect(again.status).toBe(409);
    expect(again.json.error.message).toMatch(/permanently deleted/);
  });
  it('delivered images are protected from permanent deletion', async () => {
    const c = await jim();
    const id = (await db().query(`SELECT id FROM assets WHERE protection_class='delivered' LIMIT 1`)).rows[0].id;
    await c.post('/api/images/delete', { ids: [id], confirmInUse: true });
    expect((await c.post('/api/images/purge', { ids: [id] })).status).toBe(409);
    await c.post('/api/images/restore', { ids: [id] });
  });
});

describe('script writers', () => {
  const facts = [{ id: 'f1', text: 'Our team has cared for Albuquerque families since 1998, with a relaxed office where patients feel at ease.' }, { id: 'f2', text: 'Dental implants replace missing teeth with a natural look.' }];
  const input = { businessName: 'Sunrise', industry: 'dental', story: 'Office Tour', tone: 'Friendly', facts, images: [{ id: 'i1', title: 'Front desk' }], websiteSecs: 30 };
  it('the built-in writer splits long facts into speakable lines without changing their words', () => {
    const ps = phrases(facts);
    expect(ps.every((p) => p.text.split(' ').length <= 21)).toBe(true);
    const k = templateWriter(input);
    expect(k.website.length).toBe(6);
    expect(k.social_a[0].narration).toMatch(/\?$/);                       // a hook, not a claim
  });
  it('the AI writer is used when it follows the rules, and rejected when it cites nothing', async () => {
    const scene = (n: string, ids: string[]) => ({ name: 'S', visual: 'v', narration: n, factIds: ids, imageId: 'i1' });
    const good = { website: [scene('Welcome', []), ...Array(4).fill(scene('Families since 1998.', ['f1'])), scene('Book today.', [])],
      social_a: [scene('Hook?', []), ...Array(4).fill(scene('Implants look natural.', ['f2'])), scene('Call.', [])],
      social_b: [scene('Hook 2?', []), ...Array(4).fill(scene('Relaxed office.', ['f1'])), scene('Call.', [])],
      email: [scene('Hi', []), scene('Since 1998.', ['f1']), scene('Visit.', [])] };
    const fetcher = (body: any) => async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(body) }] }) });
    expect((await claudeWriter(input, 'k', 'claude-sonnet-5', fetcher(good))).writtenBy).toBe('ai:claude-sonnet-5');
    const bad = JSON.parse(JSON.stringify(good)); bad.website[2] = scene('Voted best dentist in New Mexico!', []);
    await expect(claudeWriter(input, 'k', 'm', fetcher(bad))).rejects.toThrow(/uncited narration/);
    const invented = JSON.parse(JSON.stringify(good)); invented.email[1].factIds = ['f99'];
    await expect(claudeWriter(input, 'k', 'm', fetcher(invented))).rejects.toThrow(/unknown fact/);
  });
});
