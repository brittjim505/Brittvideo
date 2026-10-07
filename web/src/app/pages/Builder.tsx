import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { get, post, patch, put, when } from '../../shared/api';
import { useLoad, useAction, Msg, Field, Loading, LoadError, Modal, Status } from '../ui';
import { ImagePicker, uploadFiles } from './Images';

const STEPS = ['SELECT CLIENT', 'ANALYZE WEBSITE', 'REVIEW IMAGES', 'CHOOSE STORY', 'BUILD VIDEOS', 'REVIEW SCENES', 'APPROVE', 'DOWNLOAD'];
const HELP = [
  'The client and their website come from the sale — nothing to retype.',
  'BrittVideo reads the client’s website and lists facts with where each came from. Keep only what is true and useful.',
  'Choose the pictures BrittVideo may use. Mark anything unsuitable as Do Not Use.',
  'Choose the story, tone and length of the Website Video.',
  'Build the five videos: Website, Social Portrait, Social Landscape, Thank-You and Email.',
  'Read each scene. Rewrite words or change pictures, then approve each scene.',
  'When every scene is approved, approve the Complete Video Kit.',
  'Download the approved kit, send it to the client, then record the delivery.',
];
const FORMAT: Record<string, string> = { '16x9': 'Landscape 16:9', '9x16': 'Vertical 9:16', '1x1': 'Square 1:1' };

export function Builder() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const d = useLoad(() => get(`/api/projects/${id}/builder`), [id]);
  const a = useAction();
  useEffect(() => { if (d.data) document.title = `Builder — ${d.data.project.business_name}`; }, [d.data]);
  // Pin the step once the Builder opens, so finishing work on a step never jumps the owner past what they just did.
  const pinned = React.useRef(false);
  useEffect(() => { if (d.data && !pinned.current) { pinned.current = true; if (!params.get('step')) setParams({ step: String(autoStep(d.data)) }, { replace: true }); } }, [d.data]);  // eslint-disable-line
  if (d.loading && !d.data) return <Loading what="Opening the Builder" />;
  if (d.error) return <LoadError error={d.error} retry={d.reload} />;
  const b = d.data;
  const st = b.status;
  const done = doneSteps(b);
  const go = (n: number) => { setParams({ step: String(n) }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const reload = () => d.reload();
  const step = Math.min(8, Math.max(1, Number(params.get('step')) || autoStep(b)));

  return <>
    <div className="pagehead"><div><h1>{b.project.business_name}</h1><p className="muted">{b.project.title} · <Status s={b.project.status} /></p></div>
      <Link className="btn" to={`/projects/${id}`}>PROJECT DETAILS</Link></div>
    <nav className="steps" aria-label="Builder steps">
      {STEPS.map((s, i) => <button key={s} className={'step ' + (i + 1 === step ? 'active ' : '') + (done[i] ? 'done' : '')} onClick={() => go(i + 1)} aria-current={i + 1 === step ? 'step' : undefined}>
        <span className="num">{done[i] ? '✓' : i + 1}</span>{s}</button>)}
    </nav>
    <div className="card" style={{ marginBottom: 14 }}>
      <p className="youarehere">YOU ARE HERE: STEP {step} OF 8 — {STEPS[step - 1]}</p>
      <p className="muted" style={{ margin: 0 }}>{HELP[step - 1]}</p>
    </div>
    {step === 1 && <StepClient b={b} next={() => go(2)} />}
    {step === 2 && <StepWebsite b={b} reload={reload} next={() => go(3)} />}
    {step === 3 && <StepImages b={b} reload={reload} next={() => go(4)} />}
    {step === 4 && <StepStory b={b} reload={reload} next={() => go(5)} />}
    {step === 5 && <StepBuild b={b} reload={reload} next={() => go(6)} />}
    {step === 6 && <StepReview b={b} reload={reload} next={() => go(7)} />}
    {step === 7 && <StepApprove b={b} reload={reload} next={() => go(8)} />}
    {step === 8 && <StepDownload b={b} reload={reload} />}
    <Msg error={a.error} />
  </>;
}

function doneSteps(b: any): boolean[] {
  const st = b.status; const scenesExist = b.scenes.length > 0;
  return [true, b.facts.some((f: any) => f.selected), scenesExist || b.images.some((i: any) => i.selected) || b.project.workflow_step >= 4,
    !!b.project.story, scenesExist, st.allComponentsApproved, st.completeVideoKitApproved,
    b.production?.status === 'delivered' || (b.production?.status === 'package_downloaded' && st.completeVideoKitApproved)];
}
function autoStep(b: any) { const i = doneSteps(b).findIndex((x) => !x); return i === -1 ? 8 : i + 1; }

function StepClient({ b, next }: { b: any; next: () => void }) {
  const p = b.project;
  return <section className="card">
    <dl className="kv"><dt>Business</dt><dd><b>{p.business_name}</b></dd><dt>Website</dt><dd>{p.client_website ?? p.prospect_website ?? '—'}</dd>
      <dt>Industry</dt><dd>{p.industry === 'other' ? `OTHER — ${p.business_type ?? ''}` : p.industry?.replace('_', ' ')}</dd>{p.package && <><dt>Package</dt><dd>{p.package === 'premier' ? 'Premier' : 'Standard'}</dd></>}</dl>
    <div className="actions"><button className="btn next" onClick={next}>NEXT: ANALYZE WEBSITE →</button></div>
  </section>;
}

function StepWebsite({ b, reload, next }: { b: any; reload: () => void; next: () => void }) {
  const [url, setUrl] = useState(b.project.client_website ?? b.project.prospect_website ?? '');
  const [fact, setFact] = useState(''); const [editing, setEditing] = useState<any>(null);
  const a = useAction();
  const kept = b.facts.filter((f: any) => f.selected).length;
  return <>
    <section className="card">
      <Field label="Client website"><input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" /></Field>
      <div className="actions"><button className={'btn ' + (!b.facts.length ? 'next' : '')} disabled={a.busy || !url} onClick={() => a.run(async () => { await post(`/api/projects/${b.project.id}/analyze`, { url }); reload(); })}>
        {a.busy ? 'Reading the website… (up to a minute)' : b.analysis ? 'ANALYZE WEBSITE AGAIN' : 'ANALYZE WEBSITE'}</button></div>
      {b.analysis && <div className={'notice ' + (b.analysis.status === 'failed' ? 'warn' : b.analysis.status === 'partial' ? 'warn' : 'ok')} style={{ marginTop: 12 }}>{b.analysis.owner_message}<div className="small muted">{when(b.analysis.created_at)}</div></div>}
      <Msg error={a.error} />
    </section>
    <section className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Facts ({kept} kept)</h2></div>
      <p className="help">Only facts you keep are used in the videos. Each shows where it came from. Untick anything that is wrong, out of date or not useful.</p>
      {b.facts.length === 0 && <p className="empty">No facts yet. Analyze the website, or add facts yourself below.</p>}
      <div>{b.facts.map((f: any) => <div key={f.id} className={'fact ' + (f.selected ? '' : 'off')}>
        <input type="checkbox" aria-label="Keep this fact" checked={f.selected} onChange={(e) => a.run(async () => { await patch(`/api/projects/${b.project.id}/facts/${f.id}`, { selected: e.target.checked }); reload(); })} />
        <div style={{ flex: 1 }}>{f.text}<div className="source">{f.source_url ? <>From <a href={f.source_url} target="_blank" rel="noreferrer">{f.source_url}</a></> : 'Added by you'}</div></div>
        <button className="btn small" onClick={() => setEditing(f)}>EDIT</button></div>)}</div>
      <Field label="Add a fact yourself" help='For example: "Family-owned since 1998" or "Open Saturdays".'><textarea value={fact} onChange={(e) => setFact(e.target.value)} style={{ minHeight: 70 }} /></Field>
      <div className="actions">
        <button className="btn" disabled={!fact.trim() || a.busy} onClick={() => a.run(async () => { await post(`/api/projects/${b.project.id}/facts`, { text: fact }); setFact(''); reload(); })}>ADD FACT</button>
        <button className={'btn ' + (kept ? 'next' : '')} disabled={!kept} onClick={next}>NEXT: REVIEW IMAGES →</button>
      </div>
    </section>
    {editing && <Modal title="Edit fact" onClose={() => setEditing(null)}><EditFact projectId={b.project.id} f={editing} onDone={() => { setEditing(null); reload(); }} /></Modal>}
  </>;
}
function EditFact({ projectId, f, onDone }: { projectId: string; f: any; onDone: () => void }) {
  const [t, setT] = useState(f.text); const a = useAction();
  return <><Field label="Fact" help="Editing a website statement turns it into your own words."><textarea value={t} onChange={(e) => setT(e.target.value)} /></Field>
    <div className="actions"><button className="btn next" disabled={a.busy} onClick={async () => { if (await a.run(() => patch(`/api/projects/${projectId}/facts/${f.id}`, { text: t }))) onDone(); }}>SAVE FACT</button></div><Msg error={a.error} /></>;
}

function StepImages({ b, reload, next }: { b: any; reload: () => void; next: () => void }) {
  const a = useAction(); const [picking, setPicking] = useState(false);
  const pid = b.project.id;
  const toggle = (img: any, selected: boolean) => a.run(async () => { await post(`/api/projects/${pid}/images/${img.id}`, { selected }); reload(); });
  const dnu = (img: any) => a.run(async () => { await patch(`/api/images/${img.id}`, { status: img.status === 'do_not_use' ? 'available' : 'do_not_use' }); reload(); });
  const used = b.images.filter((i: any) => i.selected).length;
  return <section className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Pictures for this project ({used} in use)</h2>
      <div className="row">{b.folderWaiting > 0 && <button className="btn next" disabled={a.busy} onClick={() => a.run(async () => { const r = await post(`/api/projects/${pid}/images/from-folder`); reload(); return r.ownerMessage as string; }).then((m) => { if (m) a.setOk(m); })}>ADD {b.folderWaiting} PICTURE{b.folderWaiting === 1 ? '' : 'S'} FROM {String(b.project.business_name ?? 'THIS BUSINESS').toUpperCase()}'S FOLDER</button>}
        <button className="btn" onClick={() => setPicking(true)}>ADD FROM MY IMAGE LIBRARY</button>
        <label className="btn">UPLOAD FROM MY COMPUTER<input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }}
          onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; a.run(async () => { await uploadFiles(files, { projectId: pid, clientId: b.project.client_id, prospectId: b.project.client_id ? null : b.project.prospect_id, category: 'Client website' }); reload(); }); }} /></label></div></div>
    <p className="help">Pictures from the client’s website still need the client’s permission before final production. Do Not Use pictures are never placed in a video.</p>
    {b.images.length === 0 ? <p className="empty">No pictures yet. Analyze the website, add from your Image Library, or upload.</p> :
      <div className="imggrid">{b.images.map((img: any) => <div key={img.id} className={'imgcard ' + (img.status === 'do_not_use' ? 'dnu' : img.selected ? 'on' : '')}>
        {img.url ? <img src={img.url} alt={img.title} loading="lazy" /> : <div style={{ aspectRatio: '4/3' }} />}
        <div className="pad"><b className="small">{img.title}</b>
          {img.status === 'do_not_use' ? <span className="badge bad">Do Not Use</span> :
            <label className="check small"><input type="checkbox" checked={img.selected} onChange={(e) => toggle(img, e.target.checked)} /> Use in this project</label>}
          <button className="btn small" onClick={() => dnu(img)}>{img.status === 'do_not_use' ? 'ALLOW AGAIN' : 'DO NOT USE'}</button></div></div>)}</div>}
    <div className="actions"><button className="btn next" onClick={next}>NEXT: CHOOSE STORY →</button></div>
    <Msg error={a.error} ok={a.ok} />
    {picking && <Modal title="Add from My Image Library" onClose={() => setPicking(false)}>
      <ImagePicker onPick={async (img) => { await post(`/api/projects/${pid}/images/${img.id}`, { selected: true }); reload(); }} exclude={b.images.map((i: any) => i.id)} />
    </Modal>}
  </section>;
}

function StepStory({ b, reload, next }: { b: any; reload: () => void; next: () => void }) {
  const o = b.options; const s = b.project.settings ?? {};
  const [f, setF] = useState({ story: b.project.story ?? o.stories[0], tone: b.project.tone ?? o.tones[0], websiteSecs: o.websiteLengths.includes(s.websiteLength) ? s.websiteLength : 60,
    websiteFormat: s.websiteFormat ?? '16x9', platform: s.platform ?? 'HeyGen' });
  useEffect(() => { sessionStorage.setItem('bv-build-' + b.project.id, JSON.stringify(f)); }, [f, b.project.id]);
  return <section className="card">
    <div className="grid">
      <Field label="Video story"><select value={f.story} onChange={(e) => setF({ ...f, story: e.target.value })}>{o.stories.map((x: string) => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Tone"><select value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })}>{o.tones.map((x: string) => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Website Video length"><select value={f.websiteSecs} onChange={(e) => setF({ ...f, websiteSecs: Number(e.target.value) })}>{o.websiteLengths.map((x: number) => <option key={x} value={x}>{x} seconds</option>)}</select></Field>
      <Field label="Website Video shape" help="The client's choice."><select value={f.websiteFormat} onChange={(e) => setF({ ...f, websiteFormat: e.target.value })}>{o.websiteFormats.map((x: any) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></Field>
      <Field label="Creation platform"><select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>{o.platforms.map((x: string) => <option key={x}>{x}</option>)}</select></Field>
    </div>
    <p className="help">The two social videos (one portrait 9:16, one landscape 16:9) and the Thank-You Video are 30 seconds each. The Email Video is 15 seconds.</p>
    <div className="actions"><button className="btn next" onClick={next}>NEXT: BUILD VIDEOS →</button></div>
    {void reload}
  </section>;
}

function StepBuild({ b, reload, next }: { b: any; reload: () => void; next: () => void }) {
  const a = useAction(); const [confirm, setConfirm] = useState<string | null>(null); const [note, setNote] = useState<string | null>(null);
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem('bv-build-' + b.project.id) ?? 'null'); } catch { return null; } })();
  const s = b.project.settings ?? {};
  const choice = saved ?? { story: b.project.story ?? b.options.stories[0], tone: b.project.tone ?? b.options.tones[0], websiteSecs: b.options.websiteLengths.includes(s.websiteLength) ? s.websiteLength : 60,
    websiteFormat: s.websiteFormat ?? '16x9', platform: s.platform ?? 'HeyGen' };
  const SHAPE = { '16x9': 'Landscape 16:9', '1x1': 'Square 1:1', '9x16': 'Portrait 9:16' } as Record<string, string>;
  const build = async (confirmReplaceApproved = false) => {
    setConfirm(null);
    try {
      const r = await post(`/api/projects/${b.project.id}/build`, { ...choice, confirmReplaceApproved });
      setNote(r.note ?? null); reload(); if (!r.note) next();
    } catch (e: any) { if (e.code === 'confirm_rebuild') setConfirm(e.message); else a.setError(e.message); }
  };
  return <section className="card">
    <dl className="kv"><dt>Story</dt><dd>{choice.story}</dd><dt>Tone</dt><dd>{choice.tone}</dd><dt>Website Video</dt><dd>{choice.websiteSecs} seconds · {SHAPE[choice.websiteFormat ?? '16x9']}</dd><dt>Platform</dt><dd>{choice.platform}</dd>
      <dt>Facts kept</dt><dd>{b.facts.filter((f: any) => f.selected).length}</dd><dt>Pictures in use</dt><dd>{b.images.filter((i: any) => i.selected).length}</dd></dl>
    <div className="actions">
      <button className="btn next" disabled={a.busy} onClick={() => a.run(() => build(false))}>{b.scenes.length ? 'BUILD 5 VIDEOS AGAIN' : 'BUILD 5 VIDEOS'}</button>
      <Link className="btn" to="?step=4">CHANGE STORY SETTINGS</Link>
    </div>
    {confirm && <div className="notice warn" style={{ marginTop: 12 }}>{confirm}<div className="actions"><button className="btn next" onClick={() => a.run(() => build(true))}>BUILD AGAIN</button><button className="btn" onClick={() => setConfirm(null)}>KEEP MY APPROVED SCENES</button></div></div>}
    {note && <div className="notice" style={{ marginTop: 12 }}>{note}<div className="actions"><button className="btn next" onClick={next}>NEXT: REVIEW SCENES →</button></div></div>}
    <Msg error={a.error} />
  </section>;
}

function StepReview({ b, reload, next }: { b: any; reload: () => void; next: () => void }) {
  const [tab, setTab] = useState(b.status.deliverables[0]?.id);
  const [edit, setEdit] = useState<any>(null); const [pick, setPick] = useState<any>(null);
  const a = useAction();
  const pid = b.project.id;
  const facts = new Map(b.facts.map((f: any) => [f.id, f]));
  const imgUrl = new Map(b.images.map((i: any) => [i.id, i.url]));
  if (!b.scenes.length) return <section className="card"><p>No scenes yet. <Link to="?step=5">Go to Step 5 — Build Videos</Link>.</p></section>;
  const d = b.status.deliverables.find((x: any) => x.id === tab) ?? b.status.deliverables[0];
  const del = b.deliverables.find((x: any) => x.id === d.id);
  const scenes = b.scenes.filter((s: any) => s.deliverable_id === d.id);
  const pending = scenes.filter((s: any) => !d.scenes.find((x: any) => x.id === s.id)?.approved);
  return <section className="card">
    <div className="tabbar">{b.status.deliverables.map((x: any) => <button key={x.id} className={'btn small ' + (x.id === d.id ? 'primary' : '')} onClick={() => setTab(x.id)}>
      {x.label} · {x.approvedCount}/{x.sceneCount} {x.complete ? '✓' : ''}</button>)}</div>
    <div className="row between"><div><h2 style={{ margin: 0 }}>{d.label}</h2><div className="muted small">{d.durationS} seconds · {d.formats.map((f: string) => FORMAT[f]).join(' · ')}</div></div>
      {pending.length > 0 && <button className="btn" disabled={a.busy} onClick={() => confirmAll() }>APPROVE ALL {pending.length} SCENES IN {d.label.toUpperCase()}</button>}</div>
    <div className="stack" style={{ marginTop: 12 }}>{scenes.map((s: any) => { const ss = d.scenes.find((x: any) => x.id === s.id); const src = (s.fact_ids ?? []).map((fid: string) => facts.get(fid)).filter(Boolean) as any[];
      return <div key={s.id} className={'scene ' + (ss.approved ? 'approved' : ss.wasApprovedEarlier ? 'changed' : '')}>
        <div className="scene-row">
          {s.image_ref?.assetId && imgUrl.get(s.image_ref.assetId) ? <img src={imgUrl.get(s.image_ref.assetId) as string} alt={s.image_ref.title} /> : <div className="scene-row-img muted small" style={{ width: 180, aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--line)', borderRadius: 8 }}>{s.image_ref?.title ?? 'No picture'}</div>}
          <div>
            <div className="row between"><b>Scene {s.position} — {s.name}</b><span className="small muted">{s.start_s}–{s.end_s} sec</span></div>
            <div style={{ marginTop: 4 }}><b className="small">Narration:</b> {s.narration ? `“${s.narration}”` : <i className="muted">(no narration)</i>}</div>
            <div className="small" style={{ marginTop: 4 }}><b>Visual:</b> {s.visual}</div>
            {src.length > 0 && <div className="source" style={{ marginTop: 4 }}>Source: {src.map((f) => f.source_url ? <a key={f.id} href={f.source_url} target="_blank" rel="noreferrer">{new URL(f.source_url).pathname === '/' ? 'home page' : new URL(f.source_url).pathname}</a> : 'your own words').reduce((acc: any[], x, i) => acc.concat(i ? [' · ', x] : [x]), [])}</div>}
            {src.length === 0 && s.narration && s.written_by === 'owner' && <div className="source" style={{ marginTop: 4 }}>Source: your own words</div>}
            {ss.wasApprovedEarlier && <div className="small" style={{ color: 'var(--amber)', fontWeight: 700 }}>Changed since it was approved — approve again.</div>}
            <div className="actions" style={{ marginTop: 8 }}>
              {ss.approved ? <span className="badge ok">✓ Approved</span> : <button className="btn small next" disabled={a.busy} onClick={() => a.run(async () => { await post(`/api/projects/${pid}/approve`, { type: 'scene', id: s.id, expectedHash: s.content_hash }); reload(); })}>APPROVE SCENE</button>}
              <button className="btn small" onClick={() => setEdit(s)}>REWRITE SCENE</button>
              <button className="btn small" onClick={() => setPick(s)}>CHANGE IMAGE</button>
            </div>
          </div></div></div>; })}</div>
    <div className="actions"><button className={'btn ' + (b.status.allComponentsApproved ? 'next' : '')} onClick={next}>NEXT: APPROVE →</button></div>
    <Msg error={a.error} />
    {edit && <Modal title={`Rewrite scene ${edit.position}`} onClose={() => setEdit(null)}><Rewrite pid={pid} s={edit} onDone={() => { setEdit(null); reload(); }} /></Modal>}
    {pick && <Modal title={`Change image — scene ${pick.position}`} onClose={() => setPick(null)}>
      <p className="help">Choose from this project’s pictures or your Image Library. Changing the picture of an approved scene means approving it again.</p>
      <div className="imggrid">{b.images.filter((i: any) => i.status !== 'do_not_use').map((img: any) => <button key={img.id} className="imgcard" style={{ cursor: 'pointer', padding: 0, font: 'inherit', textAlign: 'left' }}
        onClick={() => a.run(async () => { await put(`/api/projects/${pid}/scenes/${pick.id}/image`, { assetId: img.id }); setPick(null); reload(); })}>
        {img.url && <img src={img.url} alt={img.title} />}<div className="pad small"><b>{img.title}</b></div></button>)}</div>
      <h3 style={{ marginTop: 14 }}>From My Image Library</h3>
      <ImagePicker onPick={async (img) => { await put(`/api/projects/${pid}/scenes/${pick.id}/image`, { assetId: img.id }); setPick(null); reload(); }} exclude={b.images.map((i: any) => i.id)} />
    </Modal>}
  </section>;

  function confirmAll() {
    if (!confirm(`Approve all ${pending.length} remaining scenes in ${d.label}? You are approving the words and pictures exactly as shown.`)) return;
    a.run(async () => { await post(`/api/projects/${pid}/approve-many`, { items: pending.map((s: any) => ({ id: s.id, expectedHash: s.content_hash })) }); reload(); });
  }
}
function Rewrite({ pid, s, onDone }: { pid: string; s: any; onDone: () => void }) {
  const [name, setName] = useState(s.name); const [narration, setNarration] = useState(s.narration); const [visual, setVisual] = useState(s.visual); const a = useAction();
  const words = narration.trim() ? narration.trim().split(/\s+/).length : 0;
  return <>
    <Field label="Scene name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
    <Field label="Narration — the words spoken" help={`${words} words · about 12–16 words fit a 5-second scene. Only say what is true about the business.`}><textarea value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
    <Field label="Scene visualization"><textarea value={visual} onChange={(e) => setVisual(e.target.value)} /></Field>
    <div className="actions"><button className="btn next" disabled={a.busy} onClick={async () => { if (await a.run(() => patch(`/api/projects/${pid}/scenes/${s.id}`, { name, narration, visual }))) onDone(); }}>SAVE SCENE</button></div>
    <Msg error={a.error} />
  </>;
}

function StepApprove({ b, reload, next }: { b: any; reload: () => void; next: () => void }) {
  const a = useAction(); const st = b.status;
  return <section className="card">
    <ul className="list">{st.deliverables.map((d: any) => <li key={d.id}><span><b>{d.label}</b> <span className="muted small">{d.durationS} sec</span></span>
      <span className={'badge ' + (d.complete ? 'ok' : 'warn')}>{d.complete ? '✓ ' : ''}{d.approvedCount}/{d.sceneCount} scenes approved</span></li>)}</ul>
    {st.completeVideoKitApproved ? <div className="notice ok"><b>✓ COMPLETE VIDEO KIT APPROVED</b><div className="actions"><button className="btn next" onClick={next}>NEXT: DOWNLOAD →</button></div></div> : <>
      {!st.allComponentsApproved && <p className="help">Finish approving every scene in all five videos (Step 6) first.</p>}
      {st.finalApprovalLostBecause && <div className="notice warn">{st.finalApprovalLostBecause}</div>}
      <div className="actions"><button className={'btn ' + (st.readyForFinalApproval ? 'next' : '')} disabled={!st.readyForFinalApproval || a.busy}
        onClick={() => a.run(async () => { await post(`/api/projects/${b.project.id}/approve`, { type: 'kit', expectedHash: st.compositeHash }); reload(); })}>APPROVE COMPLETE VIDEO KIT</button></div></>}
    <Msg error={a.error} />
  </section>;
}

function StepDownload({ b, reload }: { b: any; reload: () => void }) {
  const a = useAction(); const [method, setMethod] = useState('Emailed download link'); const [ref, setRef] = useState('');
  const ok = b.status.completeVideoKitApproved; const downloaded = ['package_downloaded', 'delivered'].includes(b.production?.status);
  return <section className="card">
    {!ok ? <div className="notice warn">Approve the Complete Video Kit (Step 7) to unlock downloads.</div> : <>
      <p>The kit contains a script file for each video (Website in the client's chosen shape, Social Portrait 9:16, Social Landscape 16:9, Thank-You and Email), the pictures used, and where every fact came from.</p>
      <div className="actions"><a className={'btn ' + (!downloaded ? 'next' : '')} href={`/api/projects/${b.project.id}/download/kit`} onClick={() => [1500, 4000, 9000].forEach((ms) => setTimeout(reload, ms))}>DOWNLOAD COMPLETE VIDEO KIT</a></div>
      <h2 style={{ marginTop: 20 }}>Record delivery</h2>
      <p className="help">After you send or hand over the finished files, record it here. BrittVideo won’t record a delivery before the approved kit is downloaded.</p>
      <div className="grid"><Field label="How was it delivered?"><input value={method} onChange={(e) => setMethod(e.target.value)} /></Field><Field label="Note (optional)"><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Sent to the office manager" /></Field></div>
      <div className="actions"><button className={'btn ' + (downloaded && b.production?.status !== 'delivered' ? 'next' : '')} disabled={!downloaded || a.busy}
        onClick={() => a.run(async () => { await post(`/api/projects/${b.project.id}/delivery`, { method, reference: ref }); reload(); }, 'Delivery recorded.')}>RECORD DELIVERY</button></div>
    </>}
    {b.deliveries.length > 0 && <><h3 style={{ marginTop: 16 }}>Delivery history</h3><ul className="list">{b.deliveries.map((x: any, i: number) => <li key={i}><span>{x.method}{x.reference ? ' — ' + x.reference : ''}</span><span className="small muted">{when(x.delivered_at)}</span></li>)}</ul></>}
    <Msg error={a.error} ok={a.ok} />
  </section>;
}
