import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db, closeDb } from '../src/db/pool.js';
import { resetDb, seedUsers, app as mkApp, client, uid } from './helpers.js';
import { findImages, imageSize } from '../src/modules/builder/site-images.js';

// ---- Real-looking picture files (correct headers + sizes) ----
function jpeg(w: number, h: number, seed: string) {
  const sof = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03]);
  return Buffer.concat([sof, crypto.createHash('sha512').update(seed).digest(), crypto.randomBytes(15_000)]);
}
function png(w: number, h: number, seed: string) {
  const head = Buffer.alloc(24); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8); head.write('IHDR', 12, 'ascii'); head.writeUInt32BE(w, 16); head.writeUInt32BE(h, 20);
  return Buffer.concat([head, crypto.createHash('sha512').update(seed).digest(), crypto.randomBytes(15_000)]);
}
function webp(w: number, h: number, seed: string) {
  const b = Buffer.alloc(30); b.write('RIFF', 0, 'ascii'); b.write('WEBPVP8X', 8, 'ascii');
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return Buffer.concat([b, crypto.createHash('sha512').update(seed).digest(), crypto.randomBytes(15_000)]);
}
const FILES: Record<string, { type: string; body: Buffer }> = {
  '/img/front-desk.jpg': { type: 'image/jpeg', body: jpeg(1200, 800, 'desk') },
  '/img/lazy-office.jpg': { type: 'image/jpeg', body: jpeg(1000, 700, 'lazy') },
  '/img/team-1600.jpg': { type: 'image/jpeg', body: jpeg(1600, 900, 'team-big') },
  '/img/team-400.jpg': { type: 'image/jpeg', body: jpeg(400, 225, 'team-small') },
  '/img/hero-bg.jpg': { type: 'image/jpeg', body: jpeg(1920, 1080, 'hero') },
  '/img/share.png': { type: 'image/png', body: png(1200, 630, 'share') },
  '/img/gallery-room.webp': { type: 'application/octet-stream', body: webp(900, 600, 'room') },   // wrong Content-Type on purpose
  '/img/tiny-tooth.png': { type: 'image/png', body: png(48, 48, 'tiny') },
  '/img/copy-of-desk.jpg': { type: 'image/jpeg', body: Buffer.alloc(0) },   // filled below: same bytes as front desk
  '/img/old-photo.jpg': { type: 'image/jpeg', body: jpeg(800, 600, 'old') },
  '/img/broken.jpg': { type: 'text/html', body: Buffer.from('<html>not found</html>') },
};
FILES['/img/copy-of-desk.jpg'].body = FILES['/img/front-desk.jpg'].body;
const HOME = `<!doctype html><html><head><title>Mesa Smiles Dental</title>
<meta property="og:image" content="/img/share.png"><style>.hero{background-image:url('/img/hero-bg.jpg')}</style></head>
<body><nav><a href="/">Home</a><a href="/gallery">Photo Gallery</a><a href="https://elsewhere.example/">Partner</a><a href="/brochure.pdf">Brochure</a></nav>
<div class="hero"></div>
<img src="/img/front-desk.jpg" alt="Our friendly front desk">
<img src="data:image/gif;base64,R0lGOD" data-src="/img/lazy-office.jpg" alt="Bright waiting room">
<img src="/img/team-400.jpg" srcset="/img/team-400.jpg 400w, /img/team-1600.jpg 1600w" alt="Dr. Lee and team">
<img src="/img/tiny-tooth.png" alt="tooth"><img src="/img/logo.svg" alt="Logo"><img src="/img/spacer.gif">
<img src="/img/copy-of-desk.jpg" alt="Desk again"><img src="/img/broken.jpg"><img src="/img/old-photo.jpg" alt="Old photo">
</body></html>`;
const GALLERY = `<html><body><picture><source srcset="/img/gallery-room.webp" type="image/webp"><img src="/img/front-desk.jpg"></picture></body></html>`;

let site: http.Server; let base = ''; let a: FastifyInstance;
const jim = async () => { const c = client(a); await c.login('jim@example.com'); return c; };

beforeAll(async () => {
  site = http.createServer((req, res) => {
    const u = req.url ?? '/';
    if (u === '/') { res.setHeader('content-type', 'text/html'); return res.end(HOME); }
    if (u === '/gallery') { res.setHeader('content-type', 'text/html'); return res.end(GALLERY); }
    const f = FILES[u];
    if (f) { res.setHeader('content-type', f.type); return res.end(f.body); }
    res.statusCode = 404; res.end('nope');
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(site.address() as any).port}`;
  await resetDb(); await seedUsers(); a = await mkApp();
});
afterAll(async () => { await a.close(); site.close(); await closeDb(); });

describe('GET PICTURES FROM A WEBSITE', () => {
  it('finds normal, lazy, largest-srcset, <picture>, share and CSS background pictures, and skips svg/gif/data/junk', () => {
    const { images } = findImages(HOME, base + '/');
    const urls = images.map((i) => new URL(i.url).pathname);
    expect(urls).toEqual(expect.arrayContaining(['/img/front-desk.jpg', '/img/lazy-office.jpg', '/img/team-1600.jpg', '/img/hero-bg.jpg', '/img/share.png']));
    expect(urls).not.toContain('/img/team-400.jpg');
    expect(urls.some((u) => /\.svg|\.gif|^data/.test(u))).toBe(false);
    expect(findImages(GALLERY, base + '/gallery').images.map((i) => new URL(i.url).pathname)).toContain('/img/gallery-room.webp');
  });

  it('reads picture sizes from JPEG, PNG and WebP headers', () => {
    expect(imageSize(FILES['/img/front-desk.jpg'].body)).toEqual({ width: 1200, height: 800 });
    expect(imageSize(FILES['/img/share.png'].body)).toEqual({ width: 1200, height: 630 });
    expect(imageSize(FILES['/img/gallery-room.webp'].body)).toEqual({ width: 900, height: 600 });
  });

  it('scans a website into a preview (nothing saved yet), then saves the ticked pictures into a prospect folder', async () => {
    const c = await jim();
    const pr = await c.post('/api/prospects', { businessName: 'Mesa Smiles Dental', websiteUrl: base, industry: 'dental' });
    const prospectId = pr.json.id ?? pr.json.prospect?.id;
    expect(prospectId).toBeTruthy();
    const before = (await c.get('/api/images')).json.length;

    // Permanently delete one picture first: it must never come back from a website.
    const up = await c.post('/api/images', { dataBase64: FILES['/img/old-photo.jpg'].body.toString('base64'), mime: 'image/jpeg', title: 'Old photo' });
    await c.post('/api/images/delete', { ids: [up.json.asset.id] }); await c.post('/api/images/purge', { ids: [up.json.asset.id] });

    const s = await c.post('/api/image-scans', { prospectId });   // website comes from the prospect
    expect(s.status).toBe(200);
    const paths = s.json.items.map((i: any) => new URL(i.sourceUrl).pathname);
    expect(paths).toEqual(expect.arrayContaining(['/img/front-desk.jpg', '/img/lazy-office.jpg', '/img/team-1600.jpg', '/img/hero-bg.jpg', '/img/share.png', '/img/gallery-room.webp']));
    expect(paths).not.toContain('/img/tiny-tooth.png');     // icon-sized
    expect(paths).not.toContain('/img/copy-of-desk.jpg');   // same file as the front desk picture
    expect(paths).not.toContain('/img/old-photo.jpg');      // permanently deleted earlier
    expect(s.json.skipped.blocked).toBe(1);
    expect(s.json.skipped.tooSmall).toBeGreaterThanOrEqual(1);
    expect(s.json.pages.filter((p: any) => p.ok).map((p: any) => new URL(p.url).pathname)).toEqual(['/', '/gallery']);   // never leaves the site, skips PDFs
    expect((await c.get('/api/images')).json.length).toBe(before);   // preview only

    const prev = await c.raw('GET', s.json.items[0].previewUrl);
    expect(prev.status).toBe(200);

    const desk = s.json.items.find((i: any) => i.sourceUrl.endsWith('/img/front-desk.jpg'));
    const room = s.json.items.find((i: any) => i.sourceUrl.endsWith('/img/gallery-room.webp'));
    const saved = await c.post(`/api/image-scans/${s.json.scanId}/save`, { picks: [desk.n, room.n], prospectId, category: 'Dentist' });
    expect(saved.status).toBe(200);
    expect(saved.json.saved.length).toBe(2);
    expect(saved.json.ownerMessage).toContain('Mesa Smiles Dental');

    const folder = (await c.get(`/api/images?folder=prospect:${prospectId}`)).json;
    expect(folder.map((x: any) => x.title).sort()).toEqual(['Gallery room', 'Our friendly front desk']);
    expect(folder.every((x: any) => x.sourceType === 'website' && x.category === 'Dentist' && x.prospectId === prospectId && /permission/.test(x.rightsNote))).toBe(true);
    expect((await c.get('/api/images?folder=general')).json.some((x: any) => x.title === 'Our friendly front desk')).toBe(false);

    // Saving the same pictures again does not make copies.
    const again = await c.post(`/api/image-scans/${s.json.scanId}/save`, { picks: [desk.n], prospectId });
    expect(again.json.saved.length).toBe(0); expect(again.json.alreadyHad.length).toBe(1);

    const folders = (await c.get('/api/image-folders')).json;
    expect(folders.groups.find((g: any) => g.key === 'dental').folders.find((f: any) => f.id === prospectId).pictures).toBe(2);
  });

  it('a second scan marks pictures already in the library', async () => {
    const c = await jim();
    const s = await c.post('/api/image-scans', { url: base });
    const desk = s.json.items.find((i: any) => i.sourceUrl.endsWith('/img/front-desk.jpg'));
    expect(desk.alreadyInLibrary?.title).toBe('Our friendly front desk');
  });

  it("another person cannot see or save someone else's scan, and an unknown scan says to scan again", async () => {
    const c = await jim();
    const s = await c.post('/api/image-scans', { url: base });
    const helper = client(a); await helper.login('helper@example.com');
    expect((await helper.raw('GET', s.json.items[0].previewUrl)).status).toBe(410);
    expect((await helper.post(`/api/image-scans/${s.json.scanId}/save`, { picks: [1] })).status).toBe(410);
    const gone = await c.post(`/api/image-scans/${crypto.randomUUID()}/save`, { picks: [1] });
    expect(gone.status).toBe(410); expect(gone.json.error.message).toMatch(/scan the website again/i);
  });

  it('plain answers for a missing address, an unreachable site, nothing ticked, and two folders at once', async () => {
    const c = await jim();
    expect((await c.post("/api/image-scans", {})).json.error.message).toMatch(/website address/i);
    const bad = await c.post('/api/image-scans', { url: base + '/missing-page' });
    expect(bad.status).toBe(422);
    const s = await c.post('/api/image-scans', { url: base });
    expect((await c.post(`/api/image-scans/${s.json.scanId}/save`, { picks: [] })).status).toBe(400);
    const cl = await c.get('/api/clients');
    const pr = await c.get('/api/prospects');
    if (cl.json.length) expect((await c.post(`/api/image-scans/${s.json.scanId}/save`, { picks: [1], clientId: cl.json[0].id, prospectId: pr.json[0].id })).status).toBe(400);
  });

  it('website safety still applies: private network addresses are refused in live use', async () => {
    const c = await jim();
    process.env.ALLOW_PRIVATE_FETCH = 'false';
    try { const r = await c.post('/api/image-scans', { url: base }); expect(r.status).toBe(422); expect(r.json.error.message).toMatch(/private network|standard web ports/i); }
    finally { process.env.ALLOW_PRIVATE_FETCH = 'true'; }
  });

  it('folders come in four groups — Dentists, Facilities, Attorneys, Others — each with one folder per business', async () => {
    const c = await jim();
    await c.post('/api/prospects', { businessName: 'Sandia Senior Living', websiteUrl: 'sandia-living.example', industry: 'senior_care' });
    await c.post('/api/prospects', { businessName: 'Rio Grande Law', websiteUrl: 'riolaw.example', industry: 'attorneys' });
    await c.post('/api/prospects', { businessName: 'Duke City Plumbing', websiteUrl: 'dcplumb.example', industry: 'other', businessType: 'Plumber' });
    const f = (await c.get('/api/image-folders')).json;
    expect(f.groups.map((g: any) => g.label)).toEqual(['Dentists', 'Facilities', 'Attorneys', 'Others']);
    const names = (k: string) => f.groups.find((g: any) => g.key === k).folders.map((x: any) => x.name);
    expect(names('dental')).toContain('Mesa Smiles Dental');
    expect(names('senior_care')).toEqual(['Sandia Senior Living']);
    expect(names('attorneys')).toEqual(['Rio Grande Law']);
    expect(names('other')).toEqual(['Duke City Plumbing']);
    expect(f.groups.find((g: any) => g.key === 'dental').pictures).toBe(2);
    // The whole Dentists group can be viewed at once; other groups don't show dentist pictures.
    expect((await c.get('/api/images?folder=group:dental')).json.length).toBe(2);
    expect((await c.get('/api/images?folder=group:senior_care')).json.length).toBe(0);
  });

  it("a saved picture's category follows the group when none is chosen (Facilities → Senior Living)", async () => {
    const c = await jim();
    const f = (await c.get('/api/image-folders')).json;
    const sandia = f.groups.find((g: any) => g.key === 'senior_care').folders[0];
    const s = await c.post('/api/image-scans', { url: base });
    const hero = s.json.items.find((i: any) => i.sourceUrl.endsWith('/img/hero-bg.jpg'));
    const r = await c.post(`/api/image-scans/${s.json.scanId}/save`, { picks: [hero.n], prospectId: sandia.id });
    expect(r.json.saved.length).toBe(1);
    const pics = (await c.get(`/api/images?folder=prospect:${sandia.id}`)).json;
    expect(pics[0].category).toBe('Senior Living');
  });

  it('Builder: a client folder (including pictures saved while it was a prospect) goes into a new video with one button, every time', async () => {
    const c = await jim();
    // Save pictures to a prospect, then that prospect buys: the client folder keeps them.
    const pr = (await c.post('/api/prospects', { businessName: 'Corrales Family Dentistry', websiteUrl: base, industry: 'dental' })).json;
    const prospectId = pr.id ?? pr.prospect?.id;
    const s = await c.post('/api/image-scans', { url: base });
    const share = s.json.items.find((i: any) => i.sourceUrl.endsWith('/img/share.png'));
    const team = s.json.items.find((i: any) => i.sourceUrl.endsWith('/img/team-1600.jpg'));
    const saved = await c.post(`/api/image-scans/${s.json.scanId}/save`, { picks: [share.n, team.n], prospectId });
    expect(saved.json.saved.length).toBe(2);
    const sale = await c.post('/api/sales', { saleKey: uid(), channel: 'manual', package: 'standard', prospectId,
      business: { businessName: 'Corrales Family Dentistry', industry: 'dental', websiteUrl: base }, agreement: { accepted: true, name: 'Dr C' } });
    expect(sale.status).toBe(200);
    const clientId = sale.json.clientId ?? (await c.get(`/api/projects/${sale.json.projectId}/builder`)).json.project.client_id;
    const inClient = (await c.get(`/api/images?folder=client:${clientId}`)).json.map((x: any) => x.id);
    expect(inClient).toEqual(expect.arrayContaining(saved.json.saved.map((x: any) => x.id)));

    // Video 1 and video 2 both get the folder pictures without scanning again.
    for (const pid of [sale.json.projectId]) {
      let b = (await c.get(`/api/projects/${pid}/builder`)).json;
      expect(b.folderWaiting).toBeGreaterThanOrEqual(2);
      const r = await c.post(`/api/projects/${pid}/images/from-folder`);
      expect(r.json.added).toBe(b.folderWaiting);
      b = (await c.get(`/api/projects/${pid}/builder`)).json;
      expect(b.folderWaiting).toBe(0);
      expect(b.images.filter((i: any) => i.selected).map((i: any) => i.id)).toEqual(expect.arrayContaining(saved.json.saved.map((x: any) => x.id)));
      expect((await c.post(`/api/projects/${pid}/images/from-folder`)).json.added).toBe(0);
    }
    // A Do Not Use picture in the folder is never added.
    await c.patch(`/api/images/${saved.json.saved[0].id}`, { status: 'do_not_use' });
    const second = await c.post('/api/sales', { saleKey: uid(), channel: 'manual', package: 'standard', clientId,
      business: { businessName: 'Corrales Family Dentistry', industry: 'dental', websiteUrl: base }, agreement: { accepted: true, name: 'Dr C' } });
    expect(second.status).toBe(200);
    {
      const r = await c.post(`/api/projects/${second.json.projectId}/images/from-folder`);
      const b = (await c.get(`/api/projects/${second.json.projectId}/builder`)).json;
      expect(b.images.map((i: any) => i.id)).not.toContain(saved.json.saved[0].id);
      expect(r.json.added).toBeGreaterThanOrEqual(1);
    }
  });

  it('review fix: an older Recently Deleted copy does not hide a live copy (no second save); restore never revives a permanently deleted picture', async () => {
    const c = await jim();
    const body = FILES['/img/lazy-office.jpg'].body.toString('base64');
    const first = await c.post('/api/images', { dataBase64: body, mime: 'image/jpeg', title: 'Lazy office old' });
    await c.post('/api/images/delete', { ids: [first.json.asset.id] });
    const second = await c.post('/api/images', { dataBase64: body, mime: 'image/jpeg', title: 'Lazy office live' });
    const s = await c.post('/api/image-scans', { url: base });
    const lazy = s.json.items.find((i: any) => i.sourceUrl.endsWith('/img/lazy-office.jpg'));
    expect(lazy.alreadyInLibrary?.id).toBe(second.json.asset.id);
    const again = await c.post(`/api/image-scans/${s.json.scanId}/save`, { picks: [lazy.n] });
    expect(again.json.saved.length).toBe(0);

    // Two copies in Recently Deleted; one is permanently deleted → the other can't be restored.
    await c.post('/api/images/delete', { ids: [second.json.asset.id] });
    await c.post('/api/images/purge', { ids: [second.json.asset.id] });
    const r = await c.post('/api/images/restore', { ids: [first.json.asset.id] });
    expect(r.json.restored).toBe(0);
  });
});
