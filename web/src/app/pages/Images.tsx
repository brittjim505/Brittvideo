import React, { useEffect, useState } from 'react';
import { get, post, patch, ApiError } from '../../shared/api';
import { useLoad, useAction, useSession, Msg, Loading, LoadError } from '../ui';

export const CATEGORIES = ['Senior Living', 'Dentist', 'Medical / Doctor', 'Attorney', 'Plumber', 'General Business', 'Logo', 'Client website', 'Other'];

/** Read files and upload them as base64 JSON (JPEG / PNG / WebP up to 12 MB). */
export async function uploadFiles(files: File[], extra: { projectId?: string; clientId?: string | null; category?: string }) {
  const problems: string[] = [];
  for (const f of files) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { problems.push(`${f.name}: please use JPEG, PNG or WebP (iPhone HEIC photos: choose "Most Compatible" in Camera settings, or share as JPEG).`); continue; }
    const dataBase64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
    try { await post('/api/images', { dataBase64, mime: f.type, title: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), category: extra.category ?? 'General Business', projectId: extra.projectId, clientId: extra.clientId ?? null }); }
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
  const d = useLoad(() => get(`/api/images?view=${view}&q=${encodeURIComponent(q)}&category=${encodeURIComponent(cat)}`), [view, q, cat]);
  const a = useAction();
  useEffect(() => { document.title = 'Image Library — BrittVideo'; setSel([]); }, [view]);
  const reload = () => { setSel([]); d.reload(); };
  const del = (ids: string[]) => a.run(async () => {
    try { await post('/api/images/delete', { ids }); }
    catch (e: any) { if (e.code === 'in_use' && confirm(e.message)) await post('/api/images/delete', { ids, confirmInUse: true }); else if (e.code !== 'in_use') throw e; else return; }
    reload();
  }, `Moved to Recently Deleted. You can restore from there.`);
  const deleted = view === 'recently_deleted';
  return <>
    <div className="pagehead"><div><h1>Image Library</h1><p className="muted">Your reusable pictures. Pictures marked Do Not Use are never placed in a video.</p></div>
      <label className="btn next">+ ADD IMAGES FROM MY COMPUTER<input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }}
        onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; a.run(async () => { await uploadFiles(files, { category: cat === 'All Categories' ? 'General Business' : cat }); reload(); }, 'Added.'); }} /></label></div>
    <div className="tabbar">{VIEWS.map((v) => <button key={v.key} className={'btn small ' + (view === v.key ? 'primary' : '')} onClick={() => setView(v.key)}>{v.label}</button>)}</div>
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
  </>;
}
