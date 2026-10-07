import React, { useEffect, useState } from 'react';
import { get, post, patch, ApiError } from '../../shared/api';
import { useLoad, useAction, useSession, Msg, Loading, LoadError, Modal, Field } from '../ui';

export const CATEGORIES = ['Senior Living', 'Dentist', 'Medical / Doctor', 'Attorney', 'Plumber', 'General Business', 'Logo', 'Client website', 'Other'];

/** Read files and upload them as base64 JSON (JPEG / PNG / WebP up to 12 MB). */
export async function uploadFiles(files: File[], extra: { projectId?: string; clientId?: string | null; prospectId?: string | null; category?: string }) {
  const problems: string[] = [];
  for (const f of files) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { problems.push(`${f.name}: please use JPEG, PNG or WebP (iPhone HEIC photos: choose "Most Compatible" in Camera settings, or share as JPEG).`); continue; }
    const dataBase64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
    try { await post('/api/images', { dataBase64, mime: f.type, title: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), category: extra.category ?? 'General Business', projectId: extra.projectId, clientId: extra.clientId ?? null, prospectId: extra.prospectId ?? null }); }
    catch (e: any) { problems.push(`${f.name}: ${e.message}`); }
  }
  if (problems.length) throw new ApiError(problems.join(' '), 400, 'upload');
}

/** Pick an image from the reusable library (never shows Do Not Use or deleted images). */
export function ImagePicker({ onPick, exclude = [] }: { onPick: (img: any) => Promise<void> | void; exclude?: string[] }) {
  const [q, setQ] = useState('');
  const d = useLoad(() => get('/api/images?q=' + encodeURIComponent(q)), [q]);
  const a = useAction();
  const list = (d.data ?? []).filter((i: any) => i.status !== 'do_not_use' && !exclude.includes(i.id));
  return <div>
    <input type="search" placeholder="Search my images" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
    {d.loading && !d.data ? <Loading /> : list.length === 0 ? <p className="empty">No matching images. Add some in the Image Library.</p> :
      <div className="imggrid">{list.map((img: any) => <button key={img.id} className="imgcard" style={{ cursor: 'pointer', padding: 0, font: 'inherit', textAlign: 'left' }} disabled={a.busy}
        onClick={() => a.run(async () => { await onPick(img); })}>{img.url && <img src={img.url} alt={img.title} loading="lazy" />}<div className="pad small"><b>{img.title}</b><span className="muted">{img.category}</span></div></button>)}</div>}
    <Msg error={a.error} />
  </div>;
}

const VIEWS = [{ key: 'library', label: 'My Image Library' }, { key: 'unused', label: 'Not used anywhere' }, { key: 'duplicates', label: 'Possible duplicates' }, { key: 'recently_deleted', label: 'Recently Deleted' }];
export function ImageLibrary() {
  const { can } = useSession();
  const [view, setView] = useState('library'); const [q, setQ] = useState(''); const [cat, setCat] = useState('All Categories');
  const [sel, setSel] = useState<string[]>([]);
  const [folder, setFolder] = useState('');            // '' all · group:<key> · client:<id> · prospect:<id> · general
  const [getting, setGetting] = useState(false);
  const folders = useLoad(() => get('/api/image-folders'), []);
  const d = useLoad(() => get(`/api/images?view=${view}&q=${encodeURIComponent(q)}&category=${encodeURIComponent(cat)}&folder=${encodeURIComponent(view === 'library' ? folder : '')}`), [view, q, cat, folder]);
  const a = useAction();
  useEffect(() => { document.title = 'Image Library — BrittVideo'; setSel([]); }, [view, folder]);
  const reload = () => { setSel([]); d.reload(); folders.reload(); };
  const groups: any[] = folders.data?.groups ?? [];
  const groupKey = folder.startsWith('group:') ? folder.slice(6) : groups.find((g) => g.folders.some((f: any) => `${f.kind}:${f.id}` === folder))?.key ?? '';
  const openGroup = groups.find((g) => g.key === groupKey);
  const business = openGroup?.folders.find((f: any) => `${f.kind}:${f.id}` === folder);
  const uploadTo = business ? { [business.kind === 'client' ? 'clientId' : 'prospectId']: business.id } : {};
  const del = (ids: string[]) => a.run(async () => {
    try { await post('/api/images/delete', { ids }); }
    catch (e: any) { if (e.code === 'in_use' && confirm(e.message)) await post('/api/images/delete', { ids, confirmInUse: true }); else if (e.code !== 'in_use') throw e; else return; }
    reload();
  }, `Moved to Recently Deleted. You can restore from there.`);
  const deleted = view === 'recently_deleted';
  return <>
    <div className="pagehead"><div><h1>Image Library</h1><p className="muted">Your reusable pictures. Pictures marked Do Not Use are never placed in a video.</p></div>
      <div className="row"><button className="btn next" onClick={() => setGetting(true)}>+ GET PICTURES FROM A WEBSITE</button>
      <label className="btn">+ ADD IMAGES FROM MY COMPUTER<input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }}
        onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; a.run(async () => { await uploadFiles(files, { ...uploadTo, category: cat !== 'All Categories' ? cat : openGroup?.category ?? 'General Business' }); reload(); }, business ? `Added to ${business.name}.` : 'Added.'); }} /></label></div></div>
    <div className="tabbar">{VIEWS.map((v) => <button key={v.key} className={'btn small ' + (view === v.key ? 'primary' : '')} onClick={() => setView(v.key)}>{v.label}</button>)}</div>
    {view === 'library' && <section className="card folders">
      <h2 style={{ margin: '0 0 8px' }}>Folders</h2>
      <div className="tabbar">
        <button className={'btn small ' + (folder === '' ? 'primary' : '')} onClick={() => setFolder('')}>ALL PICTURES</button>
        {groups.map((g) => <button key={g.key} className={'btn small ' + (groupKey === g.key ? 'primary' : '')} onClick={() => setFolder('group:' + g.key)}>{g.label.toUpperCase()} ({g.pictures})</button>)}
        <button className={'btn small ' + (folder === 'general' ? 'primary' : '')} onClick={() => setFolder('general')}>GENERAL LIBRARY ({folders.data?.general?.pictures ?? 0})</button>
      </div>
      {openGroup && (openGroup.folders.length === 0 ? <p className="empty">No {openGroup.label.toLowerCase()} yet. Add one on the Prospects page, then come back.</p> :
        <div className="folderlist">
          <button className={'folder ' + (folder === 'group:' + openGroup.key ? 'on' : '')} onClick={() => setFolder('group:' + openGroup.key)}><b>All {openGroup.label}</b><span>{openGroup.pictures} pictures</span></button>
          {openGroup.folders.map((f: any) => <button key={f.id} className={'folder ' + (folder === `${f.kind}:${f.id}` ? 'on' : '')} onClick={() => setFolder(`${f.kind}:${f.id}`)}>
            <b>{f.name}</b><span>{f.pictures} pictures · {f.kind === 'client' ? 'Client' : 'Prospect'}</span></button>)}
        </div>)}
      {business && <div className="row between" style={{ marginTop: 10 }}><p className="help" style={{ margin: 0 }}>Showing the <b>{business.name}</b> folder{business.websiteUrl ? ` · ${business.websiteUrl}` : ''}.</p>
        <button className="btn small next" onClick={() => setGetting(true)}>GET PICTURES FROM {business.name.toUpperCase()}'S WEBSITE</button></div>}
    </section>}
    <section className="card">
      <div className="row"><input type="search" placeholder="Find images (dentist, senior living, office…)" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ maxWidth: 240 }} aria-label="Category"><option>All Categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
      {view === 'unused' && <p className="help">Pictures not used by any project. Review before deleting — nothing here is removed automatically.</p>}
      {view === 'duplicates' && <p className="help">Pictures that are exactly the same file. Keep one and delete the others if you like.</p>}
      {deleted && <p className="help">Deleted pictures stay here until you restore them or delete them permanently. Permanent deletion cannot be undone — and a permanently deleted picture can never come back.</p>}
      {sel.length > 0 && <div className="actions">
        {!deleted && <button className="btn danger" onClick={() => del(sel)}>DELETE SELECTED ({sel.length})</button>}
        {deleted && <button className="btn" onClick={() => a.run(async () => { await post('/api/images/restore', { ids: sel }); reload(); }, 'Restored.')}>RESTORE SELECTED ({sel.length})</button>}
        {deleted && can('destructive') && <button className="btn danger" onClick={() => confirm(`Permanently delete ${sel.length} picture(s)? This cannot be undone.`) && a.run(async () => { await post('/api/images/purge', { ids: sel }); reload(); }, 'Permanently deleted.')}>DELETE PERMANENTLY</button>}
      </div>}
      <Msg error={a.error} ok={a.ok} />
      <div style={{ marginTop: 12 }}>{d.loading && !d.data ? <Loading /> : d.error ? <LoadError error={d.error} retry={d.reload} /> : d.data!.length === 0 ? <p className="empty">No pictures here.</p> :
        <div className="imggrid">{d.data!.map((img: any) => <div key={img.id} className={'imgcard ' + (img.status === 'do_not_use' ? 'dnu' : sel.includes(img.id) ? 'on' : '')}>
          {img.url ? <img src={img.url} alt={img.title} loading="lazy" /> : <div style={{ aspectRatio: '4/3' }} />}
          <div className="pad">
            <label className="check small"><input type="checkbox" checked={sel.includes(img.id)} onChange={(e) => setSel(e.target.checked ? [...sel, img.id] : sel.filter((x) => x !== img.id))} /> <b>{img.title}</b></label>
            <span className="small muted">{img.category}{img.inUse ? ` · used in ${img.inUse} scene(s)` : ''}{img.duplicateCount > 1 ? ` · ${img.duplicateCount} copies` : ''}</span>
            {!deleted && <>
              <select aria-label="Status" value={img.status} onChange={(e) => a.run(async () => { await patch(`/api/images/${img.id}`, { status: e.target.value }); d.reload(); })}>
                <option value="available">Available</option><option value="approved">Approved</option><option value="do_not_use">Do Not Use</option></select>
              <select aria-label="Category" value={img.category ?? 'Other'} onChange={(e) => a.run(async () => { await patch(`/api/images/${img.id}`, { category: e.target.value }); d.reload(); })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
              <div className="row"><button className="btn small" onClick={() => { const t = prompt('Picture name:', img.title); if (t && t.trim()) a.run(async () => { await patch(`/api/images/${img.id}`, { title: t.trim() }); d.reload(); }); }}>RENAME</button>
                <button className="btn small danger" onClick={() => del([img.id])}>DELETE IMAGE</button></div>
              {img.sourceUrl && <span className="source">From {new URL(img.sourceUrl).hostname}</span>}
            </>}
          </div></div>)}</div>}</div>
    </section>
    {getting && <WebsitePictures groups={groups} startFolder={business ? `${business.kind}:${business.id}` : ''} onClose={() => setGetting(false)}
      onSaved={(f) => { setView('library'); if (f) setFolder(f); reload(); }} />}
  </>;
}

/**
 * GET PICTURES FROM A WEBSITE: choose the folder (its website fills in), SCAN WEBSITE, tick pictures, SAVE.
 * Nothing is added to the library until the owner saves.
 */
export function WebsitePictures({ groups, startFolder, onClose, onSaved }: { groups: any[]; startFolder: string; onClose: () => void; onSaved: (folder: string) => void }) {
  const all = groups.flatMap((g) => g.folders.map((f: any) => ({ ...f, group: g })));
  const [folder, setFolder] = useState(startFolder);
  const chosen = all.find((f) => `${f.kind}:${f.id}` === folder);
  const [url, setUrl] = useState(chosen?.websiteUrl ?? '');
  const [category, setCategory] = useState(chosen?.group.category ?? 'Client website');
  const [scan, setScan] = useState<any>(null);
  const [picks, setPicks] = useState<number[]>([]);
  const a = useAction();
  const pickFolder = (v: string) => { setFolder(v); const f = all.find((x) => `${x.kind}:${x.id}` === v); if (f?.websiteUrl) setUrl(f.websiteUrl); setCategory(f?.group.category ?? 'Client website'); };
  const target = chosen ? { [chosen.kind === 'client' ? 'clientId' : 'prospectId']: chosen.id } : {};
  const doScan = () => a.run(async () => {
    setScan(null);
    const r = await post('/api/image-scans', { url, ...target });
    setScan(r); setPicks(r.items.filter((i: any) => !i.alreadyInLibrary).map((i: any) => i.n));
  });
  const doSave = () => a.run(async () => {
    const r = await post(`/api/image-scans/${scan.scanId}/save`, { picks, category, ...target });
    setPicks([]); setScan({ ...scan, items: scan.items.map((i: any) => picks.includes(i.n) ? { ...i, alreadyInLibrary: { title: i.title } } : i) });
    onSaved(chosen ? `${chosen.kind}:${chosen.id}` : 'general');
    return r.ownerMessage as string;
  }).then((m) => { if (m) a.setOk(m); });
  const fresh = (scan?.items ?? []).filter((i: any) => !i.alreadyInLibrary);
  return <Modal title="Get pictures from a website" onClose={onClose}>
    <Field label="1. Save into which folder?" help="Each business has its own folder inside Dentists, Facilities, Attorneys or Others.">
      <select value={folder} onChange={(e) => pickFolder(e.target.value)}>
        <option value="">General library (no business)</option>
        {groups.map((g) => <optgroup key={g.key} label={g.label}>{g.folders.map((f: any) => <option key={f.id} value={`${f.kind}:${f.id}`}>{f.name}{f.kind === 'prospect' ? ' (prospect)' : ''}</option>)}</optgroup>)}
      </select></Field>
    <Field label="2. Website address">
      <div className="row"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="sunrisedental.com" style={{ flex: 1, minWidth: 200 }} />
        <button className="btn next" disabled={a.busy || !url.trim()} onClick={doScan}>{a.busy && !scan ? 'LOOKING…' : scan ? 'SCAN AGAIN' : 'SCAN WEBSITE'}</button></div></Field>
    {a.busy && !scan && <p className="help">Looking at the website and its main pages. This can take up to a minute.</p>}
    <Msg error={a.error} ok={a.ok} />
    {scan && <>
      <p><b>{scan.ownerMessage}</b></p>
      {scan.items.length > 0 && <>
        <div className="row between"><span className="help" style={{ margin: 0 }}>3. Tick the pictures to keep ({picks.length} ticked)</span>
          <div className="row"><button className="btn small" onClick={() => setPicks(fresh.map((i: any) => i.n))}>TICK ALL</button><button className="btn small" onClick={() => setPicks([])}>UNTICK ALL</button></div></div>
        <div className="imggrid" style={{ marginTop: 10 }}>{scan.items.map((i: any) => <label key={i.n} className={'imgcard ' + (picks.includes(i.n) ? 'on' : '')} style={{ cursor: i.alreadyInLibrary ? 'default' : 'pointer' }}>
          <img src={i.previewUrl} alt={i.alt || i.title} loading="lazy" />
          <div className="pad">
            {i.alreadyInLibrary ? <span className="badge info">Already in your library</span> :
              <span className="check small"><input type="checkbox" checked={picks.includes(i.n)} onChange={(e) => setPicks(e.target.checked ? [...picks, i.n] : picks.filter((x) => x !== i.n))} /> <b>{i.title}</b></span>}
            <span className="small muted">{i.width} × {i.height}</span>
          </div></label>)}</div>
        <div className="row" style={{ marginTop: 12 }}>
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} style={{ maxWidth: 240 }}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <button className="btn next" disabled={a.busy || picks.length === 0} onClick={doSave}>SAVE {picks.length} PICTURE{picks.length === 1 ? '' : 'S'} TO {(chosen?.name ?? 'General library').toUpperCase()}</button></div>
        <p className="help">Pictures from a business's website need that business's permission before they appear in a finished video.</p>
      </>}
    </>}
  </Modal>;
}
