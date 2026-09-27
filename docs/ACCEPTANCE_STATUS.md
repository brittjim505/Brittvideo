# Acceptance Status — 2026-09-27 (BrittVideo 3.0.0-phase2)

Legend: **PASS (automated)** = covered by a passing automated test · **PASS (browser)** = exercised end-to-end in
Chromium (`e2e/`) · **BUILT – NEEDS OWNER TEST** · **PARTIAL** · **NOT BUILT (Phase n)**. Nothing is marked production-ready:
the spec requires every applicable item to pass, plus owner acceptance on real iPad/Mac devices.

Test files: `server/test/security.test.ts` (S), `sales.test.ts` (Sa), `integrity.test.ts` (I), `review-regressions.test.ts` (R).

## Sales
| Item | Status | Evidence |
|---|---|---|
| In-person iPad demo works | PASS (browser, iPad Pro 11 viewport) — needs real-iPad owner test | e2e.js steps 05–10; Sa "starts a prospect-safe demo…" |
| Mac/Zoom demo works | BUILT – NEEDS OWNER TEST (opens separate window to share) | Sa concurrency test uses mac_zoom session |
| Owner-controlled prospect-safe demo link | PASS (automated) | Sa "demo links (G1, V15, W25)" |
| Demo exposes no back-office/private information | PASS (automated + browser); demo is a separate bundle with no admin endpoints | Sa "shows the prospect only prospect-safe information"; e2e "demo leaks? []" |
| Senior Care, Dental, Attorneys, OTHER work | PASS (automated) | Sa prospects test; OTHER requires business type |
| Demo converts to client + project without re-entry or duplicates | PASS (automated + browser) | Sa "Become a Client…", "many simultaneous submissions…" |
| Standard/Premier terminology consistent | PASS (no "Premium" in app code — independent review) | — |

## Builder
| Item | Status |
|---|---|
| Website, images, story, scripts, narration, scenes and approvals persist | PARTIAL — scenes, scripts and approvals persist centrally (incl. imported V2 work); Builder screens are Phase 3 (use V2.11.23 meanwhile) |
| Primary video up to 120 s | PASS (schema limit 120 s; V2.11.23 builds 120 s kits) |
| Social 16:9, 9:16, 1:1 | PASS for data model (Social A/B carry all three formats); rendering Phase 4 |
| Email Video separate | PASS (separate deliverable; standalone Email Video project kind) |
| Quick Video 15/30/60/90/120 + purposes | PARTIAL — durations enforced; purposes stored; creation screen Phase 3 (V2.11.23 meanwhile) |
| Complete Video Kit derived from valid approvals | PASS (automated) — I "approval integrity" |
| Editing an approved dependency invalidates only affected approvals | PASS (automated + browser) — I "a material edit…"; e2e2 step 19 |
| No false green/completed states | PASS (automated) — new projects never show approved; restore re-syncs production state; R #4 |

## Production — NOT BUILT (Phase 4)
Adapter contract drafted in `docs/PROVIDER_ADAPTERS.md`. Secrets are server-side only (PASS, S "secrets never leave the server").

## Delivery — NOT BUILT (Phase 5)
Delivery record and "delivered" history from V2 are preserved on import. Hosting tracked separately from ownership (schema).

## Premier
| Item | Status |
|---|---|
| $149/month state tracked | PASS (automated) — membership stores $149 at sale, starts at payment |
| Quarterly due date from actual start | PARTIAL — start date recorded; scheduler Phase 7 |
| Upcoming obligations before overdue | PARTIAL — Command Center card exists; scheduler Phase 7 |
| Quarterly work is not a new sale | PARTIAL — `included_in_premier` + obligation link in schema; workflow Phase 7 |
| Cancellation/restart, no duplicate quarterly jobs | PARTIAL — unique (membership, quarter) constraint; workflow Phase 7 |
| Monthly Vimeo reports automated | NOT BUILT (Phase 5) |

## Communications — NOT BUILT (Phase 6)
Marketing preference and unsubscribe protection are built and tested now (Sa "marketing preference"; I restore test).

## Payments
| Item | Status |
|---|---|
| Square handles card data | PARTIAL — adapter contract; live Square is Phase 8. No card entry exists anywhere in BrittVideo. |
| No full card number/CVV stored | PASS (automated) — Sa checks payment rows; redaction test |
| Payment actions idempotent | PASS (automated) — R #1 (six concurrent attempts → one charge; crash-resume) |
| Duplicate callbacks cannot create duplicate orders/projects | PASS (automated) for signup retries/concurrency; Square webhooks Phase 8 |

## Recovery / Support
| Item | Status |
|---|---|
| Autosave works | PASS (browser + automated) — e2e step 03; R #2 conflicts |
| Checkpoints work | PASS (automated) — I checkpoint restore |
| Crash/session recovery | PARTIAL — Continue Working + drafts + checkpoints; full Builder session restore arrives with the Builder |
| Backup/restore tested, not merely documented | PASS (automated) — I backup tests; R #6 atomic restore + media. **Still required: restore drill on the live host.** |
| Safe retries verify external status first | PASS (automated) for payments (pending attempt resumed/checked) |
| Health checks cover DB/storage, production, Square, Vimeo, comms, cloud | PARTIAL — DB, storage, backups, jobs, Square state live; production/Vimeo/comms show "not connected yet" until their phases |
| GET SUPPORT plain-language report | PASS (browser + automated) |
| SEND FOR SUPPORT useful, no secrets | PASS (automated) — S redaction test; I job escalation test |
| Owner never needs developer tools | PASS so far — browser errors are reported automatically; every error is a plain sentence |

## Security / Roles
| Item | Status |
|---|---|
| Separate Super User/Admin/User logins | PASS (automated) |
| Permission boundaries tested | PASS (automated) — S "permission enforcement on direct requests" |
| Demo viewer is not an admin user | PASS — demo uses token-scoped public API only |
| Secrets encrypted/protected | PASS (automated) |
| Audit trail for important actions | PASS (automated) — append-only |
| Dev/test/live separated | PASS — config refuses mixed environments; test payments refused in live |

## Migration
| Item | Status |
|---|---|
| Existing local prototype data imported safely | PASS (automated + browser) with a realistic V2.11.23 export. **Still required: import of Jim's real export.** |
| Upgrade does not wipe data | PASS — migration 0002 applied to a populated database after a verified backup; I "re-running the upgrade…" |

## Owner acceptance
Not yet performed. Script: `docs/OWNER_ACCEPTANCE_TEST.md`.
