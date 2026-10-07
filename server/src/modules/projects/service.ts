import type pg from 'pg';
import type { Queryable } from '../../db/pool.js';
import { tx } from '../../db/pool.js';
import type { Actor } from '../../auth/permissions.js';
import { requirePerm } from '../../auth/service.js';
import { OwnerError, notFound } from '../../lib/errors.js';
import { contentHash, sha256 } from '../../lib/util.js';
import { audit } from '../audit/service.js';

export type DeliverableKind = 'website' | 'social_a' | 'social_b' | 'thank_you' | 'email' | 'quick';
export const DURATIONS = [15, 30, 60, 90, 120] as const;

/**
 * The Standard (and Premier) deliverable set, as confirmed by the owner on 2026-10-07 — five videos:
 * Website (up to 90 s; the client chooses landscape, square or portrait), Social Portrait 9:16, Social Landscape 16:9,
 * a Thank-You Video and a separate Email Video. (Internal kinds social_a / social_b are kept for older projects.)
 */
export const WEBSITE_FORMATS = ['16x9', '1x1', '9x16'] as const;
export const WEBSITE_LENGTHS = [30, 60, 90] as const;
export const KIT_DELIVERABLES: { kind: DeliverableKind; label: string; duration: number; formats: string[] }[] = [
  { kind: 'website', label: 'Website Video', duration: 60, formats: ['16x9'] },
  { kind: 'social_a', label: 'Social Portrait', duration: 30, formats: ['9x16'] },
  { kind: 'social_b', label: 'Social Landscape', duration: 30, formats: ['16x9'] },
  { kind: 'thank_you', label: 'Thank-You Video', duration: 30, formats: ['16x9'] },
  { kind: 'email', label: 'Email Video', duration: 15, formats: ['16x9'] },
];

export const sceneHash = (s: { name: string; start_s: number; end_s: number; image_ref: unknown; visual: string; narration: string }) =>
  contentHash({ name: s.name, start: s.start_s, end: s.end_s, image: s.image_ref ?? null, visual: s.visual, narration: s.narration });
export const scriptHash = (text: string) => sha256(text ?? '');

export async function createProject(q: Queryable, actor: Actor, p: {
  clientId?: string | null; prospectId?: string | null; orderId?: string | null; kind: 'video_kit' | 'quick_video' | 'email_video' | 'premier_quarterly' | 'provider_test';
  title: string; industry?: string | null; businessType?: string | null; source: 'sale' | 'manual' | 'migration' | 'premier_schedule' | 'provider_test';
  includedInPremier?: boolean; settings?: Record<string, unknown>; legacyRef?: string | null; status?: string;
  deliverables?: { kind: DeliverableKind; label: string; duration: number; formats: string[]; script?: string }[];
}) {
  const proj = (await q.query(
    `INSERT INTO projects (client_id, prospect_id, order_id, kind, title, industry, business_type, source, included_in_premier, settings, legacy_ref, created_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,coalesce($13,'ready_to_start')) RETURNING *`,
    [p.clientId ?? null, p.prospectId ?? null, p.orderId ?? null, p.kind, p.title, p.industry ?? null, p.businessType ?? null, p.source,
      !!p.includedInPremier, JSON.stringify(p.settings ?? {}), p.legacyRef ?? null, actor.userId, p.status ?? null])).rows[0];
  const dels = p.deliverables ?? (p.kind === 'video_kit' ? KIT_DELIVERABLES : []);
  let pos = 1;
  for (const d of dels) {
    if (!DURATIONS.includes(d.duration as any)) throw new OwnerError('Video lengths must be 15, 30, 60, 90 or 120 seconds.');
    const script = (d as any).script ?? '';
    await q.query(`INSERT INTO deliverables (project_id, kind, label, duration_s, formats, position, script_text, script_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [proj.id, d.kind, d.label, d.duration, d.formats, pos++, script, scriptHash(script)]);
  }
  await q.query(`INSERT INTO production_records (project_id) VALUES ($1) ON CONFLICT DO NOTHING`, [proj.id]);
  await audit(q, actor, 'project.created', { type: 'project', id: proj.id }, `Project created: ${proj.title}`);
  return proj;
}

// ---------------------------------------------------------------------------------------------------------------
// Approval ledger (K7–K10, Y5, Y6)
// ---------------------------------------------------------------------------------------------------------------
async function latestApprovals(q: Queryable, projectId: string) {
  const rows = (await q.query(`SELECT DISTINCT ON (subject_type, subject_id) subject_type, subject_id, content_hash, decision, decided_at, decided_by_label
      FROM approvals WHERE project_id=$1 ORDER BY subject_type, subject_id, decided_at DESC, id DESC`, [projectId])).rows;
  const map = new Map<string, any>();
  for (const r of rows) map.set(`${r.subject_type}:${r.subject_id}`, r);
  return map;
}
const isValid = (a: any, currentHash: string) => !!a && a.decision === 'approved' && a.content_hash === currentHash;

/**
 * The single source of truth for approval state. Every counter the UI shows is derived from this (K8, "no false green").
 */
export async function kitStatus(q: Queryable, projectId: string) {
  const dels = (await q.query(`SELECT * FROM deliverables WHERE project_id=$1 ORDER BY position`, [projectId])).rows;
  const scenes = (await q.query(`SELECT s.* FROM scenes s JOIN deliverables d ON d.id=s.deliverable_id WHERE d.project_id=$1 ORDER BY s.position`, [projectId])).rows;
  const appr = await latestApprovals(q, projectId);
  const deliverables = dels.map((d) => {
    const ds = scenes.filter((s) => s.deliverable_id === d.id);
    const sceneStates = ds.map((s) => ({ id: s.id, position: s.position, name: s.name, approved: isValid(appr.get(`scene:${s.id}`), s.content_hash),
      wasApprovedEarlier: !!appr.get(`scene:${s.id}`) && !isValid(appr.get(`scene:${s.id}`), s.content_hash) }));
    // Deliverables without scenes (e.g. a Quick Video script) are approved at script level.
    const scriptApproved = isValid(appr.get(`script:${d.id}`), d.script_hash);
    const approvedCount = sceneStates.filter((s) => s.approved).length;
    const complete = ds.length ? approvedCount === ds.length : scriptApproved;
    const hasContent = ds.length > 0 || (d.script_text ?? '').trim().length > 0;
    return { id: d.id, kind: d.kind, label: d.label, durationS: d.duration_s, formats: d.formats, required: d.required,
      sceneCount: ds.length, approvedCount, scriptApproved, hasContent, complete: complete && hasContent, scenes: sceneStates };
  });
  const required = deliverables.filter((d) => d.required);
  const composite = contentHash(dels.filter((d) => d.required).map((d) => ({ id: d.id, script: d.script_hash,
    scenes: scenes.filter((s) => s.deliverable_id === d.id).map((s) => s.content_hash) })));
  const allComponentsApproved = required.length > 0 && required.every((d) => d.complete);
  const kitA = appr.get(`kit:${projectId}`);
  const finalApproved = allComponentsApproved && isValid(kitA, composite);
  return {
    deliverables, compositeHash: composite, allComponentsApproved, readyForFinalApproval: allComponentsApproved && !finalApproved,
    completeVideoKitApproved: finalApproved,
    finalApprovalLostBecause: !finalApproved && kitA?.decision === 'approved' ? 'Approved content changed after final approval.' : null,
  };
}

export async function approve(pool: pg.Pool, actor: Actor, projectId: string, subject: { type: 'scene' | 'script' | 'kit'; id: string; expectedHash?: string | null }) {
  requirePerm(actor, 'work', 'approve content');
  return tx(async (t) => {
    await t.query(`SELECT id FROM projects WHERE id=$1 FOR UPDATE`, [projectId]);
    let hash: string;
    if (subject.type === 'scene') {
      const s = (await t.query(`SELECT s.* FROM scenes s JOIN deliverables d ON d.id=s.deliverable_id WHERE s.id=$1 AND d.project_id=$2`, [subject.id, projectId])).rows[0];
      if (!s) throw notFound('scene'); hash = s.content_hash;
    } else if (subject.type === 'script') {
      const d = (await t.query(`SELECT * FROM deliverables WHERE id=$1 AND project_id=$2`, [subject.id, projectId])).rows[0];
      if (!d) throw notFound('video'); hash = d.script_hash;
    } else {
      if (subject.id !== projectId) throw notFound('project');
      const st = await kitStatus(t, projectId);
      if (!st.allComponentsApproved) {
        const missing = st.deliverables.filter((d) => d.required && !d.complete).map((d) => `${d.label} (${d.approvedCount}/${d.sceneCount || 1})`);
        throw new OwnerError(`The Complete Video Kit cannot be approved yet. Still waiting on: ${missing.join(', ')}.`, 409, 'kit_incomplete');
      }
      hash = st.compositeHash;
    }
    // Approve exactly what the owner was looking at: if it changed since (another tab, a restore), refuse (Y5).
    if (!subject.expectedHash) throw new OwnerError('Please refresh the page, then approve again.', 400, 'expected_hash');
    if (subject.expectedHash !== hash) throw new OwnerError('This changed since you opened it. BrittVideo is showing you the latest version — please review it, then approve.', 409, 'content_changed');
    await t.query(`INSERT INTO approvals (project_id, subject_type, subject_id, content_hash, decision, decided_by, decided_by_label) VALUES ($1,$2,$3,$4,'approved',$5,$6)`,
      [projectId, subject.type, subject.id, hash, actor.userId, actor.label]);
    if (subject.type === 'kit') {
      await t.query(`UPDATE production_records SET status='approved', approved_at=now(), updated_at=now() WHERE project_id=$1`, [projectId]);
      await t.query(`UPDATE projects SET status='approved' WHERE id=$1`, [projectId]);
      await createCheckpoint(t, projectId, 'kit_approved', 'Complete Video Kit approved', actor.label);
      await audit(t, actor, 'project.kit_approved', { type: 'project', id: projectId }, 'Complete Video Kit approved');
    }
    return kitStatus(t, projectId);
  }, pool);
}

/**
 * Remove a picture from every scene that uses it (it was marked Do Not Use or deleted). The scene's content changes,
 * so its approval — and the Complete Video Kit approval — are withdrawn; the picture can never ship in a kit (T4, T6).
 */
export async function detachImageFromScenes(t: Queryable, actor: Actor, assetIds: string[], why: string) {
  if (!assetIds.length) return 0;
  const rows = (await t.query(`SELECT s.*, d.project_id FROM scenes s JOIN deliverables d ON d.id=s.deliverable_id
    WHERE s.image_ref->>'assetId' = ANY($1::text[]) FOR UPDATE OF s`, [assetIds])).rows;
  for (const s of rows) {
    const h = sceneHash({ ...s, image_ref: null });
    await t.query(`UPDATE scenes SET image_ref=NULL, content_hash=$2, content_version=content_version+1, updated_at=now() WHERE id=$1`, [s.id, h]);
    await recordInvalidationIfApproved(t, actor, s.project_id, 'scene', s.id, s.content_hash, h, `Scene ${s.position} picture removed (${why})`);
  }
  return rows.length;
}

/** Edit a scene's words (name, visual, narration). Pictures change only through setSceneImage, which enforces Do Not Use. */
export async function updateScene(pool: pg.Pool, actor: Actor, projectId: string, sceneId: string, input: Partial<{ name: string; visual: string; narration: string }>) {
  const patch: Record<string, string> = {};
  for (const [k, max] of [['name', 120], ['visual', 2000], ['narration', 1200]] as const) {
    const v = (input as any)?.[k];
    if (v === undefined) continue;
    if (typeof v !== 'string') throw new OwnerError('Please type words for the scene.');
    if (v.length > max) throw new OwnerError(`That is too long — please keep the ${k === 'name' ? 'scene name' : k} under ${max} characters.`);
    patch[k] = k === 'name' ? v.trim() || 'Scene' : v.trim();
  }
  return updateSceneContent(pool, actor, projectId, sceneId, patch);
}

/** Internal: apply a validated scene change. A material change to approved content invalidates that scene (and the final kit approval) — K10/W7. */
export async function updateSceneContent(pool: pg.Pool, actor: Actor, projectId: string, sceneId: string, patch: Partial<{ name: string; visual: string; narration: string; image_ref: unknown }>) {
  requirePerm(actor, 'work');
  return tx(async (t) => {
    const s = (await t.query(`SELECT s.* FROM scenes s JOIN deliverables d ON d.id=s.deliverable_id WHERE s.id=$1 AND d.project_id=$2 FOR UPDATE`, [sceneId, projectId])).rows[0];
    if (!s) throw notFound('scene');
    const next = { ...s, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    const h = sceneHash(next);
    if (h === s.content_hash) return kitStatus(t, projectId);
    // Rewritten words are the owner's own — they no longer come from a website page, so the source citation is cleared (never mis-cited).
    const reworded = (next.narration ?? '') !== (s.narration ?? '');
    await t.query(`UPDATE scenes SET name=$2, visual=$3, narration=$4, image_ref=$5, content_hash=$6, content_version=content_version+1, updated_at=now(),
        fact_ids = CASE WHEN $7 THEN '{}'::uuid[] ELSE fact_ids END, written_by = CASE WHEN $7 THEN 'owner' ELSE written_by END WHERE id=$1`,
      [sceneId, next.name, next.visual, next.narration, next.image_ref === null ? null : JSON.stringify(next.image_ref), h, reworded]);
    await recordInvalidationIfApproved(t, actor, projectId, 'scene', sceneId, s.content_hash, h, `Scene ${s.position} "${s.name}" edited`);
    return kitStatus(t, projectId);
  }, pool);
}

export async function updateScript(pool: pg.Pool, actor: Actor, projectId: string, deliverableId: string, text: string) {
  requirePerm(actor, 'work');
  return tx(async (t) => {
    const d = (await t.query(`SELECT * FROM deliverables WHERE id=$1 AND project_id=$2 FOR UPDATE`, [deliverableId, projectId])).rows[0];
    if (!d) throw notFound('video');
    const h = scriptHash(text);
    if (h === d.script_hash) return kitStatus(t, projectId);
    await t.query(`UPDATE deliverables SET script_text=$2, script_hash=$3 WHERE id=$1`, [deliverableId, text, h]);
    await recordInvalidationIfApproved(t, actor, projectId, 'script', deliverableId, d.script_hash, h, `${d.label} script edited`);
    return kitStatus(t, projectId);
  }, pool);
}

async function recordInvalidationIfApproved(t: Queryable, actor: Actor, projectId: string, type: string, id: string, prevHash: string, newHash: string, reason: string) {
  const a = (await t.query(`SELECT decision, content_hash FROM approvals WHERE subject_type=$1 AND subject_id=$2 ORDER BY decided_at DESC, id DESC LIMIT 1`, [type, id])).rows[0];
  const kitWasFinal = (await t.query(`SELECT status FROM production_records WHERE project_id=$1`, [projectId])).rows[0];
  if (a && a.decision === 'approved' && a.content_hash === prevHash) {
    await t.query(`INSERT INTO approval_invalidations (project_id, subject_type, subject_id, previous_hash, new_hash, reason, by_label) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [projectId, type, id, prevHash, newHash, reason, actor.label]);
  }
  // Mirrors prototype V2.11.13: an approved/downloaded kit returns to "changes made — reapproval required" and delivery is not claimed.
  if (kitWasFinal && ['approved', 'package_downloaded', 'delivered'].includes(kitWasFinal.status)) {
    await t.query(`UPDATE production_records SET status='needs_reapproval', updated_at=now() WHERE project_id=$1`, [projectId]);
    await t.query(`UPDATE projects SET status='in_progress' WHERE id=$1 AND status IN ('approved','ready_for_delivery','delivered')`, [projectId]);
    await audit(t, actor, 'project.final_approval_invalidated', { type: 'project', id: projectId }, `Final approval removed: ${reason}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Checkpoints (Q3–Q6) — append-only snapshots at meaningful stages; restore never fabricates approvals.
// ---------------------------------------------------------------------------------------------------------------
async function snapshot(q: Queryable, projectId: string) {
  const project = (await q.query(`SELECT id, title, status, story, tone, settings, workflow_step FROM projects WHERE id=$1`, [projectId])).rows[0];
  const deliverables = (await q.query(`SELECT id, kind, label, duration_s, formats, script_text FROM deliverables WHERE project_id=$1 ORDER BY position`, [projectId])).rows;
  const scenes = (await q.query(`SELECT s.deliverable_id, s.position, s.name, s.start_s, s.end_s, s.image_ref, s.visual, s.narration, s.fact_ids, s.written_by
    FROM scenes s JOIN deliverables d ON d.id=s.deliverable_id WHERE d.project_id=$1 ORDER BY d.position, s.position`, [projectId])).rows;
  return { project, deliverables, scenes };
}

export async function createCheckpoint(q: Queryable, projectId: string, stage: string, reason: string, byLabel: string) {
  const snap = await snapshot(q, projectId);
  const r = (await q.query(`INSERT INTO checkpoints (project_id, stage, reason, snapshot, created_by_label) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
    [projectId, stage, reason, JSON.stringify(snap), byLabel])).rows[0];
  return r;
}

export async function listCheckpoints(q: Queryable, actor: Actor, projectId: string) {
  requirePerm(actor, 'work');
  return (await q.query(`SELECT id, stage, reason, created_by_label, created_at FROM checkpoints WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100`, [projectId])).rows;
}

export async function restoreCheckpoint(pool: pg.Pool, actor: Actor, projectId: string, checkpointId: string) {
  requirePerm(actor, 'work');
  return tx(async (t) => {
    const cp = (await t.query(`SELECT * FROM checkpoints WHERE id=$1 AND project_id=$2`, [checkpointId, projectId])).rows[0];
    if (!cp) throw notFound('checkpoint');
    await t.query(`SELECT id FROM projects WHERE id=$1 FOR UPDATE`, [projectId]);
    await createCheckpoint(t, projectId, 'before_restore', `Automatic safety copy before restoring the ${new Date(cp.created_at).toLocaleString()} version`, actor.label);
    const snap = cp.snapshot;
    await t.query(`UPDATE projects SET story=$2, tone=$3, settings=$4, workflow_step=$5 WHERE id=$1`,
      [projectId, snap.project.story, snap.project.tone, JSON.stringify(snap.project.settings ?? {}), snap.project.workflow_step]);
    for (const d of snap.deliverables) {
      const cur = (await t.query(`SELECT * FROM deliverables WHERE id=$1 AND project_id=$2`, [d.id, projectId])).rows[0];
      if (!cur) continue;
      // The video's name and shape come back with its script and scenes (e.g. the Website Video shape chosen then).
      if (Array.isArray(d.formats) && d.formats.length && (d.label !== cur.label || JSON.stringify(d.formats) !== JSON.stringify(cur.formats)))
        await t.query(`UPDATE deliverables SET label=$2, formats=$3 WHERE id=$1`, [d.id, d.label ?? cur.label, d.formats]);
      const h = scriptHash(d.script_text);
      if (h !== cur.script_hash) {
        await t.query(`UPDATE deliverables SET script_text=$2, script_hash=$3, duration_s=$4 WHERE id=$1`, [d.id, d.script_text, h, d.duration_s]);
        await recordInvalidationIfApproved(t, actor, projectId, 'script', d.id, cur.script_hash, h, `${d.label} script restored from checkpoint`);
      }
      const want = snap.scenes.filter((s: any) => s.deliverable_id === d.id);
      const have = (await t.query(`SELECT * FROM scenes WHERE deliverable_id=$1 ORDER BY position`, [d.id])).rows;
      for (const raw of want) {
        // Sources come back exactly as saved (older saved versions did not record them: those restore with no citation,
        // never with the current build's citations). Facts removed since then are dropped; a picture now marked
        // Do Not Use or deleted is not brought back into a scene.
        const saved: string[] = Array.isArray(raw.fact_ids) ? raw.fact_ids : [];
        const factIds = saved.length ? (await t.query(`SELECT id FROM project_facts WHERE project_id=$1 AND id = ANY($2::uuid[])`, [projectId, saved])).rows.map((r) => r.id) : [];
        const writtenBy = 'written_by' in raw ? raw.written_by : 'restored';
        let imageRef = raw.image_ref ?? null;
        if (imageRef?.assetId) {
          const ok = (await t.query(`SELECT 1 FROM assets WHERE id::text=$1 AND status IN ('available','approved')`, [String(imageRef.assetId)])).rowCount;
          if (!ok) imageRef = null;
        }
        const s = { ...raw, image_ref: imageRef };
        const h2 = sceneHash(s); const existing = have.find((x) => x.position === s.position);
        if (existing && existing.content_hash === h2) {
          await t.query(`UPDATE scenes SET fact_ids=$2::uuid[], written_by=$3 WHERE id=$1`, [existing.id, factIds, writtenBy]);
          continue;
        }
        if (existing) {
          await t.query(`UPDATE scenes SET name=$2, start_s=$3, end_s=$4, image_ref=$5, visual=$6, narration=$7, content_hash=$8, content_version=content_version+1, updated_at=now(),
              fact_ids=$9::uuid[], written_by=$10 WHERE id=$1`,
            [existing.id, s.name, s.start_s, s.end_s, s.image_ref === null ? null : JSON.stringify(s.image_ref), s.visual, s.narration, h2, factIds, writtenBy]);
          await recordInvalidationIfApproved(t, actor, projectId, 'scene', existing.id, existing.content_hash, h2, `Scene ${s.position} restored from checkpoint`);
        } else {
          await t.query(`INSERT INTO scenes (deliverable_id, position, name, start_s, end_s, image_ref, visual, narration, content_hash, fact_ids, written_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [d.id, s.position, s.name, s.start_s, s.end_s, s.image_ref === null ? null : JSON.stringify(s.image_ref), s.visual, s.narration, h2, factIds, writtenBy]);
        }
      }
      for (const extra of have.filter((x) => !want.some((s: any) => s.position === x.position))) {
        await t.query(`DELETE FROM scenes WHERE id=$1`, [extra.id]);
      }
    }
    await syncProductionState(t, projectId);
    await audit(t, actor, 'project.checkpoint_restored', { type: 'project', id: projectId }, `Restored project to checkpoint from ${new Date(cp.created_at).toISOString()} (${cp.reason})`);
    // Approvals are never copied from the checkpoint: validity is recomputed from content hashes (Q6).
    return kitStatus(t, projectId);
  }, pool);
}

/** Keep the production record and project status consistent with the calculated kit gate (no false green). */
async function syncProductionState(t: Queryable, projectId: string) {
  const st = await kitStatus(t, projectId);
  const rec = (await t.query(`SELECT status FROM production_records WHERE project_id=$1`, [projectId])).rows[0];
  if (!rec) return;
  if (!st.completeVideoKitApproved && ['approved', 'package_downloaded', 'delivered'].includes(rec.status)) {
    await t.query(`UPDATE production_records SET status='needs_reapproval', updated_at=now() WHERE project_id=$1`, [projectId]);
    await t.query(`UPDATE projects SET status='in_progress' WHERE id=$1 AND status IN ('approved','ready_for_delivery','delivered')`, [projectId]);
  } else if (st.completeVideoKitApproved && rec.status === 'needs_reapproval') {
    await t.query(`UPDATE production_records SET status='approved', updated_at=now() WHERE project_id=$1`, [projectId]);
    await t.query(`UPDATE projects SET status='approved' WHERE id=$1 AND status='in_progress'`, [projectId]);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------
export async function listProjects(q: Queryable, actor: Actor, opts: { status?: string; clientId?: string } = {}) {
  requirePerm(actor, 'work');
  const p: unknown[] = []; const where = ['p.archived_at IS NULL'];
  if (opts.status) { p.push(opts.status); where.push(`p.status=$${p.length}`); }
  if (opts.clientId) { p.push(opts.clientId); where.push(`p.client_id=$${p.length}`); }
  return (await q.query(`SELECT p.id, p.project_number, p.kind, p.title, p.status, p.included_in_premier, p.source, p.created_at, p.updated_at,
      p.client_id, p.prospect_id, coalesce(c.business_name, pr.business_name) AS business_name, o.status AS order_status, o.package, o.order_number
    FROM projects p LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN prospects pr ON pr.id=p.prospect_id LEFT JOIN orders o ON o.id=p.order_id
    WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC LIMIT 500`, p)).rows;
}

export async function getProject(q: Queryable, actor: Actor, id: string) {
  requirePerm(actor, 'work');
  const project = (await q.query(`SELECT p.*, coalesce(c.business_name, pr.business_name) AS business_name, c.website_url AS client_website,
      o.order_number, o.package, o.status AS order_status, pr.website_url AS prospect_website
    FROM projects p LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN prospects pr ON pr.id=p.prospect_id LEFT JOIN orders o ON o.id=p.order_id WHERE p.id=$1`, [id])).rows[0];
  if (!project) throw notFound('project');
  const deliverables = (await q.query(`SELECT * FROM deliverables WHERE project_id=$1 ORDER BY position`, [id])).rows;
  const scenes = (await q.query(`SELECT s.* FROM scenes s JOIN deliverables d ON d.id=s.deliverable_id WHERE d.project_id=$1 ORDER BY d.position, s.position`, [id])).rows;
  const production = (await q.query(`SELECT * FROM production_records WHERE project_id=$1`, [id])).rows[0];
  const invalidations = (await q.query(`SELECT subject_type, reason, at, by_label FROM approval_invalidations WHERE project_id=$1 ORDER BY at DESC LIMIT 50`, [id])).rows;
  return { project, deliverables, scenes, production, status: await kitStatus(q, id), invalidations };
}
