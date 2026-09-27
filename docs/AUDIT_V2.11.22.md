# Audit — BrittVideo Builder V2.11.22 vs. Specification Package (2026‑09‑27)

Method: every script block of `BrittVideo_Builder_V2.11.22_DEMO_TO_PROJECT_HANDOFF.html` was read, then the
prototype was exercised in headless Chromium (scripts kept in `docs/audit-scripts/`). Status words follow the
master spec legend. "Verified" means observed in the browser test, not inferred from code.

## 1. Blocking defects found in the current baseline

| # | Defect | Evidence | Effect |
|---|--------|----------|--------|
| D1 | **Build 4-Script Video Kit crashes** on a fresh page load: `ReferenceError: websiteKey is not defined`. The capture-phase `doBuild` handler (V2.10.x) and the reopen path in `loadProject` reference `websiteKey`/`websiteSecs`, which only exist inside another handler's local scope. | Browser test: 0 scripts, 0 scenes built. | Core Builder unusable from a clean start. Reopening a saved project with scenes also hits the same undefined variable. |
| D2 | **Website Analysis is hard-wired to Morada Quintessence.** Every client — including a Dental prospect — gets Morada facts, Morada images and Morada narration. | Browser test: dental prospect received "Assisted Living…" facts and "At Morada Quintessence…" narration. | Cannot safely build for any customer other than Morada. Violates K3/S8 (grounded analysis) and "avoid inventing unsupported client claims". |
| D3 | **Complete Video Kit download is blocked for Website lengths under 60 s.** `downloadCompleteKit` hard-codes `website >= 12` scenes, and its manifest hard-codes "60 sec / 12/12". | Browser test (shimmed D1): 30 s kit approved but download refused. | False "not ready" state; wrong manifest for 90/120 s. |
| D4 | Social A, Social B and Email scenes are **global constants**, not per-project data. | Code: `socialAScenes`, `socialBScenes`, `emailScenes` are module constants mutated in place. | One project's edits leak into the next project opened in the same session. |
| D5 | Demo mode hides navigation with CSS only; **client/prospect data remains in the page** and GET SUPPORT stays visible. | Browser test: `clientsDataInDom: true`, `getSupport: true`. | Violates V13/Y15 ("do not load the whole admin app and merely hide sensitive sections"). |
| D6 | Demo → client conversion creates a **client only** — no order, price, agreement, payment or project record. | Browser test: project count unchanged after conversion. | Delta requirement "convert directly to a real client **and project**" is only partly met. |
| D7 | Video Library reads `state.projects`, which nothing writes. | Browser test: always 0. | Screen always empty. |
| D8 | Support report shows stale version "V2.11.17". | Code. | Q18 (actual version in report) not met. |
| D9 | **Approve Scene, Rewrite Scene and Change Image throw an error after a kit is built.** `updateProductionCheck` writes to a `#productionCheck` panel that `showKit` has already removed; the error stops the Step 7 counters and final-approval panel from refreshing. | Browser test: `approveScene(0)` → `TypeError: Cannot set properties of null`. | Counters appear one click behind or stale — the likely root cause of the repeated "approval counter" patches (V2.10.73–V2.10.76). |

## 2. Requirement status by area

| Area | Status | Notes |
|------|--------|-------|
| Builder workflow K1 (8 guided steps) | PARTIAL — NEEDS CORRECTION | Guide works; D1–D4 break real use. |
| Website analysis K3/S8 | NOT BUILT (placeholder) | D2. |
| Image controls K4/T1–T21 | PARTIAL | Library add/rename/delete (base64 in browser storage, quota-limited). No Do Not Use, in-use protection, Recently Deleted, duplicates, protection classes. |
| Story authority K5, tone/story lists per industry | BUILT | Story lists for Senior Care, Dental, Attorneys, OTHER. |
| Scripts & narration K6 | PARTIAL | Website/Social/Email scripts are templates with placeholders; Quick Video narration generator is real and editable. |
| Scene approval K7/K8 | BUILT — NEEDS CORRECTION | Works, but counters draw from several competing sources (ledger, DOM snapshot, stored copy); observed a Social A counter dropping to 0 after one scene edit. |
| Complete Video Kit gate K9/Y6 | BUILT — NEEDS TESTING | Fingerprint of scenes+scripts is a good design; final approval correctly lost after a material edit (verified). Stored only in browser. |
| Material change K10/W7 | PARTIAL | Edits reset scene approval and final approval (verified), but approval records don't reference content versions. |
| Save/restore K11, checkpoints Q3/Q4 | PARTIAL | Manual Save + 20‑s checkpoints + recovery prompt. Background autosave is intentionally disabled; nothing autosaves until the first manual save. Browser-only. |
| Quick Video K12/K13, standalone Email K15 | BUILT — NEEDS TESTING | All 8 purposes, 15/30/60/90/120 s, 3 delivery choices, personalization, editable script. |
| Standard deliverables K14/N3 | PARTIAL | Website up to 120 s; Social A/B built as 9:16 only; 16:9 and 1:1 exist as text plans in the kit ZIP. |
| Production layer / providers U1–U36 | NOT BUILT | "Creation Platform" dropdown only. |
| Delivery N1–N16 | PARTIAL | Records "package downloaded" and "delivery recorded" honestly; no files, versions or per-format review. |
| Command Center L1–L20 | NOT BUILT | Dashboard shows 3 counts. |
| Prospects / Demo & Sales B1–J1, delta | PARTIAL | Industries incl. OTHER ✓; three channels selectable ✓; duplicate-prospect guard ✓; D5, D6; no Demo Library, no real demo link, OTHER does not store actual business type (B3). |
| Pricing / orders / Square M1–M20 | NOT BUILT | |
| Clients / projects central records R5–R25 | NOT BUILT | Browser storage only; Delete Client erases history. |
| Follow-up, marketing, opt-out O1–O14 | NOT BUILT | |
| Premier quarterly system P1–P15 | NOT BUILT | |
| Vimeo hosting/reporting | NOT BUILT | |
| Roles / auth / audit V1–V31 | NOT BUILT | No login. |
| Support & recovery Q1–Q25 | PARTIAL | GET SUPPORT panel, support report without secrets, share/copy/download, structural self-check, error capture ✓. No health monitoring, backup, safe retry framework. |
| Backup Q20/W30 | PARTIAL | Per-project JSON export/import only; not automatic, not tested restore. |
| Migration R21/R22 | NOT BUILT | Data lives in 8 browser-storage keys (listed in §3). |
| AI4Seniors entitlement | NOT BUILT | |

## 3. Prototype data that must be migrated

Browser-storage keys observed in V2.11.22: `bv-state` (prospects, clients), `brittvideo-v2-projects` (saved projects:
scenes, approvals, scripts, Quick Video, production record), `brittvideo-v28-deliverable-approvals:<projectId>`,
`brittvideo-v21107-final-approvals`, `brittvideo-stage1-checkpoints`, `brittvideo-image-library-v21061`,
`brittvideo-stage1-support-log`, `brittvideo-prospect-draft-v21035`, plus UI keys (guided step, selected entity).

## 4. What this means for the plan

* The prototype remains the behavioral reference. Its best ideas are carried forward deliberately:
  content-fingerprinted final approval, honest "not delivered until recorded" states, Quick Video narration
  timing targets, the guided 8-step flow, the plain-language support report.
* D1, D3, D8 and D9 are fixed in a minimal **V2.11.23** bridge build so Jim can keep working while production is built;
  V2.11.23 also adds **EXPORT ALL DATA FOR UPGRADE** so existing work can be imported into production.
* D2, D4–D7 are not patched in the prototype; they are solved properly in production (Phases 2–3).
