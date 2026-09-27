# Latest Requirements Delta --- Overrides Older Master-Spec Wording

These decisions are newer than portions of the September 2026 master PDF
and control where conflicts exist.

## Commercial model

-   Primary Video Kit: **\$997 one-time project price**.
-   Premier subscription: **\$149/month**.
-   Premier includes Vimeo Professional hosting while active, monthly
    usage/performance reporting, and **one fresh custom video each
    quarter up to 120 seconds**.
-   Canceling Premier stops hosting; client keeps downloaded/owned
    files.
-   Do not use old "Premium" terminology in new UI; use **Premier**.
-   Owner must retain ability to change pricing without corrupting
    historical transactions.

## Deliverables

-   Primary custom website video: up to **120 seconds**.
-   Social outputs where applicable: **Landscape 16:9, Portrait/Vertical
    9:16, Square 1:1**.
-   Email Video is a **separate deliverable**.
-   Quick/Single Video lengths: **15 / 30 / 60 / 90 / 120 seconds**.
-   Quick purposes include Thank You After Service, Follow-Up /
    Check-In, Review Request, Referral Request, Promotion, Announcement,
    Seasonal, and Email Video.
-   Delivery choices include Email, Text/SMS Link, Website/Social.

## Demo & Sales Mode

Required industries: - Senior Care - Dental - Attorneys - OTHER

OTHER is for one-off/non-core opportunities such as plumbers without
creating a permanent industry for each.

Three channels must use the same prospect-safe experience: 1. In-person
on iPad. 2. Remote live demo on Mac via Zoom/window sharing. 3.
Owner-controlled prospect-safe follow-up/demo link.

Prospect-safe mode must hide internal navigation, client/prospect lists,
private notes, pricing internals/costs, diagnostics, credentials,
support logs, and back-office controls.

A demo prospect must convert directly to a real client **and project**
without re-entering name, website, industry, selected package, or other
captured sales data.

## Standard-client lifecycle marketing

A Standard client remains eligible for automated BrittVideo marketing
after delivery unless opted out. - Easy unsubscribe required. -
Marketing opt-outs are automatically honored. - Transactional/service
messages are separate. - After Standard delivery/download, automatically
send a BrittVideo-branded Thank-You Follow-Up Video asking for
referrals.

## Support & Recovery --- absolute requirement

The owner must never be expected to diagnose software failures.
Required: - autosave and checkpoints - crash/session recovery - safe
retry - idempotency/duplicate prevention - integration/system health
monitoring - diagnostic logs with no secrets - plain-language support
report - GET SUPPORT / SEND FOR SUPPORT - preservation of approvals,
clients, projects, prices, opt-outs, Premier schedules, and delivery
history across failures/upgrades

## AI4Seniors

Keep AI4Seniors standalone; do not clutter the primary BrittVideo sales
ladder. It may be provided as a benefit/add-on for Premier and later bot
subscribers, with entitlement/status automation.

## Provider architecture

HeyGen API is available but integration may be staged after core
BrittVideo is stable. Production must remain provider-independent so
supported AI/video providers can be swapped through adapters rather than
rebuilding the application.
