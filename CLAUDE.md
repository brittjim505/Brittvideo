# BrittVideo — notes for Claude

Owner: Jim Britt (not a programmer). Keep messages to him short, big headings, one thing at a time; he prefers large text.
Never change approved business rules without asking him. Locked decisions: Standard **$597** one-time; **Premier** (never
"Premium") **$997 + $149/month**. `docs/spec/LATEST_REQUIREMENTS_DELTA.md` overrides older spec text.

## Layout
- `server/` Node 22 + TypeScript + Fastify 5 + PostgreSQL 16. Migrations in `server/src/migrations/` are forward-only and
  checksummed — never edit an applied migration; add a new numbered file.
- `web/` React 18 + Vite. Two bundles: `index.html` (owner app, `/app`) and `demo.html` (prospect-safe demo, `/demo`).
  The demo bundle must never import owner-app code or call owner endpoints.
- Docs: `docs/ARCHITECTURE.md` (phase plan), `docs/ACCEPTANCE_STATUS.md`, `docs/OWNER_ACCEPTANCE_TEST.md`, `CHANGELOG.md`.

## Working rules
- Every fix gets a regression test (`cd server && npx vitest run`). Browser walkthroughs live in `e2e/` (Playwright,
  Chromium at `/opt/pw-browsers/chromium`).
- Secrets stay server-side (encrypted secrets table); never in logs, support reports or the demo.
- Approvals are content-hash based; any material edit must invalidate the affected approval (and the kit approval).
- Owner-facing errors are plain sentences (`OwnerError`). Button labels are BOLD CAPITALS and match the owner test script.
- After each phase: independent review agent → fix findings with tests → update docs → commit → push to
  github.com/brittjim505/Brittvideo (branch main).

## Phases
1–3 done (foundation, sales, Builder); 3.0.1 adds website pictures + business folders (Dentists/Facilities/Attorneys/Others). Next: 4 production provider · 5 delivery/hosting · 6 communications ·
7 Premier scheduling · 8 Square live payments. See `docs/ARCHITECTURE.md`.
Resale (decided 2026-10-07): HOSTED service for other operators — see `docs/HOSTED_RESALE_PLAN.md`. Keep new work
"buyer-ready": nothing owner-specific hard-coded (name, phone, city, prices, wording); it comes from Settings.
