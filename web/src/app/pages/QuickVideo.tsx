import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { get, post } from '../../shared/api';
import { useLoad, useAction, Msg, Field } from '../ui';

const PURPOSE_HELP: Record<string, string> = {
  'Thank You After Service': 'A warm post-service courtesy: appreciation first, with no hard sell.',
  'Follow-Up / Check-In': 'A friendly check-in: ask how things are going and offer help.',
  'Review Request': 'Thank the customer first, then politely invite an honest review — no pressure or incentives.',
  'Referral Request': 'Thank the customer first, then gently mention that referrals are appreciated.',
  'Promotion': 'One clear offer and one simple next step. Enter the offer details below.',
  'Announcement': 'One clear business update with a simple next step.',
  'Seasonal': 'A warm seasonal message with an optional light call to action.',
  'Email Video': 'A standalone email-friendly video — no full Standard package needed.',
};

/** QUICK VIDEO — BUILD ONE VIDEO (K12, K13, K15). */
export function QuickVideo() {
  const [params] = useSearchParams();
  const clients = useLoad(() => get('/api/clients'));
  const prospects = useLoad(() => get('/api/prospects'));
  const [f, setF] = useState({ who: params.get('client') ? 'c:' + params.get('client') : '', purpose: 'Thank You After Service', delivery: 'Email', lengthSecs: 15, tone: 'Warm & Emotional',
    customer: '', service: '', provider: '', message: '', promotionDetails: '' });
  const a = useAction(); const nav = useNavigate();
  useEffect(() => { document.title = 'Quick Video — BrittVideo'; }, []);
  useEffect(() => { if (f.purpose === 'Email Video' && f.delivery !== 'Email') setF({ ...f, delivery: 'Email' }); }, [f.purpose]);  // eslint-disable-line
  const u = (k: string) => (e: any) => setF({ ...f, [k]: k === 'lengthSecs' ? Number(e.target.value) : e.target.value });
  const ready = f.who && (f.purpose !== 'Promotion' || f.promotionDetails.trim());
  return <>
    <div className="pagehead"><div><h1>Quick Video — Build One Video</h1><p className="muted">One purpose-built customer video, without building the full four-video kit.</p></div></div>
    <section className="card">
      <Field label="Who is it for?"><select value={f.who} onChange={u('who')}><option value="">— Choose a client or prospect —</option>
        <optgroup label="Clients">{(clients.data ?? []).map((c: any) => <option key={c.id} value={'c:' + c.id}>{c.business_name}</option>)}</optgroup>
        <optgroup label="Prospects">{(prospects.data ?? []).map((p: any) => <option key={p.id} value={'p:' + p.id}>{p.business_name}</option>)}</optgroup></select></Field>
      <div className="grid">
        <Field label="Purpose"><select value={f.purpose} onChange={u('purpose')}>{Object.keys(PURPOSE_HELP).map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Delivery"><select value={f.delivery} onChange={u('delivery')} disabled={f.purpose === 'Email Video'}><option>Email</option><option>Text / SMS Link</option><option>Website / Social</option></select></Field>
        <Field label="Length"><select value={f.lengthSecs} onChange={u('lengthSecs')}>{[15, 30, 60, 90, 120].map((n) => <option key={n} value={n}>{n} seconds</option>)}</select></Field>
        <Field label="Tone"><select value={f.tone} onChange={u('tone')}>{['Warm & Emotional', 'Professional', 'Friendly', 'Educational', 'Energetic', 'Premium / Cinematic'].map((t) => <option key={t}>{t}</option>)}</select></Field>
      </div>
      <div className="notice" style={{ marginTop: 12 }}><b>{f.purpose}:</b> {PURPOSE_HELP[f.purpose]}</div>
      <h2 style={{ marginTop: 18 }}>Personalize this video <span className="muted small">(optional)</span></h2>
      <div className="grid">
        <Field label="Customer first name"><input value={f.customer} onChange={u('customer')} placeholder="Mary" /></Field>
        <Field label="Service provided"><input value={f.service} onChange={u('service')} placeholder="Dental cleaning, repair, consultation…" /></Field>
        <Field label="Provider / employee name"><input value={f.provider} onChange={u('provider')} placeholder="Dr. Smith, Alex, your care team…" /></Field>
      </div>
      <Field label="Special message"><textarea value={f.message} onChange={u('message')} placeholder="Anything personal you would like included." /></Field>
      {f.purpose === 'Promotion' && <Field label="Promotion / offer details" help="Describe the offer, deadline and call to action."><textarea value={f.promotionDetails} onChange={u('promotionDetails')} placeholder="Schedule a tour this month and receive a complimentary moving-planning guide." /></Field>}
      <div className="actions"><button className={'btn ' + (ready ? 'next' : '')} disabled={!ready || a.busy} onClick={async () => {
        const [kind, id] = f.who.split(':');
        const r = await a.run(() => post('/api/quick-videos', { ...f, clientId: kind === 'c' ? id : null, prospectId: kind === 'p' ? id : null }));
        if (r) nav(`/projects/${r.projectId}`);
      }}>BUILD QUICK VIDEO</button></div>
      <Msg error={a.error} />
    </section>
  </>;
}
