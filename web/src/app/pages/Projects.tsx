import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, patch, post, put, when, day } from '../../shared/api';
import { useLoad, useAction, Msg, Loading, LoadError, Status, packageLabel, Modal, Field } from '../ui';

const FORMAT: Record<string, string> = { '16x9': 'Landscape 16:9', '9x16': 'Vertical 9:16', '1x1': 'Square 1:1' };
const KIND: Record<string, string> = { video_kit: 'Video Kit', quick_video: 'Quick Video', email_video: 'Email Video', premier_quarterly: 'Premier quarterly', provider_test: 'Provider test' };

export function Projects() {
  const [status, setStatus] = useState('');
  const list = useLoad(() => get('/api/projects' + (status ? '?status=' + status : '')), [status]);
  useEffect(() => { document.title = 'Projects — BrittVideo'; }, []);
  return <>
    <div className="pagehead"><div><h1>Projects</h1><p className="muted">Every video project, with approval status calculated from the real approvals.</p></div>
      <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 260 }} aria-label="Filter by status">
        <option value="">All open projects</option><option value="ready_to_start">New — Ready to Start</option><option value="in_progress">In Progress</option>
        <option value="approved">Complete Kit Approved</option><option value="delivered">Delivered</option></select></div>
    <section className="card">
      {list.loading && !list.data ? <Loading /> : list.error ? <LoadError error={list.error} retry={list.reload} /> :
        list.data!.length === 0 ? <p className="empty">No projects match.</p> :
        <ul className="list">{list.data!.map((p: any) => <li key={p.id}>
          <div><Link to={`/projects/${p.id}`}><b>{p.business_name ?? '—'}</b></Link><div className="small muted">#{p.project_number} · {KIND[p.kind]} · {p.title}{p.package ? ' · ' + packageLabel(p.package) : ''}{p.source === 'migration' ? ' · imported from V2' : ''}</div></div>
          <div className="row">{p.order_status && p.order_status !== 'paid' && <Status s={p.order_status} />}<Status s={p.status} /></div></li>)}</ul>}
    </section>
  </>;
}

export function ProjectDetail() {
  const { id } = useParams();
  const d = useLoad(() => get(`/api/projects/${id}`), [id]);
  const cps = useLoad(() => get(`/api/projects/${id}/checkpoints`), [id]);
  const a = useAction();
  const [edit, setEdit] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (d.data) document.title = (d.data.project.business_name ?? 'Project') + ' — BrittVideo'; }, [d.data]);
  if (d.loading && !d.data) return <Loading />;
  if (d.error) return <LoadError error={d.error} retry={d.reload} />;
  const { project: p, status: st, scenes, production, invalidations } = d.data;
  const reload = () => { d.reload(); cps.reload(); };
  const approve = (type: string, sid: string | undefined, expectedHash: string) => a.run(async () => { await post(`/api/projects/${id}/approve`, { type, id: sid, expectedHash }); reload(); });
  const totalScenes = st.deliverables.reduce((s: number, x: any) => s + x.sceneCount, 0);
  const approvedScenes = st.deliverables.reduce((s: number, x: any) => s + x.approvedCount, 0);
  return <>
    <div className="pagehead"><div><h1>{p.business_name}</h1><p className="muted">Project #{p.project_number} · {KIND[p.kind]} · {p.title}{p.order_number ? ` · Order ${p.order_number}` : ''}</p></div>
      <div className="row"><Status s={p.status} />{p.client_id && <Link className="btn" to={`/clients/${p.client_id}`}>OPEN CLIENT</Link>}</div></div>

    {p.status === 'ready_to_start' && <div className="notice ok" style={{ marginBottom: 14 }}><b>New Client — Ready to Start.</b> Everything from the sale is here: business, website, industry and package. Build the videos in V2.11.23 for now; the Builder moves into this app in Phase 3.</div>}
    {production?.status === 'needs_reapproval' && <div className="notice warn" style={{ marginBottom: 14 }}><b>Changes were made after final approval.</b> Review the highlighted scenes, approve them, then approve the Complete Video Kit again.</div>}

    <section className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Approvals</h2>
        {st.completeVideoKitApproved ? <span className="badge ok" style={{ fontSize: 15 }}>✓ COMPLETE VIDEO KIT APPROVED</span> :
          <button className={'btn ' + (st.readyForFinalApproval ? 'next' : '')} disabled={!st.readyForFinalApproval || a.busy} onClick={() => approve('kit', undefined, st.compositeHash)}>APPROVE COMPLETE VIDEO KIT</button>}</div>
      {totalScenes > 0 && <div style={{ margin: '12px 0' }}><div className="progress" aria-label="Scenes approved"><span style={{ width: `${Math.round(100 * approvedScenes / totalScenes)}%` }} /></div>
        <p className="small muted" style={{ marginTop: 4 }}>{approvedScenes} of {totalScenes} scenes approved</p></div>}
      <div className="scroll-x"><table className="t"><thead><tr><th>Video</th><th>Length</th><th>Formats</th><th>Approved</th><th></th></tr></thead><tbody>
        {st.deliverables.map((x: any) => <tr key={x.id}><td><b>{x.label}</b></td><td>{x.durationS} sec</td><td>{x.formats.map((f: string) => FORMAT[f]).join(' · ')}</td>
          <td>{x.sceneCount ? `${x.approvedCount}/${x.sceneCount} scenes` : x.hasContent ? (x.scriptApproved ? 'Script approved' : 'Script not approved') : <span className="muted">Not built yet</span>} {x.complete ? <span className="badge ok">✓</span> : null}</td>
          <td>{(x.sceneCount > 0 || x.hasContent) && <button className="btn small" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? 'HIDE' : 'REVIEW'}</button>}</td></tr>)}
      </tbody></table></div>
      {totalScenes === 0 && st.deliverables.every((x: any) => !x.hasContent) && <p className="help">Scripts and scenes are created in the Builder. Nothing can show as approved until real content exists and is approved.</p>}
      <Msg error={a.error} />
    </section>

    {st.deliverables.filter((x: any) => x.id === open).map((x: any) => <section className="card" key={x.id}>
      <h2>{x.label} — review</h2>
      {x.sceneCount === 0 && <DeliverableScript projectId={id!} d={d.data.deliverables.find((z: any) => z.id === x.id)} approved={x.scriptApproved} onChange={reload} />}
      <div className="stack">{scenes.filter((s: any) => s.deliverable_id === x.id).map((s: any) => { const ss = x.scenes.find((y: any) => y.id === s.id); return (
        <div key={s.id} className={'scene ' + (ss.approved ? 'approved' : ss.wasApprovedEarlier ? 'changed' : '')}>
          <div className="row between"><b>Scene {s.position} — {s.name}</b><span className="small muted">{s.start_s}–{s.end_s} sec</span></div>
          {s.image_ref?.title && <div className="small muted">Image: {s.image_ref.title}{s.image_ref.sourceNote ? ' · ' + s.image_ref.sourceNote : ''}</div>}
          <div style={{ marginTop: 6 }}><b className="small">Visual:</b> {s.visual}</div>
          <div><b className="small">Narration:</b> “{s.narration}”</div>
          {ss.wasApprovedEarlier && <div className="small" style={{ color: 'var(--amber)', fontWeight: 700 }}>Changed since it was approved — approve again.</div>}
          <div className="actions" style={{ marginTop: 8 }}>
            {ss.approved ? <span className="badge ok">✓ Approved</span> : <button className="btn small next" disabled={a.busy} onClick={() => approve('scene', s.id, s.content_hash)}>APPROVE SCENE</button>}
            <button className="btn small" onClick={() => setEdit(s)}>REWRITE SCENE</button>
          </div>
        </div>); })}</div>
    </section>)}

    <div className="grid-2">
      <section className="card"><h2>Production &amp; delivery</h2>
        <dl className="kv"><dt>Status</dt><dd>{({ not_started: 'Not started', needs_reapproval: 'Changes made — reapproval required', approved: 'Approved for production', package_downloaded: 'Production package downloaded', delivered: 'Delivery recorded' } as any)[production?.status] ?? production?.status}</dd>
          {production?.approved_at && <><dt>Approved</dt><dd>{when(production.approved_at)}</dd></>}
          {production?.package_downloaded_at && <><dt>Package downloaded</dt><dd>{when(production.package_downloaded_at)}</dd></>}
          {production?.delivered_at && <><dt>Delivered</dt><dd>{when(production.delivered_at)} {production.delivery_method ? '· ' + production.delivery_method : ''}</dd></>}</dl>
        <p className="help">Production through the AI video provider arrives in Phase 4; delivery and downloads in Phase 5.</p>
      </section>
      <section className="card"><h2>Saved versions (checkpoints)</h2>
        <p className="help">BrittVideo saves a version at every important step. Restoring never invents an approval — approvals follow the exact words that were approved.</p>
        {cps.data?.length ? <ul className="list">{cps.data.slice(0, 12).map((c: any) => <li key={c.id}><div><b className="small">{c.reason}</b><div className="small muted">{when(c.created_at)} · {c.created_by_label}</div></div>
          {!c.stage.startsWith('prototype') && <button className="btn small" disabled={a.busy} onClick={() => confirm('Go back to this saved version? A safety copy of the current version is saved first.') && a.run(async () => { await post(`/api/projects/${id}/checkpoints/${c.id}/restore`); reload(); }, 'Restored.')}>RESTORE</button>}</li>)}</ul> : <p className="empty">No saved versions yet.</p>}
        {invalidations.length > 0 && <><h3 style={{ marginTop: 12 }}>Approval changes</h3><ul className="list">{invalidations.slice(0, 8).map((v: any, i: number) => <li key={i}><span className="small">{v.reason}</span><span className="small muted">{day(v.at)}</span></li>)}</ul></>}
      </section>
    </div>
    {edit && <EditScene projectId={id!} s={edit} onClose={() => { setEdit(null); reload(); }} />}
  </>;
}

function EditScene({ projectId, s, onClose }: { projectId: string; s: any; onClose: () => void }) {
  const [visual, setVisual] = useState(s.visual); const [narration, setNarration] = useState(s.narration); const a = useAction();
  return <Modal title={`Rewrite scene ${s.position} — ${s.name}`} onClose={onClose}>
    <p className="help">Changing approved words removes that scene's approval (and the final kit approval) until you approve again.</p>
    <Field label="Scene visualization"><textarea value={visual} onChange={(e) => setVisual(e.target.value)} /></Field>
    <Field label="Narration — the words spoken"><textarea value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
    <div className="actions"><button className="btn next" disabled={a.busy} onClick={async () => { if (await a.run(() => patch(`/api/projects/${projectId}/scenes/${s.id}`, { visual, narration }))) onClose(); }}>SAVE SCENE</button></div>
    <Msg error={a.error} />
  </Modal>;
}

function DeliverableScript({ projectId, d, approved, onChange }: { projectId: string; d: any; approved: boolean; onChange: () => void }) {
  const [text, setText] = useState(d?.script_text ?? ''); const a = useAction();
  return <div>
    <Field label="Script" help="Editing an approved script removes its approval until you approve it again."><textarea style={{ minHeight: 220, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 14 }} value={text} onChange={(e) => setText(e.target.value)} /></Field>
    <div className="actions">
      <button className="btn" disabled={a.busy || text === d.script_text} onClick={() => a.run(async () => { await put(`/api/projects/${projectId}/deliverables/${d.id}/script`, { text }); onChange(); }, 'Script saved.')}>SAVE SCRIPT</button>
      {approved ? <span className="badge ok">✓ Script approved</span> : <button className="btn next" disabled={a.busy || !text.trim() || text !== d.script_text} onClick={() => a.run(async () => { await post(`/api/projects/${projectId}/approve`, { type: 'script', id: d.id, expectedHash: d.script_hash }); onChange(); })}>APPROVE SCRIPT</button>}
    </div>
    <Msg error={a.error} ok={a.ok} />
  </div>;
}
