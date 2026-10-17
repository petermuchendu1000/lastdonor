# 88 — Admin audit (pass 1: cross-cutting sweeps)

**Date:** 2026-10-17
**Status:** ⛔ IN PROGRESS. Pass 1 + pass 1b (more sweep classes) complete.
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

**A note on the count.** Sixteen real defects so far, three of them critical.
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

## F11 HIGH — the campaigns list offers a status change the API always rejects
`CampaignsList.ALLOWED_TRANSITIONS` vs the API's map in `admin/campaigns/[campaignId]/route.ts:17`:
- `active`:          client adds `paused`; server does NOT allow it.
- `last_donor_zone`: client adds `paused`; server does NOT allow it.
The dropdown PATCHes `{status:'paused'}` and gets 400 VALIDATION_ERROR every time. Pausing works only via
`/admin/governance`, which uses the dedicated `/pause` route. Two transition maps, one of them wrong.

## F12 MEDIUM — `realDonationCount` does not filter by source
`admin/campaigns/[campaignId]/route.ts:229` counts EVERY donation row; there is no `source='real'`.
The variable name, the inline comment ("Check for real donations - cannot hard-delete campaigns with
real money"), the docblock ("no real donations") and the audit reason ("archived instead of deleted for
financial integrity") all assert a filter the query does not apply. Currently fails safe — a seed-only
campaign is archived rather than deleted — but anyone "fixing" the name to match the comment would start
hard-deleting seed-funded campaigns. `donorCount` IS incremented by the seed engine
(`simulation-engine.ts:282`), so the two paths disagree about what a donation is.

## F13 HIGH — DELETE claims a draft-only guard that does not exist (data loss)
Docblock: "Only allowed for draft campaigns with no real donations." There is NO status check in the
handler, and `CampaignsList` renders Delete on every row unconditionally (`setDeleteTarget(c)`).
An admin can permanently delete an `active` campaign with zero donations — and right now, any of the 12
`under_review` campaigns, which have zero donations. The handler then hard-deletes the campaign plus its
`campaignSeedMessages` and `campaignUpdates` rows.

## F14 LOW (downgraded after measurement) — 13 admin pages carry an INERT `revalidate = 60`
activity, audit-log, blog, blog/topics, donations, governance, monitoring, news-feed, payouts, reports,
simulation, simulation/analytics, simulation/fund-pool, users, verification. These are authenticated,
mutating operator views. Whether the full route cache actually engages is UNVERIFIED (they call `auth()`,
which reads cookies and normally forces dynamic rendering) — the measurement was blocked by the outage.
MEASURED 2026-10-17 against production as a signed-in admin: no `x-nextjs-cache` header on any of them,
and `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`. `auth()` reads cookies and
forces dynamic rendering, so **the directive is inert**. Downgraded from MEDIUM: it is a misleading dead
line, NOT stale operator data. Recorded because the next reader will otherwise assume it works.

## F15 MEDIUM — every admin date boundary is UTC, labelled "Today" / "This Month"
`admin/page.tsx:15-16`, `admin/reports/page.tsx:27-29`, `api/v1/admin/dashboard/route.ts:25-26`,
`lib/monitoring/ai-cost-tracker.ts:136` all build boundaries with `new Date(y, m, d)` = server-local.
No `TZ` is set on Fly, so that is UTC, and there is NO timezone handling anywhere in the admin.
A Nairobi admin's "Today" rolls over at 03:00 local; a US admin's at 19:00 the previous evening, so
US-evening donations land in tomorrow's figure. (Checked and CLEAN: the database is also UTC, so the
SQL `date_trunc('month', ...)` bucketing in /admin/reports does not mix bases with the Node cutoff.)

## F16 MEDIUM — /admin/users shows two contradicting totals on one screen
`admin/users/page.tsx:18` caps the fetch at `.limit(200)` but also computes a true `count(*)` and passes
it as `totalUsers`. `UsersList` uses `totalUsers` for the "All" filter tile (line 211) and
`sorted.length` for the footer (line 387). Above 200 users the tile says the real number and the footer
says "of 200". The correct value is in scope and unused.
Server-side caps with no disclosure also on: verification (500), payouts (500/200), users/donations/
governance/blog/blog-topics/notifications/news-feed/fund-pool (200 each). Whether each footer lies the
same way needs per-component confirmation — only UsersList is verified here.

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

---

# PASS 2 — write actions and mobile (partial)

Write actions were exercised against **throwaway campaigns created and
deleted by this audit** (`subject_name = 'zzpass2'`), by a throwaway admin,
all removed afterwards. No real row was touched.

## F11 CONFIRMED at runtime
All 17 transitions the client offers, driven through the API:
`active -> paused` **400 VALIDATION_ERROR**, `last_donor_zone -> paused`
**400 VALIDATION_ERROR**, the other 15 all 200. Exactly the two the static
diff predicted.

## F13 CONFIRMED, and worse than the docblock implies
`DELETE /api/v1/admin/campaigns/[id]` on campaigns with no donations:

| status | HTTP | rows left |
|---|---|---|
| `draft` | 200 | **0 — hard deleted** |
| `active` | 200 | **0 — hard deleted** |
| `completed` | 200 | **0 — hard deleted** |
| `under_review` | 200 | **0 — hard deleted** |

The docblock's "Only allowed for draft campaigns" guard does not exist in
any form. `CampaignsList` renders Delete on every row. Any of the 12 queued
campaigns — appeals naming real people — is two clicks from permanent
destruction, together with its `campaignUpdates` and `campaignSeedMessages`.

## F17 WITHDRAWN (my error, not a defect)
An initial run reported HTTP 405 on all seven verification actions. The
route exports `GET` and `PATCH`; the probe sent `POST`. The orphaned
`VerificationQueue` uses PATCH correctly. Not a bug.

## N9 CLEAN — the verification review API is complete and correct
Re-run with PATCH:

| from | action | result |
|---|---|---|
| `documents_uploaded` | `approve_t1` | 200 -> `identity_verified` |
| `identity_verified` | `approve_t2` | 200 -> `fully_verified` |
| `documents_uploaded` | `approve_t2` | 200 -> `fully_verified` |
| `submitted_for_review` | `approve_t1` | 200 -> `identity_verified` |
| `documents_uploaded` | `reject` | 200 -> `rejected` |
| `documents_uploaded` | `request_info` | 200 -> `info_requested` |
| `unverified` / `pending` | `approve_t1` | 409 CONFLICT (correctly refused) |

**This sharpens F1 rather than softening it.** The backend that would let a
campaign reach `fully_verified` — and therefore withdraw money — works
completely. The only thing missing is a reachable UI.

## N10 CLEAN — cancel matches its UI predicate exactly
`GovernancePanel.canCancel` allows everything except cancelled/completed/
archived. The API's `CANCELLABLE` is `active, last_donor_zone, paused,
under_review, suspended, draft`. Driven through all seven statuses: the two
the UI hides are the two the API refuses (400); the five it offers all
succeed. (An earlier 400 on `active` was my probe sending a free-text
`reason`; the schema is `z.enum(CANCELLATION_REASONS)`. My error.)

## N11 CLEAN — `under_review -> active` stamps `publishedAt`
Verified on a throwaway row with `published_at` nulled: 200, status
`active`, `publishedAt stamped = true`. docs/78's behaviour holds.

## F18 LOW — two admin tables overflow at 390px
Measured with Chromium at 390x844, signed in as admin. 12 of 24 pages
measured before production wedged a fifth time and the run aborted.

| page | document width | worst offender |
|---|---|---|
| `/admin/audit-log` | 390 (no page scroll) | `table.w-full.text-sm` **+66px** |
| `/admin/governance` | 390 (no page scroll) | `table.w-full.text-sm` **+7px** |

The other 10 measured clean. The page itself does not scroll horizontally
— the tables overflow inside their own container — so this is clipped
content, not a broken layout.

⛔ **12 of 24 pages are still unmeasured**: news-feed, notifications,
payouts, refunds, reports, settings, simulation ×3, users, verification,
campaigns/new.

## Still not done in pass 2
- Per-screen copy and labels (only the sidebar's "Verification Queue"
  mislabel, found in pass 1, is recorded).
- The remaining 12 pages at 390px.
- Write actions beyond campaigns: refund batches, fund-pool
  allocate/disburse, bulk email send, blog publish, user edits.

---

# FIXED 2026-10-17 (deployed and verified in production)

| ID | Fix | Proof |
|---|---|---|
| **F13** | `DELETE` refuses any non-draft with 409; menu shows Delete for drafts only | Live: `draft` 200/destroyed, `active`/`completed`/`under_review` 409 with the row intact. Menu went from `[View Details, Edit, Change Status, Delete]` to `[View Details, Edit, Change Status]`. |
| **F12** | `realDonationCount` renamed `donationCount` | Renamed, NOT filtered. Adding `source='real'` would start hard-deleting seed-funded campaigns, which is a product decision. |
| **F1** | `/admin/verification` renders `VerificationQueue`; `VerificationDashboard` (380 lines) deleted | Live row menu: `View Documents (0)`, `Approve Identity (T1)`, `Approve Full (T2)`, `Request more info`, `Reject`. |
| **F7** | `pending` no longer excluded from either verification query | A campaign in Didit's manual review is now listed. `unverified` stays excluded: nothing has started. |
| **F6** | Dashboard pending-review filters on `status = 'under_review'` alone; section always renders | Live: `/admin` shows the section with all 12 queued campaigns. |
| **F3** | `FundReleaseDashboard` deleted (508 lines, byte-identical to `PayoutsDashboard`) | Imported by nothing; `/admin/fund-releases` already redirected to `/admin/payouts`. |
| **F4** | Every admin currency render goes through `Money` / `centsToDollars` | Was FIVE independent implementations, none using the shared one. |
| **F5** | The two wrong formatters corrected | Live, same campaign: `/admin/payouts` `$1,250.5` -> `$1,250.50`, `$1,200` -> `$1,200.00`. `/admin` already showed `$1,250.50` for that row. |
| **F15** | Period boundaries come from `src/lib/reporting-timezone.ts`; screens name the zone | Live: `/admin` now prints "Periods are counted in UTC." |
| **F2** | `GET /api/v1/admin/verification-documents/[id]` signs and 302s; the queue links to it | Live, with a real PDF in the private bucket: `302` -> signed URL -> `200 application/pdf`, body starts `%PDF-1.4`. Before: list returned `supabase-private://…` and the route answered `405`. |

Notes on each, since the *reason* matters more than the diff:

- **F1 was never a backend problem.** The verification API is complete and
  correct (N9, verified against production before the fix). Only the door
  was missing. `VerificationDashboard` was deleted in the same commit
  rather than left behind, because a dead component that looks live is
  exactly how this happened.
- **F6's section now renders unconditionally.** It was wrapped in
  `length > 0 &&`, so a broken query produced no section rather than
  "0 waiting". An operator cannot notice the absence of something they
  have never seen.
- **"Submitted by" said "Unknown" for the whole queue**, because automated
  drafts have a null `creatorId`. "Unknown" implies the answer was lost;
  the news pipeline is the answer.

22 tests added across the three fixes. The seven F13 cases and the ten F1
reachability cases both fail against the pre-fix code.

## F2 in detail

`verificationDocuments.fileUrl` holds `supabase-private://<bucket>/<key>`.
The admin list endpoint returned it raw and the queue rendered
`<a href={doc.fileUrl}>View</a>`, handing the browser an unknown URL
scheme. Measured against production BEFORE the fix, with a real PDF
uploaded to the private bucket:

```
list endpoint fileUrl : supabase-private://verification/...
openable by a browser : false
GET on the doc route  : 405   (no GET existed)
public bucket read    : 400   (bucket correctly private)
```

So there was no path to the bytes at all. The organiser side had signed
correctly the whole time, and `parseStorageRef` carries a comment saying
it tolerates legacy URLs "so admin review keeps working" - the admin
side never called it.

A redirect rather than a JSON url: the queue renders an ordinary anchor,
so the href stays a stable same-origin link, the URL is minted at click
time, no signed URL is created for a document nobody opens, and none can
go stale in a list. `Cache-Control: no-store, private`, because the
target is a time-limited credential.

`DocumentViewerModal` (411 lines) was deleted: still orphaned after the
F1 fix, because the queue has its own inline viewer. Dead duplicate code
of exactly the kind that produced F1.

**Noted, not fixed:** the list endpoint still returns `fileUrl` in its
payload even though nothing consumes it now. Harmless (an admin-only
response, and the key alone grants no access to a private bucket) but it
is an internal storage path on the wire for no reason.

## Still open from this audit

**Fixed and deployed:** F1, F2, F3, F4, F5, F6, F7, F12, F13, F15.

**Still open:**
- **F8** `/admin/campaigns` has no LIMIT (unbounded as the table grows).
- **F10** `/api/v1/admin/dashboard` is an orphan endpoint duplicating the
  page's own stats.
- **F14** 13 admin pages carry an inert `revalidate = 60` (measured: no
  caching happens, `auth()` forces dynamic rendering). Misleading, not broken.
- **F16** `/admin/users` prints the true `count(*)` in the filter tile and
  the capped fetch length in the footer, so above 200 users one screen
  shows two different totals. Likely the same shape on the other capped
  lists; only UsersList is verified.
- **F18** `/admin/audit-log` (+66px) and `/admin/governance` (+7px) tables
  overflow their container at 390px.

**Pass-2 gaps:** 12 of 24 pages unmeasured at 390px, per-screen copy, and
write actions beyond campaigns (refund batches, fund-pool
allocate/disburse, bulk email, blog publish, user edits).
