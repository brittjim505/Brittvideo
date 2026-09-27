# BrittVideo Production Acceptance Checklist

## Sales

-   [ ] In-person iPad demo works.
-   [ ] Mac/Zoom demo works.
-   [ ] Owner-controlled prospect-safe demo link works.
-   [ ] Demo exposes no back-office/private information.
-   [ ] Senior Care, Dental, Attorneys, OTHER work.
-   [ ] Demo converts to client + project without re-entry or
    duplicates.
-   [ ] Standard/Premier terminology is consistent.

## Builder

-   [ ] Website, images, story, scripts, narration, scenes and approvals
    persist.
-   [ ] Primary video supports up to 120 seconds.
-   [ ] Social outputs support 16:9, 9:16 and 1:1 where applicable.
-   [ ] Email Video is separate.
-   [ ] Quick Video supports 15/30/60/90/120 seconds and approved
    purposes.
-   [ ] Complete Video Kit status is derived from valid underlying
    approvals.
-   [ ] Editing an approved dependency invalidates only affected
    approvals as designed.
-   [ ] No false green/completed states.

## Production

-   [ ] Provider adapter interface is documented.
-   [ ] Provider can be changed without rewriting business workflows.
-   [ ] Production jobs are queued, observable, retryable and
    idempotent.
-   [ ] Failed production does not lose approved work.
-   [ ] Secrets are server-side only.

## Delivery

-   [ ] Deliverables are clearly labeled.
-   [ ] Individual and package downloads work.
-   [ ] Client ownership/download history is preserved.
-   [ ] Vimeo hosting state is tracked separately from ownership.
-   [ ] Premier cancellation stops hosting according to business rules
    without deleting owned files.

## Premier

-   [ ] \$149/month subscription state is tracked.
-   [ ] Quarterly video due date is calculated from actual Premier
    start.
-   [ ] Upcoming quarterly obligations surface before overdue.
-   [ ] Quarterly included work does not create a new sale.
-   [ ] Cancellation/restart preserves history and prevents duplicate
    quarterly jobs.
-   [ ] Monthly Vimeo performance reports are automated.

## Communications

-   [ ] Standard post-delivery Thank-You Follow-Up Video workflow works.
-   [ ] Ongoing Standard marketing works until opt-out.
-   [ ] Unsubscribe is easy and automatically enforced.
-   [ ] Transactional/service messages remain separate from marketing.
-   [ ] No duplicate messages after retry.

## Payments

-   [ ] Square handles sensitive card data.
-   [ ] BrittVideo stores no full card number/CVV.
-   [ ] Payment actions are idempotent.
-   [ ] Interrupted/duplicate callbacks cannot create duplicate
    orders/projects.

## Recovery / Support

-   [ ] Autosave works.
-   [ ] Checkpoints work.
-   [ ] Crash/session recovery works.
-   [ ] Backup/restore has been tested, not merely documented.
-   [ ] Safe retries verify external status first.
-   [ ] Health checks cover database/storage, production, Square, Vimeo,
    communications, cloud/sync.
-   [ ] GET SUPPORT produces a plain-language report.
-   [ ] SEND FOR SUPPORT contains useful diagnostics but no secrets.
-   [ ] Owner never needs developer tools to diagnose a normal failure.

## Security / Roles

-   [ ] Separate Super User/Admin/User logins.
-   [ ] Permission boundaries are tested.
-   [ ] Demo viewer is not an admin user.
-   [ ] Secrets are encrypted/protected.
-   [ ] Audit trail exists for important business actions.
-   [ ] Development/test/live environments are separated.

## Migration

-   [ ] Existing local prototype data can be imported/migrated safely.
-   [ ] Upgrade does not wipe clients, projects, approvals, prices,
    opt-outs, Premier schedules, or history.
