import type { Queryable } from '../../db/pool.js';
import type { Actor } from '../../auth/permissions.js';
import { redact } from '../../lib/redact.js';

/** Record an important business action: who, what, when, with before/after context (V10, Y-audit). */
export async function audit(q: Queryable, actor: Actor, action: string, entity: { type?: string; id?: string | null } | null,
  summary: string, before?: unknown, after?: unknown, requestId?: string) {
  await q.query(
    `INSERT INTO audit_events (actor_user_id, actor_label, action, entity_type, entity_id, summary, before_data, after_data, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [actor.userId, actor.label, action, entity?.type ?? null, entity?.id ?? null, summary,
      before === undefined ? null : JSON.stringify(redact(before)), after === undefined ? null : JSON.stringify(redact(after)), requestId ?? null]);
}

export async function auditTrail(q: Queryable, filter: { entityType?: string; entityId?: string; limit?: number }) {
  const where: string[] = []; const p: unknown[] = [];
  if (filter.entityType) { p.push(filter.entityType); where.push(`entity_type=$${p.length}`); }
  if (filter.entityId) { p.push(filter.entityId); where.push(`entity_id=$${p.length}`); }
  p.push(Math.min(filter.limit ?? 100, 500));
  return (await q.query(`SELECT id, at, actor_label, action, entity_type, entity_id, summary FROM audit_events
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY at DESC, id DESC LIMIT $${p.length}`, p)).rows;
}
