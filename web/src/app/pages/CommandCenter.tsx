import React from 'react';
import { Link } from 'react-router-dom';
import { get, money, when, day } from '../../shared/api';
import { useLoad, Loading, LoadError, Status, packageLabel, useSession } from '../ui';

/** Command Center (L1–L20): what needs attention today, with one click to the exact work. */
export function CommandCenter() {
  const { data, error, loading, reload } = useLoad(() => get('/api/command-center'));
  const { can } = useSession();
  React.useEffect(() => { document.title = 'Command Center — BrittVideo'; }, []);
  if (loading && !data) return <Loading what="Loading your Command Center" />;
  if (error) return <LoadError error={error} retry={reload} />;
  const d = data!;
  const attention = d.awaitingPayment.length + d.reapproval.length + d.newClients.length;
  const problems = d.healthChecks.filter((c: any) => ['attention', 'support_needed'].includes(c.status));
  return <>
    <div className="pagehead">
      <div><h1>Command Center</h1><p className="muted">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p></div>
      <div className="row">
        <Link className="btn next" to="/prospects?new=1">+ NEW PROSPECT</Link>
        <Link className="btn" to="/demo">START A DEMO</Link>
        <Link className="btn" to="/sale">RECORD A SALE</Link>
      </div>
    </div>

    <div className={'notice ' + (d.health.overall === 'normal' ? 'ok' : d.health.overall === 'support_needed' ? 'bad' : 'warn')} style={{ marginBottom: 14 }}>
      <b>{d.health.workSavedAndProtected ? '✓ Work Saved & Protected' : 'Work is saved, but protection needs attention'}</b>
      {' · '}<b>{d.health.headline}</b>
      {problems.length > 0 && <ul style={{ margin: '8px 0 0' }}>{problems.map((p: any) => <li key={p.component}>{p.label}: {p.ownerMessage}</li>)}</ul>}
      {problems.length > 0 && <div className="actions"><Link className="btn small" to="/health">OPEN SYSTEM HEALTH</Link></div>}
    </div>

    {d.continueWorking && d.continueWorking.route !== '/app/' && d.continueWorking.route !== '/app' && (
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row between"><div><h3>Continue where you left off</h3><p className="muted small">{d.continueWorking.label} · {when(d.continueWorking.updated_at)}</p></div>
          <a className="btn primary" href={d.continueWorking.route}>CONTINUE</a></div>
      </div>)}

    <div className="grid-2">
      <section className="card">
        <h2>Needs attention today {attention > 0 && <span className="badge warn">{attention}</span>}</h2>
        {attention === 0 && <p className="empty">Nothing is waiting on you right now.</p>}
        <ul className="list">
          {d.newClients.map((x: any) => <li key={x.project_id}><div><b>{x.business_name}</b><div className="small muted">New Client — Ready to Start · {packageLabel(x.package)} · {day(x.created_at)}</div></div>
            <Link className="btn next small" to={`/projects/${x.project_id}`}>OPEN PROJECT</Link></li>)}
          {d.awaitingPayment.map((x: any) => <li key={x.order_id}><div><b>{x.business_name}</b><div className="small muted">Order {x.order_number} · {packageLabel(x.package)} · <Status s={x.status} /></div></div>
            <Link className="btn small" to={`/sale?order=${x.order_id}`}>RECORD PAYMENT</Link></li>)}
          {d.reapproval.map((x: any) => <li key={x.project_id}><div><b>{x.title}</b><div className="small muted">Changes were made after final approval — reapproval required</div></div>
            <Link className="btn small" to={`/projects/${x.project_id}`}>REVIEW</Link></li>)}
        </ul>
      </section>

      <section className="card">
        <h2>Production</h2>
        {d.inProgress.length === 0 && <p className="empty">No projects in progress.</p>}
        <ul className="list">{d.inProgress.slice(0, 8).map((x: any) => <li key={x.project_id}>
          <div><b>{x.business_name}</b><div className="small muted">{x.title}</div></div>
          <div className="row"><Status s={x.status} /><Link className="btn small" to={`/projects/${x.project_id}`}>OPEN</Link></div></li>)}</ul>
        <p className="help">Standard formats tracked per project: Website · Landscape 16:9 · Vertical 9:16 · Square 1:1 · Email.</p>
      </section>

      <section className="card">
        <h2>Sales</h2>
        <div className="row"><div className="metric">{d.prospectCount}</div><div className="muted">open prospects</div></div>
        <div className="actions"><Link className="btn" to="/prospects">OPEN PROSPECTS</Link><Link className="btn" to="/demo">DEMO &amp; SALES</Link></div>
      </section>

      <section className="card">
        <h2>Premier — quarterly videos</h2>
        {d.upcomingPremier.length === 0 ? <p className="empty">No quarterly videos due in the next 30 days.</p> :
          <ul className="list">{d.upcomingPremier.map((x: any, i: number) => <li key={i}><b>{x.business_name}</b><span>Due {day(x.due_at)}</span></li>)}</ul>}
        <p className="help">The quarterly schedule is calculated from each client's actual Premier start date (automatic scheduling arrives in Phase 7).</p>
      </section>

      <section className="card">
        <h2>Quick Video</h2>
        <p className="muted">Thank You · Follow-Up · Review Request · Referral Request · Promotion · Announcement · Seasonal · Email Video — 15 to 120 seconds.</p>
        <p className="help">The Builder moves into this app in Phase 3. Until then, build Quick Videos in BrittVideo V2.11.23 as usual.</p>
      </section>

      {can('revenue') && d.revenue && <section className="card">
        <h2>Revenue snapshot</h2>
        <div className="grid">
          <div><div className="metric">{money(d.revenue.month_one_time_cents)}</div><div className="muted small">paid project sales this month</div></div>
          <div><div className="metric">{money(d.revenue.active_monthly_cents)}</div><div className="muted small">active Premier per month</div></div>
        </div>
        <p className="help">A simple snapshot from actual sold prices — not accounting.</p>
      </section>}
    </div>
  </>;
}
