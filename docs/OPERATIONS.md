# Operations: Backup & Restore · Support Report · Migration from V2 · Provider Adapters

## 1. Backup and restore (Q20, Q21, W30)

- **What:** the whole database (`pg_dump` custom format) plus all media files.
- **When:** nightly (first worker tick after 09:00 UTC ≈ 3 a.m. Mountain), before every database upgrade, before every
  restore, before every V2 import, and on demand (System Health → **MAKE A BACKUP NOW**, or `npm run backup`).
- **Protection:** AES-256-GCM with `BACKUP_ENCRYPTION_KEY` (keep a copy in a password manager, off the server);
  SHA-256 checksum in the header; every backup is decrypted and compared immediately after it is written.
- **Retention:** scheduled backups older than 35 days are removed, always keeping the newest 7; pre-migration and
  pre-restore backups are kept.
- **Off-site:** copy `BACKUP_DIR` (files + `media/`) to separate storage nightly — sync is not backup.
- **Restore:** `npm run restore -- <file> [--into <database-url>]`. Takes a safety backup of the target, then drops and
  reloads the database **in one transaction** (a failure leaves the database untouched), re-applies any unsubscribes and
  permanent deletions that exist now, and puts back missing media files. Restart BrittVideo afterwards; newer upgrades
  apply automatically.
- **Drill:** tested automatically (`integrity.test.ts`, `review-regressions.test.ts` #6). A live drill on the production
  host is part of go-live — record date and result in `ACCEPTANCE_STATUS.md`.

## 2. Support report (Q14–Q18, Y20)

Created by **GET SUPPORT → PREPARE SUPPORT REPORT**, and automatically when a background task fails after all retries.
Contents: app version and environment; health summary and every check; which connection keys are set (never their
values); last backup; record counts; database version (migrations); recovery attempts; failed automatic tasks; recent
warnings and errors; the owner's note.
Never included: passwords, tokens, API keys, backup keys, card numbers. All free text is passed through
`server/src/lib/redact.ts` (secret-named fields, `key=value` secrets, bearer tokens, DB URLs, card-like numbers, long
opaque tokens) — tested in `security.test.ts` and `integrity.test.ts`.
**SEND FOR SUPPORT** opens an email to `SUPPORT_EMAIL` (or the device Share menu / copies the report) and records that
it was sent.

## 3. Migration from the V2 prototype (R21, R22, Y22)

1. V2.11.23 → **EXPORT ALL DATA FOR UPGRADE** (read-only; saves every `bv-*`/`brittvideo*` browser-storage key).
2. BrittVideo 3.0 → Settings → **Import from V2** (or `npm run import-prototype -- <file>`). A backup is taken first; the
   import is one transaction.
3. Mapping: prospects → prospects; clients → clients (plan noted, no order invented — V2 recorded no prices); saved
   projects → Video Kit projects (Website/Social A/Social B/Email with scenes, scripts, image references, production
   record); a newer V2 automatic checkpoint is used and the older named save kept as a checkpoint; Quick Video → its own
   project; Image Library → assets.
4. Approvals: every V2 scene approval is recorded against the exact imported content. The Complete Video Kit approval is
   carried **only** if V2's own fingerprint (re-implemented exactly) still matches; otherwise the project is marked for
   reapproval and a note explains why.
5. Re-importing the same file does nothing. Entities already imported are skipped.
6. Rollback: restore the pre-import backup.

## 4. Provider adapter contract (Appendix E, U1–U36) — design for Phase 4

Every AI video platform is an adapter implementing:

```ts
interface VideoProviderAdapter {
  id: string;                                   // 'heygen', 'test', …
  capabilities(): CapabilityProfile;            // max duration, formats, avatars, voices, captions, resolution
  health(): Promise<HealthState>;               // Connected / Not connected / Needs attention (plain language)
  checkCompatibility(req: ProductionRequest): CompatibilityResult;   // before submit or switch (U11, U12)
  submit(req: ProductionRequest, idempotencyKey: string): Promise<{ externalJobId: string }>;  // idempotent
  status(externalJobId: string): Promise<JobStatus>;                 // queued/processing/ready/failed + plain reason
  fetchOutputs(externalJobId: string): Promise<OutputAsset[]>;       // into BrittVideo media storage
}
```

`ProductionRequest` is BrittVideo's own: approved script, approved scenes (with content hashes), assets, duration,
formats, voice/avatar requirements. Only content whose approval is valid can be submitted (U8); the adapter may not
change text — any provider-side rewrite returns the project to approval (U9). Jobs run on the job queue; every attempt is
recorded (append-only), the external job state is checked before any retry, and failures never touch approved content
(S7). Global provider changes apply to new projects only; existing projects switch only via "Change Video Provider" with
a compatibility check and owner approval (U16–U18). Certification (U30): a dedicated provider-test project is produced
end-to-end before a provider is marked Approved for Production; multi-provider readiness requires the same test project
through two providers (U36).
