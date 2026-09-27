/**
 * Permission policy (V2–V12, Appendix D). Enforced on the server for every request (W27) — the UI only mirrors it.
 */
export type Role = 'super_user' | 'admin' | 'user';
export const PERMISSIONS = [
  'work',          // normal prospect/client/project/demo work
  'revenue',       // view sensitive revenue and pricing history
  'pricing',       // change global default prices
  'integrations',  // manage integrations and credentials
  'providers',     // change primary/backup AI video provider
  'support',       // full support diagnostics
  'destructive',   // permanent destructive actions (with confirmation)
  'backup',        // create/restore backups, run imports
  'users',         // manage users and roles — Super User only, never grantable
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_DEFAULTS: Record<Role, Permission[]> = {
  super_user: [...PERMISSIONS],
  admin: ['work', 'support'],
  user: ['work'],
};
/** What a Super User may grant to each role (explicitly or as time-limited elevation). */
export const GRANTABLE: Record<Role, Permission[]> = {
  super_user: [],
  admin: ['revenue', 'pricing', 'integrations', 'providers', 'destructive', 'backup'],
  user: ['revenue'],
};

export const ROLE_LABEL: Record<Role, string> = { super_user: 'Super User', admin: 'Admin', user: 'User' };

export interface Actor {
  kind: 'user' | 'system' | 'prospect';
  userId: string | null;
  label: string;
  role?: Role;
  permissions: Set<Permission>;
}

export function effectivePermissions(u: { role: Role; grants: string[]; elevated_until: Date | null; elevated_grants: string[] }, now = new Date()): Set<Permission> {
  const set = new Set<Permission>(ROLE_DEFAULTS[u.role]);
  const allowed = new Set(GRANTABLE[u.role]);
  for (const g of u.grants ?? []) if (allowed.has(g as Permission)) set.add(g as Permission);
  if (u.elevated_until && u.elevated_until > now) for (const g of u.elevated_grants ?? []) if (allowed.has(g as Permission)) set.add(g as Permission);
  return set;
}

export const systemActor = (label = 'BrittVideo (automatic)'): Actor => ({ kind: 'system', userId: null, label, permissions: new Set(PERMISSIONS) });
export const prospectActor = (label: string): Actor => ({ kind: 'prospect', userId: null, label, permissions: new Set() });
