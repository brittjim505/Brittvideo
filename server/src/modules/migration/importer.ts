import type pg from 'pg';
import { createRequire } from 'node:module';
import { tx } from '../../db/pool.js';
import type { Actor } from '../../auth/permissions.js';
import { requirePerm } from '../../auth/service.js';
import { OwnerError } from '../../lib/errors.js';
import { sha256, cleanWebsite, normaliseWebsite } from '../../lib/util.js';
import { audit } from '../audit/service.js';
import { createOrReuseClient, upsertProspect } from '../crm/service.js';
import { createProject, createCheckpoint, kitStatus, sceneHash, scriptHash, DURATIONS } from '../projects/service.js';
import { putObject } from '../../integrations/storage.js';

const require = createRequire(import.meta.url);
const DEFAULTS = require('./prototype-defaults.json') as { moradaImages: any[]; socialAScenes: any[]; socialBScenes: any[]; emailScenes: any[] };

/**
 * Import everything from a V2 prototype "EXPORT ALL DATA FOR UPGRADE" file (R21, R22, Y22).
 * - One transaction: either everything is imported or nothing is.
 * - Importing the same file twice does nothing the second time; entities already imported are skipped.
 * - Nothing is invented: approvals are imported only where the prototype recorded them, and the Complete Video Kit
 *   approval is carried over only when the prototype's own content fingerprint still matches the imported content.
 */
export interface ImportSummary {
  alreadyImported: boolean; prospects: number; clients: number; projects: number; quickVideos: number; scenes: number;
  sceneApprovals: number; kitApprovalsCarried: number; images: number; checkpoints: number; skipped: number; notes: string[];
}

const MARKET: Record<string, { industry: string; type?: string }> = {
  'senior care': { industry: 'senior_care' }, 'senior living': { industry: 'senior_care' },
  dental: { industry: 'dental' }, dentist: { industry: 'dental' },
  attorneys: { industry: 'attorneys' }, attorney: { industry: 'attorneys' },
  plumber: { industry: 'other', type: 'Plumbing' },
};
function mapMarket(m: string | undefined) {
  const hit = MARKET[(m ?? '').trim().toLowerCase()];
  return hit ?? { industry: 'other', type: 'Not specified (imported from prototype)' };
}
const parse = (s: string | undefined, fallback: any) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
const secsOf = (v: unknown, dflt: number) => { const n = parseInt(String(v ?? ''), 10); return (DURATIONS as readonly number[]).includes(n) ? n : dflt; };

/** Exact re-implementation of the prototype's V2.11.07 finalApprovalFingerprint(). */
export function prototypeFingerprint(projectKey: string, sceneState: any[], approvals: any, scripts: any) {
  const scenes = (Array.isArray(sceneState) ? sceneState : []).map((sc) => ({
    name: (sc && sc.name) || '', start: sc && sc.start, end: sc && sc.end, image: sc && sc.image,
    visual: (sc && sc.visual) || '', narration: (sc && sc.narration) || '', approved: !!(sc && sc.approved) }));
  const a = approvals || {};
  const payload = JSON.stringify({ project: projectKey, scenes, socialA: a.socialA || [], socialB: a.socialB || [], email: a.email || [], scripts: scripts || {} });
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) { h ^= payload.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16) + '-' + payload.length;
}

export async function importPrototypeExport(pool: pg.Pool, actor: Actor, fileText: string): Promise<ImportSummary> {
  requirePerm(actor, 'backup', 'import prototype data');
  const fileSha = sha256(fileText);
  const doc = parse(fileText, null);
  if (!doc || doc.format !== 'brittvideo-prototype-export' || typeof doc.keys !== 'object') {
    throw new OwnerError('This file is not a BrittVideo "Export All Data" file. In the old BrittVideo, press EXPORT ALL DATA FOR UPGRADE and choose the file it saves.');
  }
  const prior = (await pool.query(`SELECT summary FROM migration_imports WHERE file_sha256=$1`, [fileSha])).rows[0];
  if (prior) return { ...(prior.summary as ImportSummary), alreadyImported: true };

  const K = doc.keys as Record<string, string>;
  const S: ImportSummary = { alreadyImported: false, prospects: 0, clients: 0, projects: 0, quickVideos: 0, scenes: 0, sceneApprovals: 0, kitApprovalsCarried: 0, images: 0, checkpoints: 0, skipped: 0, notes: [] };
  const state = parse(K['bv-state'], { prospects: [], clients: [] });
  const projects: Record<string, any> = parse(K['brittvideo-v2-projects'], {});
  const checkpoints: Record<string, any> = parse(K['brittvideo-stage1-checkpoints'], {});
  const finals: Record<string, any> = parse(K['brittvideo-v21107-final-approvals'], {});
  const library: any[] = parse(K['brittvideo-image-library-v21061'], []);
  const src = 'prototype-v2';

  return tx(async (t) => {
    const legacy = async (id: string, type: string) => (await t.query(`SELECT entity_id FROM legacy_refs WHERE source=$1 AND legacy_id=$2 AND entity_type=$3`, [src, id, type])).rows[0]?.entity_id ?? null;
    const remember = (id: string, type: string, entityId: string) => t.query(`INSERT INTO legacy_refs (source, legacy_id, entity_type, entity_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [src, id, type, entityId]);

    // 1. Image Library → assets (content-addressed; permanently deleted images are never resurrected, T14).
    const libAssetByIndex = new Map<number, string>();
    for (let i = 0; i < library.length; i++) {
      const it = library[i];
      const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(it?.src ?? '');
      if (!m) { S.skipped++; S.notes.push(`Library image "${it?.title ?? '?'}" had no picture data and was skipped.`); continue; }
      const existing = await legacy(String(it.id), 'asset');
      if (existing) { libAssetByIndex.set(i, existing); continue; }
      const buf = Buffer.from(m[2], 'base64');
      const hash = sha256(buf);
      const tomb = (await t.query(`SELECT 1 FROM assets WHERE sha256=$1 AND status='permanently_deleted'`, [hash])).rowCount;
      if (tomb) { S.skipped++; S.notes.push(`Library image "${it.title}" was permanently deleted earlier, so it was not brought back.`); continue; }
      const obj = putObject(buf, m[1].split('/')[1] === 'jpeg' ? 'jpg' : m[1].split('/')[1]);
      const a = (await t.query(`INSERT INTO assets (client_id, title, category, source_type, status, protection_class, storage_key, sha256, bytes, mime, rights_note, legacy_ref, created_by)
        VALUES (NULL,$1,$2,'migration','available','working',$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [it.title || 'Imported image', it.category || 'Other', obj.key, obj.sha256, obj.bytes, m[1], 'Imported from the V2 Image Library — confirm usage rights before client use.', `lib:${it.id}`, actor.userId])).rows[0];
      await remember(String(it.id), 'asset', a.id); libAssetByIndex.set(i, a.id); S.images++;
    }
    const imageRef = (idx: unknown) => {
      const i = Number(idx);
      if (!Number.isInteger(i) || i < 0) return null;
      if (i < DEFAULTS.moradaImages.length) { const im = DEFAULTS.moradaImages[i]; return { legacyIndex: i, title: im.title, sourceNote: im.source, sourceUrl: im.src }; }
      const li = i - DEFAULTS.moradaImages.length; const it = library[li];
      return it ? { legacyIndex: i, title: it.title, sourceNote: 'BrittVideo Image Library — ' + (it.category ?? ''), assetId: libAssetByIndex.get(li) ?? null } : { legacyIndex: i, title: 'Unknown image', sourceNote: 'Image not found in export' };
    };

    // 2. Prospects and clients.
    const entityByName = new Map<string, { kind: 'client' | 'prospect'; id: string }>();
    const key = (name: string, url?: string) => `${(name ?? '').trim().toLowerCase()}|${normaliseWebsite(url) ?? ''}`;
    for (const p of state.prospects ?? []) {
      if (!p?.name) continue;
      const done = await legacy(String(p.id), 'prospect');
      if (done) { entityByName.set(key(p.name, p.url), { kind: 'prospect', id: done }); continue; }
      const mm = mapMarket(p.market);
      const r = await upsertProspect(t, actor, { businessName: p.name, websiteUrl: p.url, industry: mm.industry, businessType: mm.type, privateNotes: p.notes });
      await remember(String(p.id), 'prospect', r.prospect.id);
      entityByName.set(key(p.name, p.url), { kind: 'prospect', id: r.prospect.id });
      if (r.created) S.prospects++;
    }
    for (const c of state.clients ?? []) {
      if (!c?.name) continue;
      const done = await legacy(String(c.id), 'client');
      if (done) { entityByName.set(key(c.name, c.url), { kind: 'client', id: done }); continue; }
      const mm = mapMarket(c.market);
      const note = [c.notes, c.plan ? `Plan recorded in prototype: ${c.plan} (no price or payment was recorded there, so no order was created).` : null].filter(Boolean).join('\n');
      const r = await createOrReuseClient(t, actor, { businessName: c.name, websiteUrl: c.url, industry: mm.industry, businessType: mm.type, privateNotes: note }, 'migration', null);
      await remember(String(c.id), 'client', r.client.id);
      entityByName.set(key(c.name, c.url), { kind: 'client', id: r.client.id });
      if (r.created) S.clients++;
    }
    const findOwner = async (name: string, url: string, market: string) => {
      const exact = entityByName.get(key(name, url));
      if (exact) return exact;
      // Match by name alone only when one side has no website — two different businesses can share a name.
      const byName = [...entityByName.entries()].find(([k]) => k.split('|')[0] === name.trim().toLowerCase() && (!normaliseWebsite(url) || !k.split('|')[1]));
      if (byName) return byName[1];
      const mm = mapMarket(market);
      const r = await upsertProspect(t, actor, { businessName: name, websiteUrl: url, industry: mm.industry, businessType: mm.type, privateNotes: 'Created during import: a saved prototype project had no matching prospect or client.' });
      if (r.created) S.prospects++;
      const o = { kind: 'prospect' as const, id: r.prospect.id }; entityByName.set(key(name, url), o); return o;
    };

    // 3. Saved projects (+ newer protected checkpoints).
    for (const [pid, saved] of Object.entries(projects)) {
      if (await legacy(pid, 'project')) { S.skipped++; continue; }
      const cp = checkpoints[pid];
      const cpNewer = cp?.checkpointAt && Date.parse(cp.checkpointAt) > (Date.parse(saved.updated ?? 0) || 0) + 1000;
      const p = cpNewer ? { ...saved, ...cp } : saved;
      if (cpNewer) S.notes.push(`"${saved.clientName ?? saved.name}": newer automatically-protected work from ${new Date(cp.checkpointAt).toUTCString().replace(' GMT', ' UTC')} was used; the last named save is kept as a checkpoint.`);
      const name = (p.clientName || p.name || 'Imported project').trim();
      const owner = await findOwner(name, p.url ?? '', p.market);
      const mm = mapMarket(p.market);
      const websiteSecs = secsOf(p.length, 60);
      const hasKit = Array.isArray(p.sceneState) && p.sceneState.length > 0;
      if (hasKit) {
        const proj = await createProject(t, actor, {
          clientId: owner.kind === 'client' ? owner.id : null, prospectId: owner.kind === 'prospect' ? owner.id : null,
          kind: 'video_kit', title: `${name} — ${p.projectTitle || p.story || 'Video Kit'}`, industry: mm.industry, businessType: mm.type ?? null,
          source: 'migration', legacyRef: `proto:${pid}`, status: 'in_progress',
          settings: { story: p.story, platform: p.platform, tone: p.tone, format: p.format, websiteLength: websiteSecs, selectedImages: p.selectedImages ?? [], importedFrom: pid },
          deliverables: [
            { kind: 'website', label: 'Website Video', duration: websiteSecs, formats: ['16x9'], script: p.scripts?.[`Website ${websiteSecs}`] ?? '' },
            { kind: 'social_a', label: 'Social A', duration: 30, formats: ['16x9', '9x16', '1x1'], script: p.scripts?.['Social A 30'] ?? '' },
            { kind: 'social_b', label: 'Social B', duration: 30, formats: ['16x9', '9x16', '1x1'], script: p.scripts?.['Social B 30'] ?? '' },
            { kind: 'email', label: 'Email Video', duration: 15, formats: ['16x9'], script: p.scripts?.['Email 15'] ?? '' },
          ],
        });
        await t.query(`UPDATE projects SET story=$2, tone=$3 WHERE id=$1`, [proj.id, p.story ?? null, p.tone ?? null]);
        const dels = (await t.query(`SELECT id, kind FROM deliverables WHERE project_id=$1`, [proj.id])).rows;
        const del = (k: string) => dels.find((d) => d.kind === k).id;
        const approvedAt = p.updated ?? new Date().toISOString();
        const addScenes = async (kind: string, list: any[], approvedFlags: (i: number, sc: any) => boolean) => {
          let pos = 1;
          for (const sc of list) {
            const start = Math.max(0, Number(sc.start) || 0); const end = Math.min(120, Math.max(start + 1, Number(sc.end) || start + 5));
            const adjusted = start !== sc.start || end !== sc.end;
            const row = { name: sc.name || `Scene ${pos}`, start_s: start, end_s: end, image_ref: imageRef(sc.image), visual: sc.visual || '', narration: sc.narration || '' };
            const h = sceneHash(row);
            const s = (await t.query(`INSERT INTO scenes (deliverable_id, position, name, start_s, end_s, image_ref, visual, narration, content_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
              [del(kind), pos, row.name, row.start_s, row.end_s, JSON.stringify(row.image_ref), row.visual, row.narration, h])).rows[0];
            S.scenes++;
            if (adjusted && approvedFlags(pos - 1, sc)) S.notes.push(`"${name}": ${kind.replace('_', ' ')} scene ${pos} had invalid timing and was adjusted, so its approval was not carried over.`);
            if (!adjusted && approvedFlags(pos - 1, sc)) {
              await t.query(`INSERT INTO approvals (project_id, subject_type, subject_id, content_hash, decision, decided_by_label, decided_at) VALUES ($1,'scene',$2,$3,'approved',$4,$5)`,
                [proj.id, s.id, h, 'Approved in V2 prototype (imported)', approvedAt]);
              S.sceneApprovals++;
            }
            pos++;
          }
        };
        const ap = p.approvals ?? {};
        await addScenes('website', p.sceneState, (_i, sc) => sc?.approved === true);
        await addScenes('social_a', p.socialAScenes ?? DEFAULTS.socialAScenes, (i) => ap.socialA?.[i] === true);
        await addScenes('social_b', p.socialBScenes ?? DEFAULTS.socialBScenes, (i) => ap.socialB?.[i] === true);
        await addScenes('email', p.emailScenes ?? DEFAULTS.emailScenes, (i) => ap.email?.[i] === true);
        // Final kit approval: only when the prototype's own fingerprint still matches.
        const fin = finals[pid];
        const st = await kitStatus(t, proj.id);
        let kitCarried = false;
        if (fin && st.allComponentsApproved && fin.fingerprint === prototypeFingerprint(pid, p.sceneState, p.approvals, p.scripts)) {
          await t.query(`INSERT INTO approvals (project_id, subject_type, subject_id, content_hash, decision, decided_by_label, decided_at) VALUES ($1,'kit',$1,$2,'approved',$3,$4)`,
            [proj.id, st.compositeHash, 'Complete Video Kit approved in V2 prototype (imported, fingerprint verified)', fin.approvedAt ?? approvedAt]);
          kitCarried = true; S.kitApprovalsCarried++;
        } else if (fin) {
          S.notes.push(`"${name}": the Complete Video Kit approval from the prototype no longer matched its content, so it was NOT carried over. Review and approve again.`);
        }
        const pr = p.productionRecord ?? {};
        if (pr.status && pr.status !== 'not_started') {
          const status = kitCarried ? pr.status : (['approved', 'package_downloaded', 'delivered'].includes(pr.status) ? 'needs_reapproval' : pr.status);
          await t.query(`UPDATE production_records SET status=$2, approved_at=$3, package_downloaded_at=$4, delivered_at=$5, delivery_method=$6, delivery_reference=$7 WHERE project_id=$1`,
            [proj.id, status, pr.approvedAt ?? null, pr.packageDownloadedAt ?? null, pr.deliveredAt ?? null, pr.deliveryMethod ?? null, pr.deliveryReference ?? null]);
          if (pr.status === 'delivered' && kitCarried) await t.query(`UPDATE projects SET status='delivered' WHERE id=$1`, [proj.id]);
          else if (pr.status === 'delivered') S.notes.push(`"${name}": V2 recorded a delivery on ${pr.deliveredAt ?? 'an unknown date'}, but its final approval could not be verified. The delivery date is kept; the project is marked for reapproval.`);
          else if (kitCarried) await t.query(`UPDATE projects SET status='approved' WHERE id=$1`, [proj.id]);
        } else if (kitCarried) {
          await t.query(`UPDATE production_records SET status='approved', approved_at=$2 WHERE project_id=$1`, [proj.id, fin.approvedAt ?? null]);
          await t.query(`UPDATE projects SET status='approved' WHERE id=$1`, [proj.id]);
        }
        await createCheckpoint(t, proj.id, 'imported', 'Imported from the V2 prototype', actor.label); S.checkpoints++;
        if (cp && !cpNewer) { await t.query(`INSERT INTO checkpoints (project_id, stage, reason, snapshot, created_by_label, created_at) VALUES ($1,'prototype_checkpoint','Automatic checkpoint from the V2 prototype (older than the saved version)',$2,$3,$4)`,
          [proj.id, JSON.stringify({ prototype: cp }), actor.label, cp.checkpointAt ?? new Date().toISOString()]); S.checkpoints++; }
        if (cpNewer) { await t.query(`INSERT INTO checkpoints (project_id, stage, reason, snapshot, created_by_label, created_at) VALUES ($1,'prototype_saved_version','Last named save from the V2 prototype',$2,$3,$4)`,
          [proj.id, JSON.stringify({ prototype: saved }), actor.label, saved.updated ?? new Date().toISOString()]); S.checkpoints++; }
        await remember(pid, 'project', proj.id); S.projects++;
      }
      // Quick Video saved in the same prototype project.
      const q = p.quickVideo;
      if (q?.scriptKey && q?.script && !(await legacy(pid + ':quick', 'project'))) {
        const secs = secsOf(q.length, 15);
        const qp = await createProject(t, actor, {
          clientId: owner.kind === 'client' ? owner.id : null, prospectId: owner.kind === 'prospect' ? owner.id : null,
          kind: q.purpose === 'Email Video' ? 'email_video' : 'quick_video', title: `${name} — Quick Video: ${q.purpose}`, industry: mm.industry, businessType: mm.type ?? null,
          source: 'migration', legacyRef: `proto:${pid}:quick`, status: 'in_progress',
          settings: { purpose: q.purpose, delivery: q.delivery, length: secs, customer: q.customer, service: q.service, provider: q.provider, message: q.message, promotionDetails: q.promotionDetails, narration: q.narration },
          deliverables: [{ kind: 'quick', label: q.purpose || 'Quick Video', duration: secs, formats: [q.purpose === 'Email Video' ? '16x9' : (q.delivery === 'Website / Social' ? '9x16' : '16x9')], script: q.script }],
        });
        await remember(pid + ':quick', 'project', qp.id); S.quickVideos++;
      }
      if (!hasKit && !q?.script) { S.skipped++; S.notes.push(`Saved project "${name}" had no scenes or scripts yet, so only its prospect/client was kept.`); }
    }
    void scriptHash; void cleanWebsite;
    await t.query(`INSERT INTO migration_imports (file_sha256, imported_by_label, summary) VALUES ($1,$2,$3)`, [fileSha, actor.label, JSON.stringify(S)]);
    await audit(t, actor, 'migration.prototype_imported', { type: 'migration', id: fileSha.slice(0, 16) },
      `Imported prototype data: ${S.prospects} prospects, ${S.clients} clients, ${S.projects} kit projects, ${S.quickVideos} quick videos, ${S.images} images`, undefined, S);
    return S;
  }, pool);
}
