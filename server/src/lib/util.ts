import crypto from 'node:crypto';

export const sha256 = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Stable JSON (sorted keys) so hashes of the same content are always identical. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}
export const contentHash = (v: unknown) => sha256(stableStringify(v));

/** Normalise a website for duplicate detection: host (without www) + path, lowercase, no trailing slash. */
export function normaliseWebsite(url: string | null | undefined): string | null {
  const raw = (url ?? '').trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const p = u.pathname.replace(/\/+$/, '').toLowerCase();
    return host + p;
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  }
}

export function cleanWebsite(url: string | null | undefined): string | null {
  const raw = (url ?? '').trim();
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
}

export const INDUSTRIES = ['senior_care', 'dental', 'attorneys', 'other'] as const;
export type Industry = (typeof INDUSTRIES)[number];
export const INDUSTRY_LABEL: Record<Industry, string> = {
  senior_care: 'Senior Care', dental: 'Dental', attorneys: 'Attorneys', other: 'OTHER',
};

export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
}
