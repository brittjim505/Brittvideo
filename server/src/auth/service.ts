import type pg from 'pg';
import { config } from '../config.js';
import { hashPassword, verifyPassword, passwordProblem } from '../lib/crypto.js';
import { OwnerError, forbidden, notFound } from '../lib/errors.js';
import { randomToken, sha256 } from '../lib/util.js';
import { audit } from '../modules/audit/service.js';
import { tx } from '../db/pool.js';
import { type Actor, type Role, type Permission, effectivePermissions, GRANTABLE, ROLE_LABEL } from './permissions.js';

export const SESSION_COOKIE = 'bv_session';
const MAX_FAILURES = 5, LOCK_MINUTES = 15;

export function publicUser(u: any) {
  const perms = effectivePermissions(u);
  return {
    id: u.id, email: u.email, displayName: u.display_name, role: u.role as Role, roleLabel: ROLE_LABEL[u.role as Role],
    status: u.status, grants: u.grants, elevatedUntil: u.elevated_until, elevatedGrants: u.elevated_grants,
    permissions: [...perms], mustChangePassword: u.must_change_password, lastLoginAt: u.last_login_at, createdAt: u.created_at,
  };
}

export function actorFromUser(u: any): Actor {
  return { kind: 'user', userId: u.id, role: u.role, label: `${u.display_name} (${ROLE_LABEL[u.role as Role]})`, permissions: effectivePermissions(u) };
}

export function requirePerm(actor: Actor, perm: Permission, what?: string) {
  if (!actor.permissions.has(perm)) throw forbidden(what);
}

export async function login(pool: pg.Pool, email: string, password: string, meta: { ip?: string; userAgent?: string }) {
  const e = (email ?? '').trim().toLowerCase();
  const fails = (await pool.query(
    `SELECT count(*)::int n FROM login_attempts WHERE lower(email)=$1 AND success=false AND at > now() - interval '${LOCK_MINUTES} minutes'`, [e])).rows[0].n;
  if (fails >= MAX_FAILURES) {
    throw new OwnerError(`Too many sign-in attempts for this account. For your security, please wait ${LOCK_MINUTES} minutes and try again.`, 429, 'locked');
  }
  const u = (await pool.query(`SELECT * FROM users WHERE lower(email)=$1`, [e])).rows[0];
  const ok = u && u.status === 'active' && (await verifyPassword(password ?? '', u.password_hash));
  await pool.query(`INSERT INTO login_attempts (email, ip, success) VALUES ($1,$2,$3)`, [e, meta.ip ?? null, !!ok]);
  if (!ok) {
    if (u && u.status === 'disabled') throw new OwnerError('This account has been turned off. Ask the Super User if you need access.', 401, 'disabled');
    throw new OwnerError('That email and password do not match. Please try again.', 401, 'bad_credentials');
  }
  const token = randomToken(32);
  const expires = new Date(Date.now() + config().SESSION_DAYS * 86400_000);
  await pool.query(`INSERT INTO sessions (id, user_id, expires_at, user_agent, ip) VALUES ($1,$2,$3,$4,$5)`,
    [sha256(token), u.id, expires, meta.userAgent?.slice(0, 300) ?? null, meta.ip ?? null]);
  await pool.query(`UPDATE users SET last_login_at=now() WHERE id=$1`, [u.id]);
  await audit(pool, actorFromUser(u), 'user.signed_in', { type: 'user', id: u.id }, `${u.display_name} signed in`);
  return { token, expires, user: publicUser(u) };
}

export async function userForToken(pool: pg.Pool, token: string | undefined) {
  if (!token) return null;
  const r = await pool.query(
    `SELECT u.*, s.id AS session_id, s.locked_at FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id=$1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status='active'`, [sha256(token)]);
  if (!r.rowCount) return null;
  pool.query(`UPDATE sessions SET last_seen_at=now() WHERE id=$1`, [r.rows[0].session_id]).catch(() => {});
  return r.rows[0];
}

export async function logout(pool: pg.Pool, token: string | undefined) {
  if (token) await pool.query(`UPDATE sessions SET revoked_at=now() WHERE id=$1`, [sha256(token)]);
}

// ---------------------------------------------------------------------------------------------------------------
// User management (V7–V11). Super User only.
// ---------------------------------------------------------------------------------------------------------------
export async function createUser(pool: pg.Pool, actor: Actor | null, input: { email: string; displayName: string; role: Role; password: string; mustChangePassword?: boolean }) {
  if (actor) requirePerm(actor, 'users', 'manage users');
  const email = (input.email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new OwnerError('Please enter a valid email address.');
  if (!input.displayName?.trim()) throw new OwnerError('Please enter the person\'s name.');
  if (!['super_user', 'admin', 'user'].includes(input.role)) throw new OwnerError('Please choose Super User, Admin or User.');
  const pp = passwordProblem(input.password ?? ''); if (pp) throw new OwnerError(pp);
  const exists = await pool.query(`SELECT 1 FROM users WHERE lower(email)=$1`, [email]);
  if (exists.rowCount) throw new OwnerError('Someone already has an account with that email. Every person gets their own login.', 409, 'duplicate');
  const hash = await hashPassword(input.password);
  return tx(async (t) => {
    const u = (await t.query(`INSERT INTO users (email, display_name, role, password_hash, must_change_password)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`, [email, input.displayName.trim(), input.role, hash, !!input.mustChangePassword])).rows[0];
    await audit(t, actor ?? { kind: 'system', userId: null, label: 'BrittVideo setup', permissions: new Set() },
      'user.created', { type: 'user', id: u.id }, `Created ${ROLE_LABEL[input.role as Role]} account for ${u.display_name}`, undefined, { email, role: input.role });
    return publicUser(u);
  }, pool);
}

export async function listUsers(pool: pg.Pool, actor: Actor) {
  requirePerm(actor, 'users', 'manage users');
  return (await pool.query(`SELECT * FROM users ORDER BY role, display_name`)).rows.map(publicUser);
}

export async function updateUser(pool: pg.Pool, actor: Actor, id: string, patch: { role?: Role; status?: 'active' | 'disabled'; grants?: string[]; displayName?: string }) {
  requirePerm(actor, 'users', 'manage users');
  return tx(async (t) => {
    const before = (await t.query(`SELECT * FROM users WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!before) throw notFound('user');
    const role = patch.role ?? before.role;
    if (!['super_user', 'admin', 'user'].includes(role)) throw new OwnerError('Please choose Super User, Admin or User.');
    const grants = (patch.grants ?? before.grants).filter((g: string) => (GRANTABLE[role as Role] as string[]).includes(g));
    const status = patch.status ?? before.status;
    const after = (await t.query(
      `UPDATE users SET role=$2, status=$3, grants=$4, display_name=$5, disabled_at=CASE WHEN $3='disabled' THEN coalesce(disabled_at, now()) ELSE NULL END,
         elevated_until=CASE WHEN $2<>role THEN NULL ELSE elevated_until END
       WHERE id=$1 RETURNING *`, [id, role, status, grants, patch.displayName?.trim() || before.display_name])).rows[0];
    if (status === 'disabled' || role !== before.role) await t.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [id]);
    const changes: string[] = [];
    if (before.role !== role) changes.push(`role ${ROLE_LABEL[before.role as Role]} → ${ROLE_LABEL[role as Role]}`);
    if (before.status !== status) changes.push(status === 'disabled' ? 'access turned off' : 'access turned on');
    if (JSON.stringify(before.grants) !== JSON.stringify(grants)) changes.push(`permissions: ${grants.join(', ') || 'role defaults only'}`);
    await audit(t, actor, 'user.updated', { type: 'user', id }, `${after.display_name}: ${changes.join('; ') || 'details updated'}`,
      { role: before.role, status: before.status, grants: before.grants }, { role, status, grants });
    return publicUser(after);
  }, pool);
}

/** Time-limited elevated access for a developer/admin (V11). */
export async function elevateUser(pool: pg.Pool, actor: Actor, id: string, grants: string[], hours: number) {
  requirePerm(actor, 'users', 'manage users');
  if (!(hours > 0 && hours <= 72)) throw new OwnerError('Temporary access can last from 1 to 72 hours.');
  return tx(async (t) => {
    const u = (await t.query(`SELECT * FROM users WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!u) throw notFound('user');
    const allowed = grants.filter((g) => (GRANTABLE[u.role as Role] as string[]).includes(g));
    const until = new Date(Date.now() + hours * 3600_000);
    const after = (await t.query(`UPDATE users SET elevated_until=$2, elevated_grants=$3 WHERE id=$1 RETURNING *`, [id, until, allowed])).rows[0];
    await audit(t, actor, 'user.elevated', { type: 'user', id }, `${u.display_name} given temporary access (${allowed.join(', ')}) until ${until.toISOString()}`);
    return publicUser(after);
  }, pool);
}

export async function setPassword(pool: pg.Pool, actor: Actor, id: string, password: string, currentPassword?: string) {
  const self = actor.userId === id;
  if (!self) requirePerm(actor, 'users', 'reset other people\'s passwords');
  const pp = passwordProblem(password ?? ''); if (pp) throw new OwnerError(pp);
  const u = (await pool.query(`SELECT * FROM users WHERE id=$1`, [id])).rows[0];
  if (!u) throw notFound('user');
  if (self && !(await verifyPassword(currentPassword ?? '', u.password_hash))) throw new OwnerError('Your current password is not correct.', 401, 'bad_credentials');
  await pool.query(`UPDATE users SET password_hash=$2, must_change_password=$3 WHERE id=$1`, [id, await hashPassword(password), !self]);
  if (!self) await pool.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [id]);
  await audit(pool, actor, 'user.password_changed', { type: 'user', id }, self ? `${u.display_name} changed their password` : `Password reset for ${u.display_name}`);
}

/** Re-check the signed-in owner's password (used to exit prospect-safe mode on a shared iPad). */
export async function confirmPassword(pool: pg.Pool, userId: string, password: string) {
  const u = (await pool.query(`SELECT password_hash FROM users WHERE id=$1 AND status='active'`, [userId])).rows[0];
  return !!u && (await verifyPassword(password ?? '', u.password_hash));
}
