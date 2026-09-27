# Changelog

Requirement-affecting changes only. Newest first.

## 3.0.0-phase2 — 2026-09-27

### Owner decisions recorded
- **Pricing confirmed by Jim:** Standard **$597** one-time; Premier **$997** one-time **+ $149/month**. (Resolves the conflict
  between the master PDF — Standard $597 / Premium $997 — and the delta — "Primary Video Kit $997 + Premier $149/month".)
- **Name stays "Premier"** (not Premium), per Jim.

### Added — production application (Phases 1–2)
- PostgreSQL schema with checksummed, forward-only migrations; verified backup before any upgrade of a database with data.
- Separate logins; Super User / Admin / User with server-enforced permissions, explicit grants, 1–72 h temporary
  elevation, disable/re-enable with history kept, last-Super-User protection (also in the database).
- Append-only audit trail, approval ledger, order lines, price-book versions, agreements, checkpoints.
- Command Center, Prospects (no duplicates; OTHER keeps the real business type), Clients, Projects.
- Demo & Sales: in-person iPad demo (owner session locks until password), Mac + Zoom demo window, owner-controlled
  expiring Demo Links; one Demo Library; prospect-safe demo is a separate bundle and API.
- Become a Client → agreement (exact text + hash stored) → payment (test / manual) → Client + Order + Project in one
  idempotent transaction; Welcome screen; "New Client — Ready to Start" on the Mac.
- Historical pricing (list / agreed / sold) with owner deal overrides and reasons.
- Marketing preference Active / Paused / Unsubscribed; an unsubscribe can only be reversed with the client's recorded
  request, and survives new projects, restores and imports.
- Approval integrity: approvals store the exact content hash; the Complete Video Kit gate is calculated; edits invalidate
  only the affected approval; approving requires the version the owner saw.
- Autosave drafts with honest save status; checkpoints with restore that never invents approvals; Continue Working.
- System Health, plain-language errors, GET SUPPORT / SEND FOR SUPPORT report (redacted), automatic support report
  when a background task fails repeatedly; job queue with dedupe and retries.
- Encrypted, verified nightly backups (database + media), atomic restore that re-applies unsubscribes and permanent
  deletions.
- Encrypted, write-only storage for provider credentials.
- Importer for V2 prototype data (prospects, clients, projects, scene approvals, verified kit approvals, Quick Videos,
  Image Library, checkpoints).

### Fixed after independent review (see `server/test/review-regressions.test.ts`)
- Concurrent payment attempts could charge one order more than once → payments are now exactly-once per order.
- Autosave could show "Saved" for a refused stale write → conflicts are reported and the local copy kept.
- Partial client/prospect updates could erase fields → only sent fields change.
- Approvals could apply to content changed in another tab → approval requires the displayed version.
- Unlimited password guesses on a demo-locked iPad → 5 tries, then full sign-out.
- A failed restore could leave an empty database → restore is a single transaction; media now backed up.
- Stored agreement price could differ from the one shown → signup is refused if the agreement changed.
- Races in first-run setup and mutual Super User demotion closed.

## V2.11.23 BRIDGE — 2026-09-27 (prototype)
- Fixed D1: "Build 4-Script Video Kit" crashed (`websiteKey is not defined`).
- Fixed D3: 30-second kits could not be downloaded; kit manifest showed wrong length.
- Fixed D8: support report showed the wrong version.
- Fixed D9: Approve / Rewrite / Change Image threw an error after a kit was built, leaving counters stale.
- Added **EXPORT ALL DATA FOR UPGRADE** (read-only full export for the production importer).
