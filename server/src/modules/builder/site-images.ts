import type pg from 'pg';
import crypto from 'node:crypto';
import { parse } from 'node-html-parser';
import { tx } from '../../db/pool.js';
import type { Actor } from '../../auth/permissions.js';
import { requirePerm } from '../../auth/service.js';
import { OwnerError, notFound } from '../../lib/errors.js';
import { sha256, cleanWebsite } from '../../lib/util.js';
import { audit } from '../audit/service.js';
import { safeFetch } from '../../integrations/web-fetch.js';
import { putObject } from '../../integrations/storage.js';
import { CATEGORIES } from './images.js';

/**
 * GET PICTURES FROM A WEBSITE (Image Library).
 * Step 1 — SCAN: read the home page and up to 8 more pages on the same site, find every picture (normal images, lazy-loaded
 *   images, the largest srcset size, <picture> sources, share images and CSS background pictures), download them and keep
 *   them IN MEMORY only. Nothing is added to the library yet.
 * Step 2 — SAVE: the owner ticks the pictures to keep and chooses the folder (a client, a prospect, or the general library).
 * Rules kept from the Image Library: a permanently deleted picture can never come back; exact duplicates are not added twice;
 * every saved picture keeps its source address and a rights note.
 */
const MAX_PAGES = 9, MAX_CANDIDATES = 80, MAX_KEEP = 60, MAX_SCAN_BYTES = 150_000_000, SCAN_DEADLINE_MS = 90_000;
const MIN_SIDE = 200;                     // smaller pictures are icons, buttons and tracking pixels
const KEEP_MS = 30 * 60_000;              // a scan is kept for 30 minutes
const JUNK = /(sprite|pixel|spacer|favicon|badge|1x1|blank\.|loading|loader|placeholder|tracking|analytics|facebook\.com\/tr|doubleclick|gravatar)/i;
const SKIP_PAGE = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp4|mov|mp3)$/i;
const GOOD_PAGE = /(about|service|gallery|photo|team|staff|office|tour|amenit|dining|activit|life|living|practice|patient|smile|our|care|facility|location)/i;

export interface FoundImage { url: string; alt: string; page: string }

/** Every picture address on one page (deduplicated, absolute, http/https only). Exported for tests. */
export function findImages(html: string, pageUrl: string): { images: FoundImage[]; links: string[] } {
  const root = parse(html, { blockTextElements: { script: false, style: true, noscript: true } });
  const out: { url: string; alt: string }[] = [];
  const add = (u: string | null | undefined, alt = '') => { if (u && u.trim() && !u.trim().startsWith('data:')) out.push({ url: u.trim(), alt }); };
  const largest = (srcset: string | null | undefined) => {
    if (!srcset) return null;
    const parts = srcset.split(/,\s+(?=\S)/).map((s) => s.trim().split(/\s+/)).filter((p) => p[0]);
    if (!parts.length) return null;
    const size = (p: string[]) => parseFloat((p[1] ?? '1').replace(/[wx]$/i, '')) || 1;
    return parts.sort((a, b) => size(b) - size(a))[0][0];
  };
  for (const sel of ['meta[property="og:image"]', 'meta[property="og:image:url"]', 'meta[name="twitter:image"]']) add(root.querySelector(sel)?.getAttribute('content'), 'Website share picture');
  add(root.querySelector('link[rel="image_src"]')?.getAttribute('href'));
  root.querySelectorAll('img').forEach((img) => {
    const alt = (img.getAttribute('alt') ?? img.getAttribute('title') ?? '').replace(/\s+/g, ' ').trim();
    add(largest(img.getAttribute('data-srcset') ?? img.getAttribute('data-lazy-srcset') ?? img.getAttribute('srcset'))
      ?? img.getAttribute('data-src') ?? img.getAttribute('data-lazy-src') ?? img.getAttribute('data-original') ?? img.getAttribute('src'), alt);
  });
  root.querySelectorAll('picture source').forEach((s) => add(largest(s.getAttribute('data-srcset') ?? s.getAttribute('srcset'))));
  root.querySelectorAll('[data-bg],[data-background],[data-background-image]').forEach((el) =>
    add(el.getAttribute('data-bg') ?? el.getAttribute('data-background') ?? el.getAttribute('data-background-image')));
  // CSS background pictures: style="background-image:url(...)" and <style> blocks.
  const cssText = [...root.querySelectorAll('[style]').map((el) => el.getAttribute('style') ?? ''), ...root.querySelectorAll('style').map((s) => s.text)].join('\n');
  for (const m of cssText.matchAll(/url\(\s*['"]?([^'")]+?\.(?:jpe?g|png|webp)(?:\?[^'")]*)?)['"]?\s*\)/gi)) add(m[1]);

  const abs = (x: string) => { try { const u = new URL(x.replace(/&amp;/g, '&'), pageUrl); u.hash = ''; return /^https?:$/.test(u.protocol) ? u.toString() : null; } catch { return null; } };
  const seen = new Set<string>(); const images: FoundImage[] = [];
  for (const i of out) {
    const u = abs(i.url);
    if (!u || seen.has(u) || /\.(svg|gif|ico)(\?|$)/i.test(u) || JUNK.test(u)) continue;
    seen.add(u); images.push({ url: u, alt: i.alt, page: pageUrl });
  }
  const links = root.querySelectorAll('a[href]').map((a) => abs(a.getAttribute('href') ?? '')).filter((x): x is string => !!x);
  return { images, links };
}

/** Width and height from the file header (JPEG, PNG, WebP). Null when it can't be read. Exported for tests. */
export function imageSize(b: Buffer): { width: number; height: number } | null {
  try {
    if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const kind = b.toString('ascii', 12, 16);
      if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
      if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
      return null;
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const len = b.readUInt16BE(i + 2);
        if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        i += 2 + len;
      }
    }
  } catch { /* unreadable header */ }
  return null;
}

/** The real file type from the first bytes (websites often send the wrong Content-Type). */
function sniff(b: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.readUInt32BE(0) === 0x89504e47) return 'png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

interface ScanItem { n: number; buf: Buffer; mime: string; ext: string; sha: string; url: string; alt: string; page: string; width: number; height: number }
interface Scan { id: string; userId: string; host: string; startUrl: string; createdAt: number; items: ScanItem[] }
const scans = new Map<string, Scan>();
const running = new Set<string>();   // one scan per user at a time
function sweep() { const now = Date.now(); for (const [k, s] of scans) if (now - s.createdAt > KEEP_MS) scans.delete(k); }
setInterval(sweep, 60_000).unref();

function nameFor(i: { alt: string; url: string }) {
  if (i.alt && i.alt.length >= 3 && i.alt !== 'Website share picture') return i.alt.slice(0, 120);
  let file = 'Website picture';
  try { file = decodeURIComponent(new URL(i.url).pathname.split('/').pop() || file); } catch { /* keep default */ }
  const t = (file.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\b\d{2,4}x\d{2,4}\b/g, '').replace(/\s+/g, ' ').trim() || 'Website picture').slice(0, 120);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

async function folderFor(q: pg.Pool | pg.PoolClient, f: { clientId?: string | null; prospectId?: string | null }) {
  if (f.clientId && f.prospectId) throw new OwnerError('Choose one folder: a client or a prospect.');
  if (f.clientId) {
    const c = (await q.query(`SELECT id, business_name, website_url, industry FROM clients WHERE id=$1`, [f.clientId])).rows[0];
    if (!c) throw notFound('client');
    return { kind: 'client' as const, id: c.id as string, name: c.business_name as string, website: c.website_url as string | null, industry: c.industry as string };
  }
  if (f.prospectId) {
    const p = (await q.query(`SELECT id, business_name, website_url, industry FROM prospects WHERE id=$1`, [f.prospectId])).rows[0];
    if (!p) throw notFound('prospect');
    return { kind: 'prospect' as const, id: p.id as string, name: p.business_name as string, website: p.website_url as string | null, industry: p.industry as string };
  }
  return { kind: 'library' as const, id: null, name: 'My Image Library', website: null, industry: null as string | null };
}

/** SCAN WEBSITE. Returns the pictures found (preview links), which are already in the library, and what was skipped. */
export async function scanWebsite(pool: pg.Pool, actor: Actor, input: { url?: string; clientId?: string | null; prospectId?: string | null }) {
  requirePerm(actor, 'work');
  const folder = await folderFor(pool, input);
  const start = cleanWebsite(input.url || folder.website);
  if (!start) throw new OwnerError('Type the website address first (for example sunrisedental.com).');
  let startUrl: URL;
  try { startUrl = new URL(start); } catch { throw new OwnerError('That website address is not valid.'); }
  const who = actor.userId ?? actor.label;
  if (running.has(who)) throw new OwnerError('BrittVideo is already looking at a website for you. Please wait for it to finish.', 409, 'scan_running');
  running.add(who);
  for (const [k, s] of scans) if (s.userId === who) scans.delete(k);   // free the old scan before downloading a new one
  try { return await scanOnce(pool, actor, startUrl.toString()); } finally { running.delete(who); }
}

async function scanOnce(pool: pg.Pool, actor: Actor, start: string) {
  sweep();
  const deadline = Date.now() + SCAN_DEADLINE_MS;
  const pages: { url: string; ok: boolean; error?: string }[] = [];
  const candidates = new Map<string, FoundImage>();
  const readPage = async (url: string) => {
    try {
      const r = await safeFetch(url, { maxBytes: 3_000_000, timeoutMs: 12_000, accept: 'text/html,application/xhtml+xml' });
      if (r.status >= 400 || !/html/i.test(r.contentType)) { pages.push({ url, ok: false, error: `the page answered ${r.status}` }); return null; }
      const found = findImages(r.body.toString('utf8'), r.url);
      for (const i of found.images) if (candidates.size < MAX_CANDIDATES && !candidates.has(i.url)) candidates.set(i.url, i);
      pages.push({ url: r.url, ok: true });
      return { finalUrl: r.url, links: found.links };
    } catch (e: any) { pages.push({ url, ok: false, error: e?.message ?? 'no answer' }); return null; }
  };

  const home = await readPage(start);
  const host = (() => { try { return new URL(home?.finalUrl ?? start).hostname.replace(/^www\./, ''); } catch { return start; } })();
  if (!home) throw new OwnerError(`BrittVideo couldn't open ${host} (${pages[0]?.error ?? 'no answer'}). Check the address and try again.`, 422, 'scan_failed');
  const sameSite = (l: string) => { try { return new URL(l).hostname.replace(/^www\./, '') === host; } catch { return false; } };
  const visited = new Set([start, home.finalUrl].map((u) => u.replace(/\/$/, '')));
  const more = [...new Set(home.links.map((l) => l.split('#')[0]))].filter((l) => sameSite(l) && !SKIP_PAGE.test(new URL(l).pathname) && !visited.has(l.replace(/\/$/, '')));
  more.sort((a, b) => Number(GOOD_PAGE.test(new URL(b).pathname)) - Number(GOOD_PAGE.test(new URL(a).pathname)));
  for (const l of more.slice(0, MAX_PAGES - 1)) { if (Date.now() > deadline || candidates.size >= MAX_CANDIDATES) break; await readPage(l); }

  // Download candidates, four at a time.
  const items: ScanItem[] = []; const seenSha = new Set<string>();
  const skipped = { tooSmall: 0, notPicture: 0, failed: 0, blocked: 0, duplicates: 0 };
  let bytes = 0; let stoppedEarly = false;
  const queue = [...candidates.values()];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      if (Date.now() > deadline || bytes > MAX_SCAN_BYTES || items.length >= MAX_KEEP) { stoppedEarly = true; return; }
      try {
        const r = await safeFetch(c.url, { maxBytes: 12_000_000, timeoutMs: 15_000, accept: 'image/webp,image/jpeg,image/png,image/*;q=0.8' });
        if (r.status >= 400) { skipped.failed++; continue; }
        const kind = sniff(r.body);
        if (!kind) { skipped.notPicture++; continue; }
        const size = imageSize(r.body);
        if (!size || size.width < MIN_SIDE || size.height < MIN_SIDE) { skipped.tooSmall++; continue; }
        const sha = sha256(r.body);
        if (seenSha.has(sha)) { skipped.duplicates++; continue; }
        seenSha.add(sha);
        bytes += r.body.length;
        items.push({ n: 0, buf: r.body, mime: `image/${kind}`, ext: kind === 'jpeg' ? 'jpg' : kind, sha, url: c.url, alt: c.alt, page: c.page, ...size });
      } catch { skipped.failed++; }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  // Keep page order (the order pictures appear on the site), biggest first within a page is not needed.
  const order = [...candidates.keys()];
  items.sort((a, b) => order.indexOf(a.url) - order.indexOf(b.url));
  const known = items.length ? (await pool.query(`SELECT DISTINCT ON (sha256) sha256, id, title, status, client_id, prospect_id FROM assets WHERE sha256 = ANY($1::text[])
      ORDER BY sha256, (status='permanently_deleted') DESC, (status='recently_deleted') ASC, created_at`, [items.map((i) => i.sha)])).rows : [];
  const bySha = new Map(known.map((k) => [k.sha256, k]));
  const kept = items.filter((i) => { if (bySha.get(i.sha)?.status === 'permanently_deleted') { skipped.blocked++; return false; } return true; });
  kept.forEach((i, n) => { i.n = n + 1; });

  const scan: Scan = { id: crypto.randomUUID(), userId: actor.userId ?? actor.label, host, startUrl: start, createdAt: Date.now(), items: kept };
  for (const [k, s] of scans) if (s.userId === scan.userId) scans.delete(k);   // one live scan per person keeps memory small
  scans.set(scan.id, scan);

  const okPages = pages.filter((p) => p.ok).length;
  const ownerMessage = kept.length
    ? `BrittVideo looked at ${okPages} page(s) on ${host} and found ${kept.length} picture(s). Tick the ones you want, then save them.${stoppedEarly ? ' (It stopped early because the site is very large — this is the first batch.)' : ''}`
    : `BrittVideo looked at ${okPages} page(s) on ${host} but found no usable pictures (only small icons or none at all). Some websites load pictures in a way BrittVideo can't see — you can still save pictures from your computer.`;
  return {
    scanId: scan.id, host, ownerMessage, pages, skipped, stoppedEarly,
    items: kept.map((i) => {
      const k = bySha.get(i.sha);
      return { n: i.n, previewUrl: `/api/image-scans/${scan.id}/${i.n}`, title: nameFor(i), alt: i.alt, sourceUrl: i.url, page: i.page,
        width: i.width, height: i.height, bytes: i.buf.length, alreadyInLibrary: k && k.status !== 'recently_deleted' ? { id: k.id, title: k.title } : null };
    }),
  };
}

function ownScan(actor: Actor, scanId: string) {
  sweep();
  const s = scans.get(scanId);
  if (!s || s.userId !== (actor.userId ?? actor.label)) throw new OwnerError('Those website pictures are no longer available (they are kept for 30 minutes). Please scan the website again.', 410, 'scan_expired');
  return s;
}

/** Preview of one scanned picture (only for the person who scanned). */
export function scanPreview(actor: Actor, scanId: string, n: number) {
  requirePerm(actor, 'work');
  const item = ownScan(actor, scanId).items.find((i) => i.n === n);
  if (!item) throw notFound('picture');
  return item;
}

/** SAVE TO FOLDER: add the ticked pictures to the Image Library, in the chosen folder. */
export async function saveScan(pool: pg.Pool, actor: Actor, scanId: string, input: { picks?: number[]; clientId?: string | null; prospectId?: string | null; category?: string }) {
  requirePerm(actor, 'work');
  const scan = ownScan(actor, scanId);
  const picks = [...new Set((input.picks ?? []).map(Number))];
  const chosen = scan.items.filter((i) => picks.includes(i.n));
  if (!chosen.length) throw new OwnerError('Tick at least one picture to save.');
  return tx(async (t) => {
    const folder = await folderFor(t, input);
    const category = CATEGORIES.includes(input.category ?? '') ? input.category! : categoryFor(folder.industry);
    const saved: { id: string; title: string }[] = []; const alreadyHad: { id: string; title: string }[] = []; let blocked = 0;
    for (const i of chosen) {
      await t.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['asset-sha:' + i.sha]);   // two saves at once can't both add it
      const existing = (await t.query(`SELECT id, title, status FROM assets WHERE sha256=$1 ORDER BY (status='permanently_deleted') DESC, (status='recently_deleted') ASC, created_at LIMIT 1`, [i.sha])).rows[0];
      if (existing?.status === 'permanently_deleted') { blocked++; continue; }   // T14: never brought back
      if (existing && existing.status !== 'recently_deleted') { alreadyHad.push({ id: existing.id, title: existing.title }); continue; }
      const obj = putObject(i.buf, i.ext);
      const title = nameFor(i);
      const a = (await t.query(`INSERT INTO assets (client_id, prospect_id, title, category, source_type, source_url, rights_note, status, protection_class, storage_key, sha256, bytes, mime, alt_text, created_by)
        VALUES ($1,$2,$3,$4,'website',$5,$6,'available','working',$7,$8,$9,$10,$11,$12) RETURNING id, title`,
        [folder.kind === 'client' ? folder.id : null, folder.kind === 'prospect' ? folder.id : null, title, category, i.url,
          `From ${scan.host} (page: ${i.page}) — confirm the business's permission before using it in a finished video.`,
          obj.key, i.sha, obj.bytes, i.mime, i.alt || null, actor.userId])).rows[0];
      saved.push(a);
    }
    await audit(t, actor, 'image.website_pictures_saved', folder.id ? { type: folder.kind, id: folder.id } : null,
      `${saved.length} picture(s) from ${scan.host} saved to ${folder.name}${alreadyHad.length ? ` (${alreadyHad.length} already in the library)` : ''}`);
    const parts = [`${saved.length} picture(s) saved to ${folder.kind === 'library' ? 'My Image Library' : `the ${folder.name} folder`}.`];
    if (alreadyHad.length) parts.push(`${alreadyHad.length} ${alreadyHad.length === 1 ? 'was' : 'were'} already in your library, so ${alreadyHad.length === 1 ? 'it was' : 'they were'} not added twice.`);
    if (blocked) parts.push(`${blocked} had been permanently deleted earlier and ${blocked === 1 ? 'was' : 'were'} not added.`);
    return { saved, alreadyHad, blocked, folder: { kind: folder.kind, id: folder.id, name: folder.name }, ownerMessage: parts.join(' ') };
  }, pool);
}

/** The four folder groups Jim asked for. Each business (client or prospect) has its own folder inside its group. */
export const FOLDER_GROUPS = [
  { key: 'dental', label: 'Dentists', category: 'Dentist' },
  { key: 'senior_care', label: 'Facilities', category: 'Senior Living' },
  { key: 'attorneys', label: 'Attorneys', category: 'Attorney' },
  { key: 'other', label: 'Others', category: 'General Business' },
];
export function categoryFor(industry: string | null | undefined) {
  return FOLDER_GROUPS.find((g) => g.key === industry)?.category ?? 'Client website';
}

/** Folders for the Image Library: Dentists / Facilities / Attorneys / Others, each holding one folder per business. */
export async function listFolders(pool: pg.Pool, actor: Actor) {
  requirePerm(actor, 'work');
  const live = `a.status NOT IN ('recently_deleted','permanently_deleted') AND a.kind='image'`;
  const clients = (await pool.query(`SELECT c.id, c.business_name, c.website_url, c.industry,
      (SELECT count(*)::int FROM assets a WHERE ${live} AND (a.client_id=c.id OR (c.source_prospect_id IS NOT NULL AND a.prospect_id=c.source_prospect_id))) AS pictures
    FROM clients c WHERE c.archived_at IS NULL`)).rows;
  const prospects = (await pool.query(`SELECT p.id, p.business_name, p.website_url, p.industry,
      (SELECT count(*)::int FROM assets a WHERE ${live} AND a.prospect_id=p.id) AS pictures
    FROM prospects p WHERE p.archived_at IS NULL AND p.status <> 'converted'`)).rows;
  const all = [...clients.map((r) => ({ ...r, kind: 'client' })), ...prospects.map((r) => ({ ...r, kind: 'prospect' }))];
  const general = (await pool.query(`SELECT count(*)::int AS n FROM assets a WHERE ${live} AND a.client_id IS NULL AND a.prospect_id IS NULL`)).rows[0].n;
  return {
    general: { pictures: general },
    groups: FOLDER_GROUPS.map((g) => {
      const folders = all.filter((r) => (r.industry ?? 'other') === g.key)
        .sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'client' ? -1 : 1) || x.business_name.localeCompare(y.business_name))
        .map((r) => ({ kind: r.kind, id: r.id, name: r.business_name, websiteUrl: r.website_url, industry: r.industry, pictures: r.pictures }));
      return { key: g.key, label: g.label, category: g.category, pictures: folders.reduce((n, f) => n + f.pictures, 0), folders };
    }),
  };
}

/** Builder: put every usable picture from this project's business folder into the project (ADD PICTURES FROM THIS FOLDER). */
export async function folderPicturesForProject(q: pg.Pool | pg.PoolClient, projectId: string) {
  const p = (await q.query(`SELECT coalesce(p.client_id, cv.id) AS client_id, p.prospect_id, coalesce(c.source_prospect_id, p.prospect_id) AS source_prospect_id
    FROM projects p LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN clients cv ON p.client_id IS NULL AND cv.source_prospect_id=p.prospect_id WHERE p.id=$1`, [projectId])).rows[0];
  if (!p) throw notFound('project');
  if (!p.client_id && !p.prospect_id) return [];
  return (await q.query(`SELECT a.id FROM assets a WHERE a.kind='image' AND a.status IN ('available','approved')
      AND ((a.client_id IS NOT NULL AND a.client_id=$1) OR (a.prospect_id IS NOT NULL AND a.prospect_id IN ($2, $3)))
      AND NOT EXISTS (SELECT 1 FROM project_images pi WHERE pi.project_id=$4 AND pi.asset_id=a.id)
    ORDER BY a.created_at`, [p.client_id, p.prospect_id, p.source_prospect_id, projectId])).rows.map((r) => r.id as string);
}
export async function addFolderToProject(pool: pg.Pool, actor: Actor, projectId: string) {
  requirePerm(actor, 'work');
  return tx(async (t) => {
    const ids = await folderPicturesForProject(t, projectId);
    let pos = (await t.query(`SELECT coalesce(max(position),0)::int AS m FROM project_images WHERE project_id=$1`, [projectId])).rows[0].m;
    for (const id of ids) await t.query(`INSERT INTO project_images (project_id, asset_id, selected, position) VALUES ($1,$2,true,$3) ON CONFLICT DO NOTHING`, [projectId, id, ++pos]);
    if (ids.length) await audit(t, actor, 'project.folder_pictures_added', { type: 'project', id: projectId }, `${ids.length} picture(s) added from the business folder`);
    return { added: ids.length, ownerMessage: ids.length ? `${ids.length} picture(s) added from the folder.` : 'Every picture in the folder is already in this project.' };
  }, pool);
}
