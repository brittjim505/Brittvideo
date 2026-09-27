import type pg from 'pg';
import { tx } from '../../db/pool.js';
import type { Actor } from '../../auth/permissions.js';
import { requirePerm } from '../../auth/service.js';
import { OwnerError, notFound } from '../../lib/errors.js';
import { sha256 } from '../../lib/util.js';
import { audit } from '../audit/service.js';
import { putObject, deleteObject } from '../../integrations/storage.js';
import { detachImageFromScenes } from '../projects/service.js';

/**
 * Image Library (T1–T21). States: available, approved, do_not_use, recently_deleted, permanently_deleted (tombstone).
 * - Do Not Use images are never offered for scenes or chosen automatically (T4).
 * - Deleting an image used by an active or delivered project needs explicit confirmation (T6, T7).
 * - Recently Deleted can be restored; permanent deletion removes the file and leaves a tombstone so no restore,
 *   import or re-analysis can bring it back (T13, T14).
 * - Duplicates and unused images are identified for review, never deleted automatically (T8, T9).
 */
export const CATEGORIES = ['Senior Living', 'Dentist', 'Medical / Doctor', 'Attorney', 'Plumber', 'General Business', 'Logo', 'Client website', 'Other'];
const MIMES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function uploadImage(pool: pg.Pool, actor: Actor, input: { dataBase64: string; mime: string; title?: string; category?: string; clientId?: string | null; projectId?: string | null; rightsNote?: string }) {
  requirePerm(actor, 'work');
  const ext = MIMES[input.mime];
  if (!ext) throw new OwnerError('Please choose a JPEG, PNG or WebP picture.');
  const buf = Buffer.from(input.dataBase64 ?? '', 'base64');
  if (buf.length < 100) throw new OwnerError('That picture could not be read.');
  if (buf.length > 12_000_000) throw new OwnerError('That picture is larger than 12 MB. Please choose a smaller one.');
  const hash = sha256(buf);
  const tomb = (await pool.query(`SELECT 1 FROM assets WHERE sha256=$1 AND status='permanently_deleted'`, [hash])).rowCount;
  if (tomb) throw new OwnerError('This exact picture was permanently deleted earlier, so BrittVideo will not add it again.', 409, 'permanently_deleted');
  const dup = (await pool.query(`SELECT id, title FROM assets WHERE sha256=$1 AND status NOT IN ('permanently_deleted','recently_deleted') LIMIT 1`, [hash])).rows[0];
  const obj = putObject(buf, ext);
  return tx(async (t) => {
    const a = (await t.query(`INSERT INTO assets (client_id, title, category, source_type, rights_note, status, protection_class, storage_key, sha256, bytes, mime, created_by)
      VALUES ($1,$2,$3,'library_upload',$4,'available','working',$5,$6,$7,$8,$9) RETURNING *`,
      [input.clientId ?? null, (input.title || 'New image').slice(0, 120), CATEGORIES.includes(input.category ?? '') ? input.category : 'General Business',
        input.rightsNote ?? 'Uploaded by BrittVideo — confirm commercial-use rights for images found online.', obj.key, hash, obj.bytes, input.mime, actor.userId])).rows[0];
    if (input.projectId) await t.query(`INSERT INTO project_images (project_id, asset_id, selected, position) VALUES ($1,$2,true,1000) ON CONFLICT DO NOTHING`, [input.projectId, a.id]);
    await audit(t, actor, 'image.uploaded', { type: 'asset', id: a.id }, `Image added: ${a.title}`);
    return { asset: publicAsset(a), duplicateOf: dup ? { id: dup.id, title: dup.title } : null };
  }, pool);
}

export function publicAsset(a: any) {
  return { id: a.id, title: a.title, category: a.category, status: a.status, sourceType: a.source_type, sourceUrl: a.source_url, rightsNote: a.rights_note,
    url: a.storage_key ? '/' + a.storage_key : null, bytes: a.bytes, clientId: a.client_id, createdAt: a.created_at, deletedAt: a.deleted_at, altText: a.alt_text,
    outdated: a.outdated_flag, inUse: a.in_use ?? undefined, duplicateCount: a.duplicate_count ?? undefined };
}

const USAGE_SQL = `(SELECT count(*)::int FROM scenes s JOIN deliverables d ON d.id=s.deliverable_id JOIN projects p ON p.id=d.project_id
   WHERE (s.image_ref->>'assetId')::text = a.id::text AND p.archived_at IS NULL)`;

export async function listLibrary(pool: pg.Pool, actor: Actor, f: { view?: 'library' | 'recently_deleted' | 'unused' | 'duplicates' | 'client'; clientId?: string; search?: string; category?: string }) {
  requirePerm(actor, 'work');
  const where: string[] = []; const p: unknown[] = [];
  if (f.view === 'recently_deleted') where.push(`a.status='recently_deleted'`);
  else where.push(`a.status NOT IN ('recently_deleted','permanently_deleted')`);
  if (f.view === 'client' && f.clientId) { p.push(f.clientId); where.push(`a.client_id=$${p.length}`); }
  if (f.search) { p.push('%' + f.search.toLowerCase() + '%'); where.push(`(lower(a.title) LIKE $${p.length} OR lower(coalesce(a.category,'')) LIKE $${p.length})`); }
  if (f.category && f.category !== 'All Categories') { p.push(f.category); where.push(`a.category=$${p.length}`); }
  if (f.view === 'unused') where.push(`${USAGE_SQL} = 0 AND NOT EXISTS (SELECT 1 FROM project_images pi WHERE pi.asset_id=a.id AND pi.selected)`);
  if (f.view === 'duplicates') where.push(`(SELECT count(*) FROM assets b WHERE b.sha256=a.sha256 AND b.status NOT IN ('recently_deleted','permanently_deleted')) > 1`);
  const rows = (await pool.query(`SELECT a.*, ${USAGE_SQL} AS in_use,
      (SELECT count(*)::int FROM assets b WHERE b.sha256=a.sha256 AND b.status NOT IN ('recently_deleted','permanently_deleted')) AS duplicate_count
    FROM assets a WHERE a.kind='image' AND ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT 400`, p)).rows;
  return rows.map(publicAsset);
}

export async function updateImage(pool: pg.Pool, actor: Actor, id: string, patch: { title?: string; category?: string; status?: 'available' | 'approved' | 'do_not_use'; outdated?: boolean }) {
  requirePerm(actor, 'work');
  return tx(async (t) => {
    const a = (await t.query(`SELECT * FROM assets WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!a || a.status === 'permanently_deleted') throw notFound('image');
    if (patch.status && !['available', 'approved', 'do_not_use'].includes(patch.status)) throw new OwnerError('Choose Available, Approved or Do Not Use.');
    const after = (await t.query(`UPDATE assets SET title=$2, category=$3, status=$4, outdated_flag=$5 WHERE id=$1 RETURNING *`,
      [id, (patch.title ?? a.title).slice(0, 120), patch.category ?? a.category, patch.status ?? a.status, patch.outdated ?? a.outdated_flag])).rows[0];
    if (patch.status === 'do_not_use' && a.status !== 'do_not_use') {
      await t.query(`UPDATE project_images SET selected=false WHERE asset_id=$1`, [id]);
      await detachImageFromScenes(t, actor, [id], 'marked Do Not Use');
    }
    await audit(t, actor, 'image.updated', { type: 'asset', id }, `Image "${after.title}": ${patch.status ? 'marked ' + patch.status.replace(/_/g, ' ') : 'details changed'}`);
    return publicAsset(after);
  }, pool);
}

/** DELETE IMAGE / DELETE SELECTED → Recently Deleted. In-use images need `confirmInUse` (owner keeps final authority). */
export async function deleteImages(pool: pg.Pool, actor: Actor, ids: string[], confirmInUse = false) {
  requirePerm(actor, 'work');
  if (!ids?.length) throw new OwnerError('Choose at least one image.');
  return tx(async (t) => {
    const rows = (await t.query(`SELECT a.id, a.title, ${USAGE_SQL} AS in_use FROM assets a WHERE a.id = ANY($1::uuid[]) AND a.status NOT IN ('recently_deleted','permanently_deleted')`, [ids])).rows;
    const used = rows.filter((r) => r.in_use > 0);
    if (used.length && !confirmInUse) {
      throw new OwnerError(`${used.map((u) => `"${u.title}"`).join(', ')} ${used.length === 1 ? 'is' : 'are'} used in a project. Delete anyway? Scenes using it will lose the picture and need a new one — and approval again.`, 409, 'in_use', { inUse: used.map((u) => u.id) });
    }
    await t.query(`UPDATE assets SET status='recently_deleted', deleted_at=now() WHERE id = ANY($1::uuid[])`, [rows.map((r) => r.id)]);
    await t.query(`UPDATE project_images SET selected=false WHERE asset_id = ANY($1::uuid[])`, [rows.map((r) => r.id)]);
    await detachImageFromScenes(t, actor, rows.map((r) => r.id), 'picture deleted');
    await audit(t, actor, 'image.deleted', { type: 'asset', id: rows.map((r) => r.id).join(',').slice(0, 200) }, `${rows.length} image(s) moved to Recently Deleted`);
    return { deleted: rows.length };
  }, pool);
}

export async function restoreImages(pool: pg.Pool, actor: Actor, ids: string[]) {
  requirePerm(actor, 'work');
  const r = await pool.query(`UPDATE assets SET status='available', deleted_at=NULL WHERE id = ANY($1::uuid[]) AND status='recently_deleted' RETURNING id`, [ids]);
  await audit(pool, actor, 'image.restored', null, `${r.rowCount} image(s) restored from Recently Deleted`);
  return { restored: r.rowCount };
}

/** Permanent deletion (Super User or 'destructive' permission). The file is removed; a tombstone remains. */
export async function purgeImages(pool: pg.Pool, actor: Actor, ids: string[]) {
  requirePerm(actor, 'destructive', 'permanently delete images');
  return tx(async (t) => {
    const rows = (await t.query(`SELECT id, storage_key, protection_class, title FROM assets WHERE id = ANY($1::uuid[]) AND status='recently_deleted' FOR UPDATE`, [ids])).rows;
    if (rows.some((r) => r.protection_class === 'delivered')) throw new OwnerError('One of these images is part of delivered work and is protected. It can stay in Recently Deleted.', 409, 'protected');
    await t.query(`UPDATE assets SET status='permanently_deleted', storage_key=NULL WHERE id = ANY($1::uuid[])`, [rows.map((r) => r.id)]);
    await audit(t, actor, 'image.permanently_deleted', null, `${rows.length} image(s) permanently deleted: ${rows.map((r) => r.title).join(', ').slice(0, 300)}`);
    return rows;
  }, pool).then((rows) => {
    // The file is removed only if no other live asset shares the same content (content-addressed storage).
    for (const r of rows) if (r.storage_key) pool.query(`SELECT 1 FROM assets WHERE storage_key=$1 AND status<>'permanently_deleted'`, [r.storage_key]).then((x) => { if (!x.rowCount) deleteObject(r.storage_key); }).catch(() => {});
    return { purged: rows.length };
  });
}

// Project image selection (Review Images step).
export async function projectImages(pool: pg.Pool, projectId: string) {
  return (await pool.query(`SELECT a.*, pi.selected FROM project_images pi JOIN assets a ON a.id=pi.asset_id
    WHERE pi.project_id=$1 AND a.status NOT IN ('recently_deleted','permanently_deleted') ORDER BY pi.position, pi.added_at`, [projectId])).rows
    .map((a) => ({ ...publicAsset(a), selected: a.selected && a.status !== 'do_not_use' }));
}
export async function setProjectImage(pool: pg.Pool, actor: Actor, projectId: string, assetId: string, selected: boolean) {
  requirePerm(actor, 'work');
  if (!(await pool.query(`SELECT 1 FROM projects WHERE id=$1`, [projectId])).rowCount) throw notFound('project');
  const a = (await pool.query(`SELECT status FROM assets WHERE id=$1`, [assetId])).rows[0];
  if (!a || ['recently_deleted', 'permanently_deleted'].includes(a.status)) throw notFound('image');
  if (selected && a.status === 'do_not_use') throw new OwnerError('That image is marked Do Not Use. Change it in the Image Library first if you want to use it.', 409, 'do_not_use');
  await pool.query(`INSERT INTO project_images (project_id, asset_id, selected, position) VALUES ($1,$2,$3,999)
    ON CONFLICT (project_id, asset_id) DO UPDATE SET selected=EXCLUDED.selected`, [projectId, assetId, selected]);
  return projectImages(pool, projectId);
}
