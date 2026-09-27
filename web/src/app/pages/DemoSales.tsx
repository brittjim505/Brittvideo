import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, when } from '../../shared/api';
import { useLoad, useAction, Msg, Field, Loading, LoadError } from '../ui';
import { BusinessFields, emptyBiz, type BizForm } from './Prospects';

/**
 * Start a prospect-safe demo. In-person (iPad): this tab switches to the demo and BrittVideo locks until the owner's
 * password is entered. Remote (Mac + Zoom): the demo opens in its own window — share ONLY that window in Zoom.
 */
export async function startDemo(channel: 'ipad_in_person' | 'mac_zoom', target: { prospectId?: string; business?: BizForm }) {
  const win = channel === 'mac_zoom' ? window.open('', 'BrittVideoDemo', 'width=1280,height=860') : null;
  try {
    const r = await post('/api/demo/sessions', { channel, ...target });
    if (channel === 'mac_zoom' && win) { win.location.href = r.url; return r; }
    window.location.href = r.url;
    return r;
  } catch (e) { win?.close(); throw e; }
}

export function DemoLinkMaker({ prospectId, business, onMade }: { prospectId?: string; business?: BizForm; onMade?: () => void }) {
  const [days, setDays] = useState(14); const [allowSignup, setAllowSignup] = useState(true);
  const [made, setMade] = useState<any>(null); const a = useAction();
  if (made) return <div className="stack">
    <div className="notice ok"><b>Your demo link is ready.</b> Copy it now — for security, the full link is shown only this once.</div>
    <input readOnly value={made.url} onFocus={(e) => e.target.select()} aria-label="Demo link" />
    <div className="actions"><button className="btn next" onClick={() => navigator.clipboard.writeText(made.url).then(() => a.setOk('Copied. Paste it into your email or text to the prospect.'))}>COPY LINK</button></div>
    <p className="help">Expires {when(made.expiresAt)}. You can turn it off any time in Demo &amp; Sales → Demo Links.</p>
    <Msg ok={a.ok} />
  </div>;
  return <div>
    <p className="muted">The prospect sees only your demo videos, what's included and list prices — never your client list, notes or pricing history.</p>
    <Field label="Link works for (days)"><input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} /></Field>
    <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={allowSignup} onChange={(e) => setAllowSignup(e.target.checked)} /> Let the prospect sign up from this link (Become a Client)</label>
    <div className="actions"><button className="btn next" disabled={a.busy || (!prospectId && !business?.businessName)} onClick={async () => {
      const r = await a.run(() => post('/api/demo/links', { prospectId, business: prospectId ? undefined : business, days, allowSignup }));
      if (r) { setMade(r); onMade?.(); }
    }}>CREATE DEMO LINK</button></div>
    <Msg error={a.error} />
  </div>;
}

export function DemoSales() {
  const [f, setF] = useState<BizForm>(emptyBiz);
  const [prospectId, setProspectId] = useState('');
  const prospects = useLoad(() => get('/api/prospects'));
  const links = useLoad(() => get('/api/demo/links'));
  const a = useAction(); const l = useAction();
  useEffect(() => { document.title = 'Demo & Sales — BrittVideo'; }, []);
  const target = prospectId ? { prospectId } : { business: f };
  const ready = !!prospectId || (f.businessName.trim() && (f.industry !== 'other' || f.businessType.trim()));
  return <>
    <div className="pagehead"><div><h1>Demo &amp; Sales</h1><p className="muted">One prospect-safe experience for in-person iPad, Mac + Zoom, and follow-up Demo Links.</p></div>
      <Link className="btn" to="/settings/demo-library">DEMO LIBRARY</Link></div>

    <section className="card">
      <h2>1. Who is the demo for?</h2>
      <Field label="Choose a prospect">
        <select value={prospectId} onChange={(e) => setProspectId(e.target.value)}>
          <option value="">— A new business (enter below) —</option>
          {(prospects.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.business_name}</option>)}
        </select>
      </Field>
      {!prospectId && <BusinessFields f={f} set={setF} showNotes={false} />}
      <h2 style={{ marginTop: 22 }}>2. Start the demo</h2>
      <div className="grid">
        <div className="card" style={{ boxShadow: 'none' }}>
          <h3>In person — iPad</h3>
          <p className="muted small">This screen turns into the demo. When you take the iPad back, enter your password to unlock BrittVideo.</p>
          <button className={'btn ' + (ready ? 'next' : '')} disabled={!ready || a.busy} onClick={() => a.run(() => startDemo('ipad_in_person', target))}>START IPAD DEMO</button>
        </div>
        <div className="card" style={{ boxShadow: 'none' }}>
          <h3>Remote live — Mac + Zoom</h3>
          <p className="muted small">The demo opens in its own window. In Zoom, choose Share Screen → that <b>window only</b>.</p>
          <button className="btn primary" disabled={!ready || a.busy} onClick={() => a.run(() => startDemo('mac_zoom', target))}>OPEN ZOOM DEMO WINDOW</button>
        </div>
        <div className="card" style={{ boxShadow: 'none' }}>
          <h3>Follow-up Demo Link</h3>
          <p className="muted small">A private link you send by email or text. You control when it expires.</p>
          {ready ? <DemoLinkMaker prospectId={prospectId || undefined} business={prospectId ? undefined : f} onMade={links.reload} /> : <p className="help">Choose or enter a business first.</p>}
        </div>
      </div>
      <Msg error={a.error} />
    </section>

    <section className="card">
      <h2>Demo Links</h2>
      {links.loading && !links.data ? <Loading /> : links.error ? <LoadError error={links.error} retry={links.reload} /> :
        links.data!.length === 0 ? <p className="empty">No demo links yet.</p> :
        <div className="scroll-x"><table className="t"><thead><tr><th>Business</th><th>Created</th><th>Expires</th><th>Views</th><th>Status</th><th></th></tr></thead><tbody>
          {links.data!.map((x: any) => <tr key={x.id}><td>{x.business_name}</td><td>{when(x.created_at)}</td><td>{when(x.expires_at)}</td><td>{x.view_count}{x.last_viewed_at ? ` (last ${when(x.last_viewed_at)})` : ''}</td>
            <td>{x.active ? <span className="badge ok">Active</span> : <span className="badge">{x.disabled_at ? 'Turned off' : 'Expired'}</span>}</td>
            <td>{x.active && <button className="btn small danger" disabled={l.busy} onClick={async () => { if (await l.run(() => post(`/api/demo/links/${x.id}/disable`))) links.reload(); }}>TURN OFF</button>}</td></tr>)}
        </tbody></table></div>}
      <Msg error={l.error} />
    </section>
  </>;
}
