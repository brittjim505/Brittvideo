# BrittVideo 3.0 (production application)

BrittVideo is the one-owner business system for BrittVideo: prospects → demo → sale → client, order and project →
video builder → production → delivery → follow-up and Premier. This repository replaces the single-file V2 HTML
prototype with a secure, cloud-ready application, built in stages from the owner's specification package
(`docs/spec/`).

**Current stage:** Phase 1 (foundation) + Phase 2 (sales) complete — see `docs/ACCEPTANCE_STATUS.md` for exactly what
is done and tested, and what is not yet. The video Builder still runs in the **V2.11.23 bridge build**
(`prototype/BrittVideo_Builder_V2.11.23_BRIDGE.html`) until Phase 3.

| Where | What |
|---|---|
| `docs/AUDIT_V2.11.22.md` | Audit of the V2 baseline (defects D1–D9) |
| `docs/ARCHITECTURE.md` | Architecture, folder layout, phased plan mapped to acceptance gates |
| `docs/DATA_MODEL.md` | Every entity and business rule, and where it is enforced |
| `docs/ACCEPTANCE_STATUS.md` | Checklist status with evidence |
| `docs/OWNER_ACCEPTANCE_TEST.md` | Jim's hands-on test, one step at a time |
| `docs/OPERATIONS.md` | Backup & restore, support report, migration from V2, provider adapter contract |
| `CHANGELOG.md` | Requirement-affecting changes |

---

## For the owner (Jim)

You do not need to run commands. Your developer sets BrittVideo up once (below); after that you open it in Safari
on your Mac or iPad at your BrittVideo address and sign in. If anything looks wrong, press **GET SUPPORT**.

## For the developer — Mac setup (about 20 minutes)

Requirements: macOS with [Homebrew](https://brew.sh), Node.js 22, PostgreSQL 16.

```bash
brew install node@22 postgresql@16
brew services start postgresql@16
createdb brittvideo_dev
createdb brittvideo_test

git clone <repo> brittvideo && cd brittvideo
npm install
cp .env.example server/.env
# Generate two DIFFERENT keys and paste them into server/.env:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# If pg_dump is not on PATH:  PG_BIN_DIR=/opt/homebrew/opt/postgresql@16/bin

npm run build            # builds the web client and the server
npm run migrate          # creates/upgrades the database (takes a verified backup first if data exists)
npm start                # http://localhost:3000/app  → first visit creates the owner's Super User
```

Development with auto-reload: `npm run dev` (server) and `npm run dev -w web` (web client on :5173, proxied to :3000).

### Tests

```bash
cd server && npx vitest run          # 55 automated tests, real PostgreSQL (brittvideo_test)
node e2e/e2e.js && node e2e/e2e2.js  # browser walkthroughs (Playwright; server running on :3000 with an empty dev DB)
```

### Environments (V29, Y21)

`APP_ENV` is `development`, `test` or `live`, each with its **own** database. BrittVideo refuses to start if a non-live
environment points at a live database or vice versa. Outside `live`, test payments are simulated and no real card can
be charged; Square card payments are not switched on until Phase 8.

### Operations

| Task | Command |
|---|---|
| Create another login from the command line | `npm run create-super-user` (or Settings → Users in the app) |
| Make a backup now | `npm run backup` (also nightly, automatically) |
| Restore a backup | `npm run restore -- <file>` (takes a safety backup first; asks to type RESTORE) |
| Import V2 prototype data | Settings → Import from V2 in the app, or `npm run import-prototype -- <file>` |

### Deployment (go-live)

Run as one Node service with a managed PostgreSQL 16 database and a persistent disk for `STORAGE_DIR` and
`BACKUP_DIR`; copy `BACKUP_DIR` off the server nightly. Health check endpoint: `GET /api/health/live`. Set
`APP_ENV=live`, `PUBLIC_BASE_URL=https://…`, and `SUPPORT_EMAIL` to the developer's address. See the Developer Brief
for the full go-live checklist.
