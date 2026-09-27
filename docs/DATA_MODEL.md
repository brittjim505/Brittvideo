# Data Model and Business Rules

Schema: `server/src/migrations/*.sql`. IDs are UUIDs; money is integer cents; times are `timestamptz`.
"Enforced by" names every layer that protects a rule — S = service code, C = database constraint/index, T = trigger.

| Entity (table) | Purpose | Key rules | Enforced by |
|---|---|---|---|
| User (`users`), Session (`sessions`), `login_attempts` | Separate logins, roles | One account per email; last active Super User cannot be demoted/disabled/deleted; 5 failed sign-ins → 15 min lock; disabling revokes sessions; only token hashes stored | S, C `users_email_uq`, T `bv_guard_last_super_user` (advisory-locked) |
| AuditEvent (`audit_events`) | Who did what, when | Append-only; secrets redacted from before/after | T `bv_append_only` |
| Secret (`secrets`) | Provider credentials | AES-256-GCM; write-only via API; never in reports | S |
| Prospect (`prospects`) | Sales pipeline | No duplicate name+website; OTHER requires real business type; private notes never shown in demos | S, C `prospects_dedupe_uq`, C `prospects_other_needs_type` |
| Client (`clients`) | Durable customer record | One per prospect; name+website dedupe; archived not deleted | C `source_prospect_id UNIQUE`, C `clients_dedupe_uq`, T `bv_no_hard_delete` |
| MarketingConsent (`marketing_preferences`, `marketing_preference_events`) | Active / Paused / Unsubscribed | Created once, never reset by projects/sales/imports; leaving Unsubscribed needs client's recorded request; restore re-applies unsubscribes | S, T `bv_guard_unsubscribe`, backup restore |
| PriceBookVersion (`price_book_versions`) | Default prices | Immutable versions; new sales use latest | T append-only |
| Sale/Order (`orders`), `order_lines` | What was sold at what price | List, agreed and sold price copied at sale; lines immutable; one order per demo session; idempotent sale key | S, T append-only, C `orders.demo_session_id UNIQUE`, C `orders.sale_key UNIQUE` |
| Agreement (`agreements`) | Evidence of acceptance | Exact text + SHA-256 + terms version + name/time/IP; must equal what the prospect read | S, T append-only |
| Payment (`payments`), PaymentEvent (`payment_events`) | Payment state | No card data; exactly-once per order (advisory lock); max one paid and one pending per order; pending attempts resumed with the same provider key | S, C `payments_one_paid_per_order`, C `payments_one_pending_per_order` |
| PremierMembership (`premier_memberships`), QuarterlyObligation (`quarterly_obligations`) | $149/month membership, quarterly videos | Monthly price copied at sale; starts at actual payment; one active per client; one obligation per quarter | S, C `premier_one_active_per_client`, C `UNIQUE(membership_id, period_index)` |
| Project (`projects`) | Video work | One Video Kit project per order; belongs to client or prospect (demo builds); archived not deleted; provider chosen at creation | C `projects_one_kit_per_order`, T `bv_no_hard_delete` |
| Deliverable (`deliverables`) | Website / Social A / Social B / Email / Quick | Durations 15/30/60/90/120 only; formats ⊆ {16x9, 9x16, 1x1} | C checks |
| Scene (`scenes`) | Scene content | `content_hash` = SHA-256 of name, timing, image, visual, narration | S |
| Approval (`approvals`), ApprovalInvalidation (`approval_invalidations`) | Approval ledger | Append-only; valid only while hash matches current content; approving requires the hash the owner saw; Complete Video Kit calculated from all required components + composite hash | S, T append-only |
| Checkpoint (`checkpoints`) | Recoverable versions | Append-only; restore takes a safety checkpoint first and never copies approvals | S, T append-only |
| ProductionRecord (`production_records`) | Honest production/delivery state | Returns to "needs reapproval" whenever the calculated gate is no longer satisfied | S |
| Asset (`assets`) | Image Library / media | Statuses incl. Do Not Use; permanent deletion leaves a tombstone that can never be restored | T `bv_guard_tombstone` |
| DemoSession / DemoLink (`demo_sessions`, `demo_links`) | Prospect-safe access | 256-bit random tokens, only hashes stored; expiry; owner can turn off; every invalid token gets the same answer | S, C |
| DemoItem (`demo_library_items`) | Demo Library | Client work shown only with recorded permission | S, C `demo_publish_needs_permission` |
| Drafts, UserActivity | Autosave, Continue Working | Revisioned; unaware or stale writes are conflicts, never overwrites | S |
| Idempotency (`idempotency_keys`), Job (`jobs`) | Safe retry, automation | Same key + same request → same result; job dedupe keys; stuck jobs reclaimed; dead jobs → recovery event + support report | S, C |
| IntegrationHealth (`health_checks`), RecoveryEvent, SupportReport, `diagnostic_log`, `backups` | Support & recovery | Owner-facing sentences; redacted detail | S |
| Migration bookkeeping (`migration_imports`, `legacy_refs`, `schema_migrations`) | Upgrades and V2 import | Same file imported once; changed applied migration refuses to start | S, C |

Entities in `DATA_MODEL_AND_STATE.md` not yet present (arrive with their phase): ScriptVersion/NarrationVersion history
(Phase 3), ProductionJob/ProviderAttempt/OutputAsset (4), Delivery/DownloadEvent/VideoLibraryItem/HostingRecord/
VimeoReport (5), Communication/MessageAttempt (6), AI4SeniorsEntitlement (7).
