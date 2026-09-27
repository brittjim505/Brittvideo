# BrittVideo Production Architecture

Deliverables A–E required by `START_HERE_CLAUDE_CODE.md`. The requirement IDs (K9, Q14, V9 …) refer to the master
specification; "Delta" refers to `LATEST_REQUIREMENTS_DELTA.md`, which overrides older wording.

---

## A. Proposed production architecture

```
 iPad (Safari)        Mac (Safari/Chrome)          Prospect's browser
 Demo/Sales/Signup    Full business + production   Demo Link only
        │                    │                             │
        ▼                    ▼                             ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │  BrittVideo web client  (React, two separate bundles)            │
 │   /app/*  — owner/admin app (login required)                     │
 │   /demo/* — prospect-safe app: its own bundle, its own API.      │
 │             Never loads admin code or admin data (Y15, V13).     │
 └──────────────────────────────────────────────────────────────────┘
        │ HTTPS, httpOnly session cookie (admin)  │ demo token (prospect-safe)
        ▼                                         ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │  BrittVideo server (Node.js 22, TypeScript, Fastify)             │
 │   Modules: Auth/Users · Audit · Prospects · Clients · Pricing ·  │
 │   Sales/Orders · Demo · Projects/Builder · Approvals · Assets ·   │
 │   Production · Delivery · Quick Video · Premier · Communications │
 │   · Marketing · Payments · Integrations · Support/Recovery ·     │
 │   System Health · Backup · Migration (Y3)                        │
 │   Permission checks happen here, on every request (W27).         │
 │   Job runner (same process): Postgres-backed queue, retries,     │
 │   idempotency keys, schedules; every job safe to run twice.      │
 └──────────────────────────────────────────────────────────────────┘
        │                    │                           │
        ▼                    ▼                           ▼
   PostgreSQL 16        Media storage adapter       Provider adapters
   (authoritative       (local disk now; S3-        Payment: Square | Test | Manual
   business records,    compatible later)           Video:   HeyGen | Test | …
   audit, jobs)         (R6, Y17)                   Hosting: Vimeo  | Test
        │                                           Messages: Email/SMS | Outbox
        ▼
   Encrypted, verified backups (pg_dump → AES-256-GCM, checksum, restore-tested) (Q20, W30)
```

Key decisions and why:

| Decision | Reason (requirement) |
|---|---|
| One server + one PostgreSQL database is the single source of truth; the browser holds only drafts and an outbox. | R3, R5, R10–R15, R23 (device loss ≠ data loss). Mac-primary design avoids multi-device edit conflicts (R17). |
| Business rules live in server services with database constraints as a second line of defence (unique keys, append-only triggers, check constraints). | "Human approval gates cannot be bypassed by stale UI state"; Y24 do-not-simplify-away list. |
| Approvals are rows that store the SHA-256 of the exact content approved. Validity = latest approval's hash equals the current content hash. Complete Video Kit is **calculated**, never stored as a flag. | K9, K10, Y5, Y6, W6, W7. Carries forward the prototype's V2.11.07 fingerprint idea, made durable. |
| Money in integer cents. Orders copy list price, agreed price and sold price onto immutable order lines, and reference the price-book version used. | M4, R12, W21, Delta "change pricing without corrupting history". |
| Every external side effect (payment, production submit, upload, message) and every sale conversion takes an idempotency key; results are stored and replayed on retry. | Q8–Q10, M15, O14, P14. |
| Provider adapters behind small interfaces with a common request/response contract and capability profiles; provider credentials server-side only, encrypted at rest. | U1–U36, Appendix E, V18, S16. |
| Prospect-safe demo is a separate bundle and a separate API surface that can only read published Demo Library items and write a signup. | V13, V15, Y15, W25. |
| Environments: `development`, `test`, `live`, each with its own database. Non-live environments can never charge a real card, message a real client or publish a real demo (adapters refuse). | V29, V30, Y21. |
| Owner-facing errors are plain-language `OwnerMessage`s; technical detail goes to the redacted diagnostic log and support report. | Q11, Q15–Q18, V31, K19. |

Hosting recommendation (not yet provisioned — requires Jim's accounts): a managed host that runs one Node service
with a managed PostgreSQL database and a persistent disk (for example Render or Fly.io), plus S3-compatible
object storage for video files when production outputs arrive (Phase 4–5). Estimated running cost for one owner
is modest; exact choice is a cost decision for Jim before go-live.

---

## B. Repository / folder structure

```
brittvideo/
├─ README.md                 Owner + developer setup (Mac)
├─ CHANGELOG.md              Every requirements-affecting change
├─ package.json              npm workspaces: server, web
├─ .env.example              Environment template — no real secrets
├─ docs/
│  ├─ ARCHITECTURE.md        (this file)
│  ├─ AUDIT_V2.11.22.md      Baseline audit
│  ├─ DATA_MODEL.md          Entities, invariants, where each rule is enforced
│  ├─ ACCEPTANCE_STATUS.md   Checklist with evidence per item
│  ├─ OWNER_ACCEPTANCE_TEST.md  Jim's one-step-at-a-time test
│  ├─ OPERATIONS.md          Backup/restore, support report, V2 migration, provider adapter contract
│  ├─ spec/                  The owner's specification package (unchanged)
│  └─ audit-scripts/         Browser scripts used for the audit
├─ prototype/                V2.11.22 (reference) and V2.11.23 bridge build
├─ server/
│  ├─ src/
│  │  ├─ app.ts, index.ts, config.ts, version.ts
│  │  ├─ db/                 pool, transaction helper, migration runner
│  │  ├─ migrations/         0001_*.sql … (forward-only, checksummed)
│  │  ├─ lib/                ids, money, hashing, redaction, owner-facing errors, idempotency
│  │  ├─ auth/               passwords, sessions, permission policy, login routes
│  │  ├─ modules/<module>/   service.ts (rules) + routes.ts (HTTP) per module
│  │  ├─ integrations/       payment/, video/, hosting/, messaging/, storage/ — interfaces + adapters
│  │  ├─ jobs/               queue, runner, scheduled jobs
│  │  └─ cli/                migrate, create-super-user, backup, restore, import-prototype
│  └─ test/                  Vitest integration tests against a real PostgreSQL test database
└─ web/
   ├─ index.html → src/app/  Owner app (Mac-first, iPad-friendly)
   ├─ demo.html  → src/demo/ Prospect-safe app (separate bundle)
   └─ src/shared/            API client with autosave outbox, UI kit
```

---

## C. Database schema and migrations

The schema is the SQL in `server/src/migrations/`. `docs/DATA_MODEL.md` explains each entity and every
invariant, with the layer that enforces it (service, constraint or trigger).

Migration rules: forward-only numbered files, each run in a transaction, recorded with a checksum (an edited,
already-applied migration refuses to start the app). **Before any migration touches a database that holds data, the
runner takes a verified backup** — that backup is the rollback path (Y22, Y23). No migration may drop or rewrite
clients, projects, approvals, prices, opt-outs, Premier schedules or history; this is checked by the upgrade test.

---

## D. Environment variables

See `.env.example` (committed, no real secrets). Secrets are read only by the server; integration credentials
entered by the Super User in Settings are stored encrypted with `SECRETS_ENCRYPTION_KEY` and are write-only through
the API (never returned to any browser, demo link, export or support report).

---

## E. Implementation plan mapped to acceptance gates

"Done" follows the Build Brief definition: happy path, failure path, retry/recovery, persistence, permissions,
audit and owner-facing explanation all tested.

| Phase | Scope | Acceptance-checklist items / spec gates it closes |
|---|---|---|
| 0 (done) | Audit; V2.11.23 bridge (build crash, short-kit download, Export All Data) | Keeps owner working; enables Migration items |
| **1** | Domain model; PostgreSQL + checksummed migrations; Super User/Admin/User with server-side permission policy, last-Super-User guard, disable/downgrade, time-limited elevation; audit trail (append-only); autosave drafts + outbox; project checkpoints + Continue Working; encrypted secret store; environment separation; health checks; plain-language support report + GET SUPPORT / SEND FOR SUPPORT; encrypted backup + tested restore; job queue foundation | Security/Roles (all), Recovery/Support (autosave, checkpoints, backup/restore, health – DB/storage, GET/SEND SUPPORT, no secrets), Migration (upgrade does not wipe) — W26–W30 |
| **2** | Prospects (dedupe, OTHER keeps actual business type); price book (versioned) + deal override with reason; Demo & Sales: in-person iPad, Mac/Zoom, owner-controlled Demo Links (expire/disable, attack-tested); Demo Library; Become a Client → agreement → payment (Test/Manual adapter; Square adapter interface) → Client + Order + Project in one idempotent transaction; "New Client — Ready to Start"; returning-client purchase; prototype data importer | Sales (all 7), Payments (idempotent, no duplicate orders/projects), W20, W21, W23, W24, W25, Migration (import) |
| 3 | Builder in production: website analysis with source grounding and fallback, Image Library (states, Do Not Use, delete/in-use protection, Recently Deleted, tombstones), story, scripts/narration, scenes, approval ledger UI, calculated Complete Video Kit, Quick Video (15/30/60/90/120, 8 purposes), standalone Email Video, Standard formats 16:9/9:16/1:1 | Builder (all 8), W5–W11 |
| 4 | Production layer: adapter interface + capability profiles, compatibility check, job queue submit/poll/ingest, retries with external status check, provider switching with owner approval, backup provider, certification test project; HeyGen adapter | Production (all 5), U-series, W12–W15 |
| 5 | Delivery: per-format final review, clean filenames, individual + package downloads, delivery records/version history, customer links scoped per client; Vimeo hosting records + monthly reports | Delivery (all 5), N-series, W16 |
| 6 | Communications service: transactional vs marketing, consent check at send time, easy unsubscribe link, duplicate suppression; Standard post-delivery Thank-You Follow-Up Video; lifecycle marketing | Communications (all 5), O-series, W17 |
| 7 | Premier: $149/month membership, quarterly obligations from actual start date (unique per period), advance warnings, included-work projects (no new sale), cancellation stops hosting/keeps files, restart; AI4Seniors entitlement (isolated) | Premier (all 6), P-series, W18 |
| 8 | Square live integration: hosted checkout/payment links, webhook signature verification, reconciliation job, subscription billing for Premier | Payments (Square), W22 |
| 9 | Full health automation (Square/Vimeo/production/comms), automatic support escalation, scheduled backup verification drills | Recovery/Support remaining items |
| 10 | Security review, permission fuzzing, migration rehearsal on Jim's real export, iPad/Mac device testing, owner acceptance session | W31–W34; "production-ready" only when every applicable checklist item passes |

Phase 1 and Phase 2 are implemented in this delivery. Status per checklist item, with evidence, is kept in
`docs/ACCEPTANCE_STATUS.md`.
