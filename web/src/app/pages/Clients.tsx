import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, patch, post, industryLabel, money, day, when } from '../../shared/api';
import { useLoad, useAction, useSession, Msg, Field, Loading, LoadError, Status, packageLabel, Modal } from '../ui';
import { BusinessFields, type BizForm } from './Prospects';

export function Clients() {
  const [q, setQ] = useState('');
  const list = useLoad(() => get('/api/clients' + (q ? '?q=' + encodeURIComponent(q) : '')), [q]);
  useEffect(() => { document.title = 'Clients — BrittVideo'; }, []);
  return <>
    <div className="pagehead"><div><h1>Clients</h1><p className="muted">One durable record per client, with every order, project and preference.</p></div>
      <input type="search" placeholder="Find a client" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} /></div>
    <section className="card">
      {list.loading && !list.data ? <Loading /> : list.error ? <LoadError error={list.error} retry={list.reload} /> :
        list.data!.length === 0 ? <p className="empty">No clients yet. Clients appear here when a prospect signs up or you record a sale.</p> :
        <ul className="list">{list.data!.map((c: any) => <li key={c.id}>
          <div><Link to={`/clients/${c.id}`}><b>{c.business_name}</b></Link>
            <div className="small muted">{industryLabel(c.industry, c.business_type)} · {c.project_count} project(s){c.latest_package ? ' · ' + packageLabel(c.latest_package) : ''}</div></div>
          <div className="row">{c.premier_status && <span className="badge info">Premier: {c.premier_status.replace('_', ' ')}</span>}
            <span className="small muted">Marketing</span> <Status s={c.marketing_status} /></div></li>)}</ul>}
    </section>
  </>;
}

export function ClientDetail() {
  const { id } = useParams();
  const { can } = useSession();
  const d = useLoad(() => get(`/api/clients/${id}`), [id]);
  const hist = useLoad(() => get(`/api/audit?entityType=client&entityId=${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [mkt, setMkt] = useState(false);
  useEffect(() => { if (d.data) document.title = d.data.client.business_name + ' — BrittVideo'; }, [d.data]);
  if (d.loading && !d.data) return <Loading />;
  if (d.error) return <LoadError error={d.error} retry={d.reload} />;
  const { client: c, orders, projects, premier } = d.data;
  return <>
    <div className="pagehead"><div><h1>{c.business_name}</h1><p className="muted">Client #{c.client_number} · {industryLabel(c.industry, c.business_type)} · since {day(c.created_at)}</p></div>
      <div className="row"><Link className="btn next" to={`/sale?client=${c.id}`}>SELL MORE WORK</Link><button className="btn" onClick={() => setEditing(true)}>EDIT DETAILS</button></div></div>
    <div className="grid-2">
      <section className="card">
        <h2>Details</h2>
        <dl className="kv">
          <dt>Website</dt><dd>{c.website_url ? <a href={c.website_url} target="_blank" rel="noreferrer">{c.website_url}</a> : '—'}</dd>
          <dt>Contact</dt><dd>{c.contact_name ?? '—'}</dd><dt>Email</dt><dd>{c.email ?? '—'}</dd><dt>Phone</dt><dd>{c.phone ?? '—'}</dd>
          <dt>Came from</dt><dd>{({ demo_ipad: 'In-person iPad demo', demo_zoom: 'Mac / Zoom demo', demo_link: 'Demo link', manual: 'Recorded sale', migration: 'Imported from V2' } as any)[c.source] ?? c.source}</dd>
          {c.private_notes && <><dt>Private notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{c.private_notes}</dd></>}
        </dl>
      </section>
      <section className="card">
        <h2>Marketing messages</h2>
        <p><Status s={c.marketing_status} /> <span className="small muted">since {when(c.marketing_changed_at)}{c.marketing_reason ? ' — ' + c.marketing_reason : ''}</span></p>
        <p className="help">Service messages about their projects are always allowed. Marketing is sent only while Active, and an unsubscribe is honored automatically.</p>
        <button className="btn" onClick={() => setMkt(true)}>CHANGE MARKETING PREFERENCE</button>
        {premier.length > 0 && <><h2 style={{ marginTop: 18 }}>Premier</h2>{premier.map((m: any) => <p key={m.id}><Status s={m.status} /> {m.started_at ? 'started ' + day(m.started_at) : ''}{m.cancelled_at ? ' · cancelled ' + day(m.cancelled_at) : ''}</p>)}</>}
      </section>
    </div>
    <section className="card"><h2>Projects</h2>
      {projects.length === 0 ? <p className="empty">No projects yet.</p> : <ul className="list">{projects.map((p: any) => <li key={p.id}>
        <div><Link to={`/projects/${p.id}`}><b>{p.title}</b></Link><div className="small muted">#{p.project_number} · {day(p.created_at)}{p.included_in_premier ? ' · Included in Premier' : ''}</div></div><Status s={p.status} /></li>)}</ul>}
    </section>
    <section className="card"><h2>Orders</h2>
      {orders.length === 0 ? <p className="empty">No orders recorded.</p> : <div className="scroll-x"><table className="t"><thead><tr><th>Order</th><th>Date</th><th>Package</th><th>Status</th><th>{can('revenue') ? 'Prices (list → sold)' : 'Items'}</th></tr></thead><tbody>
        {orders.map((o: any) => <tr key={o.id}><td>{o.order_number}</td><td>{day(o.created_at)}</td><td>{packageLabel(o.package)}</td><td><Status s={o.status} />{o.status !== 'paid' && <> <Link to={`/sale?order=${o.id}`}>record payment</Link></>}</td>
          <td>{(o.lines ?? []).map((l: any, i: number) => <div key={i}>{l.label}{l.soldCents != null ? `: ${l.listCents !== l.soldCents ? money(l.listCents) + ' → ' : ''}${money(l.soldCents)}${l.billing === 'monthly' ? '/mo' : ''}` : ''}{l.overrideReason ? <span className="muted small"> ({l.overrideReason})</span> : null}</div>)}</td></tr>)}
      </tbody></table></div>}
    </section>
    <section className="card"><h2>History</h2>
      {hist.data?.length ? <ul className="list">{hist.data.map((h: any) => <li key={h.id}><span>{h.summary}</span><span className="small muted">{h.actor_label} · {when(h.at)}</span></li>)}</ul> : <p className="empty">No history yet.</p>}
    </section>
    {editing && <EditClient c={c} onClose={() => { setEditing(false); d.reload(); hist.reload(); }} />}
    {mkt && <MarketingModal c={c} onClose={() => { setMkt(false); d.reload(); hist.reload(); }} />}
  </>;
}

function EditClient({ c, onClose }: { c: any; onClose: () => void }) {
  const [f, setF] = useState<BizForm>({ businessName: c.business_name, websiteUrl: c.website_url ?? '', industry: c.industry, businessType: c.business_type ?? '', contactName: c.contact_name ?? '', email: c.email ?? '', phone: c.phone ?? '', privateNotes: c.private_notes ?? '' });
  const a = useAction();
  return <Modal title="Edit client details" onClose={onClose}><BusinessFields f={f} set={setF} />
    <div className="actions"><button className="btn next" disabled={a.busy} onClick={async () => { if (await a.run(() => patch(`/api/clients/${c.id}`, f))) onClose(); }}>SAVE CHANGES</button></div><Msg error={a.error} /></Modal>;
}

function MarketingModal({ c, onClose }: { c: any; onClose: () => void }) {
  const [status, setStatus] = useState(c.marketing_status); const [reason, setReason] = useState(''); const [evidence, setEvidence] = useState(''); const a = useAction();
  const leavingUnsub = c.marketing_status === 'unsubscribed' && status !== 'unsubscribed';
  return <Modal title="Marketing preference" onClose={onClose}>
    <Field label="Marketing messages"><select value={status} onChange={(e) => setStatus(e.target.value)}>
      <option value="active">Active — send helpful updates</option><option value="paused">Paused — hold marketing for now</option><option value="unsubscribed">Unsubscribed — never send marketing</option></select></Field>
    <Field label="Reason (optional)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    {leavingUnsub && <Field label="How did the client ask to be resubscribed?" help="Required. An unsubscribe can only be reversed at the client's own request."><input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Client emailed on 10/2 asking for updates" /></Field>}
    <div className="actions"><button className="btn next" disabled={a.busy} onClick={async () => { if (await a.run(() => post(`/api/clients/${c.id}/marketing`, { status, reason, resubscribeEvidence: evidence || undefined }))) onClose(); }}>SAVE PREFERENCE</button></div>
    <Msg error={a.error} />
  </Modal>;
}
