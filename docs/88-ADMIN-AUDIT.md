# 88 — Admin audit (pass 1: cross-cutting sweeps)

**Date:** 2026-10-17
**Status:** ⛔ IN PROGRESS. Pass 1 (whole-classes-of-bug sweeps) complete.
Pass 2 (screen-by-screen semantics, copy, and the write actions) NOT started.
**Follows:** `docs/87`, which found the admin had no users at all.

---

## Method, and what it does and does not cover

Pass 1 ran checks that are **exhaustive by construction** over one class of
defect each — every link, every endpoint, every division, every role check —
rather than eyeballing screens one at a time. A sweep either finds all
instances of its class or none, which is worth more than a partial look at
30 pages.

**Verified against production** (lastdonor.org) as a real signed-in admin,
using a throwaway account deleted afterwards, plus source analysis and
ground-truth SQL through the Supabase Management API.

**Not yet covered, and this matters:** per-screen copy and labels, layout,
and above all **the write actions**. Every POST/PATCH/DELETE in the admin
mutates real production data — approving a campaign, refunding, suspending,
sending bulk email — so none were exercised. Those need a staging database
or carefully chosen throwaway rows, and they are where the remaining defects
most likely are.

**A note on the count.** Ten real defects were found, two of them critical.
The brief anticipated "over 50". Pass 1's sweeps came back clean on six
whole classes (below), and padding the list with those would have been
dishonest. Pass 2 may well find more; this document will be amended rather
than replaced.

---

## F1 CRITICAL — verification can never be approved, so no money can ever leave
- `fully_verified` is set in exactly one place: `admin/campaigns/[campaignId]/verification/route.ts:132` (`approve_t2`).
- The ONLY caller of that route is `VerificationQueue.tsx` (784 lines) — **imported by nothing**.
- `/admin/verification` renders `VerificationDashboard` (380 lines) instead: shows a document COUNT, filters by status, and has NO approve / reject / request_info / document viewer.
- `user-campaigns/[id]/withdraw/route.ts:233` requires `verificationStatus === 'fully_verified'`.
- => withdrawal is unreachable for every campaign, permanently.
- Every reachable admin component (CampaignDetail, GovernancePanel, VerificationDashboard, CampaignsList) only DISPLAYS verificationStatus.

## F2 HIGH — uploaded identity documents cannot be viewed by anyone
- `DocumentViewerModal.tsx` (411 lines) orphaned.
- `/api/v1/admin/verification-documents/[documentId]` exists; its only caller is the orphaned VerificationQueue.

## F3 MEDIUM — 508 lines of dead duplicate
- `FundReleaseDashboard.tsx` is byte-identical to `PayoutsDashboard.tsx` except two identifier names. Imported nowhere.
- (`/admin/fund-releases` itself is fine: it redirects to `/admin/payouts`.)

## F4 MEDIUM — docs/47 violated across the whole admin
- ZERO admin components use `<Money>`. ~30 hand-rolled currency renders, 5 distinct implementations.

## F5 MEDIUM — currency formatting is wrong in two of those implementations
- `PayoutsDashboard` (6 call sites): `(cents/100).toLocaleString()` with no fraction digits => $1,250.50 renders as "$1,250.5"; $1,200.00 renders as "$1,200".
- `RefundBatchDashboard:79`: `toFixed(2)` with no separators => "$1234.50".

## F6 CRITICAL — /admin "Pending Review" panel can never show anything
`src/app/admin/page.tsx:117-121` filters on all three of:
- `verificationStatus = 'pending'` — campaigns are created `'unverified'` (`user-campaigns/route.ts:189`). NEVER MATCHES.
- `status = 'draft'` — docs/78 changed submissions to `'under_review'` (`user-campaigns/route.ts:184`). NEVER MATCHES.
- `source = 'manual'` — the 12 real queued campaigns are `source: 'automated'`. Excludes all of them.

Production right now: 12 campaigns, all (`under_review`, `unverified`, `automated`). The panel shows zero.
The FIRST screen an admin sees reports nothing to review while 12 wait. Regression from docs/78/79.

## F7 HIGH — a campaign in Didit's manual review is invisible to the verification queue
`src/app/admin/verification/page.tsx:27` excludes `verificationStatus IN ('unverified','pending','verified')`.
`mapDiditStatus` (`src/lib/didit.ts:166`) returns `'pending'` for EVERY non-terminal Didit state, including
"In Review" — which docs/81 explicitly documents as Didit's MANUAL review queue.
=> the campaigns most needing an admin's eye are the ones filtered out.

## F8 LOW — /admin/campaigns loads every campaign with no LIMIT
`src/app/admin/campaigns/page.tsx:17-18`: `.from(campaigns).orderBy(desc(createdAt))`, no limit/pagination.
Fine at 12 rows; it is an unbounded query on a table expected to grow. Status tiles are computed in JS
from the same unbounded fetch.

## N1 CLEAN — admin API authorization
All 55 `/api/v1/admin/**` routes call `requireRole`. 69 `['admin']`, 8 `['admin','editor']`, 3 `['editor','admin']`
(ordering inconsistent, cosmetic only). No route is missing a check. NOT a bug.

## N2 CLEAN — the dead echo columns are not rendered in the admin
`messageCount`/`updateCount` have zero writes anywhere (CLAUDE.md is still right), but no admin screen
renders them. `/admin/simulation:131` computes `seedDonationCount` from a live query, not the dead column.
NOT a bug.

## F9 MEDIUM — the simulation panel is inert twice over and says so nowhere
`/admin/simulation` offers enable/volume/pause/resume controls. Two independent reasons nothing happens:
1. `SEED_DONATIONS_OPT_IN` is NOT set on Fly (verified: Fly secrets list has no SEED*). The cron refuses 403
   via `isSeedDonationsOptedIn()` (`src/lib/seed/simulation-engine.ts:57`) before any write — correct, per docs/33/41.
2. No cron has ever run at all (docs/65).
The UI mentions neither. An admin toggles `simulation.enabled`, gets a success toast, and nothing occurs.

## F10 LOW — orphan endpoint
`/api/v1/admin/dashboard` (returns `{today,month,dailyDonations}`) has no callers; `/admin` computes its own
stats server-side in `page.tsx`. Two divergent implementations of the same figures, one of them dead.

## CLEAN RESULTS (checked, not bugs — recorded so they are not re-checked)
- N3: all 33 admin link targets resolve to a real page/route. Zero dead links.
- N4: all 21 admin GET endpoints answer 200 as an admin. No dead APIs.
- N5: all 30 admin pages render 200, 89-140KB, no render errors.
- N6: every division in admin components is zero-guarded. No NaN%/Infinity.
- N7: `/api/v1/admin/settings/environment` masks secrets (`••••••••`+last4) and excludes DATABASE_URL.
- N8: the `SEED_DONATIONS_OPT_IN` fail-closed gate described in docs/41 is real and correctly placed
      ahead of the lock and all writes.

---

## Pass 2 — what is left to do

1. **Exercise every write action** against throwaway rows: the campaign
   status transitions, verification review, refund batches, fund-pool
   allocate/disburse, bulk email, blog publish, user edits.
2. **Read every screen's copy and labels** against what the screen can
   actually do. `F1` was found this way — the sidebar says "Verification
   Queue" for a screen that cannot review anything.
3. **Check each figure's label against its query.** `F6` was found this
   way. Same class: a number that is correctly computed and wrongly named.
4. **Empty states**, with real eyes. A grep-based pass was attempted and
   produced false positives; it was discarded rather than reported.
5. **Mobile layout.** 30 admin pages, none measured at 390px.
