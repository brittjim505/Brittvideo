# Changelog

Requirement-affecting changes only. Newest first.

## 3.1.0 — 2026-10-07

### Changed — products (owner decision, 2026-10-07)
- **Standard ($597)** is now five videos: Website Video up to 90 seconds in the shape the client chooses (landscape 16:9,
  square 1:1 or portrait 9:16 — chosen in Builder Step 4), **Social Portrait** 9:16, **Social Landscape** 16:9, a new
  **Thank-You Video** (claim-free fixed wording) and the Email Video. Builder: **BUILD 5 VIDEOS**.
- **Premier ($997 + $149/month)**: the same five videos plus hosting, monthly report and a fresh video each quarter.
- New product **One-Off Video ($197)**: sold in Record a Sale and in demos/Demo Links; creates a waiting One-Off project;
  **BUILD THIS VIDEO** opens Quick Video and the script is written into that same project.
- Agreement text updated (terms version 2026-10-07.draft-2); demo "What you get" updated.
- Existing price books are upgraded once at start-up (owner-changed prices are kept; past sales keep theirs).
- Older four-video projects are brought up to the five-video kit the next time they are built.
- Kit download file names now always name the video and its shape (e.g. `…_Social_Portrait_30sec_9x16_Portrait.txt`).
- Migration 0005 (deliverable kind `thank_you`).

## 3.0.1 — 2026-10-07

### Added — Get pictures from a website + business folders
- Image Library: **GET PICTURES FROM A WEBSITE**. Choose a folder (its website fills in), **SCAN WEBSITE** reads the home
  page and up to 8 more pages on the same site and finds every picture (normal, lazy-loaded, largest srcset size,
  <picture> sources, share pictures, CSS backgrounds). Icons (under 200 px), SVG/GIF, duplicates and permanently deleted
  pictures are left out. Results are a preview kept in memory for 30 minutes — nothing is saved until the owner ticks
  pictures and presses **SAVE n PICTURES TO …**. Same website-safety rules as Website Analysis.
- Folders: four groups — **Dentists, Facilities, Attorneys, Others** (from the business's industry) — each with one folder
  per client or prospect, plus the General library. A client's folder also shows pictures saved while it was a prospect.
  Saved pictures get the group's category (Dentist / Senior Living / Attorney / General Business) unless one is chosen.
- Builder, Review Images: **ADD n PICTURES FROM <BUSINESS>'S FOLDER** puts every usable folder picture into the new
  video, so later videos for the same client don't need a new scan. Do Not Use pictures are never added.
- Website Analysis now files its pictures in the business's folder (also for prospects) with the group's category.
- Migration 0004: `assets.prospect_id` (a picture belongs to a client, a prospect, or neither).

## 3.0.0-phase3 — 2026-09-27

### Added — Builder (Phase 3)
- 8-step Builder inside the app (SELECT CLIENT → ANALYZE WEBSITE → REVIEW IMAGES → CHOOSE STORY → BUILD VIDEOS →
  REVIEW SCENES → APPROVE → DOWNLOAD) with "YOU ARE HERE: STEP n OF 8"; the owner stays on the step being worked on.
- Website analysis reads the home page plus up to 4 useful linked pages; every fact shows the page it came from;
  boilerplate dropped; real images collected. Private/internal network addresses are refused (incl. IPv6 forms).
  Analyzing again keeps the owner's unticked facts unticked. Owner can add and edit facts.
- Four videos built only from facts the owner kept: Website 30/60/90/120 s (5-second scenes), Social A and B
  (16:9, 9:16, 1:1), Email. Optional AI writer (server-side key) must cite facts; its opening/closing lines are fixed
  wording. Do Not Use pictures are never placed.
- Scene review: approve, rewrite, change picture, approve all; rewritten words are cited as the owner's own.
- Complete Video Kit download (approval-gated, consistent snapshot) with clean file names per format, pictures and
  image sources; delivery can be recorded only after the approved kit was downloaded; delivered pictures protected.
- Rebuilding saves a copy first and asks before replacing approved or owner-rewritten scenes; saved versions restore
  the exact sources.
- Marking a used picture Do Not Use (or deleting it) removes it from scenes and withdraws the kit approval.
- Quick Video (8 purposes, 15–120 s, personalization) and standalone Email Video; script approve + download.
- Image Library: search, categories, Available / Approved / Do Not Use, rename, unused, duplicates, Recently Deleted,
  restore, permanent delete (tombstone; delivered pictures protected).
- Text size control (A / A+ / A++, default A+); menu wraps at large sizes.
- Independent review of Phase 3: 8 defects found and fixed, each with a regression test (79 automated tests).

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
