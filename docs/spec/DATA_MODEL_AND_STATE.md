# Data Model and State Requirements

Use durable IDs (UUIDs recommended) and timestamps. Preserve history
rather than overwriting business truth.

Core entities: - User, Role, Session - Prospect - DemoSession /
DemoLink - Client - Contact - Offer / PriceBookVersion - Sale /
Agreement - Payment / PaymentEvent - Project - Deliverable -
ScriptVersion - NarrationVersion - Scene - SceneAsset / AssetSource /
RightsNote - Approval / ApprovalInvalidation - ProductionJob /
ProviderAttempt / OutputAsset - Delivery / DownloadEvent -
VideoLibraryItem - HostingRecord - VimeoReport / PerformanceMetric -
Subscription / PremierMembership - QuarterlyObligation /
IncludedProject - Communication / MessageAttempt - MarketingConsent /
OptOut - AI4SeniorsEntitlement - IntegrationConnection /
IntegrationHealth - Checkpoint / RecoveryEvent - SupportReport -
AuditEvent

Important rules: - Never derive historical sale price from today's price
book. - Marketing opt-out is durable and cannot be reset by project
creation, migration, restore, or retry. - Approval records reference the
exact content/version approved. - Changed dependencies invalidate
affected approval state. - Production attempts are append-only history;
current status may summarize them. - External operation keys/idempotency
keys are stored for payment, production, upload and communication
operations. - Premier quarterly obligations have unique constraints
preventing duplicate periods. - Soft-delete/archive where history must
remain; permanent deletion only where explicitly allowed and audited.
