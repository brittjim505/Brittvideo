import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, post, money, newKey } from '../../shared/api';
import { useLoad, useAction, useSession, Msg, Field, Loading, LoadError, Status, packageLabel } from '../ui';
import { BusinessFields, emptyBiz, type BizForm } from './Prospects';

/**
 * Record a sale from the Mac (Zoom follow-up, phone, email or returning client — M1, M18, M20). It creates the same
 * central Client + Order + Agreement + Project records as the iPad signup, with a deal-specific price if needed.
 */
export function NewSale() {
  const [params] = useSearchParams();
  const orderParam = params.get('order');
  const prospectParam = params.get('prospect');
  const clientParam = params.get('client');
  const { can } = useSession();
  const pricing = useLoad(() => get('/api/pricing'));
  const [f, setF] = useState<BizForm>(emptyBiz);
  const [pkg, setPkg] = useState<'standard' | 'premier'>('standard');
  const [override, setOverride] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [agreeName, setAgreeName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [saleKey] = useState(newKey);
  const [orderId, setOrderId] = useState<string | null>(orderParam);
  const [clientName, setClientName] = useState<string>('');
  const a = useAction();
  useEffect(() => { document.title = 'Record a Sale — BrittVideo'; }, []);
  useEffect(() => {
    if (prospectParam) get(`/api/prospects/${prospectParam}`).then((p) => setF({ businessName: p.business_name, websiteUrl: p.website_url ?? '', industry: p.industry, businessType: p.business_type ?? '', contactName: p.contact_name ?? '', email: p.email ?? '', phone: p.phone ?? '', privateNotes: '' })).catch(() => {});
    if (clientParam) get(`/api/clients/${clientParam}`).then((c) => { setClientName(c.client.business_name); setF({ businessName: c.client.business_name, websiteUrl: c.client.website_url ?? '', industry: c.client.industry, businessType: c.client.business_type ?? '', contactName: c.client.contact_name ?? '', email: c.client.email ?? '', phone: c.client.phone ?? '', privateNotes: '' }); }).catch(() => {});
  }, [prospectParam, clientParam]);
  const pk = useMemo(() => pricing.data?.packages.find((p: any) => p.code === pkg), [pricing.data, pkg]);

  if (orderId) return <PaymentStep orderId={orderId} />;
  if (pricing.loading && !pricing.data) return <Loading />;
  if (pricing.error) return <LoadError error={pricing.error} retry={pricing.reload} />;
  const overrides = Object.fromEntries(Object.entries(override).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, { agreedCents: Math.round(Number(v.replace(/[$,]/g, '')) * 100), reason }]));
  const codes: string[] = pk ? pk.lines.map((l: any) => l.code) : [];
  return <>
    <div className="pagehead"><div><h1>Record a Sale</h1><p className="muted">For Zoom follow-ups, phone or email sales, and returning clients. Creates the client, order, agreement and project in one step.</p></div></div>
    <section className="card">
      <h2>1. Business</h2>
      {clientName ? <p>Returning client: <b>{clientName}</b> — no duplicate record will be made.</p> : <BusinessFields f={f} set={setF} showNotes={false} />}
      <h2 style={{ marginTop: 20 }}>2. Package</h2>
      <div className="grid">{pricing.data.packages.map((p: any) => <label key={p.code} className="card" style={{ cursor: 'pointer', boxShadow: 'none', borderColor: pkg === p.code ? 'var(--blue)' : undefined, margin: 0 }}>
        <div className="row"><input type="radio" name="pkg" checked={pkg === p.code} onChange={() => setPkg(p.code)} style={{ width: 22, minHeight: 0 }} /><b style={{ fontSize: 19 }}>{p.label}</b></div>
        <div className="metric" style={{ fontSize: 24, marginTop: 6 }}>{p.priceText}</div><p className="muted small">{p.summary}</p></label>)}</div>
      {can('revenue') && <details style={{ marginTop: 14 }}><summary><b>Deal-specific price (optional)</b></summary>
        <p className="help">Changes this sale only. Default prices and past sales are not affected. The list price is kept with the sale for history.</p>
        <div className="grid">{codes.map((code) => { const it = pricing.data.items[code]; return <Field key={code} label={`${it.label} — list ${money(it.amount_cents)}${it.billing === 'monthly' ? '/month' : ''}`}>
          <input inputMode="decimal" placeholder={String((it.amount_cents ?? 0) / 100)} value={override[code] ?? ''} onChange={(e) => setOverride({ ...override, [code]: e.target.value })} /></Field>; })}</div>
        <Field label="Reason (optional)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Referral discount" /></Field>
      </details>}
      <h2 style={{ marginTop: 20 }}>3. Agreement</h2>
      <p className="muted small">The client's agreement text (with the exact price) is stored with the order as evidence. Type the name of the person who agreed.</p>
      <Field label="Agreed by (full name)"><input value={agreeName} onChange={(e) => setAgreeName(e.target.value)} /></Field>
      <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> The client accepted the {packageLabel(pkg)} agreement</label>
      <div className="actions"><button className={'btn ' + (agreed && agreeName ? 'next' : '')} disabled={a.busy || !agreed || !agreeName} onClick={async () => {
        const r = await a.run(() => post('/api/sales', { saleKey, channel: 'manual', package: pkg, clientId: clientParam || undefined, prospectId: prospectParam || undefined,
          business: f, overrides: Object.keys(overrides).length ? overrides : undefined, agreement: { accepted: true, name: agreeName, email: f.email } }));
        if (r) setOrderId(r.orderId);
      }}>CREATE SALE</button></div>
      <Msg error={a.error} />
    </section>
  </>;
}

function PaymentStep({ orderId }: { orderId: string }) {
  const o = useLoad(() => get(`/api/orders/${orderId}`), [orderId]);
  const [note, setNote] = useState(''); const [key] = useState(newKey); const a = useAction();
  if (o.loading && !o.data) return <Loading />;
  if (o.error) return <LoadError error={o.error} retry={o.reload} />;
  const d = o.data;
  return <section className="card">
    <h1>Order {d.order_number} — {d.business_name}</h1>
    <p><Status s={d.status} /> {packageLabel(d.package)} · due today <b>{money(d.dueTodayCents)}</b>{d.monthlyCents ? <> · then <b>{money(d.monthlyCents)}/month</b></> : null}</p>
    {d.status === 'paid' ? <div className="notice ok"><b>Paid.</b> The project is on your Command Center as New Client — Ready to Start.
      <div className="actions"><Link className="btn next" to="/">GO TO COMMAND CENTER</Link></div></div> : <>
      <div className="notice">Square card payments arrive in a later phase. For now, record payments you receive by check, cash or invoice here.</div>
      <Field label="How was it paid?" help='For example "Check #1042" or "Square invoice 5531".'><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="actions"><button className={'btn ' + (note ? 'next' : '')} disabled={!note || a.busy} onClick={async () => {
        if (await a.run(() => post(`/api/orders/${orderId}/manual-payment`, { attemptKey: key, amountCents: d.dueTodayCents, note }), 'Payment recorded.')) o.reload();
      }}>RECORD PAYMENT OF {money(d.dueTodayCents)}</button><Link className="btn" to="/">DO THIS LATER</Link></div>
    </>}
    <Msg error={a.error} ok={a.ok} />
  </section>;
}
