import type pg from 'pg';
import { parse, type HTMLElement } from 'node-html-parser';
import { tx } from '../../db/pool.js';
import type { Actor } from '../../auth/permissions.js';
import { requirePerm } from '../../auth/service.js';
import { OwnerError, notFound } from '../../lib/errors.js';
import { sha256, cleanWebsite } from '../../lib/util.js';
import { audit } from '../audit/service.js';
import { safeFetch, FetchRefused } from '../../integrations/web-fetch.js';
import { putObject } from '../../integrations/storage.js';
import { logDiagnostic } from '../support/diagnostics.js';
import { createCheckpoint } from '../projects/service.js';

/**
 * Website Analysis (K3, S8, "ground generated claims in source material").
 * Reads the public website (home page + up to 4 relevant pages), keeps useful statements WITH their source page, and
 * collects candidate images with their source. Nothing is invented. The owner reviews and chooses (human authority).
 * If the site can't be read, the owner is told plainly and can add facts and images by hand (fallback).
 */
const USEFUL_PAGE = /(about|service|care|amenit|dining|activit|life|living|team|staff|practice|patient|dental|smile|attorney|lawyer|legal|area|why|our|what-we|program|treatment|residen|tour|faq|experience|family)/i;
const BOILERPLATE = /(cookie|copyright|©|all rights reserved|privacy|terms of (use|service)|javascript|click here|subscribe|newsletter|sign up|log ?in|skip to|menu|accessibility statement|equal housing|site ?map|powered by|©)/i;
const INDUSTRY_WORDS: Record<string, string[]> = {
  senior_care: ['care', 'resident', 'living', 'dining', 'activit', 'assist', 'memory', 'community', 'family', 'independ', 'meal', 'transport', 'wellness', 'nurse', 'staff', 'home'],
  dental: ['patient', 'smile', 'dental', 'teeth', 'clean', 'implant', 'comfort', 'family', 'cosmetic', 'emergency', 'insurance', 'visit', 'care', 'doctor', 'team'],
  attorneys: ['client', 'case', 'law', 'attorney', 'legal', 'injury', 'family', 'estate', 'experience', 'consult', 'court', 'represent', 'trust', 'result'],
  other: ['service', 'customer', 'quality', 'team', 'experience', 'local', 'family', 'licensed', 'guarantee', 'repair', 'install', 'years', 'trusted'],
};
const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/ /g, ' ').trim();

export interface ExtractedPage { url: string; title: string; facts: string[]; images: { url: string; alt: string }[]; links: string[] }

export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });
  // Links first: site menus live in <nav>/<header>, which are removed below before reading statements.
  const links = root.querySelectorAll('a[href]').map((a) => a.getAttribute('href')!).filter(Boolean);
  root.querySelectorAll('script,style,noscript,nav,footer,form,svg,header nav').forEach((n) => n.remove());
  const title = clean(root.querySelector('title')?.text ?? '');
  const facts: string[] = [];
  const meta = root.querySelector('meta[name="description"]')?.getAttribute('content') ?? root.querySelector('meta[property="og:description"]')?.getAttribute('content');
  if (meta) facts.push(clean(meta));
  root.querySelectorAll('p,li,h2,h3').forEach((el: HTMLElement) => {
    const t = clean(el.text);
    if (t.length >= 30 && t.length <= 260 && !BOILERPLATE.test(t) && /[a-z]/.test(t) && t.split(' ').length >= 5) facts.push(t);
  });
  const images: { url: string; alt: string }[] = [];
  const og = root.querySelector('meta[property="og:image"]')?.getAttribute('content');
  if (og) images.push({ url: og, alt: 'Website feature image' });
  root.querySelectorAll('img').forEach((img) => {
    const srcset = img.getAttribute('srcset') ?? img.getAttribute('data-srcset');
    const best = srcset ? srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).pop() : null;
    const src = img.getAttribute('data-src') ?? best ?? img.getAttribute('src');
    if (src) images.push({ url: src, alt: clean(img.getAttribute('alt') ?? '') });
  });
  const abs = (x: string) => { try { return new URL(x, pageUrl).toString(); } catch { return null; } };
  return {
    url: pageUrl, title, facts,
    images: images.map((i) => ({ url: abs(i.url)!, alt: i.alt })).filter((i) => i.url && /^https?:/.test(i.url) && !/\.(svg|gif)(\?|$)/i.test(i.url) && !/(sprite|pixel|spacer|icon|favicon|badge|1x1)/i.test(i.url)),
    links: links.map(abs).filter((x): x is string => !!x),
  };
}

/** Rank statements by how useful they are for this industry's video; drop near-duplicates. */
export function rankFacts(all: { text: string; url: string }[], industry: string, businessName: string, max = 16) {
  const words = INDUSTRY_WORDS[industry] ?? INDUSTRY_WORDS.other;
  const seen = new Set<string>();
  const scored = all.map((f) => {
    const t = f.text.toLowerCase();
    let score = words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
    if (t.includes(businessName.toLowerCase().split(' ')[0])) score += 1;
    if (f.text.length > 60 && f.text.length < 200) score += 1;
    if (/\d{3}[-.)\s]\d{3}[-.\s]\d{4}|@|http/.test(t)) score -= 3;          // contact details are not story facts
    return { ...f, score };
  }).filter((f) => {
    const key = f.text.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').slice(0, 8).join(' ');
    if (seen.has(key)) return false; seen.add(key); return f.score > 0;
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, max);
}

const running = new Set<string>();   // one analysis per project at a time (double-click / second tab)
export async function analyzeWebsite(pool: pg.Pool, actor: Actor, projectId: string, urlOverride?: string) {
  requirePerm(actor, 'work');
  if (running.has(projectId)) throw new OwnerError('BrittVideo is already reading this website. Please wait for it to finish.', 409, 'analysis_running');
  running.add(projectId);
  try { return await analyzeWebsiteOnce(pool, actor, projectId, urlOverride); } finally { running.delete(projectId); }
}
async function analyzeWebsiteOnce(pool: pg.Pool, actor: Actor, projectId: string, urlOverride?: string) {
  const p = (await pool.query(`SELECT p.*, coalesce(c.business_name, pr.business_name) AS business_name, coalesce(c.website_url, pr.website_url) AS website_url, p.client_id
    FROM projects p LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN prospects pr ON pr.id=p.prospect_id WHERE p.id=$1`, [projectId])).rows[0];
  if (!p) throw notFound('project');
  const url = cleanWebsite(urlOverride || p.website_url);
  if (!url) throw new OwnerError('This client has no website address yet. Add it on the client page, or add facts and images by hand below.');

  const pages: { url: string; title?: string; ok: boolean; error?: string }[] = [];
  const found: { text: string; url: string }[] = [];
  const imageCandidates = new Map<string, { url: string; alt: string; page: string }>();
  let home: ExtractedPage | null = null;
  const readPage = async (pageUrl: string) => {
    try {
      const r = await safeFetch(pageUrl, { accept: 'text/html' });
      if (r.status >= 400) throw new Error(`the page answered with error ${r.status}`);
      if (!/html/i.test(r.contentType)) throw new Error('that address is not a web page');
      const ex = extractPage(r.body.toString('utf8'), r.url);
      pages.push({ url: r.url, title: ex.title, ok: true });
      ex.facts.forEach((t) => found.push({ text: t, url: r.url }));
      ex.images.forEach((i) => { if (!imageCandidates.has(i.url)) imageCandidates.set(i.url, { ...i, page: r.url }); });
      return ex;
    } catch (e: any) {
      pages.push({ url: pageUrl, ok: false, error: e instanceof FetchRefused ? e.message : (e?.code === 'ENOTFOUND' ? 'the website address could not be found' : e?.message ?? 'could not be read') });
      return null;
    }
  };
  home = await readPage(url);
  if (home) {
    const host = new URL(pages[0].url).hostname;
    const internal = [...new Set(home.links)].filter((l) => { try { const x = new URL(l); return x.hostname === host && USEFUL_PAGE.test(x.pathname) && !/\.(pdf|jpg|png|zip)$/i.test(x.pathname) && x.toString() !== pages[0].url; } catch { return false; } });
    for (const l of internal.slice(0, 4)) await readPage(l.split('#')[0]);
  }
  const ranked = rankFacts(found, p.industry ?? 'other', p.business_name);

  // Download up to 12 candidate images (content-addressed; permanently deleted images are never brought back — T14).
  const assets: { id: string; usable: boolean }[] = [];
  let tried = 0;
  for (const img of imageCandidates.values()) {
    if (assets.length >= 12 || tried >= 30) break;
    tried++;
    try {
      const r = await safeFetch(img.url, { maxBytes: 8_000_000, accept: 'image/*', timeoutMs: 10_000 });
      const type = /image\/(jpeg|jpg|png|webp)/i.exec(r.contentType);
      if (r.status >= 400 || !type || r.body.length < 8_000) continue;          // skip errors, icons and tiny images
      const hash = sha256(r.body);
      const existing = (await pool.query(`SELECT id, status FROM assets WHERE sha256=$1 ORDER BY created_at LIMIT 1`, [hash])).rows[0];
      if (existing?.status === 'permanently_deleted') continue;
      if (assets.some((x) => x.id === existing?.id)) continue;
      let assetId = existing?.id;
      if (!assetId) {
        const obj = putObject(r.body, type[1] === 'jpeg' ? 'jpg' : type[1]);
        const name = img.alt || decodeURIComponent(new URL(img.url).pathname.split('/').pop() ?? 'Website image').replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ');
        assetId = (await pool.query(`INSERT INTO assets (client_id, title, category, source_type, source_url, rights_note, status, protection_class, storage_key, sha256, bytes, mime, alt_text, created_by)
          VALUES ($1,$2,'Client website','website',$3,$4,'available','working',$5,$6,$7,$8,$9,$10) RETURNING id`,
          [p.client_id, name.slice(0, 120), img.url, `From ${new URL(img.page).hostname} — confirm the client's permission before final production.`, obj.key, hash, obj.bytes, `image/${type[1] === 'jpg' ? 'jpeg' : type[1]}`, img.alt || null, actor.userId])).rows[0].id;
      }
      assets.push({ id: assetId, usable: !existing || ['available', 'approved'].includes(existing.status) });
    } catch { /* one bad image never stops the analysis */ }
  }

  const status = !home ? 'failed' : ranked.length >= 3 ? 'succeeded' : 'partial';
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })();
  const ownerMessage = status === 'failed'
    ? `BrittVideo couldn't read ${host} (${pages[0]?.error ?? 'no answer'}). You can still continue: add facts yourself and upload images below.`
    : status === 'partial'
      ? `BrittVideo read ${pages.filter((x) => x.ok).length} page(s) on ${host} but found only ${ranked.length} useful statement(s). Add a few facts yourself for a stronger video.`
      : `BrittVideo read ${pages.filter((x) => x.ok).length} page(s) on ${host}: ${ranked.length} facts and ${assets.length} images found. Review them — only what you keep is used.`;
  if (status === 'failed') await logDiagnostic(pool, 'warn', 'website-analysis', `Website analysis failed for ${host}`, { pages });

  return tx(async (t) => {
    const a = (await t.query(`INSERT INTO website_analyses (project_id, url, status, pages, owner_message, created_by_label) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [projectId, url, status, JSON.stringify(pages), ownerMessage, actor.label])).rows[0];
    if (status !== 'failed') {
      // Re-analysis respects the owner's earlier choices: a website statement the owner unticked stays unticked,
      // and statements still on file (kept, or used by scenes) are not duplicated. Unused website facts are refreshed.
      const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const prior = (await t.query(`SELECT id, text, selected, EXISTS (SELECT 1 FROM scenes s JOIN deliverables d ON d.id=s.deliverable_id WHERE d.project_id=$1 AND f.id = ANY(s.fact_ids)) AS used
        FROM project_facts f WHERE f.project_id=$1 AND f.source_kind='website'`, [projectId])).rows;
      const choice = new Map(prior.map((f) => [norm(f.text), f.selected as boolean]));
      const kept = new Set(prior.filter((f) => f.used).map((f) => norm(f.text)));
      const owned = new Set((await t.query(`SELECT text FROM project_facts WHERE project_id=$1 AND source_kind='owner'`, [projectId])).rows.map((f) => norm(f.text)));
      await t.query(`DELETE FROM project_facts f WHERE f.project_id=$1 AND f.source_kind='website' AND NOT (f.id = ANY($2::uuid[]))`,
        [projectId, prior.filter((f) => f.used).map((f) => f.id)]);
      let pos = 0;
      for (const f of ranked) {
        const k = norm(f.text);
        if (kept.has(k) || owned.has(k)) continue;
        await t.query(`INSERT INTO project_facts (project_id, analysis_id, text, source_url, source_kind, selected, position) VALUES ($1,$2,$3,$4,'website',$5,$6)`,
          [projectId, a.id, f.text, f.url, choice.get(k) ?? true, pos++]);
      }
      for (const x of assets) await t.query(`INSERT INTO project_images (project_id, asset_id, selected, position) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [projectId, x.id, x.usable, pos++]);
    }
    await t.query(`UPDATE projects SET status=CASE WHEN status='ready_to_start' THEN 'in_progress' ELSE status END, workflow_step=GREATEST(workflow_step,3) WHERE id=$1`, [projectId]);
    await createCheckpoint(t, projectId, 'website_analyzed', `Website analyzed (${status})`, actor.label);
    await audit(t, actor, 'project.website_analyzed', { type: 'project', id: projectId }, ownerMessage);
    return { status, ownerMessage, pages, factCount: ranked.length, imageCount: assets.length };
  }, pool);
}

// ---------------------------------------------------------------------------------------------------------------
// Owner review of facts (keep / drop / add / edit)
// ---------------------------------------------------------------------------------------------------------------
export async function listFacts(q: pg.Pool, projectId: string) {
  return (await q.query(`SELECT id, text, source_url, source_kind, selected, position FROM project_facts WHERE project_id=$1 ORDER BY selected DESC, position, created_at`, [projectId])).rows;
}
export async function addFact(pool: pg.Pool, actor: Actor, projectId: string, text: string) {
  requirePerm(actor, 'work');
  const t = clean(text ?? '');
  if (!(await pool.query(`SELECT 1 FROM projects WHERE id=$1`, [projectId])).rowCount) throw notFound('project');
  if (t.length < 5) throw new OwnerError('Type a fact about the business (for example "Family-owned since 1998").');
  if (t.length > 400) throw new OwnerError('Please keep each fact under 400 characters.');
  const pos = (await pool.query(`SELECT coalesce(max(position),0)+1 AS n FROM project_facts WHERE project_id=$1`, [projectId])).rows[0].n;
  return (await pool.query(`INSERT INTO project_facts (project_id, text, source_kind, selected, position) VALUES ($1,$2,'owner',true,$3) RETURNING *`, [projectId, t, pos])).rows[0];
}
export async function updateFact(pool: pg.Pool, actor: Actor, projectId: string, factId: string, patch: { selected?: boolean; text?: string }) {
  requirePerm(actor, 'work');
  const f = (await pool.query(`SELECT * FROM project_facts WHERE id=$1 AND project_id=$2`, [factId, projectId])).rows[0];
  if (!f) throw notFound('fact');
  const text = patch.text !== undefined ? clean(patch.text) : f.text;
  if (text.length < 5) throw new OwnerError('A fact needs a few words.');
  // Editing a website statement makes it the owner's words (it is no longer a quote from the site).
  const kind = patch.text !== undefined && text !== f.text ? 'owner' : f.source_kind;
  return (await pool.query(`UPDATE project_facts SET selected=$3, text=$4, source_kind=$5 WHERE id=$1 AND project_id=$2 RETURNING *`,
    [factId, projectId, patch.selected ?? f.selected, text, kind])).rows[0];
}
