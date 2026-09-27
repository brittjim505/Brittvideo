import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { get, post, patch, INDUSTRIES, industryLabel, day } from '../../shared/api';
import { useAutosave, loadDraft, saveLabel } from '../../shared/autosave';
import { useLoad, useAction, Msg, Field, Loading, LoadError, Status, Modal } from '../ui';
import { startDemo, DemoLinkMaker } from './DemoSales';

export interface BizForm { businessName: string; websiteUrl: string; industry: string; businessType: string; contactName: string; email: string; phone: string; privateNotes: string }
export const emptyBiz: BizForm = { businessName: '', websiteUrl: '', industry: 'senior_care', businessType: '', contactName: '', email: '', phone: '', privateNotes: '' };

export function BusinessFields({ f, set, showNotes = true }: { f: BizForm; set: (f: BizForm) => void; showNotes?: boolean }) {
  const u = (k: keyof BizForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set({ ...f, [k]: e.target.value });
  return <>
    <div className="grid">
      <Field label="Business / facility name"><input value={f.businessName} onChange={u('businessName')} placeholder="Morada Quintessence" /></Field>
      <Field label="Website"><input value={f.websiteUrl} onChange={u('websiteUrl')} placeholder="example.com" inputMode="url" /></Field>
      <Field label="Industry"><select value={f.industry} onChange={u('industry')}>{INDUSTRIES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}</select></Field>
      {f.industry === 'other' && <Field label="Type of business" help="For example Plumbing, HVAC, Real Estate, Restaurant."><input value={f.businessType} onChange={u('businessType')} /></Field>}
    </div>
    <div className="grid">
      <Field label="Contact name"><input value={f.contactName} onChange={u('contactName')} placeholder="Executive Director" /></Field>
      <Field label="Email"><input type="email" value={f.email} onChange={u('email')} /></Field>
      <Field label="Phone"><input type="tel" value={f.phone} onChange={u('phone')} /></Field>
    </div>
    {showNotes && <Field label="Private notes" help="Only you see these. They are never shown in a demo."><textarea value={f.privateNotes} onChange={u('privateNotes')} /></Field>}
  </>;
}

export function Prospects() {
  const [params, setParams] = useSearchParams();
  const [f, setF] = useState<BizForm>(emptyBiz);
  const [restored, setRestored] = useState(false);
  const [rev, setRev] = useState<number | null>(null);
  const save = useAutosave('prospect-form', f, { enabled: restored, initialRevision: rev });
  const add = useAction();
  const act = useAction();
  const list = useLoad(() => get('/api/prospects'));
  const [editing, setEditing] = useState<any>(null);
  const [linkFor, setLinkFor] = useState<any>(null);
  const nav = useNavigate();
  useEffect(() => { document.title = 'Prospects — BrittVideo'; loadDraft<BizForm>('prospect-form').then((d) => { if (d.value) setF({ ...emptyBiz, ...d.value }); setRev(d.revision); setRestored(true); }); }, []);
  const ready = f.businessName.trim() && (f.industry !== 'other' || f.businessType.trim());
  const open = params.get('open');
  useEffect(() => { if (open && list.data) { const p = list.data.find((x: any) => x.id === open); if (p) setEditing(p); } }, [open, list.data]);

  return <>
    <div className="pagehead"><div><h1>Prospects</h1><p className="muted">Add a prospect before or during a sales visit. Duplicates are never created.</p></div></div>
    <section className="card">
      <h2>Add a prospect</h2>
      <BusinessFields f={f} set={setF} />
      <div className="actions">
        <button className={'btn ' + (ready ? 'next' : '')} disabled={!ready || add.busy} onClick={async () => {
          const r = await add.run(() => post('/api/prospects', f));
          if (r) { add.setOk(r.created ? `${r.prospect.business_name} was added.` : `${r.prospect.business_name} is already in your list — no duplicate was added.`); setF(emptyBiz); await save.clear(); list.reload(); setParams({}); }
        }}>ADD PROSPECT</button>
        <span className={'savestate ' + (['retrying', 'offline', 'conflict'].includes(save.state) ? 'warn' : '')}>{saveLabel(save.state)}</span>
      </div>
      <Msg error={add.error} ok={add.ok} />
    </section>

    <section className="card">
      <h2>Your prospects</h2>
      {list.loading && !list.data ? <Loading /> : list.error ? <LoadError error={list.error} retry={list.reload} /> :
        list.data!.length === 0 ? <p className="empty">No prospects yet.</p> :
        <ul className="list">{list.data!.map((p: any) => <li key={p.id}>
          <div style={{ minWidth: 240 }}><b>{p.business_name}</b> <Status s={p.status} />
            <div className="small muted">{industryLabel(p.industry, p.business_type)}{p.website_url ? ' · ' + p.website_url.replace(/^https?:\/\//, '') : ''} · added {day(p.created_at)}</div></div>
          <div className="row">
            <button className="btn small next" disabled={act.busy} onClick={() => act.run(() => startDemo('ipad_in_person', { prospectId: p.id }))}>IPAD DEMO</button>
            <button className="btn small" disabled={act.busy} onClick={() => act.run(() => startDemo('mac_zoom', { prospectId: p.id }))}>ZOOM DEMO</button>
            <button className="btn small" onClick={() => setLinkFor(p)}>DEMO LINK</button>
            <button className="btn small" onClick={() => nav(`/sale?prospect=${p.id}`)}>RECORD A SALE</button>
            <button className="btn small" onClick={() => setEditing(p)}>EDIT</button>
          </div></li>)}</ul>}
      <Msg error={act.error} />
    </section>
    {editing && <EditProspect p={editing} onClose={() => { setEditing(null); setParams({}); list.reload(); }} />}
    {linkFor && <Modal title={`Demo link for ${linkFor.business_name}`} onClose={() => setLinkFor(null)}><DemoLinkMaker prospectId={linkFor.id} /></Modal>}
  </>;
}

function EditProspect({ p, onClose }: { p: any; onClose: () => void }) {
  const [f, setF] = useState<BizForm>({ businessName: p.business_name, websiteUrl: p.website_url ?? '', industry: p.industry, businessType: p.business_type ?? '', contactName: p.contact_name ?? '', email: p.email ?? '', phone: p.phone ?? '', privateNotes: p.private_notes ?? '' });
  const a = useAction();
  return <Modal title="Edit prospect" onClose={onClose}>
    <BusinessFields f={f} set={setF} />
    <div className="actions">
      <button className="btn next" disabled={a.busy} onClick={async () => { if (await a.run(() => patch(`/api/prospects/${p.id}`, f))) onClose(); }}>SAVE CHANGES</button>
      <button className="btn danger" disabled={a.busy} onClick={async () => { if (confirm(`Archive ${p.business_name}? It stays in history and can be found by search.`) && await a.run(() => post(`/api/prospects/${p.id}/archive`))) onClose(); }}>ARCHIVE PROSPECT</button>
      <Link className="btn" to={`/sale?prospect=${p.id}`}>RECORD A SALE</Link>
    </div>
    <Msg error={a.error} />
  </Modal>;
}
