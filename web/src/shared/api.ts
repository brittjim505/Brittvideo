/** Minimal API client. Every error the owner sees is the server's plain-language message. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string, public reference?: string) { super(message); }
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { 'X-BrittVideo': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('BrittVideo cannot be reached right now. Check the internet connection — your typing on this screen is kept.', 0, 'offline');
  }
  const text = await res.text();
  let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) {
    const e = json?.error;
    if (res.status === 423) window.dispatchEvent(new CustomEvent('bv:locked'));
    if (res.status === 401 && e?.code === 'not_signed_in') window.dispatchEvent(new CustomEvent('bv:signed-out'));
    throw new ApiError(e?.message ?? 'Something went wrong. Please try again.', res.status, e?.code ?? 'error', e?.reference);
  }
  return json as T;
}
export const get = <T = any>(u: string) => api<T>('GET', u);
export const post = <T = any>(u: string, b: unknown = {}) => api<T>('POST', u, b);
export const put = <T = any>(u: string, b: unknown = {}) => api<T>('PUT', u, b);
export const patch = <T = any>(u: string, b: unknown = {}) => api<T>('PATCH', u, b);
export const del = <T = any>(u: string) => api<T>('DELETE', u);

export const newKey = () => (crypto as any).randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);

export const money = (cents: number | null | undefined) =>
  cents == null ? '—' : '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });

export const INDUSTRIES = [
  { value: 'senior_care', label: 'Senior Care' }, { value: 'dental', label: 'Dental' },
  { value: 'attorneys', label: 'Attorneys' }, { value: 'other', label: 'OTHER' },
];
export const industryLabel = (i: string, t?: string | null) => i === 'other' ? `OTHER — ${t || 'type not set'}` : (INDUSTRIES.find((x) => x.value === i)?.label ?? i);
export const when = (d: string | null | undefined) => d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
export const day = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString([], { dateStyle: 'medium' }) : '—';

/** Local storage is used only as a small safety buffer for unsent drafts; it may be unavailable. */
export const local = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  remove(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
