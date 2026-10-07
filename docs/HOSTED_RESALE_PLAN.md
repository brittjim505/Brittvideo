# BrittVideo — Hosted Resale Plan

**Decision (Jim, 2026-10-07):** sell BrittVideo to other local video operators as a **hosted service**. Jim runs one
online system; each buyer rents a private account. Buyers never install anything.

Starting prices to test (not final): setup $299–499 · Starter $99/month (1 person) · Pro $199/month (owner + helpers) ·
yearly = 2 months free · first 5 "founding buyers" $79/month for as long as they stay.

---

## The order of work

### Stage 1 — Finish the app for Jim first
A buyer expects a finished product, and Jim's own results are the best sales proof.
1. Put the TEST copy online and run the owner acceptance test (46 steps).
2. Phases 4–8: AI video production (HeyGen), delivery/hosting of finished videos, customer emails and texts,
   Premier scheduling, live Square payments.
3. Jim runs his own business on it with real clients for about 2–3 months. Fix what comes up.

While Stage 1 runs, new work is kept "buyer-ready": nothing about Jim (name, phone, city, prices, wording) is
hard-coded — it all comes from Settings.

### Stage 2 — Make it multi-buyer (hosted)
1. **One database per buyer** on the same server. Each buyer's clients, pictures and videos are completely
   separate from Jim's and from each other. The app's existing code barely changes; backups and restores
   work per buyer; one buyer can be moved or removed without touching the others.
2. **Each buyer gets their own web address**, e.g. `mesavideo.<product-domain>`; their prospects' demo pages use it.
3. **Buyer branding:** business name, logo, colors, phone, email, signature — shown in the app, demo pages,
   agreements, emails and kit downloads.
4. **First-run setup wizard** for a new buyer: business details → prices → industries they serve → connect
   their own Square, HeyGen and email accounts → done.
5. **Jim's control panel:** add a buyer, see who is paying, suspend/close an account, see each buyer's health
   and backups, log in as support (recorded in their audit trail).
6. **Subscription billing** for buyers (Square subscriptions, since Jim already uses Square): setup fee, monthly
   or yearly, founding price, card failures → friendly reminders → read-only after a grace period (never deletes data).
7. **Fair-use limits** per plan (users, storage) so one buyer can't slow everyone down.
8. Security review before the first outside buyer (separate data, login protection, backups off-site).

### Stage 3 — The package buyers receive
1. **User guide** — short, picture-by-picture, the same style as the owner acceptance test: "Find a prospect →
   demo → Become a Client → build a kit → deliver." Available inside the app (HELP button) and as a PDF.
2. **How-to videos** (2–3 minutes each) — can be made with the app's own HeyGen workflow.
3. **Starter kit:** outreach message templates, sample demo videos per industry, pricing guidance.
4. **Buyer agreement / terms of service and privacy policy** — drafted, then reviewed by a lawyer.
5. **Support plan:** GET SUPPORT reports already go to the owner; for buyers they come to Jim, with an
   agreed reply time.
6. **Sales page** for the product, with Jim's own results.

### Stage 4 — Founding buyers
Sign up to 5 local operators at the founding price. Onboard each personally, collect feedback and testimonials,
then open to more buyers at the regular price.

---

## Decisions Jim will need to make (later, one at a time)
1. Product name for buyers (keep "BrittVideo" or a new name) and its web domain.
2. Final prices after the founding buyers.
3. Whether buyers may serve any industry, or only Dentists / Facilities / Attorneys / Others.
4. Whether to offer a territory promise (e.g. one buyer per city).

## Rough running cost
One server plus off-site backups: about $40–80/month for the first 10–20 buyers. Each buyer pays for their own
HeyGen, Square, email/text and Vimeo accounts.
