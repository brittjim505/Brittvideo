import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/styles.css';
import './demo.css';
import { api, money, newKey, ApiError } from '../shared/api';

/**
 * PROSPECT-SAFE DEMO (B1, E1, G1, V13, Y15). This bundle is separate from the owner app and only talks to
 * /api/public/demo/<kind>/<token>, which returns an allow-listed public view. It has no access to the admin API.
 */
const m = location.pathname.match(/^\/demo\/(s|l)\/([A-Za-z0-9_-]+)/);
const base = m ? `/api/public/demo/${m[1]}/${m[2]}` : '';
const isInPerson = m?.[1] === 's';

type View = any;
function Demo() {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<'show' | 'signup' | 'pay' | 'welcome'>('show');
  const [order, setOrder] = useState<any>(null);
  const [pkg, setPkg] = useState<'standard' | 'premier' | 'quick_video'>('standard');
  useEffect(() => {
    if (!base) { setErr('This demo link is not complete. Please contact BrittVideo.'); return; }
    api('GET', base).then((x) => { setV(x); if (x.alreadySignedUp) api('GET', base + '/order').then((o) => { setOrder(o); setStep(o.status === 'paid' ? 'welcome' : 'pay'); }).catch(() => {}); })
      .catch((e) => setErr(e.message));
  }, []);
  if (err) return <div className="demo-wrap"><div className="card"><h1>BrittVideo</h1><p>{err}</p></div></div>;
  if (!v) return <div className="demo-wrap"><p className="muted">Loading…</p></div>;
  return <div className="demo-wrap">
    <header className="demo-hero">
      <div className="demo-brand">BrittVideo</div>
      <h1>{v.business.name} <span className="plus">+</span> BrittVideo</h1>
      <p>Custom video for {v.business.industryLabel === 'OTHER' ? 'your business' : v.business.industryLabel.toLowerCase()} — built from your own story, reviewed and approved by you.</p>
    </header>
    {step === 'show' && <Showcase v={v} onChoose={(p) => { setPkg(p); setStep('signup'); }} />}
    {step === 'signup' && <Signup v={v} pkg={pkg} setPkg={setPkg} onBack={() => setStep('show')} onDone={(o) => { setOrder(o); setStep(o.status === 'paid' ? 'welcome' : 'pay'); }} />}
    {step === 'pay' && order && <Pay order={order} onPaid={(o) => { setOrder(o); setStep('welcome'); }} />}
    {step === 'welcome' && order && <Welcome order={order} />}
    <footer className="demo-foot">
      {isInPerson && <a className="owner-exit" href="/app">Owner: exit demo</a>}
      <span>© BrittVideo · Albuquerque, New Mexico</span>
    </footer>
  </div>;
}

function Showcase({ v, onChoose }: { v: View; onChoose: (p: 'standard' | 'premier') => void }) {
  const [playing, setPlaying] = useState<any>(null);
  return <>
    <section className="demo-section">
      <h2>What you get</h2>
      <div className="grid">{v.offerings.map((o: any) => <div className="card" key={o.title}><h3>{o.title}</h3><p className="muted">{o.text}</p></div>)}</div>
    </section>
    {v.library.length > 0 && <section className="demo-section">
      <h2>Examples</h2>
      <div className="grid">{v.library.map((i: any) => <div className="card demo-item" key={i.id}>
        <div className="demo-thumb" aria-hidden>{i.format === '9x16' ? '9:16' : i.format === '1x1' ? '1:1' : '16:9'}</div>
        <h3>{i.title}</h3>
        <p className="muted small">{[i.kind === 'website_video' ? 'Website video' : i.kind === 'quick_video' ? 'Follow-up video' : i.kind === 'social' ? 'Social video' : i.kind === 'email' ? 'Email video' : 'Sample', i.durationS ? `${i.durationS} seconds` : null].filter(Boolean).join(' · ')}</p>
        <p>{i.description}</p>
        {i.mediaUrl && <button className="btn primary" onClick={() => setPlaying(i)}>▶ WATCH</button>}
      </div>)}</div>
    </section>}
    <section className="demo-section">
      <h2>Choose your package</h2>
      <div className="grid-2">{v.packages.map((p: any) => <div className={'card pkg ' + (p.code === 'premier' ? 'pkg-premier' : '')} key={p.code}>
        <h3 style={{ fontSize: 22 }}>{p.label}</h3>
        <div className="price">{p.priceText}</div>
        <p className="muted">{p.summary}</p>
        <ul>{p.includes.map((x: string) => <li key={x}>{x}</li>)}</ul>
        {v.allowSignup && <button className="btn next" style={{ width: '100%' }} onClick={() => onChoose(p.code)}>BECOME A CLIENT — {p.label.toUpperCase()}</button>}
      </div>)}</div>
      {!v.allowSignup && <p className="muted" style={{ marginTop: 12 }}>To get started, just reply to the message this link came in.</p>}
    </section>
    {playing && <div className="modal-back" onClick={() => setPlaying(null)}><div className="modal" style={{ width: 'min(960px,100%)' }} onClick={(e) => e.stopPropagation()}>
      <div className="row between"><h2 style={{ margin: 0 }}>{playing.title}</h2><button className="btn small" onClick={() => setPlaying(null)}>CLOSE</button></div>
      <VideoEmbed url={playing.mediaUrl} title={playing.title} /></div></div>}
  </>;
}

function VideoEmbed({ url, title }: { url: string; title: string }) {
  const src = useMemo(() => {
    const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/); if (vm) return { kind: 'iframe', src: `https://player.vimeo.com/video/${vm[1]}` };
    const yt = url.match(/(?:youtu\.be\/|v=)([\w-]{11})/); if (yt) return { kind: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}` };
    return { kind: 'video', src: url };
  }, [url]);
  return <div style={{ marginTop: 12, aspectRatio: '16 / 9', background: '#000', borderRadius: 10, overflow: 'hidden' }}>
    {src.kind === 'iframe' ? <iframe src={src.src} title={title} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen style={{ width: '100%', height: '100%', border: 0 }} />
      : <video src={src.src} controls playsInline style={{ width: '100%', height: '100%' }} />}
  </div>;
}

function Signup({ v, pkg, setPkg, onBack, onDone }: { v: View; pkg: 'standard' | 'premier' | 'quick_video'; setPkg: (p: any) => void; onBack: () => void; onDone: (o: any) => void }) {
  const [f, setF] = useState({ contactName: '', email: '', phone: '' });
  const [terms, setTerms] = useState<string>(''); const [termsSha, setTermsSha] = useState('');
  const [name, setName] = useState(''); const [agree, setAgree] = useState(false);
  const [saleKey] = useState(newKey); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api('GET', `${base}/terms?package=${pkg}`).then((t) => { setTerms(t.text); setTermsSha(t.sha256); }).catch(() => setTerms('')); setAgree(false); }, [pkg]);
  const chosen = v.packages.find((p: any) => p.code === pkg);
  const ready = f.contactName.trim() && /\S+@\S+\.\S+/.test(f.email) && name.trim() && agree;
  return <section className="demo-section"><div className="card" style={{ maxWidth: 720, margin: '0 auto' }}>
    <h2>Become a Client</h2>
    <p className="muted">We already have your business details — just a few things about you.</p>
    <dl className="kv"><dt>Business</dt><dd><b>{v.business.name}</b></dd>{v.business.website && <><dt>Website</dt><dd>{v.business.website.replace(/^https?:\/\//, '')}</dd></>}
      <dt>Package</dt><dd><select value={pkg} onChange={(e) => setPkg(e.target.value)} style={{ maxWidth: 360 }}>{v.packages.map((p: any) => <option key={p.code} value={p.code}>{p.label} — {p.priceText}</option>)}</select></dd></dl>
    <div className="grid">
      <div><label htmlFor="d-yourname">Your name</label><input id="d-yourname" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} autoComplete="name" /></div>
      <div><label htmlFor="d-email">Email</label><input id="d-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" inputMode="email" /></div>
      <div><label htmlFor="d-phoneoptional">Phone (optional)</label><input id="d-phoneoptional" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></div>
    </div>
    <label style={{ marginTop: 18 }}>Agreement — {chosen?.label}</label>
    <pre className="report" style={{ fontFamily: 'inherit', fontSize: 15, maxHeight: 240 }}>{terms || 'Loading agreement…'}</pre>
    <div><label htmlFor="d-typeyourfullnametosign">Type your full name to sign</label><input id="d-typeyourfullnametosign" value={name} onChange={(e) => setName(e.target.value)} /></div>
    <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I have read and agree to the {chosen?.label} agreement</label>
    <div className="actions">
      <button className={'btn ' + (ready ? 'next' : '')} disabled={!ready || busy} onClick={async () => {
        setBusy(true); setErr(null);
        try { onDone(await api('POST', `${base}/signup`, { saleKey, package: pkg, ...f, agreementAccepted: agree, agreementName: name, termsSha256: termsSha })); }
        catch (e: any) {
          setErr(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
          if (e?.code === 'terms_changed') api('GET', `${base}/terms?package=${pkg}`).then((t) => { setTerms(t.text); setTermsSha(t.sha256); setAgree(false); }).catch(() => {});
        } finally { setBusy(false); }
      }}>{busy ? 'Saving…' : 'CONTINUE TO PAYMENT'}</button>
      <button className="btn" onClick={onBack}>BACK</button>
    </div>
    {err && <div className="notice bad" style={{ marginTop: 12 }}>{err}</div>}
  </div></section>;
}

function Pay({ order, onPaid }: { order: any; onPaid: (o: any) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(newKey); const lastOutcome = React.useRef<string | null>(null);
  const test = order.paymentOptions.includes('test');
  const pay = async (outcome: 'approve' | 'decline') => {
    const key = outcome === lastOutcome.current ? attempt : newKey(); lastOutcome.current = outcome; if (key !== attempt) setAttempt(key);
    setBusy(true); setErr(null);
    try { const o = await api('POST', `${base}/pay`, { attemptKey: key, testOutcome: outcome });
      if (o.status === 'paid') onPaid(o); else { setErr('The card was declined. Please try a different card.'); setAttempt(newKey()); lastOutcome.current = null; } }
    // Keep the same attempt after a network or server problem so a retry resumes it instead of paying twice.
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return <section className="demo-section"><div className="card" style={{ maxWidth: 620, margin: '0 auto' }}>
    <h2>Payment</h2>
    <table className="t"><tbody>{order.lines.map((l: any, i: number) => <tr key={i}><td>{l.label}</td><td style={{ textAlign: 'right' }}>{money(l.amountCents)}{l.billing === 'monthly' ? ' / month' : ''}</td></tr>)}
      <tr><td><b>Due today</b></td><td style={{ textAlign: 'right' }}><b>{money(order.dueTodayCents)}</b></td></tr></tbody></table>
    {order.monthlyCents > 0 && <p className="muted small">Your Premier membership of {money(order.monthlyCents)} per month starts today. Cancel anytime.</p>}
    {test ? <>
      <div className="notice warn" style={{ marginTop: 12 }}><b>Test mode</b> — no real card is charged. (Secure Square card payment replaces this screen in live use.)</div>
      <div className="actions"><button className="btn next" disabled={busy} onClick={() => pay('approve')}>PAY {money(order.dueTodayCents)} WITH TEST CARD</button>
        <button className="btn" disabled={busy} onClick={() => pay('decline')}>SIMULATE A DECLINED CARD</button></div>
    </> : <div className="notice ok" style={{ marginTop: 12 }}><b>You're all set.</b> BrittVideo will send you a secure payment link by email. You never need to share card details over the phone or on a video call.</div>}
    {err && <div className="notice bad" style={{ marginTop: 12 }}>{err}</div>}
  </div></section>;
}

function Welcome({ order }: { order: any }) {
  return <section className="demo-section"><div className="card welcome" style={{ maxWidth: 680, margin: '0 auto', textAlign: 'center' }}>
    <div className="welcome-mark" aria-hidden>✓</div>
    <h2 style={{ fontSize: 30 }}>Welcome to BrittVideo!</h2>
    <p style={{ fontSize: 19 }}>Thank you, {order.businessName}. Your {order.package === 'premier' ? 'Premier' : order.package === 'quick_video' ? 'One-Off Video' : 'Standard'} video project is set up and ready to start.</p>
    <p className="muted">Next: Jim reviews your website and sends your video story and scripts for your approval. Nothing is finalized until you approve it.</p>
    <p className="muted small">Order {order.orderNumber}</p>
  </div></section>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Demo /></React.StrictMode>);
