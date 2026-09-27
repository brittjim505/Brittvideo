import type pg from 'pg';
import type { Queryable } from '../../db/pool.js';
import { tx } from '../../db/pool.js';
import type { Actor } from '../../auth/permissions.js';
import { requirePerm } from '../../auth/service.js';
import { OwnerError, notFound } from '../../lib/errors.js';
import { audit } from '../audit/service.js';
import { INDUSTRIES, INDUSTRY_LABEL, cleanWebsite, normaliseWebsite, type Industry } from '../../lib/util.js';

export interface BusinessInput {
  businessName: string; websiteUrl?: string | null; industry: Industry | string; businessType?: string | null;
  contactName?: string | null; email?: string | null; phone?: string | null; privateNotes?: string | null;
}

/** Validate + normalise business details. OTHER must keep the actual business type (B3). */
export function cleanBusiness(b: BusinessInput) {
  const businessName = (b.businessName ?? '').trim();
  if (!businessName) throw new OwnerError('Please enter the business name.');
  const industry = (b.industry ?? '').toString().trim().toLowerCase().replace(/\s+/g, '_') as Industry;
  if (!INDUSTRIES.includes(industry)) throw new OwnerError('Please choose Senior Care, Dental, Attorneys or OTHER.');
  const businessType = (b.businessType ?? '').trim() || null;
  if (industry === 'other' && !businessType) throw new OwnerError('For OTHER, please enter the type of business (for example Plumbing, HVAC, Real Estate).');
  const email = (b.email ?? '').trim() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new OwnerError('That email address does not look right. Please check it.');
  const websiteUrl = cleanWebsite(b.websiteUrl);
  return {
    businessName, websiteUrl, websiteNorm: normaliseWebsite(websiteUrl), industry, businessType: industry === 'other' ? businessType : businessType,
    contactName: (b.contactName ?? '').trim() || null, email, phone: (b.phone ?? '').trim() || null, privateNotes: (b.privateNotes ?? '').trim() || null,
  };
}

export const industryText = (industry: Industry, businessType?: string | null) =>
  industry === 'other' ? `OTHER — ${businessType ?? 'business type not set'}` : INDUSTRY_LABEL[industry];

// --------------------------------------------------------------------------------------------------------------
// Prospects
// --------------------------------------------------------------------------------------------------------------
export async function findDuplicateProspect(q: Queryable, name: string, websiteNorm: string | null) {
  return (await q.query(`SELECT * FROM prospects WHERE lower(trim(business_name))=lower(trim($1)) AND coalesce(website_norm,'')=coalesce($2,'') AND archived_at IS NULL`,
    [name, websiteNorm])).rows[0] ?? null;
}

/** Create a prospect, or return the existing one — never a duplicate (V2.10.39 behaviour, now enforced by the DB). */
export async function upsertProspect(q: Queryable, actor: Actor, input: BusinessInput): Promise<{ prospect: any; created: boolean }> {
  const b = cleanBusiness(input);
  const existing = await findDuplicateProspect(q, b.businessName, b.websiteNorm);
  if (existing) return { prospect: existing, created: false };
  const ins = await q.query(
    `INSERT INTO prospects (business_name, website_url, website_norm, industry, business_type, contact_name, email, phone, private_notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING *`,
    [b.businessName, b.websiteUrl, b.websiteNorm, b.industry, b.businessType, b.contactName, b.email, b.phone, b.privateNotes, actor.userId]);
  if (!ins.rowCount) return { prospect: await findDuplicateProspect(q, b.businessName, b.websiteNorm), created: false };
  const p = ins.rows[0];
  await audit(q, actor, 'prospect.created', { type: 'prospect', id: p.id }, `Prospect added: ${p.business_name} (${industryText(p.industry, p.business_type)})`);
  return { prospect: p, created: true };
}

export async function listProspects(q: Queryable, actor: Actor, opts: { includeArchived?: boolean; search?: string } = {}) {
  requirePerm(actor, 'work');
  const p: unknown[] = []; const where = [];
  if (!opts.includeArchived) where.push(`archived_at IS NULL AND status <> 'converted'`);
  if (opts.search) { p.push('%' + opts.search.toLowerCase() + '%'); where.push(`(lower(business_name) LIKE $${p.length} OR lower(coalesce(website_url,'')) LIKE $${p.length})`); }
  return (await q.query(`SELECT * FROM prospects ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT 500`, p)).rows;
}

export async function getProspect(q: Queryable, actor: Actor, id: string) {
  requirePerm(actor, 'work');
  const p = (await q.query(`SELECT * FROM prospects WHERE id=$1`, [id])).rows[0];
  if (!p) throw notFound('prospect');
  return p;
}

export async function updateProspect(pool: pg.Pool, actor: Actor, id: string, input: BusinessInput) {
  requirePerm(actor, 'work');
  const b = cleanBusiness(input);
  return tx(async (t) => {
    const before = (await t.query(`SELECT * FROM prospects WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!before) throw notFound('prospect');
    const dup = await findDuplicateProspect(t, b.businessName, b.websiteNorm);
    if (dup && dup.id !== id) throw new OwnerError(`Another prospect already has that name and website (${dup.business_name}).`, 409, 'duplicate');
    const after = (await t.query(`UPDATE prospects SET business_name=$2, website_url=$3, website_norm=$4, industry=$5, business_type=$6,
      contact_name=$7, email=$8, phone=$9, private_notes=$10 WHERE id=$1 RETURNING *`,
      [id, b.businessName, b.websiteUrl, b.websiteNorm, b.industry, b.businessType, b.contactName, b.email, b.phone, b.privateNotes])).rows[0];
    await audit(t, actor, 'prospect.updated', { type: 'prospect', id }, `Prospect updated: ${after.business_name}`, before, after);
    return after;
  }, pool);
}

export async function archiveProspect(q: Queryable, actor: Actor, id: string) {
  requirePerm(actor, 'work');
  const r = (await q.query(`UPDATE prospects SET archived_at=now(), status='archived' WHERE id=$1 AND archived_at IS NULL RETURNING *`, [id])).rows[0];
  if (!r) throw notFound('prospect');
  await audit(q, actor, 'prospect.archived', { type: 'prospect', id }, `Prospect archived: ${r.business_name} (kept in history)`);
  return r;
}

// --------------------------------------------------------------------------------------------------------------
// Clients
// --------------------------------------------------------------------------------------------------------------
export async function findDuplicateClient(q: Queryable, name: string, websiteNorm: string | null) {
  return (await q.query(`SELECT * FROM clients WHERE lower(trim(business_name))=lower(trim($1)) AND coalesce(website_norm,'')=coalesce($2,'') AND archived_at IS NULL`,
    [name, websiteNorm])).rows[0] ?? null;
}

/** Create a client with an 'active' marketing preference — or reuse the durable existing record (K2, M18). */
export async function createOrReuseClient(q: Queryable, actor: Actor, input: BusinessInput, source: string, sourceProspectId: string | null) {
  const b = cleanBusiness(input);
  if (sourceProspectId) {
    const byProspect = (await q.query(`SELECT * FROM clients WHERE source_prospect_id=$1`, [sourceProspectId])).rows[0];
    if (byProspect) return { client: byProspect, created: false };
  }
  const dup = await findDuplicateClient(q, b.businessName, b.websiteNorm);
  if (dup) return { client: dup, created: false };
  const c = (await q.query(
    `INSERT INTO clients (business_name, website_url, website_norm, industry, business_type, contact_name, email, phone, private_notes, source, source_prospect_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [b.businessName, b.websiteUrl, b.websiteNorm, b.industry, b.businessType, b.contactName, b.email, b.phone, b.privateNotes, source, sourceProspectId, actor.userId])).rows[0];
  // Marketing preference is created once and never reset (O8). ON CONFLICT DO NOTHING keeps an existing unsubscribe.
  await q.query(`INSERT INTO marketing_preferences (client_id, status, changed_by, reason) VALUES ($1,'active',$2,'New client')
    ON CONFLICT (client_id) DO NOTHING`, [c.id, actor.label]);
  await q.query(`INSERT INTO marketing_preference_events (client_id, from_status, to_status, by_label, reason) VALUES ($1,NULL,'active',$2,'New client')`, [c.id, actor.label]);
  if (sourceProspectId) await q.query(`UPDATE prospects SET status='converted', converted_client_id=$2 WHERE id=$1`, [sourceProspectId, c.id]);
  await audit(q, actor, 'client.created', { type: 'client', id: c.id }, `New client: ${c.business_name} (${industryText(c.industry, c.business_type)})`);
  return { client: c, created: true };
}

export async function listClients(q: Queryable, actor: Actor, opts: { search?: string } = {}) {
  requirePerm(actor, 'work');
  const p: unknown[] = []; let where = 'WHERE c.archived_at IS NULL';
  if (opts.search) { p.push('%' + opts.search.toLowerCase() + '%'); where += ` AND (lower(c.business_name) LIKE $1 OR lower(coalesce(c.website_url,'')) LIKE $1)`; }
  return (await q.query(`SELECT c.*, mp.status AS marketing_status,
      (SELECT count(*)::int FROM projects p WHERE p.client_id=c.id AND p.archived_at IS NULL) AS project_count,
      (SELECT package FROM orders o WHERE o.client_id=c.id ORDER BY o.created_at DESC LIMIT 1) AS latest_package,
      (SELECT status FROM premier_memberships m WHERE m.client_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS premier_status
    FROM clients c LEFT JOIN marketing_preferences mp ON mp.client_id=c.id ${where} ORDER BY c.updated_at DESC LIMIT 500`, p)).rows;
}

export async function getClient(q: Queryable, actor: Actor, id: string) {
  requirePerm(actor, 'work');
  const c = (await q.query(`SELECT c.*, mp.status AS marketing_status, mp.changed_at AS marketing_changed_at, mp.reason AS marketing_reason
    FROM clients c LEFT JOIN marketing_preferences mp ON mp.client_id=c.id WHERE c.id=$1`, [id])).rows[0];
  if (!c) throw notFound('client');
  const orders = (await q.query(`SELECT o.id, o.order_number, o.package, o.status, o.source_channel, o.created_at,
      (SELECT json_agg(json_build_object('label',l.label,'billing',l.billing,'listCents',l.list_price_cents,'agreedCents',l.agreed_price_cents,'soldCents',l.sold_price_cents,'overrideReason',l.override_reason) ORDER BY l.created_at)
         FROM order_lines l WHERE l.order_id=o.id) AS lines
    FROM orders o WHERE o.client_id=$1 ORDER BY o.created_at DESC`, [id])).rows;
  // Revenue/price detail is sensitive (Appendix D): strip amounts for accounts without the 'revenue' permission.
  if (!actor.permissions.has('revenue')) for (const o of orders) o.lines = (o.lines ?? []).map((l: any) => ({ label: l.label, billing: l.billing }));
  const projects = (await q.query(`SELECT id, project_number, kind, title, status, included_in_premier, created_at, updated_at FROM projects
    WHERE client_id=$1 ORDER BY created_at DESC`, [id])).rows;
  const premier = (await q.query(`SELECT id, status, started_at, cancelled_at, created_at FROM premier_memberships WHERE client_id=$1 ORDER BY created_at DESC`, [id])).rows;
  const marketingHistory = (await q.query(`SELECT from_status, to_status, at, by_label, reason FROM marketing_preference_events WHERE client_id=$1 ORDER BY at DESC`, [id])).rows;
  return { client: c, orders, projects, premier, marketingHistory };
}

export async function updateClient(pool: pg.Pool, actor: Actor, id: string, input: BusinessInput) {
  requirePerm(actor, 'work');
  const b = cleanBusiness(input);
  return tx(async (t) => {
    const before = (await t.query(`SELECT * FROM clients WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!before) throw notFound('client');
    const dup = await findDuplicateClient(t, b.businessName, b.websiteNorm);
    if (dup && dup.id !== id) throw new OwnerError(`Another client already has that name and website (${dup.business_name}).`, 409, 'duplicate');
    const after = (await t.query(`UPDATE clients SET business_name=$2, website_url=$3, website_norm=$4, industry=$5, business_type=$6,
      contact_name=$7, email=$8, phone=$9, private_notes=$10 WHERE id=$1 RETURNING *`,
      [id, b.businessName, b.websiteUrl, b.websiteNorm, b.industry, b.businessType, b.contactName, b.email, b.phone, b.privateNotes])).rows[0];
    await audit(t, actor, 'client.updated', { type: 'client', id }, `Client updated: ${after.business_name}`, before, after);
    return after;
  }, pool);
}

/**
 * Change a client's marketing preference (O4–O8). Moving out of 'unsubscribed' requires the client's own recorded
 * request (evidence) — the database refuses otherwise.
 */
export async function setMarketingPreference(pool: pg.Pool, actor: Actor, clientId: string, status: 'active' | 'paused' | 'unsubscribed', reason: string, resubscribeEvidence?: string) {
  if (actor.kind === 'user') requirePerm(actor, 'work');
  if (!['active', 'paused', 'unsubscribed'].includes(status)) throw new OwnerError('Choose Active, Paused or Unsubscribed.');
  return tx(async (t) => {
    const cur = (await t.query(`SELECT * FROM marketing_preferences WHERE client_id=$1 FOR UPDATE`, [clientId])).rows[0];
    if (!cur) throw notFound('client');
    if (cur.status === status) return cur;
    if (cur.status === 'unsubscribed' && !resubscribeEvidence?.trim()) {
      throw new OwnerError('This client unsubscribed. To turn marketing back on, record how the client asked to be resubscribed (for example "Client emailed on 10/2 asking to receive updates").', 409, 'unsubscribe_protected');
    }
    const after = (await t.query(`UPDATE marketing_preferences SET status=$2, changed_at=now(), changed_by=$3, reason=$4,
      resubscribe_evidence=CASE WHEN $5::text IS NOT NULL THEN $5 ELSE resubscribe_evidence END WHERE client_id=$1 RETURNING *`,
      [clientId, status, actor.label, reason || null, resubscribeEvidence?.trim() || null])).rows[0];
    await t.query(`INSERT INTO marketing_preference_events (client_id, from_status, to_status, by_label, reason) VALUES ($1,$2,$3,$4,$5)`,
      [clientId, cur.status, status, actor.label, reason || resubscribeEvidence || null]);
    await audit(t, actor, 'marketing.preference_changed', { type: 'client', id: clientId }, `Marketing preference: ${cur.status} → ${status}`);
    return after;
  }, pool);
}
