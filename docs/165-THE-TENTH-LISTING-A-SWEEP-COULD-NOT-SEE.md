# 165 — The tenth listing a sweep could not see

`docs/145`'s last open line:

> ⛔ Still open: the CATEGORY page and `/completed-campaigns` have the same
> ceiling and are untouched.

Walking it answered that line **no** and found two other things on the same
page.

---

## 1. First, the reported item: REFUTED — and the stale claim was in CLAUDE.md, not in `docs/145`

⚠️ **I had this the wrong way round at first and nearly amended the wrong
file.** `docs/145` §6 is accurate: it says *"Its 'View all' link points at
`/campaigns?category=X`, which now paginates, so the overflow is reachable in
two hops — but the category page itself still shows at most 12 with no
control."* That is exactly right.

The claim that *"the escape hatch leads back to the same wall"* is in
**CLAUDE.md's index row** for `docs/145`, and it is wrong: that wall was
`/campaigns`' own 12-cap, which `docs/145` itself removed. A summary drifted
from the doc it summarises, and the summary is what the next reader reaches
for. CLAUDE.md is corrected in place.

[VERIFIED by execution, 15 `active` campaigns seeded in one category:]

| hop | result |
|---|---|
| `/campaigns/category/medical` | 12 of 15 cards, and **`View all` → `/campaigns?category=medical`** |
| that target, page 1 | 12 cards, **`rel="next"` present** |
| `?page=2` | the remaining **3** (`lab-med-1,2,3`) |

So a crawler already reaches campaign #13. ⛔ **And adding `?page=` to the
category page would cost more than it buys**: that page exports
`revalidate = 300` with `generateStaticParams` for all 23 categories
(`page.tsx:17,23`), and CLAUDE.md's own rule is that *a page that reads
`searchParams` must not export `revalidate`* — so it would turn 23
prerendered, crawler-facing pages dynamic and require deleting the ISR
directive, to reach rows a crawler can already reach.

⚠️ `/completed-campaigns` is a different case and the trap is real but not
yet armed: `page.tsx:187` is `nextCursor = hasMore ? String(PAGE_SIZE) : null`
— the constant cursor `docs/145` fixed on `/campaigns` — and it is correct
**only because page 1 is the only page**. It arms itself the moment anybody
adds pagination there. Recorded, not changed: with **0** completed campaigns
in production there is nothing to paginate, and the page's own "Load more"
works ([VERIFIED] `page.tsx:254` passes `extraParams={{ status: 'completed' }}`,
so the continuation asks the API for the right mode — a suspected defect,
refuted by reading before it cost a browser pass).

## 2. ⛔ FINDING A: a public listing showed the platform's own fund, with a 404 link

`/completed-campaigns:119` filtered `[inArray(campaigns.status,
[...COMPLETED_STATUSES])]` — **no platform-fund exclusion and no
`published_at`**. `api/v1/campaigns/route.ts:48-49`, the Load-More
continuation of that same page, had the identical predicate, and its comment
said it *"must match the page's first query exactly (docs/147)"*: it did.
**They agreed, wrongly.**

### 2.1 Verified three ways, each able to give the other answer

1. **Source**, cited above: neither site composes
   `notInArray(campaigns.id, PLATFORM_FUND_CAMPAIGN_IDS)`.
2. **Execution.** Seeded the fund `completed` with `published_at` NULL, which
   is exactly how production holds it: `?sort=newest` rendered **1** href to
   the fund among 12 cards, while the default sort rendered **0** — so the
   probe can produce both answers.
3. **The link's destination.** The fund's slug answered **404**; a real
   completed campaign answered **200** as the control. Live production agrees:
   `/campaigns/lastdonor-general-fund` is **404** today with
   `/campaigns/harold-jennings` **200**.

### 2.2 ⚠️ Why `docs/147`'s sweep could not see it

`docs/147` enumerated **nine** listing surfaces and built
`public-campaigns.ratchet.test.ts` to hold them. Its rule 1 asks *"who names
the raw ACTIVE status?"* — and a listing that filters on `COMPLETED_STATUSES`
names nothing it searches for. **The gap is the shape of the question, not
the length of the list**, which is why the fix is a second question asked the
same absolute way (rule 4) rather than a tenth allowlist entry.

Same family as `docs/152`: *"an allowlist entry is a hole, and what falls
through it is not always what the exemption was for."* Here it was not even an
entry — the surface was outside the sweep's subject entirely.

### 2.3 Severity, stated honestly

**Latent, behind two deliberate acts.** [VERIFIED from production]
`completed = 0`, so the page lists nothing today. The fund reaches `completed`
only if:

- an admin PATCHes `active -> completed` (allowed by `ALLOWED_TRANSITIONS:21`), **or**
- the raise cap is lifted and it crosses its goal — and it cannot today:
  [VERIFIED] `KES.unverifiedCapMinor = 5_000_000` against the fund's
  `goal_amount = 10_000_000`, so collection stops at **half** the goal and
  `payment-service`'s completion path cannot fire.

⚠️ A falsifier that nearly closed this and did not: `ALLOWED_TRANSITIONS`
admits `completed` only from `active`/`last_donor_zone`, and reaching those
through the admin route stamps `published_at` — so "a completed campaign
always has a public page" looked airtight. It is not, because the fund was
**inserted directly** as `active` with `published_at NULL` by owner decision
(`docs/147`), and [VERIFIED by my own query, not by reading that doc] it still
is: `status=active, currency=KES, goal_amount=10000000, raised_amount=5000,
published_at IS NULL`.

## 3. ⛔ FINDING B: the third surface to silently widen a filter

`page.tsx:104` was `VALID_CATEGORIES.includes(params.category) ? … : null`
over its **own 23-entry copy** of the category list (`:55-60`). Three
consequences in one expression:

1. **Silent widening.** `?category=garbage` served every completed campaign
   with nothing saying the filter was dropped — the thing
   `browse-params.ts`'s own header forbids (`docs/45`).
2. **No alias resolution.** [VERIFIED live on production]
   `/campaigns?category=disaster-relief` returns **1** card and
   `?category=disaster` returns **1**, because `resolveCategory` carries
   `CATEGORY_ALIASES` — the slug the product's own menu *displays*. This page
   had no alias table, so the same URL gave **12**, unfiltered.
3. A copy that drifts from the enum.

Fixed by calling the **existing** `resolveCategory` and rendering the
**existing** `<FilterNotice>` — the same resolver and the same component
`/campaigns` uses, so the two browse surfaces cannot disagree again. ⚠️ The
sort list is deliberately **not** shared: `browse-params` has a fourth option,
`closing_soon`, and a completed campaign has no deadline left to close.

This is docs/45's rule on its **third** surface (`/campaigns` where it was
written, `/blog` by `docs/164`, here), so the guard is a **sweep**
(`docs/110` §9.2), not a third per-surface assertion.

## 4. The fix, and why it touches five call sites

⛔ **`docs/146`'s invariant forced it**: *the predicate that COUNTS a group
must be the predicate that LISTS it*, because a count rendered as a link is a
promise about what is behind the link. Excluding the fund from the listing
alone would have made the `/campaigns` tab read "Completed 1" over an empty
page — **the exact defect `docs/146` was reported for.** So all five sites
move together:

| site | kind |
|---|---|
| `completed-campaigns/page.tsx` | listing |
| `api/v1/campaigns/route.ts` | listing (Load More) |
| `campaigns/(index)/page.tsx` | the tab badge |
| `api/v1/stats/route.ts` | the public stat |
| `transparency/page.tsx` | "Campaigns Funded" |

One `completedCampaignFilter()` in `src/db/public-campaigns.ts`, composing a
new `excludePlatformFunds()` that `listedCampaignFilter()` now also uses.

⛔ **`isNotNull(publishedAt)` is in it deliberately.** A card in a public
listing is a LINK, and `docs/131` made `published_at` the record of approval
the public page requires — so a row without it is a card whose href 404s. The
two predicates answer different questions and both belong to *"would a visitor
be able to open this?"*, which is what a listing **and its count** both mean.

**Blast radius, measured:** production has 0 completed campaigns, so all five
sites return 0/empty either way — **zero today**. Rollback: revert the commit;
no schema or data change.

⚠️ **The SQL was RENDERED, not reasoned about** (`docs/130`):

```
("campaigns"."status" in ($1) and "campaigns"."id" not in ($2)
 and "campaigns"."published_at" is not null)
params: ["completed","d7fcb01f-468a-49e1-848f-bee7377a35ea"]
```

Columns come out **qualified**, so `docs/101`'s unqualified-identifier trap
does not apply — and that is how it is known rather than assumed. Both
`sql`-template interpolations (`count(*) FILTER (WHERE …)`,
`COUNT(CASE WHEN … THEN 1 END)`) render correctly, and
`listedCampaignFilter()` renders **byte-identical** to before, so composing
the new helper moved none of the nine active surfaces.

## 5. ⚠️ A guard disagreed with the change, and the guard had drifted

Pointing those four sites at the shared predicate failed **4 tests** in
`completed-statuses.test.ts` rule 4, whose name is *"the surfaces that count
or list completed **read the constant**"*. It asserted the literal
`COMPLETED_STATUSES` appears in each file's body.

The rule named a **mechanism** where the property is *one definition*. The
change strengthens that property — the sites now read a shared function that
reads the constant once — so the rule drifted relative to the new shape. It
accepts either spelling now, **and a new test closes the hole that loosening
would open**: `completedCampaignFilter` must itself read the constant and must
still carry both predicates. Without that, somebody could hardcode the pair
inside the function and all five sites would still pass.

⚠️ Taking that inventory also found `/transparency` **missing from rule 4's
site list** — a pre-existing gap, visible only because pointing every site at
one predicate meant enumerating them. The list's own comment says it must
shrink when a surface disappears; it must also grow when one is found.

## 6. Gate 4 — and the hole it found in my own sweep

⚠️ **Injection row 2 DID NOT FIRE**, and for two reasons at once. My
`REPORTS` matcher was the alternation
`/FilterNotice|unappliedCategoryNotice|unappliedCategory|unapplied/`:

- `FilterNoticeDisabled` **contains** `FilterNotice` as a substring. That is
  `docs/149` §5.1's trap word for word (`/<LocalAmount/` matching
  `<LocalAmountXX`) — written the day after reading it.
- Bare `unapplied` matched the local **variable declaration**, so a surface
  that computes the list and never renders it would have passed. That is
  `docs/119`'s `_hasCampaigns` shape — the defect class itself satisfying the
  rule meant to catch it.

Each pattern now requires a **render or a call**, with boundaries, and an
anti-vacuity row pins both failures so they cannot return.

| row | injection | expect | result |
|---|---|---|---|
| 0 | baseline | pass | 63 passed |
| 1 | **the real production state** — the page resolves its own category | fire | FIRED |
| 2 | the page stops reporting | fire | FIRED *(after the fix above)* |
| 3 | `/blog` stops reporting | fire | FIRED |
| 4 | the page is excused in the reason list | fire | FIRED |
| 5 | the discovery pattern is broken | fire | FIRED |
| 6 | **the real production state** — the listing builds its own filter | fire | FIRED |
| 7 | the Load More path builds its own | fire | FIRED |
| 8 | the fund exclusion dropped | fire | FIRED |
| 9 | `published_at` dropped | fire | FIRED |
| 10 | the shared predicate hardcodes the pair | fire | FIRED |
| 11 | **CONTROL** — `listedCampaignFilter` loses the exclusion | fire | FIRED |
| 12 | **reword the notice copy** | **pass** | PASSED |
| 13 | **a comment-only edit** | **pass** | PASSED |

Rows 12-13 are `docs/160` §5.2's guard against a rule that pins today's
prose. Each row refuses to be scored unless its anchor matched exactly once
**and** the file's sha changed, and the restore is sha-verified across all six
files any row touches.

⚠️ Row 13's first anchor was wrong — the comment is JSX-wrapped (`{/* … */}`)
and my anchor omitted the braces, so it would have read ANCHOR_MISS. Caught
before the run by checking the line, which is the only reason it did not
read as a hole (`docs/152` §5.2).

## 7. Verified by execution, paired on one build

| | BEFORE | AFTER |
|---|---|---|
| `?sort=newest`, fund card | **LISTED** (1 href) | **gone** |
| `?category=garbage-not-real`, notice | absent | **present** |
| `?category=medical` (**control**) | 7 cards | **7 cards**, unchanged |
| `?category=disaster-relief` (alias) | **12**, unfiltered, silent | **0** + empty state |
| `/campaigns` "Completed N" badge | — | **14** |

The badge is the invariant check, and it is arithmetic rather than eyeballing:
15 completed rows, 1 of them the fund (and the same row is the only one with
`published_at` NULL), so **14** is what the predicate should count — and 14 is
what it reads. Count and listing agree, and both exclude the fund.

## 8. Gate

lint 1 pre-existing warning, typecheck clean, unit **8261 passed / 0 failed /
16 skipped** (297 files, +13 tests and +1 file), integration **329 passed / 0
failed** (35 files, unchanged).

## 9. What was NOT checked

- **No production verification of the fix's effect**, because there is nothing
  to see: production has 0 completed campaigns, so all five sites answered
  0/empty before and after. Everything in §7 is a lab measurement against
  production's exact row shape. The only production observations are the
  negative ones (`completed = 0`, the fund's row, the fund page's 404) and the
  `/campaigns` filter-honesty behaviour that the fix copies.
- **`/completed-campaigns` pagination** — the constant-cursor trap at `:187`
  is recorded and unfixed (§1).
- **The category page's `?page=`** — refuted, and the ISR cost is the reason
  it would be wrong to add anyway.
- **`filters.tsx`'s own option list** and `api-helpers.ts:151`'s
  `VALID_CATEGORY_SET` are two further copies of the category vocabulary. The
  first only decides which options are *offered* (offering a valid subset is
  not a defect) and the second is an API validator; neither silently widens a
  page a visitor browses. Recorded, not swept.
- **`/api/v1/search`** resolves a category and reports nothing. [VERIFIED] it
  has no consumer anywhere in `src/` outside its own tests, so there is no
  surface on which a notice could appear; it is named with that reason and
  will need the blog API's treatment if anything starts calling it.
- **No screen reader**, and the three pages were measured at 1280px, not at
  390px.

---

## 10. Deployed as v171 — and the rollout split again, with my own check blind to it

✅ **Live as v171, 2026-10-31.** CI run `41205664594` on `6162f48` was green on
all 8 jobs, 0 flaky. Verified against the pre-deploy baseline:

| check | before | after |
|---|---|---|
| unapplied notice, 16 loads | **0 / 10** | **16 / 16** |
| a RECOGNISED category (**control**) | — | **0** notices — the fix does not fire indiscriminately |
| `/api/v1/stats` `campaignsCompleted` | — | **0** |
| `/transparency` "Campaigns Funded" | — | **0** |
| `/completed-campaigns` cards | — | **0** |
| `/campaigns` "Completed N" tab | — | **correctly absent** |
| `/`, `/campaigns`, `/completed-campaigns`, `/transparency`, `/api/v1/stats`, `/api/v1/live` | — | all **200** |
| sitemap campaign URLs, two reads | 8 / 8 | **8 / 8** |

The four count-or-list surfaces all read 0 and agree, so `docs/146`'s
invariant holds live. ⚠️ The tab's absence is **correct**, not a failed
measurement: `page.tsx:444` gates the whole strip on `completedCount > 0`, and
the comment above it records that deliberately.

### 10.1 ⛔ Another partial rollout, and THE CHUNK-HASH CHECK WAS BLIND TO IT

Fly **replaced** the app machine again (`Checking health of machine
080776daee2d48`, a different id from the pre-deploy `84705df2700598`) and left
the old one `started`. Two `app` machines, **v171** and **v170**, both 1/1
passing, release reading `complete` — `docs/161` §7.2 for the second time in
one day.

⚠️ **CLAUDE.md calls the chunk-hash sweep *"the cheap, decisive check"*, and
here it read 20/20 IDENTICAL while the split was real.** The reason is
structural and worth knowing: this change touches only server components
(`FilterNotice` has no `'use client'`), so it alters **no client code** and the
page's client chunk hash is legitimately unchanged between the two versions.

**So the chunk-hash check is decisive only for a change that affects client
code.** For a server-only change the discriminator has to be the BEHAVIOUR:
the new notice was present on **12 of 16** loads and absent on **4** — which
is what proved the split, and what read **16/16** after the stale machine was
destroyed.

### 10.2 ⚠️ `flyctl status` ALSO returns no machine table sometimes

CLAUDE.md records `flyctl machine list` answering *"No machines are available
on this app"* while a machine runs, and prescribes: *"Confirm with `flyctl
status`, whose PROCESS column names every machine."* **`flyctl status` does it
too.** Observed here: one call returned the App block with `Image │ -` and
**no Machines section at all**; a second call three seconds later returned the
table correctly.

⛔ **And I acted on that empty read.** The Gate-8 requirement is to confirm
which id carries which version *immediately before* the destroy. My
confirming read printed nothing, the two commands were sequential rather than
`&&`-chained, and the destroy ran on the strength of a read from two calls
earlier. The id/version pairing had been stable across two prior reads so the
outcome was right, but the confirmation did not happen, which is the whole
point of the step. **Treat an empty machine table as a FAILED READ, never as
"no machines", and chain the destroy behind a read that actually printed.**

### 10.3 ✅ An E2E count discrepancy, reconciled rather than waved through

CI reported **82 passed + 12 skipped per leg** where CLAUDE.md quotes
`166 pass / 24 skips (83+83)`. Two fewer per leg is `docs/89`'s exact failure
mode — *"80 tests silently not running while the summary still read 5898
passed"* — so it was counted rather than assumed:

```
npx playwright test --list            Total: 188 tests in 23 files
  --project="Desktop Chrome"          Total:  94 tests
  --project="Mobile Chrome"           Total:  94 tests
```

**94 collected = 82 passed + 12 skipped**, per leg, and `164 + 24 = 188`.
Every collected test is accounted for, so nothing is silently skipped; the
documented figure is simply stale. CLAUDE.md corrected.
