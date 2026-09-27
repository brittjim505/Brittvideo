# Integrations and Automation Specification

## Square

Purpose: payment/subscription processing. - Use hosted/secure Square
payment surfaces; BrittVideo does not collect full card data. - Webhook
verification required. - Idempotent payment/order handling. -
Reconciliation job for missed/delayed webhooks. - Never create duplicate
client/order/project from repeated callbacks.

## Vimeo

Purpose: Premier hosting, playback/review where appropriate, monthly
usage/performance reporting. - Hosting status is separate from file
ownership. - Track video IDs, upload state, privacy/share state, hosting
entitlement, report periods. - On Premier cancellation, apply approved
hosting-stop rules without deleting owned downloads/history. - Failed
report retrieval should retry safely and surface health status.

## HeyGen / video providers

-   HeyGen is an adapter, not the architecture.
-   Keep provider credentials server-side.
-   Common production request/response contract.
-   Track provider job ID, status, attempts, error classification,
    output assets and cost metadata if available.
-   Provider failure must not erase approved scripts/scenes.
-   Support future provider replacement/certification.

## AI / website analysis

-   Website analysis must ground generated claims in source material.
-   Keep source URLs/facts/assets used for a project.
-   Avoid inventing unsupported client claims.
-   Human review/approval remains mandatory.

## Communications

-   Abstract email/SMS provider behind a service layer.
-   Marketing consent/opt-out checked at send time.
-   Transactional and marketing categories are distinct.
-   Retry with idempotency and duplicate suppression.
-   Record message purpose, recipient, provider ID, status and
    timestamps.

## Automation jobs

At minimum: - Premier quarterly due-date scheduler - Vimeo monthly
reporting - hosting entitlement/status checks - Standard post-delivery
Thank-You Follow-Up - lifecycle marketing sends - opt-out enforcement -
payment reconciliation - production polling/reconciliation - integration
health checks - backup verification - failed-job recovery/support
escalation

Every scheduled job must be safe to run twice.
