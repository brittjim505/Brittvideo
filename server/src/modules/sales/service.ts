import type pg from 'pg';
import { tx } from '../../db/pool.js';
import { config } from '../../config.js';
import type { Actor } from '../../auth/permissions.js';
import { requirePerm } from '../../auth/service.js';
import { OwnerError, notFound } from '../../lib/errors.js';
import { once } from '../../lib/idempotency.js';
import { money, sha256 } from '../../lib/util.js';
import { audit } from '../audit/service.js';
import { cleanBusiness, createOrReuseClient, upsertProspect, type BusinessInput } from '../crm/service.js';
import { currentPriceBook, publicPackages, type PackageCode } from '../pricing/service.js';
import { createProject, createCheckpoint } from '../projects/service.js';
import { TERMS_VERSION, termsText } from './terms.js';
import { paymentAdapters } from '../../integrations/payment.js';
import { readSecret } from '../integrations/secrets.js';
import { logDiagnostic, recordRecovery } from '../support/diagnostics.js';

export type Channel = 'ipad_in_person' | 'mac_zoom' | 'demo_link' | 'manual';

export interface SaleInput {
  saleKey: string;                          // idempotency key generated once per signup form
  channel: Channel;
  demoSessionId?: string | null;
  demoLinkId?: string | null;
  prospectId?: string | null;
  clientId?: string | null;                 // returning client purchasing more work (M18)
  business: BusinessInput;
  package: PackageCode;
  /** Owner-only deal-specific prices (M3, M6). Prospects can never set prices (C3). */
  overrides?: Record<string, { agreedCents: number; reason?: string }>;
  agreement: { accepted: boolean; name: string; email?: string | null; shownTermsSha256?: string | null };
  meta?: { ip?: string; userAgent?: string };
}

/**
 * Prospect → Client + Order + Agreement + Payment record + Project, in ONE database transaction, exactly once per
 * saleKey (M1, M16, I1, Delta "without re-entering … or duplicates"). Retries return the original result.
 */
export async function completeSale(pool: pg.Pool, actor: Actor, input: SaleInput) {
  if (actor.kind === 'user') requirePerm(actor, 'work', 'record sales');
  if (!['standard', 'premier'].includes(input.package)) throw new OwnerError('Please choose Standard or Premier.');
  if (!input.agreement?.accepted || !input.agreement.name?.trim()) throw new OwnerError('Please read the agreement, type your full name and check "I agree" to continue.');
  if (input.overrides && Object.keys(input.overrides).length) {
    if (actor.kind !== 'user') throw new OwnerError('Prices can only be adjusted by BrittVideo.', 403, 'forbidden');
    requirePerm(actor, 'revenue', 'set a deal-specific price');
  }
  const b = cleanBusiness(input.business);
  const requestShape = { ...input, meta: undefined };

  const { result, replayed } = await once(pool, 'sale', input.saleKey, requestShape, () => tx(async (t) => {
    // A demo session can convert only once (DB unique constraint on orders.demo_session_id as a second guard).
    if (input.demoSessionId) {
      const s = (await t.query(`SELECT * FROM demo_sessions WHERE id=$1 FOR UPDATE`, [input.demoSessionId])).rows[0];
      if (!s) throw notFound('demo');
      if (s.converted_order_id) {
        const o = (await t.query(`SELECT * FROM orders WHERE id=$1`, [s.converted_order_id])).rows[0];
        return saleResult(t, o.id);
      }
    }
    // 1. Client — reuse durable records; carry demo/prospect data forward so nothing is re-typed.
    let prospectId = input.prospectId ?? null;
    let client: any;
    if (input.clientId) {
      client = (await t.query(`SELECT * FROM clients WHERE id=$1 AND archived_at IS NULL`, [input.clientId])).rows[0];
      if (!client) throw notFound('client');
    } else {
      if (!prospectId) prospectId = (await upsertProspect(t, actor, input.business)).prospect.id;
      const source = input.channel === 'ipad_in_person' ? 'demo_ipad' : input.channel === 'mac_zoom' ? 'demo_zoom' : input.channel === 'demo_link' ? 'demo_link' : 'manual';
      client = (await createOrReuseClient(t, actor, input.business, source, prospectId)).client;
      // Fill contact details captured at signup without overwriting existing values.
      await t.query(`UPDATE clients SET contact_name=coalesce(contact_name,$2), email=coalesce(email,$3), phone=coalesce(phone,$4) WHERE id=$1`,
        [client.id, b.contactName, b.email, b.phone]);
    }
    // 2. Prices frozen from the current price book version (M4, R12).
    const pb = await currentPriceBook(t);
    const pkgDef = pb.packages[input.package];
    const lines = pkgDef.lines.map((code) => {
      const item = pb.items[code];
      const ov = input.overrides?.[code];
      if (ov && (!Number.isInteger(ov.agreedCents) || ov.agreedCents < 0)) throw new OwnerError('Agreed prices must be whole dollars and cents, not negative.');
      const agreed = ov ? ov.agreedCents : item.amount_cents;
      if (agreed === null || agreed === undefined) throw new OwnerError(`${item.label} needs an agreed price.`);
      return { code, label: item.label, billing: item.billing, list: item.amount_cents, agreed, reason: ov?.reason?.trim() || null };
    });
    const order = (await t.query(`INSERT INTO orders (client_id, package, price_book_version_id, status, source_channel, demo_session_id, sale_key, created_by_label, created_by)
      VALUES ($1,$2,$3,'pending_payment',$4,$5,$6,$7,$8) RETURNING *`,
      [client.id, input.package, pb.id, input.channel, input.demoSessionId ?? null, input.saleKey, actor.label, actor.userId])).rows[0];
    for (const l of lines) {
      await t.query(`INSERT INTO order_lines (order_id, item_code, label, billing, list_price_cents, agreed_price_cents, sold_price_cents, override_reason)
        VALUES ($1,$2,$3,$4,$5,$6,$6,$7)`, [order.id, l.code, l.label, l.billing, l.list, l.agreed, l.reason]);
    }
    // 3. Agreement evidence (M10): exact text, version and hash.
    const pub = publicPackages(pb).find((p) => p.code === input.package)!;
    const oneTime = lines.filter((l) => l.billing === 'one_time').reduce((s, l) => s + l.agreed, 0);
    const monthly = lines.filter((l) => l.billing === 'monthly').reduce((s, l) => s + l.agreed, 0);
    const priceText = monthly ? `${money(oneTime)} one-time + ${money(monthly)} per month` : `${money(oneTime)} one-time`;
    const text = termsText(input.package, priceText);
    // The stored agreement must be exactly what the person read (M10). Prospect signups always send what they saw.
    if ((actor.kind === 'prospect' || input.agreement.shownTermsSha256) && input.agreement.shownTermsSha256 !== sha256(text)) {
      throw new OwnerError('The agreement was just updated. Please read it again, then sign.', 409, 'terms_changed');
    }
    await t.query(`INSERT INTO agreements (order_id, package, terms_version, terms_text, terms_sha256, accepted_name, accepted_email, accepted_ip, accepted_user_agent)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [order.id, input.package, TERMS_VERSION, text, sha256(text), input.agreement.name.trim(),
      input.agreement.email?.trim() || b.email, input.meta?.ip ?? null, input.meta?.userAgent?.slice(0, 300) ?? null]);
    // 4. Premier membership record — starts when payment succeeds (P3: schedule from actual start).
    if (input.package === 'premier') {
      const active = (await t.query(`SELECT id FROM premier_memberships WHERE client_id=$1 AND status IN ('pending_start','active')`, [client.id])).rows[0];
      if (active) throw new OwnerError(`${client.business_name} already has a Premier membership. Additional work can be sold separately.`, 409, 'premier_exists');
      await t.query(`INSERT INTO premier_memberships (client_id, order_id, status, monthly_price_cents) VALUES ($1,$2,'pending_start',$3)`, [client.id, order.id, monthly]);
    }
    // 5. Project — "New Client — Ready to Start" on the Mac (I1, W23). One per order (unique index).
    const project = await createProject(t, actor, {
      clientId: client.id, orderId: order.id, kind: 'video_kit', title: `${client.business_name} — ${pkgDef.label} Video Kit`,
      industry: client.industry, businessType: client.business_type, source: 'sale', settings: { package: input.package },
    });
    await createCheckpoint(t, project.id, 'created', 'Project created from sale', actor.label);
    if (input.demoSessionId) await t.query(`UPDATE demo_sessions SET converted_order_id=$2, prospect_id=coalesce(prospect_id,$3) WHERE id=$1`, [input.demoSessionId, order.id, prospectId]);
    await audit(t, actor, 'sale.completed', { type: 'order', id: order.id },
      `Sale: ${client.business_name} — ${pkgDef.label} (${priceText}) via ${input.channel.replace(/_/g, ' ')}. Awaiting payment.`, undefined,
      { lines: lines.map((l) => ({ item: l.code, list: l.list, agreed: l.agreed, reason: l.reason })) });
    void pub;
    return saleResult(t, order.id);
  }, pool));
  return { ...result, replayed };
}

async function saleResult(t: pg.PoolClient | pg.Pool, orderId: string) {
  const o = (await t.query(`SELECT o.*, c.business_name FROM orders o JOIN clients c ON c.id=o.client_id WHERE o.id=$1`, [orderId])).rows[0];
  const p = (await t.query(`SELECT id, project_number, title, status FROM projects WHERE order_id=$1 AND kind='video_kit'`, [orderId])).rows[0];
  const lines = (await t.query(`SELECT item_code, label, billing, sold_price_cents FROM order_lines WHERE order_id=$1 ORDER BY created_at`, [orderId])).rows;
  return {
    orderId: o.id, orderNumber: o.order_number, clientId: o.client_id, businessName: o.business_name, package: o.package,
    orderStatus: o.status, projectId: p?.id ?? null, projectNumber: p?.project_number ?? null,
    dueTodayCents: lines.filter((l: any) => l.billing === 'one_time').reduce((s: number, l: any) => s + l.sold_price_cents, 0),
    monthlyCents: lines.filter((l: any) => l.billing === 'monthly').reduce((s: number, l: any) => s + l.sold_price_cents, 0),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Payments (M11–M15). One successful payment per order; retries replay; provider state is checked before retrying.
// ---------------------------------------------------------------------------------------------------------------
async function adapters(pool: pg.Pool) {
  return paymentAdapters({ accessToken: await readSecret(pool, 'square.access_token').catch(() => null), locationId: await readSecret(pool, 'square.location_id').catch(() => null) });
}

/**
 * Charge an order (M11–M15, Q8–Q10). Exactly-once per ORDER, not per click:
 * - all payment work for one order is serialised with an advisory lock;
 * - an order already paid is never charged again;
 * - an unfinished (pending) attempt is resumed with the SAME provider idempotency key, so if the provider charged
 *   but BrittVideo crashed before recording it, the retry picks up the existing charge instead of making a new one;
 * - a new provider key is created only after a real decline/failure.
 * The database also allows at most one paid and one pending payment per order (migration 0002).
 */
export async function payOrder(pool: pg.Pool, actor: Actor, orderId: string, req: { attemptKey: string; provider: 'test' | 'square'; testOutcome?: 'approve' | 'decline' }) {
  if (actor.kind === 'user') requirePerm(actor, 'work');
  const { result } = await once(pool, 'payment', req.attemptKey, { orderId, ...req }, () => withOrderLock(pool, orderId, async () => {
    const order = (await pool.query(`SELECT * FROM orders WHERE id=$1`, [orderId])).rows[0];
    if (!order) throw notFound('order');
    if (order.status === 'paid') return { status: 'paid', alreadyPaid: true, orderId };
    const amount = (await pool.query(`SELECT coalesce(sum(sold_price_cents),0)::int n FROM order_lines WHERE order_id=$1 AND billing='one_time'`, [orderId])).rows[0].n;
    const adapter = (await adapters(pool))[req.provider];
    if (!adapter) throw new OwnerError('That way of paying is not available here.', 400, 'no_adapter');
    // Resume an unfinished attempt (same provider key) or start a new one. Recorded BEFORE calling the provider (Q10).
    let pay = (await pool.query(`SELECT * FROM payments WHERE order_id=$1 AND status='pending' AND provider=$2`, [orderId, adapter.name])).rows[0];
    if (pay && pay.provider_payment_ref) {
      const ext = await adapter.getPayment(pay.provider_payment_ref).catch(() => null);
      if (ext && ext.status !== 'pending') return applyPaymentResult(pool, actor, pay.id, ext);
    }
    if (!pay) {
      const n = (await pool.query(`SELECT count(*)::int n FROM payments WHERE order_id=$1`, [orderId])).rows[0].n;
      pay = (await pool.query(`INSERT INTO payments (order_id, provider, mode, idempotency_key, amount_cents, status)
        VALUES ($1,$2,$3,$4,$5,'pending') RETURNING *`, [orderId, adapter.name, adapter.mode, `pay:${orderId}:${n + 1}`, amount])).rows[0];
    }
    let r;
    try {
      r = await adapter.createPayment({ idempotencyKey: pay.idempotency_key, amountCents: amount, orderNumber: order.order_number, description: `BrittVideo order ${order.order_number}`, testOutcome: req.testOutcome });
    } catch (e: any) {
      await logDiagnostic(pool, 'error', 'payments', 'Payment provider call failed', { orderId, provider: adapter.name, error: e.message });
      await recordRecovery(pool, 'payments', `A payment attempt for order ${order.order_number} could not reach ${adapter.name}. It will be checked before any retry, so nothing is charged twice.`, 'needs_attention', e.message);
      throw e;
    }
    return applyPaymentResult(pool, actor, pay.id, r);
  }));
  return result;
}

/** Serialise all payment activity for one order across requests and processes. */
async function withOrderLock<T>(pool: pg.Pool, orderId: string, fn: () => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query(`SELECT pg_advisory_lock(hashtextextended($1, 42))`, ['order-pay:' + orderId]);
    return await fn();
  } finally {
    await c.query(`SELECT pg_advisory_unlock(hashtextextended($1, 42))`, ['order-pay:' + orderId]).catch(() => {});
    c.release();
  }
}

async function applyPaymentResult(pool: pg.Pool, actor: Actor, paymentId: string, r: { status: string; providerRef: string | null; failureMessage?: string | null; paymentLinkUrl?: string | null }) {
  return tx(async (t) => {
    const pay = (await t.query(`UPDATE payments SET status=$2, provider_payment_ref=$3, failure_message=$4, payment_link_url=$5 WHERE id=$1 RETURNING *`,
      [paymentId, r.status, r.providerRef, r.failureMessage ?? null, r.paymentLinkUrl ?? null])).rows[0];
    await t.query(`INSERT INTO payment_events (payment_id, provider, provider_event_id, kind, status) VALUES ($1,$2,$3,'result',$4) ON CONFLICT DO NOTHING`,
      [paymentId, pay.provider, `${pay.idempotency_key}:${r.status}`, r.status]);
    if (r.status === 'paid') await markOrderPaid(t, actor, pay.order_id);
    else if (r.status === 'failed') await t.query(`UPDATE orders SET status='payment_failed' WHERE id=$1 AND status='pending_payment'`, [pay.order_id]);
    return { status: r.status, orderId: pay.order_id, failureMessage: r.failureMessage ?? null, paymentLinkUrl: r.paymentLinkUrl ?? null };
  }, pool);
}

async function markOrderPaid(t: pg.PoolClient, actor: Actor, orderId: string) {
  const o = (await t.query(`UPDATE orders SET status='paid' WHERE id=$1 AND status IN ('pending_payment','payment_failed') RETURNING *`, [orderId])).rows[0];
  if (!o) return;
  await t.query(`UPDATE premier_memberships SET status='active', started_at=now() WHERE order_id=$1 AND status='pending_start'`, [orderId]);
  await audit(t, actor, 'payment.received', { type: 'order', id: orderId }, `Payment received for order ${o.order_number}`);
}

/** Owner records a payment received outside BrittVideo (M20). */
export async function recordManualPayment(pool: pg.Pool, actor: Actor, orderId: string, input: { attemptKey: string; amountCents: number; note: string }) {
  requirePerm(actor, 'work', 'record payments');
  if (!input.note?.trim()) throw new OwnerError('Please note how it was paid (for example "Check #1042").');
  const { result } = await once(pool, 'manual_payment', input.attemptKey, { orderId, ...input }, () => withOrderLock(pool, orderId, () => tx(async (t) => {
    const o = (await t.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`, [orderId])).rows[0];
    if (!o) throw notFound('order');
    if (o.status === 'paid') return { status: 'paid', alreadyPaid: true, orderId };
    const due = (await t.query(`SELECT coalesce(sum(sold_price_cents),0)::int n FROM order_lines WHERE order_id=$1 AND billing='one_time'`, [orderId])).rows[0].n;
    if (!Number.isInteger(input.amountCents) || input.amountCents !== due) throw new OwnerError(`The amount due today is ${money(due)}. Record the full amount, or ask support about partial payments.`);
    await t.query(`UPDATE payments SET status='cancelled', failure_message='Closed: paid another way (recorded manually).' WHERE order_id=$1 AND status='pending'`, [orderId]);
    await t.query(`INSERT INTO payments (order_id, provider, mode, idempotency_key, amount_cents, status, method_note) VALUES ($1,'manual',$2,$3,$4,'paid',$5)`,
      [orderId, config().isLive ? 'live' : 'test', `manual:${orderId}:${input.attemptKey}`, input.amountCents, input.note.trim()]);
    await markOrderPaid(t, actor, orderId);
    return { status: 'paid', orderId };
  }, pool)));
  return result;
}

export async function getOrderForPayment(pool: pg.Pool, orderId: string) {
  const o = (await pool.query(`SELECT o.id, o.order_number, o.status, o.package, c.business_name FROM orders o JOIN clients c ON c.id=o.client_id WHERE o.id=$1`, [orderId])).rows[0];
  if (!o) throw notFound('order');
  const lines = (await pool.query(`SELECT label, billing, sold_price_cents FROM order_lines WHERE order_id=$1 ORDER BY created_at`, [orderId])).rows;
  return { ...o, lines, dueTodayCents: lines.filter((l) => l.billing === 'one_time').reduce((s, l) => s + l.sold_price_cents, 0),
    monthlyCents: lines.filter((l) => l.billing === 'monthly').reduce((s, l) => s + l.sold_price_cents, 0) };
}
