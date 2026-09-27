import { useEffect, useRef, useState } from 'react';
import { api, local } from './api';

export type SaveState = 'idle' | 'saving' | 'saved' | 'retrying' | 'offline';

/**
 * Autosave a form to the server (Q2). The status is honest (Q7): "Saved" only after the server confirms.
 * If saving fails, the latest value is kept in this browser and retried automatically until it succeeds.
 */
export function useAutosave<T>(key: string, value: T, opts: { enabled?: boolean; delayMs?: number } = {}) {
  const [state, setState] = useState<SaveState>('idle');
  const revision = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const latest = useRef(value);
  const first = useRef(true);
  latest.current = value;
  const enabled = opts.enabled !== false;

  const push = async () => {
    const body = { payload: latest.current, baseRevision: revision.current };
    local.set('bv-outbox:' + key, JSON.stringify(latest.current));
    setState('saving');
    try {
      const r = await api<any>('PUT', `/api/drafts/${encodeURIComponent(key)}`, body);
      if (!r.conflict) revision.current = r.revision; else revision.current = r.revision;
      local.remove('bv-outbox:' + key);
      setState('saved');
    } catch (e: any) {
      setState(e?.status === 0 ? 'offline' : 'retrying');
      timer.current = window.setTimeout(push, 8000);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    if (first.current) { first.current = false; return; }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(push, opts.delayMs ?? 1200);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value), enabled]);

  const clear = async () => {
    if (timer.current) window.clearTimeout(timer.current);
    local.remove('bv-outbox:' + key);
    revision.current = null;
    try { await api('DELETE', `/api/drafts/${encodeURIComponent(key)}`); } catch { /* the draft simply stays */ }
    setState('idle');
  };
  return { state, clear };
}

/** Load a previously autosaved draft (server first, then this browser's unsent copy). */
export async function loadDraft<T>(key: string): Promise<T | null> {
  const unsent = local.get('bv-outbox:' + key);
  if (unsent) { try { return JSON.parse(unsent) as T; } catch { /* ignore */ } }
  try { const r = await api<any>('GET', `/api/drafts/${encodeURIComponent(key)}`); return (r.draft?.payload as T) ?? null; } catch { return null; }
}

export function saveLabel(s: SaveState) {
  return ({ idle: '', saving: 'Saving…', saved: '✓ Saved', retrying: 'Not saved yet — retrying automatically. Keep this screen open.', offline: 'Offline — kept on this device, will save when reconnected.' } as const)[s];
}
