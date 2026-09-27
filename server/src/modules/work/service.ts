import type { Queryable } from '../../db/pool.js';
import type { Actor } from '../../auth/permissions.js';
import { requirePerm } from '../../auth/service.js';
import { OwnerError } from '../../lib/errors.js';

// ---------------------------------------------------------------------------------------------------------------
// Autosave drafts (Q2, Q7). The client saves every few seconds; stale writes (lower revision) are refused so an old
// tab can never overwrite newer work. Payload size is capped to protect storage.
// ---------------------------------------------------------------------------------------------------------------
export async function saveDraft(q: Queryable, actor: Actor, key: string, payload: unknown, baseRevision: number | null) {
  if (!actor.userId) throw new OwnerError('Please sign in.', 401);
  if (!/^[a-z0-9:_-]{1,120}$/i.test(key)) throw new OwnerError('Invalid draft name.');
  const json = JSON.stringify(payload ?? {});
  if (json.length > 200_000) throw new OwnerError('This draft is too large to autosave. Please save it as a project.');
  const cur = (await q.query(`SELECT revision FROM drafts WHERE user_id=$1 AND draft_key=$2`, [actor.userId, key])).rows[0];
  // A write that doesn't know about the stored version (another tab/device saved first) must not overwrite it.
  if (cur && (baseRevision === null || baseRevision < cur.revision)) {
    const latest = (await q.query(`SELECT payload, revision, updated_at FROM drafts WHERE user_id=$1 AND draft_key=$2`, [actor.userId, key])).rows[0];
    return { conflict: true, ...latest };
  }
  const r = (await q.query(`INSERT INTO drafts (user_id, draft_key, payload) VALUES ($1,$2,$3)
    ON CONFLICT (user_id, draft_key) DO UPDATE SET payload=EXCLUDED.payload, revision=drafts.revision+1, updated_at=now()
    RETURNING revision, updated_at`, [actor.userId, key, json])).rows[0];
  return { conflict: false, revision: r.revision, updatedAt: r.updated_at };
}
export async function getDraft(q: Queryable, actor: Actor, key: string) {
  return (await q.query(`SELECT payload, revision, updated_at FROM drafts WHERE user_id=$1 AND draft_key=$2`, [actor.userId, key])).rows[0] ?? null;
}
export async function deleteDraft(q: Queryable, actor: Actor, key: string) {
  await q.query(`DELETE FROM drafts WHERE user_id=$1 AND draft_key=$2`, [actor.userId, key]);
}

// Continue Working (L5, Q5): remember the last meaningful place.
export async function setActivity(q: Queryable, actor: Actor, a: { route: string; entityType?: string; entityId?: string; label?: string }) {
  if (!actor.userId || !a.route?.startsWith('/app')) return;
  await q.query(`INSERT INTO user_activity (user_id, route, entity_type, entity_id, label) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (user_id) DO UPDATE SET route=EXCLUDED.route, entity_type=EXCLUDED.entity_type, entity_id=EXCLUDED.entity_id, label=EXCLUDED.label, updated_at=now()`,
    [actor.userId, a.route.slice(0, 300), a.entityType ?? null, a.entityId ?? null, a.label?.slice(0, 200) ?? null]);
}

// ---------------------------------------------------------------------------------------------------------------
// Command Center (L1–L18): actionable counts, exact navigation targets, no technical noise.
// ---------------------------------------------------------------------------------------------------------------
export async function commandCenter(q: Queryable, actor: Actor) {
  requirePerm(actor, 'work');
  const one = async (sql: string, p: unknown[] = []) => (await q.query(sql, p)).rows;
  const newClients = await one(`SELECT p.id AS project_id, p.title, c.business_name, o.package, o.status AS order_status, p.created_at
    FROM projects p JOIN clients c ON c.id=p.client_id LEFT JOIN orders o ON o.id=p.order_id
    WHERE p.status='ready_to_start' AND p.archived_at IS NULL AND (o.id IS NULL OR o.status='paid') ORDER BY p.created_at DESC LIMIT 20`);
  const awaitingPayment = await one(`SELECT o.id AS order_id, o.order_number, c.business_name, o.package, o.status, o.created_at
    FROM orders o JOIN clients c ON c.id=o.client_id WHERE o.status IN ('pending_payment','payment_failed') ORDER BY o.created_at DESC LIMIT 20`);
  const inProgress = await one(`SELECT p.id AS project_id, p.title, coalesce(c.business_name, pr.business_name) AS business_name, p.status, p.updated_at
    FROM projects p LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN prospects pr ON pr.id=p.prospect_id
    WHERE p.status IN ('in_progress','awaiting_approval','approved','in_production','ready_for_review','ready_for_delivery') AND p.archived_at IS NULL
    ORDER BY p.updated_at DESC LIMIT 20`);
  const reapproval = await one(`SELECT p.id AS project_id, p.title FROM production_records r JOIN projects p ON p.id=r.project_id WHERE r.status='needs_reapproval' LIMIT 20`);
  const prospects = await one(`SELECT count(*)::int n FROM prospects WHERE archived_at IS NULL AND status IN ('new','demoed')`);
  const upcomingPremier = await one(`SELECT q.due_at, c.business_name, q.status FROM quarterly_obligations q JOIN premier_memberships m ON m.id=q.membership_id
    JOIN clients c ON c.id=m.client_id WHERE q.status IN ('upcoming','in_progress') AND q.due_at < now() + interval '30 days' ORDER BY q.due_at LIMIT 10`);
  const activity = actor.userId ? (await one(`SELECT route, label, updated_at FROM user_activity WHERE user_id=$1`, [actor.userId]))[0] ?? null : null;
  let revenue = null;
  if (actor.permissions.has('revenue')) {
    revenue = (await one(`SELECT
        coalesce(sum(l.sold_price_cents) FILTER (WHERE l.billing='one_time' AND o.created_at >= date_trunc('month', now())),0)::int AS month_one_time_cents,
        coalesce(sum(l.sold_price_cents) FILTER (WHERE l.billing='monthly' AND m.status='active'),0)::int AS active_monthly_cents
      FROM orders o JOIN order_lines l ON l.order_id=o.id LEFT JOIN premier_memberships m ON m.order_id=o.id WHERE o.status='paid'`))[0];
  }
  return { newClients, awaitingPayment, inProgress, reapproval, prospectCount: prospects[0].n, upcomingPremier, continueWorking: activity, revenue };
}

export async function globalSearch(q: Queryable, actor: Actor, term: string) {
  requirePerm(actor, 'work');
  const t = '%' + (term ?? '').trim().toLowerCase() + '%';
  if (t.length < 4) return [];
  const rows = await q.query(`
    SELECT 'client' AS type, id::text, business_name AS label, '/app/clients/' || id AS route FROM clients WHERE lower(business_name) LIKE $1 OR lower(coalesce(website_url,'')) LIKE $1
    UNION ALL SELECT 'prospect', id::text, business_name, '/app/prospects?open=' || id FROM prospects WHERE archived_at IS NULL AND status<>'converted' AND (lower(business_name) LIKE $1 OR lower(coalesce(website_url,'')) LIKE $1)
    UNION ALL SELECT 'project', id::text, title, '/app/projects/' || id FROM projects WHERE lower(title) LIKE $1
    LIMIT 25`, [t]);
  return rows.rows;
}
