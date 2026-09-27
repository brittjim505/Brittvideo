import type { Queryable } from '../../db/pool.js';
import { config } from '../../config.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import type { Actor } from '../../auth/permissions.js';
import { requirePerm } from '../../auth/service.js';
import { audit } from '../audit/service.js';
import { OwnerError } from '../../lib/errors.js';

/** Allowed secret names. Values are write-only through the API (V18, S16, U6). */
export const SECRET_NAMES = ['square.access_token', 'square.location_id', 'square.webhook_signature_key',
  'vimeo.access_token', 'heygen.api_key', 'email.api_key', 'sms.api_key'] as const;

export async function setSecret(q: Queryable, actor: Actor, name: string, value: string) {
  requirePerm(actor, 'integrations', 'manage integration credentials');
  if (!(SECRET_NAMES as readonly string[]).includes(name)) throw new OwnerError('Unknown connection setting.');
  const v = (value ?? '').trim();
  if (!v) throw new OwnerError('Please paste the value from the provider\'s website.');
  await q.query(`INSERT INTO secrets (name, ciphertext, hint, updated_by) VALUES ($1,$2,$3,$4)
    ON CONFLICT (name) DO UPDATE SET ciphertext=EXCLUDED.ciphertext, hint=EXCLUDED.hint, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [name, encrypt(v, config().SECRETS_ENCRYPTION_KEY), v.slice(-4), actor.userId]);
  await audit(q, actor, 'integration.secret_set', { type: 'secret', id: name }, `Connection setting saved: ${name} (value hidden)`);
}

export async function clearSecret(q: Queryable, actor: Actor, name: string) {
  requirePerm(actor, 'integrations', 'manage integration credentials');
  await q.query(`DELETE FROM secrets WHERE name=$1`, [name]);
  await audit(q, actor, 'integration.secret_cleared', { type: 'secret', id: name }, `Connection setting removed: ${name}`);
}

/** Server-internal only. Never expose through a route. */
export async function readSecret(q: Queryable, name: string): Promise<string | null> {
  const r = (await q.query(`SELECT ciphertext FROM secrets WHERE name=$1`, [name])).rows[0];
  return r ? decrypt(r.ciphertext, config().SECRETS_ENCRYPTION_KEY).toString('utf8') : null;
}

export async function secretStatus(q: Queryable) {
  const rows = (await q.query(`SELECT name, hint, updated_at FROM secrets`)).rows;
  return SECRET_NAMES.map((n) => { const r = rows.find((x) => x.name === n); return { name: n, set: !!r, hint: r ? '…' + r.hint : null, updatedAt: r?.updated_at ?? null }; });
}
