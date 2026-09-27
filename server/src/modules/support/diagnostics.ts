import type { Queryable } from '../../db/pool.js';
import { redact, redactString } from '../../lib/redact.js';

export async function logDiagnostic(q: Queryable, level: 'info' | 'warn' | 'error', area: string, message: string, context?: unknown, requestId?: string) {
  try {
    await q.query(`INSERT INTO diagnostic_log (level, area, message, context, request_id) VALUES ($1,$2,$3,$4,$5)`,
      [level, area, redactString(message).slice(0, 2000), context === undefined ? null : JSON.stringify(redact(context)), requestId ?? null]);
  } catch { /* diagnostics must never break the owner's work */ }
}

export async function recordRecovery(q: Queryable, area: string, whatHappened: string,
  outcome: 'recovered_automatically' | 'needs_attention' | 'support_needed', detail?: string) {
  try {
    await q.query(`INSERT INTO recovery_events (area, what_happened, outcome, detail) VALUES ($1,$2,$3,$4)`,
      [area, whatHappened, outcome, detail ? redactString(detail).slice(0, 2000) : null]);
  } catch { /* never throw from recovery bookkeeping */ }
}
