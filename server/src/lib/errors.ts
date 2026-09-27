/**
 * OwnerError: a problem the owner can understand and act on. `message` is plain language with an exact next step.
 * Anything else that goes wrong is treated as a system problem: logged (redacted), recorded for support, and the
 * owner is shown a calm generic message plus GET SUPPORT — never a stack trace (Q11, K19).
 */
export class OwnerError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    public readonly code: string = 'invalid_request',
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new OwnerError(`That ${what} could not be found. It may have been archived.`, 404, 'not_found');
export const forbidden = (what = 'do that') =>
  new OwnerError(`Your account is not allowed to ${what}. Ask the Super User if you need this access.`, 403, 'forbidden');
export const notSignedIn = () => new OwnerError('Please sign in to continue.', 401, 'not_signed_in');

/** Translate known database guard errors into plain language. */
export function translateDbError(e: any): OwnerError | null {
  const msg: string = e?.message ?? '';
  if (msg.includes('BV_LAST_SUPER_USER')) return new OwnerError('BrittVideo must always have at least one active Super User, so that change was not made.', 409, 'last_super_user');
  if (msg.includes('BV_UNSUBSCRIBE_PROTECTED')) return new OwnerError('This client unsubscribed from marketing. That can only be reversed when the client asks to be resubscribed — record their request as evidence.', 409, 'unsubscribe_protected');
  if (msg.includes('BV_APPEND_ONLY')) return new OwnerError('That record is part of permanent history and cannot be changed.', 409, 'history_protected');
  if (msg.includes('BV_NO_HARD_DELETE')) return new OwnerError('That record has business history, so it is archived instead of deleted.', 409, 'archive_instead');
  if (msg.includes('BV_DELETED_MEANS_DELETED')) return new OwnerError('That image was permanently deleted and cannot be restored.', 409, 'permanently_deleted');
  if (e?.code === '22P02') return new OwnerError('That could not be found. The link may be incomplete.', 404, 'not_found');
  if (e?.code === '23505') return new OwnerError('That already exists, so nothing new was created.', 409, 'duplicate');
  return null;
}
