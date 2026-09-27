import React, { useEffect } from 'react';
import { get, post, when } from '../../shared/api';
import { useLoad, useAction, useSession, Msg, Loading, LoadError } from '../ui';

const TONE: Record<string, string> = { normal: 'ok', recovered: 'ok', not_configured: '', attention: 'warn', support_needed: 'bad' };
const WORD: Record<string, string> = { normal: 'Normal', recovered: 'Recovered automatically', not_configured: 'Not connected yet', attention: 'Needs attention', support_needed: 'Support needed' };

export function SystemHealth() {
  const { can, openSupport } = useSession();
  const h = useLoad(() => get('/api/health'));
  const rec = useLoad(() => get('/api/recovery-events'));
  const backups = useLoad(() => can('backup') ? get('/api/backups') : Promise.resolve(null));
  const a = useAction();
  useEffect(() => { document.title = 'System Health — BrittVideo'; }, []);
  if (h.loading && !h.data) return <Loading what="Checking BrittVideo" />;
  if (h.error) return <LoadError error={h.error} retry={h.reload} />;
  const s = h.data.summary;
  return <>
    <div className="pagehead"><div><h1>System Health</h1><p className="muted">BrittVideo checks itself. If something needs a person, press GET SUPPORT — you don't need to diagnose it.</p></div>
      <div className="row"><button className="btn" onClick={() => { h.reload(); rec.reload(); backups.reload(); }}>CHECK AGAIN</button><button className="btn support" onClick={() => openSupport('System Health')}>GET SUPPORT</button></div></div>
    <div className={'notice ' + (s.overall === 'normal' ? 'ok' : s.overall === 'support_needed' ? 'bad' : 'warn')} style={{ marginBottom: 14 }}>
      <b style={{ fontSize: 19 }}>{s.headline}</b><div>{s.workSavedAndProtected ? '✓ Work Saved & Protected' : 'Your work is saved; protection needs attention (see below).'}</div></div>
    <section className="card"><ul className="list">{h.data.checks.map((c: any) => <li key={c.component}><div><b>{c.label}</b><div className="small muted">{c.ownerMessage}</div></div><span className={'badge ' + TONE[c.status]}>{WORD[c.status]}</span></li>)}</ul></section>
    {can('backup') && <section className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Backups</h2><button className="btn next" disabled={a.busy} onClick={async () => { if (await a.run(() => post('/api/backups'), 'Backup created and checked.')) { backups.reload(); h.reload(); } }}>{a.busy ? 'Making backup…' : 'MAKE A BACKUP NOW'}</button></div>
      <p className="help">A backup is made automatically every night, checked immediately, and kept 35 days. Sync is not backup — these are separate, encrypted copies.</p>
      <Msg error={a.error} ok={a.ok} />
      {backups.data?.length ? <div className="scroll-x"><table className="t"><thead><tr><th>When</th><th>Kind</th><th>Result</th><th>Size</th></tr></thead><tbody>
        {backups.data.slice(0, 15).map((b: any) => <tr key={b.id}><td>{when(b.started_at)}</td><td>{b.kind.replace('_', ' ')}</td><td>{b.status === 'succeeded' ? <span className="badge ok">{b.verify_status === 'passed' ? 'Checked ✓' : 'Made'}</span> : <span className="badge bad">{b.owner_message ?? b.status}</span>}</td><td>{b.bytes ? Math.round(b.bytes / 1024) + ' KB' : '—'}</td></tr>)}
      </tbody></table></div> : <p className="empty">No backups yet.</p>}
    </section>}
    <section className="card"><h2>Recent problems and recoveries</h2>
      {rec.data?.length ? <ul className="list">{rec.data.map((r: any) => <li key={r.id}><div>{r.what_happened}<div className="small muted">{r.area} · {when(r.at)}</div></div><span className={'badge ' + (r.outcome === 'recovered_automatically' ? 'ok' : r.outcome === 'support_needed' ? 'bad' : 'warn')}>{r.outcome.replace(/_/g, ' ')}</span></li>)}</ul>
        : <p className="empty">Nothing has gone wrong.</p>}
    </section>
  </>;
}
