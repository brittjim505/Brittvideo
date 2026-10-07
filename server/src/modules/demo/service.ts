import type pg from 'pg';
import type { Queryable } from '../../db/pool.js';
import { tx } from '../../db/pool.js';
import { config } from '../../config.js';
import type { Actor } from '../../auth/permissions.js';
import { requirePerm } from '../../auth/service.js';
import { OwnerError, notFound } from '../../lib/errors.js';
import { randomToken, sha256, INDUSTRY_LABEL, type Industry } from '../../lib/util.js';
import { audit } from '../audit/service.js';
import { cleanBusiness, upsertProspect, type BusinessInput } from '../crm/service.js';
import { currentPriceBook, publicPackages } from '../pricing/service.js';

/**
 * Demo & Sales (B1, E1, G1, H1, J1). One Demo Library feeds all three channels. The prospect-facing side only ever
 * receives a PUBLIC view: business name, industry, published library items and list prices — never client lists,
 * private notes, pricing internals, diagnostics or credentials (V13, Delta). Tokens are random 256-bit values;
 * only their SHA-256 is stored, so a leaked database cannot be used to open demos (V15).
 */
const SESSION_HOURS = 12;

export async function startDemoSession(pool: pg.Pool, actor: Actor, input: { channel: 'ipad_in_person' | 'mac_zoom'; prospectId?: string | null; business?: BusinessInput }, ownerSessionId?: string) {
  requirePerm(actor, 'work', 'start demos');
  if (!['ipad_in_person', 'mac_zoom'].includes(input.channel)) throw new OwnerError('Choose In-Person (iPad) or Remote Live (Mac / Zoom).');
  return tx(async (t) => {
    let p: any;
    if (input.prospectId) {
      p = (await t.query(`SELECT * FROM prospects WHERE id=$1`, [input.prospectId])).rows[0];
      if (!p) throw notFound('prospect');
    } else {
      if (!input.business) throw new OwnerError('Enter the prospect\'s business name to start the demo.');
      p = (await upsertProspect(t, actor, input.business)).prospect;
    }
    const token = randomToken(32);
    const s = (await t.query(`INSERT INTO demo_sessions (channel, prospect_id, business_name, website_url, industry, business_type, token_hash, started_by, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + interval '${SESSION_HOURS} hours') RETURNING *`,
      [input.channel, p.id, p.business_name, p.website_url, p.industry, p.business_type, sha256(token), actor.userId])).rows[0];
    await t.query(`UPDATE prospects SET status='demoed' WHERE id=$1 AND status='new'`, [p.id]);
    // On a shared iPad, lock the owner's admin session until the owner's password is entered again.
    if (input.channel === 'ipad_in_person' && ownerSessionId) await t.query(`UPDATE sessions SET locked_at=now() WHERE id=$1`, [ownerSessionId]);
    await audit(t, actor, 'demo.started', { type: 'demo_session', id: s.id }, `${input.channel === 'ipad_in_person' ? 'In-person iPad' : 'Mac / Zoom'} demo started for ${p.business_name}`);
    return { sessionId: s.id, url: `/demo/s/${token}`, token, expiresAt: s.expires_at, prospectId: p.id, locked: input.channel === 'ipad_in_person' };
  }, pool);
}

export async function endDemoSession(q: Queryable, actor: Actor, sessionId: string) {
  requirePerm(actor, 'work');
  await q.query(`UPDATE demo_sessions SET ended_at=coalesce(ended_at, now()) WHERE id=$1`, [sessionId]);
  await audit(q, actor, 'demo.ended', { type: 'demo_session', id: sessionId }, 'Demo ended');
}

// ---------------------------------------------------------------------------------------------------------------
// Demo Links (G1, V15, W25): owner-controlled, expiring, can be turned off; reveals nothing beyond its own demo.
// ---------------------------------------------------------------------------------------------------------------
export async function createDemoLink(pool: pg.Pool, actor: Actor, input: { prospectId?: string | null; business?: BusinessInput; label?: string; days?: number; allowSignup?: boolean }) {
  requirePerm(actor, 'work', 'create demo links');
  const days = input.days ?? config().DEMO_LINK_DEFAULT_DAYS;
  if (!(days >= 1 && days <= 90)) throw new OwnerError('A demo link can last from 1 to 90 days.');
  return tx(async (t) => {
    let p: any;
    if (input.prospectId) { p = (await t.query(`SELECT * FROM prospects WHERE id=$1`, [input.prospectId])).rows[0]; if (!p) throw notFound('prospect'); }
    else { if (!input.business) throw new OwnerError('Choose a prospect or enter a business name.'); p = (await upsertProspect(t, actor, input.business)).prospect; }
    const token = randomToken(32);
    const l = (await t.query(`INSERT INTO demo_links (token_hash, prospect_id, label, business_name, website_url, industry, business_type, allow_signup, created_by, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + ($10 || ' days')::interval) RETURNING *`,
      [sha256(token), p.id, (input.label || `Demo for ${p.business_name}`).slice(0, 120), p.business_name, p.website_url, p.industry, p.business_type,
        input.allowSignup !== false, actor.userId, String(days)])).rows[0];
    await audit(t, actor, 'demo_link.created', { type: 'demo_link', id: l.id }, `Demo link created for ${p.business_name} (expires in ${days} days)`);
    // The full link is shown ONCE to the owner; afterwards only its label/status are visible.
    return { id: l.id, url: `${config().PUBLIC_BASE_URL}/demo/l/${token}`, expiresAt: l.expires_at };
  }, pool);
}

export async function listDemoLinks(q: Queryable, actor: Actor) {
  requirePerm(actor, 'work');
  return (await q.query(`SELECT id, label, business_name, industry, business_type, allow_signup, created_at, expires_at, disabled_at, last_viewed_at, view_count,
      (disabled_at IS NULL AND expires_at > now()) AS active FROM demo_links ORDER BY created_at DESC LIMIT 200`)).rows;
}

export async function disableDemoLink(q: Queryable, actor: Actor, id: string) {
  requirePerm(actor, 'work');
  const r = (await q.query(`UPDATE demo_links SET disabled_at=coalesce(disabled_at, now()) WHERE id=$1 RETURNING business_name`, [id])).rows[0];
  if (!r) throw notFound('demo link');
  await audit(q, actor, 'demo_link.disabled', { type: 'demo_link', id }, `Demo link turned off (${r.business_name})`);
}

// ---------------------------------------------------------------------------------------------------------------
// Public (prospect-safe) resolution. Any invalid, expired or disabled token gets the same generic answer.
// ---------------------------------------------------------------------------------------------------------------
export type DemoContext = { kind: 'session' | 'link'; id: string; businessName: string; websiteUrl: string | null; industry: Industry;
  businessType: string | null; allowSignup: boolean; channel: string; prospectId: string | null; convertedOrderId: string | null };

const unavailable = () => new OwnerError('This demo is no longer available. Please contact BrittVideo for a new link.', 404, 'demo_unavailable');

export async function resolveDemo(q: Queryable, kind: string, token: string, countView = false): Promise<DemoContext> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token ?? '')) throw unavailable();
  const h = sha256(token);
  if (kind === 's') {
    const s = (await q.query(`SELECT * FROM demo_sessions WHERE token_hash=$1 AND ended_at IS NULL AND expires_at > now()`, [h])).rows[0];
    if (!s) throw unavailable();
    return { kind: 'session', id: s.id, businessName: s.business_name, websiteUrl: s.website_url, industry: s.industry, businessType: s.business_type,
      allowSignup: true, channel: s.channel, prospectId: s.prospect_id, convertedOrderId: s.converted_order_id };
  }
  if (kind === 'l') {
    const l = (await q.query(`SELECT * FROM demo_links WHERE token_hash=$1 AND disabled_at IS NULL AND expires_at > now()`, [h])).rows[0];
    if (!l) throw unavailable();
    if (countView) await q.query(`UPDATE demo_links SET view_count=view_count+1, last_viewed_at=now() WHERE id=$1`, [l.id]);
    return { kind: 'link', id: l.id, businessName: l.business_name, websiteUrl: l.website_url, industry: l.industry, businessType: l.business_type,
      allowSignup: l.allow_signup, channel: 'demo_link', prospectId: l.prospect_id, convertedOrderId: null };
  }
  throw unavailable();
}

/** Everything a prospect may see. Built from an allow-list — nothing else can leak into it. */
export async function publicDemoView(q: Queryable, ctx: DemoContext) {
  const items = (await q.query(`SELECT id, title, description, industry, business_type, kind, purpose, duration_s, format, media_url, poster_url
    FROM demo_library_items WHERE published = true AND (industry = $1 OR industry = 'all') ORDER BY (industry = $1) DESC, sort_order, title LIMIT 50`, [ctx.industry])).rows;
  const pb = await currentPriceBook(q);
  return {
    business: { name: ctx.businessName, website: ctx.websiteUrl, industryLabel: ctx.industry === 'other' ? (ctx.businessType ?? 'Local business') : INDUSTRY_LABEL[ctx.industry] },
    channel: ctx.channel,
    allowSignup: ctx.allowSignup && !ctx.convertedOrderId,
    alreadySignedUp: !!ctx.convertedOrderId,
    offerings: [
      { title: 'Website Video', text: 'A polished custom story for your website, up to 90 seconds — landscape, square or portrait, your choice.' },
      { title: 'Two Social Media Videos', text: 'One portrait (9:16) and one landscape (16:9) video for your social media.' },
      { title: 'Thank-You Video', text: 'A warm thank-you your customers receive after their visit.' },
      { title: 'Email Video', text: 'A separate, email-ready video.' },
      { title: 'One-Off Videos', text: 'Need just one? A single video for a thank-you, review request, promotion, announcement and more.' },
    ],
    library: items.map((i) => ({ id: i.id, title: i.title, description: i.description, kind: i.kind, purpose: i.purpose, durationS: i.duration_s,
      format: i.format, mediaUrl: i.media_url, posterUrl: i.poster_url })),
    packages: publicPackages(pb).map(({ code, label, summary, includes, priceText, oneTimeCents, monthlyCents }) => ({ code, label, summary, includes, priceText, oneTimeCents, monthlyCents })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Demo Library (H1, R8, O13, V23)
// ---------------------------------------------------------------------------------------------------------------
export interface LibraryInput { title: string; description?: string; industry: string; businessType?: string; kind: string; purpose?: string;
  durationS?: number | null; format?: string | null; mediaUrl?: string | null; posterUrl?: string | null;
  permissionState?: 'owner_created' | 'client_permission_granted' | 'permission_pending'; permissionEvidence?: string; published?: boolean; sortOrder?: number }

function cleanLibrary(i: LibraryInput) {
  if (!i.title?.trim()) throw new OwnerError('Please give the demo item a title.');
  if (!['senior_care', 'dental', 'attorneys', 'other', 'all'].includes(i.industry)) throw new OwnerError('Choose which industry this demo is for (or All).');
  if (i.durationS != null && !(i.durationS > 0 && i.durationS <= 120)) throw new OwnerError('Demo videos are up to 120 seconds.');
  if (i.format && !['16x9', '9x16', '1x1'].includes(i.format)) throw new OwnerError('Format must be 16:9, 9:16 or 1:1.');
  if (i.mediaUrl && !/^(https:\/\/|\/media\/)/.test(i.mediaUrl)) throw new OwnerError('Video links must start with https://');
  const permission = i.permissionState ?? 'owner_created';
  if (permission === 'client_permission_granted' && !i.permissionEvidence?.trim()) throw new OwnerError('Record how the client gave permission to use their video as an example.');
  if (i.published && permission === 'permission_pending') throw new OwnerError('This uses client work without recorded permission, so it cannot be shown to prospects yet.');
  return { ...i, permissionState: permission };
}

export async function saveLibraryItem(q: Queryable, actor: Actor, id: string | null, input: LibraryInput) {
  requirePerm(actor, 'work');
  const i = cleanLibrary(input);
  const vals = [i.title.trim(), i.description ?? null, i.industry, i.businessType ?? null, i.kind, i.purpose ?? null, i.durationS ?? null, i.format ?? null,
    i.mediaUrl ?? null, i.posterUrl ?? null, i.permissionState, i.permissionEvidence ?? null, !!i.published, i.sortOrder ?? 100];
  const row = id
    ? (await q.query(`UPDATE demo_library_items SET title=$2, description=$3, industry=$4, business_type=$5, kind=$6, purpose=$7, duration_s=$8, format=$9,
        media_url=$10, poster_url=$11, permission_state=$12, permission_evidence=$13, published=$14, sort_order=$15 WHERE id=$1 RETURNING *`, [id, ...vals])).rows[0]
    : (await q.query(`INSERT INTO demo_library_items (title, description, industry, business_type, kind, purpose, duration_s, format, media_url, poster_url,
        permission_state, permission_evidence, published, sort_order, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [...vals, actor.userId])).rows[0];
  if (!row) throw notFound('demo item');
  await audit(q, actor, id ? 'demo_library.updated' : 'demo_library.created', { type: 'demo_library_item', id: row.id },
    `Demo Library: ${row.title} (${row.published ? 'shown to prospects' : 'hidden'})`);
  return row;
}

export async function listLibrary(q: Queryable, actor: Actor) {
  requirePerm(actor, 'work');
  return (await q.query(`SELECT * FROM demo_library_items ORDER BY industry, sort_order, title`)).rows;
}

/** Starter Demo Library so the demo is never empty (owner-created descriptions; no client work, no media). */
export async function seedDemoLibrary(q: Queryable) {
  const n = (await q.query(`SELECT count(*)::int n FROM demo_library_items`)).rows[0].n;
  if (n) return;
  const seed: [string, string, string, string, number, string][] = [
    ['senior_care', 'A Day in the Life', 'Follow a resident\'s day — morning comfort, dining with friends, activities and support close at hand.', 'website_video', 60, '16x9'],
    ['senior_care', 'Family\'s Search for Care', 'Speaks directly to adult children choosing a community: what to look for and why it feels like home.', 'social', 30, '9x16'],
    ['dental', 'New Patient Experience', 'From the first phone call to a confident smile — shows new patients exactly what to expect.', 'website_video', 60, '16x9'],
    ['dental', 'Meet the Dentist', 'A warm introduction that builds trust before the first visit.', 'social', 30, '9x16'],
    ['attorneys', 'What Happens After You Call', 'Takes the fear out of the first call — a calm walk through the process.', 'website_video', 60, '16x9'],
    ['attorneys', 'Practice Area Spotlight', 'A focused explainer for one practice area, ideal for social and email.', 'social', 30, '1x1'],
    ['other', 'Customer Journey', 'From the customer\'s problem to a job done right — for any local service business.', 'website_video', 60, '16x9'],
    ['all', 'Thank You After Service', 'A short personal thank-you your customers receive after their visit — appreciation first, no hard sell.', 'quick_video', 15, '16x9'],
    ['all', 'Review Request', 'Thanks the customer, then politely invites an honest review.', 'quick_video', 30, '9x16'],
  ];
  let order = 10;
  for (const [industry, title, description, kind, dur, format] of seed) {
    await q.query(`INSERT INTO demo_library_items (title, description, industry, kind, duration_s, format, permission_state, published, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,'owner_created',true,$7)`, [title, description, industry, kind, dur, format, order += 10]);
  }
}

export { cleanBusiness };
