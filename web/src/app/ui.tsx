import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError } from '../shared/api';

export interface Me { id: string; email: string; displayName: string; role: string; roleLabel: string; permissions: string[]; mustChangePassword: boolean }
export const SessionCtx = createContext<{ me: Me | null; refresh: () => Promise<void>; can: (p: string) => boolean; openSupport: (area?: string) => void }>(
  { me: null, refresh: async () => {}, can: () => false, openSupport: () => {} });
export const useSession = () => useContext(SessionCtx);

/** Load data with loading/error state and a reload function. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setError(null); } catch (e: any) { setError(e?.message ?? 'Could not load.'); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

/** Run an action with busy state; shows the server's plain-language message on failure. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true); setError(null); setOk(null);
    try { const r = await fn(); if (success) setOk(success); return r; }
    catch (e: any) { setError(e instanceof ApiError || e?.message ? e.message : 'Something went wrong.'); return undefined; }
    finally { setBusy(false); }
  };
  return { busy, error, ok, run, setError, setOk };
}

export function Msg({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error) return <div className="notice bad" role="alert" style={{ marginTop: 12 }}>{error}</div>;
  if (ok) return <div className="notice ok" role="status" style={{ marginTop: 12 }}>{ok}</div>;
  return null;
}

export function Loading({ what = 'Loading' }: { what?: string }) { return <p className="muted">{what}…</p>; }

export function LoadError({ error, retry }: { error: string; retry?: () => void }) {
  const { openSupport } = useSession();
  return <div className="notice bad"><p>{error}</p><div className="actions">{retry && <button className="btn" onClick={retry}>TRY AGAIN</button>}<button className="btn support" onClick={() => openSupport()}>GET SUPPORT</button></div></div>;
}

/** A labelled form control. The label is linked to its control (tap-to-focus, VoiceOver). */
export function Field(props: { label: string; help?: string; children: React.ReactNode }) {
  const id = React.useId();
  const helpId = props.help ? id + '-help' : undefined;
  const child = React.isValidElement(props.children)
    ? React.cloneElement(props.children as React.ReactElement<any>, { id: (props.children as any).props.id ?? id, 'aria-describedby': helpId })
    : props.children;
  return <div><label htmlFor={id}>{props.label}</label>{child}{props.help && <div className="help" id={helpId}>{props.help}</div>}</div>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="modal-back" onClick={onClose}><div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
    <div className="row between"><h2 style={{ margin: 0 }}>{title}</h2><button className="btn small" onClick={onClose}>CLOSE</button></div>
    <div style={{ marginTop: 12 }}>{children}</div></div></div>;
}

export const STATUS_LABEL: Record<string, [string, string]> = {
  ready_to_start: ['New — Ready to Start', 'info'], in_progress: ['In Progress', 'warn'], awaiting_approval: ['Awaiting Approval', 'warn'],
  approved: ['Complete Kit Approved', 'ok'], in_production: ['In Production', 'info'], ready_for_review: ['Ready for Review', 'warn'],
  ready_for_delivery: ['Ready for Delivery', 'ok'], delivered: ['Delivered', 'ok'], archived: ['Archived', ''],
  pending_payment: ['Awaiting Payment', 'warn'], payment_failed: ['Payment Failed', 'bad'], paid: ['Paid', 'ok'], cancelled: ['Cancelled', ''], refunded: ['Refunded', ''],
  active: ['Active', 'ok'], paused: ['Paused', 'warn'], unsubscribed: ['Unsubscribed', 'bad'], pending_start: ['Starts at payment', 'warn'],
  new: ['New', 'info'], demoed: ['Demo given', 'info'], converted: ['Became a client', 'ok'],
};
export function Status({ s }: { s: string | null | undefined }) {
  if (!s) return null;
  const [label, tone] = STATUS_LABEL[s] ?? [s.replace(/_/g, ' '), ''];
  return <span className={'badge ' + tone}>{label}</span>;
}
export const packageLabel = (p?: string | null) => p === 'premier' ? 'Premier' : p === 'standard' ? 'Standard' : p === 'quick_video' ? 'One-Off Video' : p ?? '';
