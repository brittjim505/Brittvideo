import type pg from 'pg';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { tx } from '../../db/pool.js';
import type { Actor } from '../../auth/permissions.js';
import { requirePerm } from '../../auth/service.js';
import { OwnerError, notFound } from '../../lib/errors.js';
import { audit } from '../audit/service.js';
import { createCheckpoint, createProject, kitStatus, sceneHash, scriptHash, DURATIONS } from '../projects/service.js';
import { STORIES, TONES, PLATFORMS, QUICK_PURPOSES, QUICK_DELIVERY, quickNarration, quickScript } from './templates.js';
import { templateWriter, claudeWriter, type KitDraft, type WriterInput } from './writer.js';
import { readSecret } from '../integrations/secrets.js';
import { logDiagnostic } from '../support/diagnostics.js';
import { objectPath } from '../../integrations/storage.js';
import { INDUSTRY_LABEL, type Industry } from '../../lib/util.js';

async function projectRow(q: pg.Pool | pg.PoolClient, id: string) {
  const p = (await q.query(`SELECT p.*, coalesce(c.business_name, pr.business_name) AS business_name, coalesce(c.website_url, pr.website_url) AS website_url,
      coalesce(c.business_type, pr.business_type, p.business_type) AS btype
    FROM projects p LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN prospects pr ON pr.id=p.prospect_id WHERE p.id=$1`, [id])).rows[0];
  if (!p) throw notFound('project');
  return p;
}
const marketLabel = (industry: string, type?: string | null) => industry === 'other' ? (type || 'Local business') : INDUSTRY_LABEL[industry as Industry] ?? industry;

export function builderOptions(industry: string) {
  return { stories: STORIES[industry] ?? STORIES.other, tones: TONES, platforms: PLATFORMS, websiteLengths: [30, 60, 90, 120], quickPurposes: QUICK_PURPOSES, quickDelivery: QUICK_DELIVERY, quickLengths: DURATIONS };
}

/**
 * STEP 5 — Build the four-video kit (Website, Social A, Social B, Email) from the owner-approved facts and images.
 * Rebuilding replaces scenes; if anything was approved, the owner must confirm, and the approvals are recorded as
 * invalidated (no silent loss, no false green).
 */
export async function buildKit(pool: pg.Pool, actor: Actor, projectId: string, o: { story: string; tone: string; websiteSecs: number; platform: string; confirmReplaceApproved?: boolean },
  deps: { fetcher?: any } = {}) {
  requirePerm(actor, 'work');
  const p = await projectRow(pool, projectId);
  if (p.kind !== 'video_kit') throw new OwnerError('This project is not a Video Kit.');
  const industry = p.industry ?? 'other';
  if (!(STORIES[industry] ?? STORIES.other).includes(o.story)) throw new OwnerError('Please choose a story from the list.');
  if (!TONES.includes(o.tone)) throw new OwnerError('Please choose a tone from the list.');
  if (![30, 60, 90, 120].includes(o.websiteSecs)) throw new OwnerError('The Website Video can be 30, 60, 90 or 120 seconds.');
  const platform = PLATFORMS.includes(o.platform) ? o.platform : 'Universal / Not Sure';
  const facts = (await pool.query(`SELECT id, text FROM project_facts WHERE project_id=$1 AND selected ORDER BY position, created_at`, [projectId])).rows;
  if (!facts.length) throw new OwnerError('Keep or add at least one fact about the business first (Step 2). BrittVideo only writes from facts you have approved.', 409, 'no_facts');
  const images = (await pool.query(`SELECT a.id, a.title, a.alt_text AS alt FROM project_images pi JOIN assets a ON a.id=pi.asset_id
    WHERE pi.project_id=$1 AND pi.selected AND a.status IN ('available','approved') ORDER BY pi.position, pi.added_at`, [projectId])).rows;   // never Do Not Use (T4)
  const status = await kitStatus(pool, projectId);
  const approvedScenes = status.deliverables.reduce((n, d) => n + d.approvedCount, 0);
  if (approvedScenes > 0 && !o.confirmReplaceApproved) {
    throw new OwnerError(`${approvedScenes} scene(s) are already approved. Building again replaces all scenes and they will need approval again. Press BUILD AGAIN to confirm.`, 409, 'confirm_rebuild', { approvedScenes });
  }
  const input: WriterInput = { businessName: p.business_name, industry, businessType: p.btype, story: o.story, tone: o.tone, websiteUrl: p.website_url, facts, images, websiteSecs: o.websiteSecs };
  let draft: KitDraft;
  const key = await readSecret(pool, 'anthropic.api_key').catch(() => null);
  if (key) {
    try { draft = await claudeWriter(input, key, process.env.ANTHROPIC_MODEL || 'claude-sonnet-5', deps.fetcher); }
    catch (e: any) {
      await logDiagnostic(pool, 'warn', 'ai-writer', 'AI writer result rejected or unavailable; used templates', { error: e.message });
      draft = { ...templateWriter(input), note: 'The AI writer was not available (or its draft did not follow the rules), so BrittVideo wrote this from your facts using its built-in templates.' };
    }
  } else draft = templateWriter(input);

  return tx(async (t) => {
    await t.query(`SELECT id FROM projects WHERE id=$1 FOR UPDATE`, [projectId]);
    const dels = (await t.query(`SELECT * FROM deliverables WHERE project_id=$1`, [projectId])).rows;
    const byKind = (k: string) => dels.find((d) => d.kind === k);
    for (const kind of ['website', 'social_a', 'social_b', 'email'] as const) {
      const d = byKind(kind); if (!d) continue;
      const old = (await t.query(`SELECT id, content_hash FROM scenes WHERE deliverable_id=$1`, [d.id])).rows;
      for (const s of old) {
        const a = (await t.query(`SELECT decision, content_hash FROM approvals WHERE subject_type='scene' AND subject_id=$1 ORDER BY decided_at DESC, id DESC LIMIT 1`, [s.id])).rows[0];
        if (a?.decision === 'approved' && a.content_hash === s.content_hash)
          await t.query(`INSERT INTO approval_invalidations (project_id, subject_type, subject_id, previous_hash, new_hash, reason, by_label) VALUES ($1,'scene',$2,$3,'rebuilt',$4,$5)`,
            [projectId, s.id, s.content_hash, `${d.label} rebuilt from Step 5`, actor.label]);
      }
      await t.query(`DELETE FROM scenes WHERE deliverable_id=$1`, [d.id]);
      const secs = kind === 'website' ? o.websiteSecs : d.duration_s;
      const brief = `${secs}-Second ${marketLabel(industry, p.btype)} Video — “${o.story}”\nFor: ${p.business_name}\nVideo: ${d.label} · ${d.formats.map((f: string) => f.replace('x', ':')).join(' / ')}\nTone: ${o.tone}\nCreation platform: ${platform}\nRule: each scene is one continuous shot; no on-screen text generated in-scene; logo and call to action are added in editing.`;
      await t.query(`UPDATE deliverables SET duration_s=$2, script_text=$3, script_hash=$4 WHERE id=$1`, [d.id, secs, brief, scriptHash(brief)]);
      let pos = 1;
      for (const s of draft[kind]) {
        const imageRow = s.imageId ? images.find((i) => i.id === s.imageId) : null;
        const image_ref = imageRow ? { assetId: imageRow.id, title: imageRow.title } : null;
        const row = { name: s.name || `Scene ${pos}`, start_s: s.start_s, end_s: Math.min(s.end_s, secs), image_ref, visual: s.visual, narration: s.narration };
        await t.query(`INSERT INTO scenes (deliverable_id, position, name, start_s, end_s, image_ref, visual, narration, content_hash, fact_ids, written_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [d.id, pos++, row.name, row.start_s, row.end_s, image_ref ? JSON.stringify(image_ref) : null, row.visual, row.narration, sceneHash(row), s.factIds, draft.writtenBy]);
      }
    }
    await t.query(`UPDATE projects SET story=$2, tone=$3, settings=settings || $4::jsonb, workflow_step=GREATEST(workflow_step,6),
      status=CASE WHEN status IN ('ready_to_start','approved') THEN 'in_progress' ELSE status END WHERE id=$1`,
      [projectId, o.story, o.tone, JSON.stringify({ websiteLength: o.websiteSecs, platform, writtenBy: draft.writtenBy })]);
    const rec = (await t.query(`SELECT status FROM production_records WHERE project_id=$1`, [projectId])).rows[0];
    if (rec && ['approved', 'package_downloaded', 'delivered'].includes(rec.status)) await t.query(`UPDATE production_records SET status='needs_reapproval', updated_at=now() WHERE project_id=$1`, [projectId]);
    await createCheckpoint(t, projectId, 'scripts_built', `Four videos built (${o.story}, ${o.websiteSecs}-second website)`, actor.label);
    await audit(t, actor, 'project.kit_built', { type: 'project', id: projectId }, `Built Website ${o.websiteSecs}s, Social A, Social B and Email (${draft.writtenBy})`);
    return { writtenBy: draft.writtenBy, note: draft.note ?? null, status: await kitStatus(t, projectId) };
  }, pool);
}

/** Change a scene's image (never a Do Not Use or deleted image). */
export async function setSceneImage(pool: pg.Pool, actor: Actor, projectId: string, sceneId: string, assetId: string | null) {
  requirePerm(actor, 'work');
  let ref: any = null;
  if (assetId) {
    const a = (await pool.query(`SELECT id, title, status FROM assets WHERE id=$1`, [assetId])).rows[0];
    if (!a || ['recently_deleted', 'permanently_deleted'].includes(a.status)) throw notFound('image');
    if (a.status === 'do_not_use') throw new OwnerError('That image is marked Do Not Use.', 409, 'do_not_use');
    ref = { assetId: a.id, title: a.title };
    await pool.query(`INSERT INTO project_images (project_id, asset_id, selected, position) VALUES ($1,$2,true,999) ON CONFLICT (project_id, asset_id) DO UPDATE SET selected=true`, [projectId, a.id]);
  }
  const { updateScene } = await import('../projects/service.js');
  return updateScene(pool, actor, projectId, sceneId, { image_ref: ref });
}

// ---------------------------------------------------------------------------------------------------------------
// STEP 8 — Download (approval-gated) and delivery record
// ---------------------------------------------------------------------------------------------------------------
function zip(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'); const crc = zlib.crc32(f.data) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(f.data.length, 18); local.writeUInt32LE(f.data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, f.data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(f.data.length, 20); c.writeUInt32LE(f.data.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42); central.push(c, name);
    offset += 30 + name.length + f.data.length;
  }
  const cen = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cen.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cen, end]);
}
export const cleanName = (s: string) => s.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'Client';
const FORMAT_FILE: Record<string, string> = { '16x9': '16x9_Landscape', '9x16': '9x16_Vertical', '1x1': '1x1_Square' };

export async function buildKitZip(pool: pg.Pool, actor: Actor, projectId: string) {
  requirePerm(actor, 'work');
  const p = await projectRow(pool, projectId);
  const st = await kitStatus(pool, projectId);
  if (!st.completeVideoKitApproved) throw new OwnerError('Approve the Complete Video Kit (Step 7) before downloading. BrittVideo only packages approved work.', 409, 'not_approved');
  const dels = (await pool.query(`SELECT * FROM deliverables WHERE project_id=$1 ORDER BY position`, [projectId])).rows;
  const scenes = (await pool.query(`SELECT s.* FROM scenes s JOIN deliverables d ON d.id=s.deliverable_id WHERE d.project_id=$1 ORDER BY d.position, s.position`, [projectId])).rows;
  const facts = new Map((await pool.query(`SELECT id, text, source_url FROM project_facts WHERE project_id=$1`, [projectId])).rows.map((f) => [f.id, f]));
  const client = cleanName(p.business_name);
  const files: { name: string; data: Buffer }[] = [];
  const usedAssets = new Map<string, { title: string }>();
  const sceneText = (d: any, fmt: string) => `${d.script_text}\nFormat for this file: ${fmt}\n\n` + scenes.filter((s) => s.deliverable_id === d.id).map((s) => {
    if (s.image_ref?.assetId) usedAssets.set(s.image_ref.assetId, { title: s.image_ref.title });
    const src = (s.fact_ids ?? []).map((id: string) => facts.get(id)).filter(Boolean).map((f: any) => f.source_url ? `${f.source_url}` : 'provided by the client/owner');
    return `SCENE ${s.position} — ${s.name}\nTIME: ${s.start_s}–${s.end_s} sec\nIMAGE: ${s.image_ref?.title ?? 'none'}\nSCENE VISUALIZATION: ${s.visual}\nNARRATION: ${s.narration ? '“' + s.narration + '”' : '(no narration)'}\n${src.length ? 'SOURCE: ' + [...new Set(src)].join(' ; ') + '\n' : s.narration && s.written_by === 'owner' ? 'SOURCE: written by the owner\n' : ''}`;
  }).join('\n');
  for (const d of dels) {
    const label = d.kind === 'website' ? 'Website' : d.kind === 'social_a' ? 'Social_A' : d.kind === 'social_b' ? 'Social_B' : d.kind === 'email' ? 'Email' : 'Video';
    if (d.formats.length === 1) files.push({ name: `${client}_${label}_${d.duration_s}sec.txt`, data: Buffer.from(sceneText(d, FORMAT_FILE[d.formats[0]].replace('_', ' '))) });
    else for (const f of d.formats) files.push({ name: `${client}_${label}_${d.duration_s}sec_${FORMAT_FILE[f]}.txt`, data: Buffer.from(sceneText(d, FORMAT_FILE[f].replace('_', ' ') + (f === '9x16' ? '' : ' — reframe the approved scenes without changing narration'))) });
  }
  const assets = usedAssets.size ? (await pool.query(`SELECT id, title, storage_key, mime, source_url, rights_note FROM assets WHERE id = ANY($1::uuid[])`, [[...usedAssets.keys()]])).rows : [];
  const sources: string[] = [];
  let n = 1;
  for (const a of assets) {
    const ext = a.mime === 'image/png' ? 'png' : a.mime === 'image/webp' ? 'webp' : 'jpg';
    const fname = `images/${String(n).padStart(2, '0')}_${cleanName(a.title)}.${ext}`;
    const pth = a.storage_key ? objectPath(a.storage_key) : null;
    if (pth) files.push({ name: fname, data: fs.readFileSync(pth) });
    sources.push(`${n}. ${a.title}\n   File: ${pth ? fname : '(file no longer available)'}\n   Source: ${a.source_url ?? 'BrittVideo Image Library'}\n   Rights: ${a.rights_note ?? 'Confirm usage rights.'}`);
    n++;
  }
  files.push({ name: `${client}_Image_Sources.txt`, data: Buffer.from(`IMAGE SOURCES — ${p.business_name}\n\n${sources.join('\n\n') || 'No images used.'}\n`) });
  const manifest = `BRITTVIDEO COMPLETE VIDEO KIT\nClient: ${p.business_name}\nProject: ${p.title}\nStory: ${p.story ?? ''}\nApproved version: ${st.compositeHash.slice(0, 12)}\n\nPACKAGE\n` +
    st.deliverables.map((d, i) => `${i + 1}. ${d.label} — ${d.durationS} sec — ${d.formats.map((f: string) => FORMAT_FILE[f].replace('_', ' ')).join(' / ')} — ${d.approvedCount}/${d.sceneCount} scenes approved`).join('\n') +
    `\n\nSTATUS: COMPLETE VIDEO KIT APPROVED\nEvery narration line lists its source. Confirm the client's permission for all images before final production.\n`;
  files.unshift({ name: '00_READ_ME.txt', data: Buffer.from(manifest) });
  const fileName = `${client}_BrittVideo_Complete_Kit.zip`;
  await tx(async (t) => {
    await t.query(`INSERT INTO download_events (project_id, kind, kit_hash, file_name, by_label) VALUES ($1,'complete_kit',$2,$3,$4)`, [projectId, st.compositeHash, fileName, actor.label]);
    await t.query(`UPDATE production_records SET status=CASE WHEN status='delivered' THEN status ELSE 'package_downloaded' END, package_downloaded_at=now(), updated_at=now() WHERE project_id=$1`, [projectId]);
    await t.query(`UPDATE projects SET workflow_step=GREATEST(workflow_step,8) WHERE id=$1`, [projectId]);
    await audit(t, actor, 'project.kit_downloaded', { type: 'project', id: projectId }, `Complete Video Kit downloaded (${fileName})`);
  }, pool);
  return { fileName, data: zip(files) };
}

/** RECORD DELIVERY — only after the approved kit was actually downloaded; history is append-only (N11, N13). */
export async function recordDelivery(pool: pg.Pool, actor: Actor, projectId: string, input: { method: string; reference?: string }) {
  requirePerm(actor, 'work');
  if (!input.method?.trim()) throw new OwnerError('Say how the files were delivered (for example "Emailed download link").');
  return tx(async (t) => {
    const st = await kitStatus(t, projectId);
    const rec = (await t.query(`SELECT * FROM production_records WHERE project_id=$1 FOR UPDATE`, [projectId])).rows[0];
    if (!st.completeVideoKitApproved) throw new OwnerError('The kit is not approved in its current form, so delivery cannot be recorded.', 409, 'not_approved');
    const dl = (await t.query(`SELECT 1 FROM download_events WHERE project_id=$1 AND kit_hash=$2 AND kind='complete_kit'`, [projectId, st.compositeHash])).rowCount;
    if (!dl) throw new OwnerError('Download the approved Complete Video Kit first. BrittVideo will not record a delivery before that happens.', 409, 'not_downloaded');
    await t.query(`INSERT INTO delivery_records (project_id, kit_hash, method, reference, recorded_by_label) VALUES ($1,$2,$3,$4,$5)`, [projectId, st.compositeHash, input.method.trim(), input.reference?.trim() || null, actor.label]);
    await t.query(`UPDATE production_records SET status='delivered', delivered_at=now(), delivery_method=$2, delivery_reference=$3, updated_at=now() WHERE project_id=$1`, [projectId, input.method.trim(), input.reference?.trim() || null]);
    await t.query(`UPDATE projects SET status='delivered' WHERE id=$1`, [projectId]);
    // Images in delivered work get the strongest protection class (T15, Q21).
    await t.query(`UPDATE assets SET protection_class='delivered' WHERE id IN (SELECT (s.image_ref->>'assetId')::uuid FROM scenes s JOIN deliverables d ON d.id=s.deliverable_id WHERE d.project_id=$1 AND s.image_ref ? 'assetId')`, [projectId]);
    await audit(t, actor, 'project.delivered', { type: 'project', id: projectId }, `Delivery recorded: ${input.method.trim()}`);
    void rec;
    return { delivered: true };
  }, pool);
}

export async function deliveryHistory(pool: pg.Pool, projectId: string) {
  return (await pool.query(`SELECT method, reference, delivered_at, recorded_by_label, kit_hash FROM delivery_records WHERE project_id=$1 ORDER BY delivered_at DESC`, [projectId])).rows;
}

// ---------------------------------------------------------------------------------------------------------------
// Quick Video and standalone Email Video (K12, K13, K15)
// ---------------------------------------------------------------------------------------------------------------
export interface QuickInput { clientId?: string | null; prospectId?: string | null; purpose: string; delivery: string; lengthSecs: number; tone?: string;
  customer?: string; service?: string; provider?: string; message?: string; promotionDetails?: string }

export async function createQuickVideo(pool: pg.Pool, actor: Actor, i: QuickInput) {
  requirePerm(actor, 'work');
  if (!(QUICK_PURPOSES as readonly string[]).includes(i.purpose)) throw new OwnerError('Please choose a purpose from the list.');
  if (!(QUICK_DELIVERY as readonly string[]).includes(i.delivery)) throw new OwnerError('Please choose Email, Text / SMS Link or Website / Social.');
  if (!DURATIONS.includes(i.lengthSecs as any)) throw new OwnerError('Quick Videos can be 15, 30, 60, 90 or 120 seconds.');
  if (i.purpose === 'Promotion' && !i.promotionDetails?.trim()) throw new OwnerError('Please enter Promotion / Offer Details before building the Promotion video.');
  const owner = i.clientId ? (await pool.query(`SELECT id, business_name, industry, business_type FROM clients WHERE id=$1`, [i.clientId])).rows[0]
    : i.prospectId ? (await pool.query(`SELECT id, business_name, industry, business_type FROM prospects WHERE id=$1`, [i.prospectId])).rows[0] : null;
  if (!owner) throw new OwnerError('Choose the client (or prospect) this video is for.');
  const tone = TONES.includes(i.tone ?? '') ? i.tone! : 'Warm & Emotional';
  const narration = quickNarration(i.purpose, owner.business_name, i.customer?.trim() ?? '', i.service?.trim() ?? '', i.provider?.trim() ?? '', i.message?.trim() ?? '', i.lengthSecs, i.promotionDetails?.trim() ?? '');
  const market = marketLabel(owner.industry, owner.business_type);
  const script = quickScript({ purpose: i.purpose, delivery: i.delivery, secs: i.lengthSecs, client: owner.business_name, market, tone, customer: i.customer ?? '', service: i.service ?? '', provider: i.provider ?? '', message: i.message ?? '', promotionDetails: i.promotionDetails ?? '', narration });
  const isEmail = i.purpose === 'Email Video';
  const format = isEmail || i.delivery !== 'Website / Social' ? ['16x9'] : ['16x9', '9x16', '1x1'];
  return tx(async (t) => {
    const p = await createProject(t, actor, {
      clientId: i.clientId ?? null, prospectId: i.clientId ? null : i.prospectId ?? null, kind: isEmail ? 'email_video' : 'quick_video',
      title: `${owner.business_name} — ${isEmail ? 'Email Video' : 'Quick Video: ' + i.purpose} (${i.lengthSecs} sec)`, industry: owner.industry, businessType: owner.business_type,
      source: 'manual', status: 'in_progress',
      settings: { purpose: i.purpose, delivery: i.delivery, length: i.lengthSecs, tone, customer: i.customer ?? '', service: i.service ?? '', provider: i.provider ?? '', message: i.message ?? '', promotionDetails: i.promotionDetails ?? '', narration },
      deliverables: [{ kind: isEmail ? 'email' : 'quick', label: isEmail ? 'Email Video' : i.purpose, duration: i.lengthSecs, formats: format, script }],
    });
    await createCheckpoint(t, p.id, 'scripts_built', `${isEmail ? 'Email Video' : 'Quick Video'} script built`, actor.label);
    return { projectId: p.id };
  }, pool);
}

/** Download one approved script (Quick Video / Email Video), with a clean filename. */
export async function scriptDownload(pool: pg.Pool, actor: Actor, projectId: string, deliverableId: string) {
  requirePerm(actor, 'work');
  const p = await projectRow(pool, projectId);
  const d = (await pool.query(`SELECT * FROM deliverables WHERE id=$1 AND project_id=$2`, [deliverableId, projectId])).rows[0];
  if (!d) throw notFound('video');
  const st = await kitStatus(pool, projectId);
  const ds = st.deliverables.find((x) => x.id === deliverableId)!;
  if (!ds.complete) throw new OwnerError('Approve this script first. BrittVideo only downloads approved work.', 409, 'not_approved');
  const fileName = `${cleanName(p.business_name)}_${cleanName(d.label)}_${d.duration_s}sec.txt`;
  await pool.query(`INSERT INTO download_events (project_id, kind, kit_hash, file_name, by_label) VALUES ($1,'script',$2,$3,$4)`, [projectId, d.script_hash, fileName, actor.label]);
  return { fileName, data: Buffer.from(d.script_text) };
}
