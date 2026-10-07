import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { get, post, put } from '../shared/api';
import { SessionCtx, type Me, Msg, useAction, Field } from './ui';
import { SupportModal } from './Support';
import { CommandCenter } from './pages/CommandCenter';
import { Prospects } from './pages/Prospects';
import { DemoSales } from './pages/DemoSales';
import { Clients, ClientDetail } from './pages/Clients';
import { Projects, ProjectDetail } from './pages/Projects';
import { NewSale } from './pages/NewSale';
import { Settings } from './pages/Settings';
import { SystemHealth } from './pages/SystemHealth';
import { Builder } from './pages/Builder';
import { ImageLibrary } from './pages/Images';
import { QuickVideo } from './pages/QuickVideo';
import { SIZES, currentSize, applySize, type SizeKey } from '../shared/textsize';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'setup' | 'signin' | 'locked' | 'ready'>('loading');
  const [support, setSupport] = useState<{ open: boolean; area?: string }>({ open: false });
  const [env, setEnv] = useState('');

  const refresh = useCallback(async () => {
    try {
      const r = await get('/api/auth/me');
      setMe(r.user); setEnv(r.env); setState(r.locked ? 'locked' : 'ready');
    } catch {
      try { const s = await get('/api/setup/status'); setEnv(s.env); setState(s.needsFirstUser ? 'setup' : 'signin'); } catch { setState('signin'); }
      setMe(null);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const lock = () => setState('locked'); const out = () => { setMe(null); setState('signin'); };
    window.addEventListener('bv:locked', lock); window.addEventListener('bv:signed-out', out);
    return () => { window.removeEventListener('bv:locked', lock); window.removeEventListener('bv:signed-out', out); };
  }, []);

  const ctx = { me, refresh, can: (p: string) => !!me?.permissions.includes(p), openSupport: (area?: string) => setSupport({ open: true, area }) };
  if (state === 'loading') return <main><p className="muted">Opening BrittVideo…</p></main>;
  if (state === 'setup') return <FirstRun onDone={refresh} />;
  if (state === 'signin') return <SignIn onDone={refresh} env={env} />;
  if (state === 'locked') return <SessionCtx.Provider value={ctx}><Locked onDone={refresh} />{support.open && <SupportModal area={support.area} onClose={() => setSupport({ open: false })} />}</SessionCtx.Provider>;
  return (
    <SessionCtx.Provider value={ctx}>
      <Shell env={env} />
      {support.open && <SupportModal area={support.area} onClose={() => setSupport({ open: false })} />}
    </SessionCtx.Provider>
  );
}

function Shell({ env }: { env: string }) {
  const { me, openSupport, can } = React.useContext(SessionCtx);
  const nav = useNavigate(); const loc = useLocation();
  const [q, setQ] = useState(''); const [results, setResults] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [healthTick, setHealthTick] = useState(0);
  useEffect(() => { const f = () => setHealthTick((n) => n + 1); window.addEventListener('bv:health-changed', f); return () => window.removeEventListener('bv:health-changed', f); }, []);
  useEffect(() => { get('/api/health').then((h) => setHealth(h.summary)).catch(() => setHealth(null)); }, [loc.pathname, healthTick]);
  useEffect(() => { // Continue Working (L5)
    const label = document.title;
    put('/api/activity', { route: '/app' + loc.pathname + loc.search, label }).catch(() => {});
  }, [loc.pathname, loc.search]);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => get('/api/search?q=' + encodeURIComponent(q)).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  const pill = !health ? null : health.overall === 'normal'
    ? <span className="status-pill ok" title="Work Saved & Protected · Systems Normal"><span className="dot" />{health.workSavedAndProtected ? 'Work Saved & Protected' : 'Systems Normal'}</span>
    : <button className={'status-pill ' + (health.overall === 'support_needed' ? 'bad' : 'warn')} style={{ border: 0, cursor: 'pointer' }} onClick={() => nav('/health')}><span className="dot" />{health.headline}</button>;
  return (
    <>
      <header className="topbar">
        <a className="logo" href="/app"><svg width="22" height="22" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="7" fill="#1f2937" /><path d="M12 9.5v13l11-6.5z" fill="#22c55e" /></svg>BrittVideo</a>
        {env !== 'live' && <span className="badge warn">{env.toUpperCase()} — test data only</span>}
        {pill}
        <div className="spacer" />
        <div style={{ position: 'relative' }}>
          <input type="search" placeholder="Search clients, prospects, projects" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          {results.length > 0 && <div className="card" style={{ position: 'absolute', right: 0, top: 50, width: 360, zIndex: 30, padding: 8 }}>
            {results.map((r) => <button key={r.type + r.id} className="btn small" style={{ width: '100%', justifyContent: 'flex-start', border: 0 }} onClick={() => { setQ(''); nav(r.route.replace(/^\/app/, '')); }}>
              <span className="badge">{r.type}</span> {r.label}</button>)}
          </div>}
        </div>
        <TextSize />
        <button className="btn support small" onClick={() => openSupport()}>GET SUPPORT</button>
        <span className="user">{me?.displayName} · {me?.roleLabel}</span>
        <button className="btn small" onClick={async () => { await post('/api/auth/logout'); location.href = '/app'; }}>Sign out</button>
      </header>
      <nav className="navbar" aria-label="Main">
        <NavLink to="/" end>Command Center</NavLink>
        <NavLink to="/prospects">Prospects</NavLink>
        <NavLink to="/demo">Demo &amp; Sales</NavLink>
        <NavLink to="/clients">Clients</NavLink>
        <NavLink to="/projects">Projects</NavLink>
        <NavLink to="/quick">Quick Video</NavLink>
        <NavLink to="/images">Image Library</NavLink>
        <NavLink to="/health">System Health</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
      <main>
        {me?.mustChangePassword && <ChangePasswordBanner />}
        <Routes>
          <Route path="/" element={<CommandCenter />} />
          <Route path="/prospects" element={<Prospects />} />
          <Route path="/demo" element={<DemoSales />} />
          <Route path="/sale" element={<NewSale />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/projects/:id/build" element={<Builder />} />
          <Route path="/quick" element={<QuickVideo />} />
          <Route path="/images" element={<ImageLibrary />} />
          <Route path="/health" element={<SystemHealth />} />
          <Route path="/settings/*" element={<Settings />} />
          <Route path="*" element={<div className="card"><h1>Page not found</h1><p><a href="/app">Go to the Command Center</a></p></div>} />
        </Routes>
        {!can('work') && <p className="muted">Your account has limited access.</p>}
      </main>
    </>
  );
}

/** Text size: A / A+ / A++ (remembered on this device). */
function TextSize() {
  const [size, setSize] = useState<SizeKey>(currentSize());
  return <span className="textsize" role="group" aria-label="Text size">{SIZES.map((s) =>
    <button key={s.key} className={size === s.key ? 'on' : ''} aria-pressed={size === s.key} title={'Text size ' + s.label} onClick={() => { applySize(s.key); setSize(s.key); }}>{s.label}</button>)}</span>;
}

function ChangePasswordBanner() {
  const [open, setOpen] = useState(false); const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const a = useAction();
  const { refresh } = React.useContext(SessionCtx);
  return <div className="notice warn" style={{ marginBottom: 16 }}>
    <b>Please choose your own password.</b> This account was set up with a temporary one.
    {!open ? <div className="actions"><button className="btn next" onClick={() => setOpen(true)}>CHANGE MY PASSWORD</button></div> :
      <form onSubmit={async (e) => { e.preventDefault(); if (await a.run(() => post('/api/auth/password', { currentPassword: cur, newPassword: pw }), 'Password changed.')) refresh(); }}>
        <Field label="Current (temporary) password"><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
        <Field label="New password" help="At least 12 characters. A short sentence you will remember works well."><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
        <div className="actions"><button className="btn next" disabled={a.busy}>SAVE NEW PASSWORD</button></div><Msg error={a.error} ok={a.ok} />
      </form>}
  </div>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main style={{ maxWidth: 480, paddingTop: 70 }}><div style={{ textAlign: 'center', marginBottom: 18 }}>
    <svg width="54" height="54" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="7" fill="#111827" /><path d="M12 9.5v13l11-6.5z" fill="#22c55e" /></svg>
    <h1 style={{ marginTop: 8 }}>BrittVideo</h1></div><div className="card">{children}</div></main>;
}

function SignIn({ onDone, env }: { onDone: () => void; env: string }) {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const a = useAction();
  return <Centered>
    <h2>Sign in</h2>
    {env && env !== 'live' && <p className="badge warn">{env.toUpperCase()} — test data only</p>}
    <form onSubmit={async (e) => { e.preventDefault(); if (await a.run(() => post('/api/auth/login', { email, password: pw }))) onDone(); }}>
      <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
      <Field label="Password"><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
      <div className="actions"><button className="btn next" style={{ width: '100%' }} disabled={a.busy}>SIGN IN</button></div>
      <Msg error={a.error} />
    </form>
    <p className="help" style={{ marginTop: 14 }}>Every person has their own login. Forgot your password? Ask the Super User to reset it.</p>
  </Centered>;
}

function FirstRun({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ displayName: '', email: '', password: '' }); const a = useAction();
  return <Centered>
    <h2>Welcome — set up BrittVideo</h2>
    <p className="muted">Create the owner's Super User account. This only happens once.</p>
    <form onSubmit={async (e) => { e.preventDefault(); if (await a.run(() => post('/api/setup/first-user', f))) onDone(); }}>
      <Field label="Your name"><input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} required /></Field>
      <Field label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
      <Field label="Password" help="At least 12 characters. A short sentence you will remember works well."><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" required /></Field>
      <div className="actions"><button className="btn next" disabled={a.busy}>CREATE MY SUPER USER ACCOUNT</button></div>
      <Msg error={a.error} />
    </form>
  </Centered>;
}

function Locked({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState(''); const a = useAction();
  return <Centered>
    <h2>BrittVideo is locked</h2>
    <p className="muted">A prospect demo was running on this device. Enter your password to return to your business information.</p>
    <form onSubmit={async (e) => { e.preventDefault(); if (await a.run(() => post('/api/auth/unlock', { password: pw }))) onDone(); }}>
      <Field label="Your password"><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></Field>
      <div className="actions"><button className="btn next" disabled={a.busy}>UNLOCK</button></div>
      <Msg error={a.error} />
    </form>
  </Centered>;
}
