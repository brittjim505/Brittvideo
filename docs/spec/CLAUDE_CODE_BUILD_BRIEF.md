# Claude Code Build Brief

You are building the complete production BrittVideo system from the
supplied specification package.

## Mission

Turn the current single-file HTML prototype into a reliable production
business operating system for one owner, with secure cloud persistence,
role-based access, automated business workflows, provider-independent
video production, prospect-safe sales, delivery, reporting, marketing,
and support/recovery.

## Non-negotiable design principles

-   The owner runs the business; BrittVideo diagnoses
    software/integration problems.
-   Never require the owner to inspect code, browser consoles, API logs,
    or raw stack traces.
-   Human approval gates are authoritative and cannot be bypassed by
    stale UI state.
-   Cloud sync is not backup. Implement tested backup/restore.
-   External side effects (payment, production, messages, uploads) must
    be idempotent.
-   No secrets in browser code, logs, exports, demo links, or support
    packages.
-   Separate development/test/live environments.
-   Preserve historical truth: pricing at sale, approvals, deliveries,
    cancellations, opt-outs, and quarterly history.
-   Responsive Mac + iPad experience; iPad is especially important for
    Demo/Sales/Signup/Payment.
-   Accessibility: large clear controls, unambiguous labels, exact
    action wording, low cognitive load.

## Core modules

1.  Command Center / Dashboard
2.  Prospects / CRM
3.  Demo & Sales Mode
4.  Client onboarding / agreement / payment
5.  Client & project records
6.  Website analysis + source/rights tracking
7.  Image Library
8.  Video Builder
9.  Quick/Single Video Builder
10. Script/narration editing
11. Scene Builder + approvals
12. Production Layer + provider adapters
13. Video Library
14. Delivery / downloads / ownership
15. Vimeo hosting + performance reports
16. Premier quarterly scheduling
17. Communications / follow-up / lifecycle marketing
18. Billing/subscription status
19. AI4Seniors entitlement status (isolated benefit)
20. Settings / integrations / roles
21. Support, Recovery, Backup & System Health
22. Audit/history

## Build sequence

Phase 1: stabilize domain model, auth/roles, database, migrations,
autosave/checkpoints, audit log. Phase 2: prospect → demo → sale →
client/order/project with no duplicate entry. Phase 3: complete Builder
and approval-integrity workflow. Phase 4: production provider
abstraction, job queue, retries, result ingestion. Phase 5: delivery,
ownership, Vimeo hosting/reporting. Phase 6: Standard lifecycle
marketing and opt-out enforcement. Phase 7: Premier subscription +
quarterly scheduler and included-work workflow. Phase 8: Square payment
integration and reconciliation. Phase 9: support/recovery/health
automation, backup/restore drills. Phase 10: security, permission,
failure, migration, iPad/Mac, and owner acceptance testing.

## Definition of done

Do not call a feature complete merely because a screen exists. It is
complete only when its happy path, failure path, retry/recovery
behavior, persistence, permissions, audit/history, and owner-facing
explanation have been tested.
