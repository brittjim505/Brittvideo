import React, { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { get, post, patch, put, del, api, money, when, INDUSTRIES } from '../../shared/api';
import { useLoad, useAction, useSession, Msg, Field, Loading, LoadError, Modal } from '../ui';

export function Settings() {
  const { can } = useSession();
  useEffect(() => { document.title = 'Settings — BrittVideo'; }, []);
  return <>
    <div className="pagehead"><h1>Settings</h1></div>
    <nav className="row" style={{ marginBottom: 14 }} aria-label="Settings">
      <NavLink className="btn small" to="/settings" end>Pricing</NavLink>
      {can('users') && <NavLink className="btn small" to="/settings/users">Users</NavLink>}
      <NavLink className="btn small" to="/settings/integrations">Integrations</NavLink>
      <NavLink className="btn small" to="/settings/demo-library">Demo Library</NavLink>
      {can('backup') && <NavLink className="btn small" to="/settings/import">Import from V2</NavLink>}
    </nav>
    <Routes>
      <Route path="/" element={<Pricing />} />
      <Route path="/users" element={<Users />} />
      <Route path="/integrations" element={<Integrations />} />
      <Route path="/demo-library" element={<DemoLibrary />} />
      <Route path="/import" element={<ImportV2 />} />
    </Routes>
  </>;
}

function Pricing() {
  const { can } = useSession();
  const d = useLoad(() => get('/api/pricing'));
  const hist = useLoad(() => can('revenue') ? get('/api/pricing/history') : Promise.resolve([]));
  const [vals, setVals] = useState<Record<string, string>>({}); const [note, setNote] = useState(''); const [confirming, setConfirming] = useState(false);
  const a = useAction();
  useEffect(() => { if (d.data) setVals(Object.fromEntries(Object.entries(d.data.items).map(([k, v]: any) => [k, v.amount_cents == null ? '' : String(v.amount_cents / 100)]))); }, [d.data]);
  if (d.loading && !d.data) return <Loading />;
  if (d.error) return <LoadError error={d.error} retry={d.reload} />;
  const changes = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v.trim() === '' ? null : Math.round(Number(v.replace(/[$,]/g, '')) * 100)])
    .filter(([k, v]) => d.data.items[k as string].amount_cents !== v));
  return <div className="grid-2">
    <section className="card">
      <h2>Default prices <span className="badge">version {d.data.version}</span></h2>
      <p className="muted small">These are the list prices for new sales. Every past sale keeps the price it was sold at.</p>
      {Object.entries(d.data.items).map(([code, it]: any) => <Field key={code} label={`${it.label}${it.billing === 'monthly' ? ' (per month)' : ' (one-time)'}`} help={code === 'quick_video' ? 'Leave blank: Quick Video has no set price — you enter the agreed price on each sale.' : undefined}>
        <input inputMode="decimal" disabled={!d.data.canEdit} value={vals[code] ?? ''} onChange={(e) => setVals({ ...vals, [code]: e.target.value })} /></Field>)}
      {d.data.canEdit ? <>
        <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why the change" /></Field>
        <div className="actions"><button className={'btn ' + (Object.keys(changes).length ? 'next' : '')} disabled={!Object.keys(changes).length} onClick={() => setConfirming(true)}>SAVE NEW DEFAULT PRICES</button></div>
      </> : <p className="help">Only the Super User can change default prices.</p>}
      <Msg error={a.error} ok={a.ok} />
      {confirming && <Modal title="Change default prices?" onClose={() => setConfirming(false)}>
        <ul>{Object.entries(changes).map(([k, v]) => <li key={k}>{d.data.items[k].label}: {money(d.data.items[k].amount_cents)} → <b>{money(v as number)}</b></li>)}</ul>
        <p>New prices apply to <b>future sales only</b>. Past sales, agreements and Premier memberships keep their original prices.</p>
        <div className="actions"><button className="btn next" disabled={a.busy} onClick={async () => { if (await a.run(() => post('/api/pricing', { changes, note }), 'New default prices saved.')) { setConfirming(false); d.reload(); hist.reload(); } }}>YES, SAVE NEW PRICES</button><button className="btn" onClick={() => setConfirming(false)}>CANCEL</button></div>
      </Modal>}
    </section>
    <section className="card">
      <h2>What prospects see</h2>
      {d.data.packages.map((p: any) => <div key={p.code} style={{ marginBottom: 12 }}><b>{p.label}</b> — {p.priceText}<ul className="small" style={{ margin: '4px 0' }}>{p.includes.map((x: string) => <li key={x}>{x}</li>)}</ul></div>)}
      {can('revenue') && hist.data?.length ? <><h3>Price history</h3><ul className="list">{hist.data.map((h: any) => <li key={h.id}><span>Version {h.version_no}{h.note ? ' — ' + h.note : ''}</span><span className="small muted">{when(h.published_at)}{h.published_by ? ' · ' + h.published_by : ''}</span></li>)}</ul></> : null}
    </section>
  </div>;
}

const GRANT_LABEL: Record<string, string> = { revenue: 'See revenue & price history', pricing: 'Change default prices', integrations: 'Manage connections', providers: 'Change video provider', destructive: 'Permanent deletions', backup: 'Backups & imports' };
function Users() {
  const d = useLoad(() => get('/api/users'));
  const [adding, setAdding] = useState(false); const [f, setF] = useState({ displayName: '', email: '', role: 'admin', password: '' });
  const a = useAction();
  if (d.loading && !d.data) return <Loading />;
  if (d.error) return <LoadError error={d.error} retry={d.reload} />;
  const upd = (id: string, body: any, msg: string) => a.run(async () => { await patch(`/api/users/${id}`, body); d.reload(); }, msg);
  return <section className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>People with access</h2><button className="btn next" onClick={() => setAdding(true)}>+ ADD PERSON</button></div>
    <p className="help">Everyone gets their own login — never share yours. Your developer should be an Admin. Turning someone off keeps their history.</p>
    <div className="scroll-x"><table className="t"><thead><tr><th>Name</th><th>Role</th><th>Extra permissions</th><th>Status</th><th></th></tr></thead><tbody>
      {d.data!.map((u: any) => <tr key={u.id}><td><b>{u.displayName}</b><div className="small muted">{u.email}{u.lastLoginAt ? ' · last sign-in ' + when(u.lastLoginAt) : ''}</div></td>
        <td><select value={u.role} onChange={(e) => upd(u.id, { role: e.target.value }, 'Role changed.')} aria-label="Role"><option value="super_user">Super User</option><option value="admin">Admin</option><option value="user">User</option></select></td>
        <td>{u.role === 'super_user' ? <span className="muted small">Everything</span> : Object.keys(GRANT_LABEL).filter((g) => u.role === 'admin' || g === 'revenue').map((g) =>
          <label key={g} className="check small" style={{ margin: '2px 0', fontWeight: 500 }}><input type="checkbox" checked={u.grants.includes(g)} onChange={(e) => upd(u.id, { grants: e.target.checked ? [...u.grants, g] : u.grants.filter((x: string) => x !== g) }, 'Permissions updated.')} />{GRANT_LABEL[g]}</label>)}
          {u.elevatedUntil && new Date(u.elevatedUntil) > new Date() && <div className="badge warn">Temporary: {u.elevatedGrants.join(', ')} until {when(u.elevatedUntil)}</div>}</td>
        <td>{u.status === 'active' ? <span className="badge ok">Active</span> : <span className="badge bad">Turned off</span>}</td>
        <td className="row">
          {u.status === 'active' ? <button className="btn small danger" onClick={() => confirm(`Turn off access for ${u.displayName}? They are signed out immediately. Their history is kept.`) && upd(u.id, { status: 'disabled' }, 'Access turned off.')}>TURN OFF ACCESS</button>
            : <button className="btn small" onClick={() => upd(u.id, { status: 'active' }, 'Access turned on.')}>TURN ON ACCESS</button>}
          {u.role === 'admin' && u.status === 'active' && <button className="btn small" onClick={() => a.run(async () => { await post(`/api/users/${u.id}/elevate`, { grants: ['backup', 'integrations', 'providers'], hours: 24 }); d.reload(); }, 'Temporary access granted for 24 hours.')}>24-HOUR DEVELOPER ACCESS</button>}
        </td></tr>)}
    </tbody></table></div>
    <Msg error={a.error} ok={a.ok} />
    {adding && <Modal title="Add a person" onClose={() => setAdding(false)}>
      <Field label="Name"><input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
      <Field label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Role" help="Admin: your developer or a trusted helper. User: day-to-day work only."><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="admin">Admin</option><option value="user">User</option><option value="super_user">Super User</option></select></Field>
      <Field label="Temporary password" help="Give it to them privately. They must choose their own at first sign-in."><input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      <div className="actions"><button className="btn next" disabled={a.busy} onClick={async () => { if (await a.run(() => post('/api/users', f), 'Account created.')) { setAdding(false); setF({ displayName: '', email: '', role: 'admin', password: '' }); d.reload(); } }}>CREATE ACCOUNT</button></div>
      <Msg error={a.error} />
    </Modal>}
  </section>;
}

const SECRET_LABEL: Record<string, string> = { 'square.access_token': 'Square access token', 'square.location_id': 'Square location ID', 'square.webhook_signature_key': 'Square webhook signature key',
  'vimeo.access_token': 'Vimeo access token', 'heygen.api_key': 'HeyGen API key', 'email.api_key': 'Email service key', 'sms.api_key': 'Text message service key' };
function Integrations() {
  const d = useLoad(() => get('/api/integrations'));
  const [val, setVal] = useState<Record<string, string>>({}); const a = useAction();
  if (d.loading && !d.data) return <Loading />;
  if (d.error) return <LoadError error={d.error} retry={d.reload} />;
  const tone = (s: string) => s === 'normal' ? 'ok' : s === 'not_configured' ? '' : s === 'attention' ? 'warn' : 'bad';
  return <div className="grid-2">
    <section className="card"><h2>Connections</h2>
      <ul className="list">{d.data.checks.map((c: any) => <li key={c.component}><div><b>{c.label}</b><div className="small muted">{c.ownerMessage}</div></div>
        <span className={'badge ' + tone(c.status)}>{c.status === 'normal' ? 'Connected' : c.status === 'not_configured' ? 'Not connected yet' : 'Needs attention'}</span></li>)}</ul>
    </section>
    <section className="card"><h2>Connection keys</h2>
      {!d.data.canEdit ? <p className="muted">Only the Super User (or someone given "Manage connections") can enter keys.</p> : <>
        <p className="help">Paste each key from the provider's website. Keys are stored encrypted and are never shown again — not here, not in demos, not in support reports.</p>
        {d.data.secrets.map((s: any) => <div key={s.name} style={{ marginBottom: 10 }}>
          <label>{SECRET_LABEL[s.name] ?? s.name} {s.set ? <span className="badge ok">Saved {s.hint}</span> : <span className="badge">Not set</span>}</label>
          <div className="row"><input type="password" autoComplete="off" value={val[s.name] ?? ''} onChange={(e) => setVal({ ...val, [s.name]: e.target.value })} placeholder={s.set ? 'Paste a new key to replace' : 'Paste key'} style={{ flex: 1, minWidth: 200 }} />
            <button className="btn small" disabled={!val[s.name]} onClick={() => a.run(async () => { await put(`/api/integrations/secrets/${s.name}`, { value: val[s.name] }); setVal({ ...val, [s.name]: '' }); d.reload(); }, 'Saved securely.')}>SAVE</button>
            {s.set && <button className="btn small danger" onClick={() => confirm('Remove this key?') && a.run(async () => { await del(`/api/integrations/secrets/${s.name}`); d.reload(); }, 'Removed.')}>REMOVE</button>}</div>
        </div>)}
        <Msg error={a.error} ok={a.ok} />
      </>}
    </section>
  </div>;
}

const emptyItem = { title: '', description: '', industry: 'all', businessType: '', kind: 'website_video', purpose: '', durationS: 60, format: '16x9', mediaUrl: '', permissionState: 'owner_created', permissionEvidence: '', published: true };
function DemoLibrary() {
  const d = useLoad(() => get('/api/demo/library'));
  const [edit, setEdit] = useState<any>(null); const a = useAction();
  if (d.loading && !d.data) return <Loading />;
  if (d.error) return <LoadError error={d.error} retry={d.reload} />;
  return <section className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Demo Library</h2><button className="btn next" onClick={() => setEdit({ ...emptyItem })}>+ ADD DEMO ITEM</button></div>
    <p className="help">One library feeds the iPad demo, the Zoom demo and every Demo Link. Client videos can be shown only with the client's recorded permission.</p>
    <ul className="list">{d.data!.map((x: any) => <li key={x.id}><div><b>{x.title}</b> {x.published ? <span className="badge ok">Shown</span> : <span className="badge">Hidden</span>}
      <div className="small muted">{x.industry === 'all' ? 'All industries' : INDUSTRIES.find((i) => i.value === x.industry)?.label} · {x.kind.replace('_', ' ')}{x.duration_s ? ` · ${x.duration_s} sec` : ''}{x.media_url ? ' · has video' : ' · description only'}</div></div>
      <button className="btn small" onClick={() => setEdit({ id: x.id, title: x.title, description: x.description ?? '', industry: x.industry, businessType: x.business_type ?? '', kind: x.kind, purpose: x.purpose ?? '', durationS: x.duration_s, format: x.format ?? '', mediaUrl: x.media_url ?? '', permissionState: x.permission_state, permissionEvidence: x.permission_evidence ?? '', published: x.published })}>EDIT</button></li>)}</ul>
    {edit && <Modal title={edit.id ? 'Edit demo item' : 'Add demo item'} onClose={() => setEdit(null)}>
      <Field label="Title"><input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
      <Field label="Description"><textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
      <div className="grid">
        <Field label="Industry"><select value={edit.industry} onChange={(e) => setEdit({ ...edit, industry: e.target.value })}><option value="all">All industries</option>{INDUSTRIES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}</select></Field>
        <Field label="Type"><select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}><option value="website_video">Website video</option><option value="social">Social video</option><option value="email">Email video</option><option value="quick_video">Quick video</option><option value="sample_script">Sample script</option></select></Field>
        <Field label="Length (seconds)"><select value={edit.durationS ?? ''} onChange={(e) => setEdit({ ...edit, durationS: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{[15, 30, 60, 90, 120].map((n) => <option key={n}>{n}</option>)}</select></Field>
        <Field label="Format"><select value={edit.format ?? ''} onChange={(e) => setEdit({ ...edit, format: e.target.value || null })}><option value="16x9">Landscape 16:9</option><option value="9x16">Vertical 9:16</option><option value="1x1">Square 1:1</option></select></Field>
      </div>
      <Field label="Video link (optional)" help="A Vimeo or YouTube link starting with https://"><input value={edit.mediaUrl} onChange={(e) => setEdit({ ...edit, mediaUrl: e.target.value })} /></Field>
      <Field label="Whose work is this?"><select value={edit.permissionState} onChange={(e) => setEdit({ ...edit, permissionState: e.target.value })}>
        <option value="owner_created">My own sample (BrittVideo-made)</option><option value="client_permission_granted">A client's video — they gave permission</option><option value="permission_pending">A client's video — permission not yet given</option></select></Field>
      {edit.permissionState === 'client_permission_granted' && <Field label="How did the client give permission?"><input value={edit.permissionEvidence} onChange={(e) => setEdit({ ...edit, permissionEvidence: e.target.value })} placeholder="Signed release 9/30" /></Field>}
      <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={edit.published} onChange={(e) => setEdit({ ...edit, published: e.target.checked })} /> Show this to prospects</label>
      <div className="actions"><button className="btn next" disabled={a.busy} onClick={async () => { const body = { ...edit, mediaUrl: edit.mediaUrl || null }; if (await a.run(() => edit.id ? put(`/api/demo/library/${edit.id}`, body) : post('/api/demo/library', body))) { setEdit(null); d.reload(); } }}>SAVE</button></div>
      <Msg error={a.error} />
    </Modal>}
  </section>;
}

const n = (c: number, w: string) => `${c} ${w}${c === 1 ? '' : 's'}`;
function ImportV2() {
  const [result, setResult] = useState<any>(null); const a = useAction();
  return <section className="card">
    <h2>Bring in your work from BrittVideo V2</h2>
    <ol>
      <li>Open <b>BrittVideo V2.11.23</b> on the computer where you did your work.</li>
      <li>Press <b>EXPORT ALL DATA FOR UPGRADE</b> (top bar). A file named <code>BrittVideo_ALL_DATA_….json</code> is saved.</li>
      <li>Press <b>CHOOSE EXPORT FILE</b> below and pick that file.</li>
    </ol>
    <p className="help">A backup is made first. Importing the same file twice does nothing the second time. Approvals are brought over only where V2 recorded them, and a Complete Video Kit approval only if its content still matches.</p>
    <label className="btn next" style={{ display: 'inline-flex' }}>CHOOSE EXPORT FILE
      <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={async (e) => {
        const file = e.target.files?.[0]; if (!file) return; const text = await file.text(); e.target.value = '';
        const r = await a.run(() => api('POST', '/api/migration/prototype', text)); if (r) setResult(r);
      }} /></label>
    {a.busy && <p className="muted">Importing… this can take a minute.</p>}
    <Msg error={a.error} />
    {result && <div className={'notice ' + (result.alreadyImported ? '' : 'ok')} style={{ marginTop: 14 }}>
      <b>{result.alreadyImported ? 'This file was already imported — nothing changed.' : 'Import complete.'}</b>
      <ul><li>{n(result.prospects, 'prospect')}, {n(result.clients, 'client')}</li><li>{n(result.projects, 'video kit project')}, {n(result.quickVideos, 'quick video')}, {n(result.scenes, 'scene')}</li>
        <li>{n(result.sceneApprovals, 'scene approval')}, {n(result.kitApprovalsCarried, 'Complete Video Kit approval')} (verified)</li><li>{n(result.images, 'library image')}</li></ul>
      {result.notes?.length > 0 && <><b>Please note:</b><ul>{result.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></>}
    </div>}
  </section>;
}
