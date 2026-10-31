# 146 — A count that disagreed with its own link

**Date:** 2026-10-29
**Status:** Fixed, tested, deployed.
**Reported from production** by the owner, from a screenshot of `/campaigns`.

---

## 1. The report

`/campaigns` rendered a two-tab strip:

```
Reviewed Fundraisers Raising Money Right Now
14 active campaigns · Each one reviewed before going live

   Active 14  |  Completed 1
```

Clicking **Completed 1** showed nothing.

[VERIFIED live, three ways, before any change]

1. `/campaigns` HTML carried the tab with the figure `1`.
2. `/completed-campaigns` served **0** campaign links and its empty state
   (*"No completed campaigns yet. Check back soon."*).
3. The public API agreed with the badge and contradicted itself in the same
   payload:

```json
{"ok":true,"data":{"totalRaised":10000,"totalDonors":1,
 "campaignsCompleted":1,"campaignsActive":14,"peopleSupported":0}}
```

**One completed campaign that supported nobody.** Both figures are computed
nine lines apart in `src/app/api/v1/stats/route.ts`, one from
`status IN ('completed','archived')` and one from `status = 'completed'`.

---

## 2. The cause

`archived` was treated as a synonym for `completed` in everything that
**counted**, while everything that **listed** treated the two as distinct.

[VERIFIED from production, 2026-10-29]

| status | rows | with `published_at` |
|---|---|---|
| `active` | 14 | 14 |
| `archived` | **1** | 1 |
| `under_review` | 9 | 0 |

and over the whole table: **24 campaigns, 0 with `completed_at` set, 0 with
`status = 'completed'`.** The single archived row is the PayHero test campaign
(`docs/92`): `zz-payments-test-mpesa-gateway`, **KES 100.00 raised against a
KES 1,000.00 goal** (10,000 of 100,000 minor units — `docs/92`: every amount
column is in its row's own minor units), 2 donors, `completed_at` **NULL**.

So the badge was counting a test campaign at a tenth of its goal, calling it a
success, and linking to a page that correctly declined to list it.

### 2.1 `archived` is not a kind of success, and that is structural

Two independent facts make `archived` unusable as a completeness signal, and
`completed-statuses.test.ts` derives the reason from both rather than restating
it:

- `ALLOWED_TRANSITIONS` in `admin/campaigns/[campaignId]/route.ts` permits
  **`draft -> archived`**. A campaign that never launched can reach it.
- **Both delete routes implement deletion AS archiving** —
  `user-campaigns/[id]/route.ts:254` and `campaigns/[slug]/route.ts:221` each
  write `status: 'archived'` instead of removing the row.

So the set `('completed','archived')` contains deleted drafts.

### 2.2 The alternative that was rejected

A campaign *can* legitimately go `completed -> archived`, so the right answer
for such a row is not obvious, and there IS a column that records it:
`campaigns.completed_at` has exactly **two** writers, both meaning genuine
completion — `payment-service.ts:268` (a donation crosses the goal) and
`admin/campaigns/[campaignId]/route.ts:146` (an admin moves a campaign to
`completed`).

⚠️ **An earlier draft of this fix asserted in a code comment that "no column
records *was ever completed*". That was wrong and is corrected here.** The grep
that produced it matched `completedAt: new Date()` in
`admin/campaigns/[campaignId]/cancel/route.ts:337`, which is
**`refundBatches.completedAt`** — a different table — and read that as evidence
the column was unreliable.

Counting `completed_at IS NOT NULL` instead was therefore a real option. It was
rejected because holding the invariant in §3 means **both ends** must move, and
the listing end is a public page: it would make `/completed-campaigns` start
listing closed campaigns, which is a product decision about what that page is
for, not a fix for a count that disagreed with its own link. [VERIFIED] it
would also change nothing in production today — 0 rows have `completed_at` set.
Counting only `completed` under-claims rather than over-claiming a success on
behalf of a real person.

---

## 3. The invariant

> **The predicate that COUNTS a group must be the predicate that LISTS it.**

A count rendered as a link is a promise about what is behind the link. There is
now one definition, `COMPLETED_STATUSES` in `src/lib/campaign-visibility.ts`,
and every surface that counts or lists completed campaigns reads it.

---

## 4. The sweep: six sites, not one

The reported bug was two of these. The other four were found by asking the
question *"what else decides for itself what completed means?"*

| # | Site | Was | Now |
|---|---|---|---|
| 1 | `/campaigns` tab badge | `count(*) FILTER (WHERE status IN ('completed','archived'))` | `COMPLETED_STATUSES` |
| 2 | `/completed-campaigns` listing | `eq(status,'completed')` (the other end) | `COMPLETED_STATUSES` |
| 3 | `/api/v1/stats` `campaignsCompleted` — **public** | `inArray(status,['completed','archived'])`, beside a sibling using `'completed'` | `COMPLETED_STATUSES` |
| 4 | `/` homepage `completed` tile | `COUNT(*) FILTER (… IN ('completed','archived'))`, beside `supported` using `'completed'` | **query deleted** — nothing read it (§4.0b) |
| 5 | `/transparency` **"Campaigns Funded"** | `COUNT(CASE WHEN … IN ('completed','archived') …)` | `COMPLETED_STATUSES` |
| 6 | `browse-params.ts` local `COMPLETED_STATUSES` | `['completed','archived']` — told a visitor `?status=archived` is *served by* `/completed-campaigns` | reads the shared constant |

Two of the six are worse than the reported one:

- **Site 3 is a public API.** Anything consuming it was handed
  `campaignsCompleted: 1` for a platform that has completed nothing.
- **Site 5 is labelled "Campaigns Funded"** on the page whose entire job is
  trust. It called a 10%-funded test campaign *funded*.

### 4.0a A seventh site: the page's own "Load more"

Found after the first six, by asking where `/completed-campaigns` continues its
list. `CampaignGrid` is handed `extraParams={{ status: 'completed' }}`, and
`GET /api/v1/campaigns` answered that with a hardcoded
`eq(campaigns.status, 'completed')` — a **third** definition of completed, on
the continuation path of the very page whose disagreement with the badge
started this.

It agreed with the other two only because the set happens to hold exactly one
value. Adding a status to `COMPLETED_STATUSES` would have made **page 1 and
"Load more" list different things** — the reported defect one level down, and
invisible until a visitor pressed the button. `status=completed` is a MODE, not
a status value, so the mode's predicate is now the shared constant and the
listing API is the fifth entry in rule 4's site list. Injection 9 (restoring
the hardcoded `eq`) fails that row.

⚠️ This landed one commit after the other six and is a **latent** fix: it
changes no query result today, so it was left to ride the next deploy rather
than taking a six-minute release of its own.

### 4.0b And site 4 turned out to feed nothing at all

Found while verifying the deploy, by checking the homepage figure live and
discovering there was no figure to check: `ImpactCounter` renders
**"Campaigns Funded"** from `campaignsCompleted`, and [VERIFIED] `docs/51`
removed that component from the homepage — *"it advertised the absence it was
meant to dispel"* — leaving the query behind.

Asking what the homepage actually reads:

```
$ grep -o "data\.[a-zA-Z]*" src/app/(home)/page.tsx | sort | uniq -c
      2 data.activeCampaigns
      1 data.categoryCounts
      2 data.latestPosts
```

`getCachedHomepageData` has exactly **one** caller, so `featuredCampaign`,
`totalDonors`, `campaignsCompleted` and `peopleSupported` were being computed,
cached and discarded — **three of the six queries** on the busiest public
route, one of them a `COUNT(DISTINCT donor_email)` scan of `donations`. The
file's own comment records that this fan-out was already a problem
(`docs/87` amendment 5, *"six concurrent queries ... against a pool of five"*),
so half of what it was split into two batches to survive was dead work.

This is the `docs/119` `_hasCampaigns` shape — a query whose result is thrown
away — three times over. The three dead queries are deleted and the remaining
three run as **one** batch, which is the `docs/87` cap exactly and one round
trip instead of two. The figures are derived from source, not measured at the
database.

⚠️ **Site 4 is therefore GONE from rule 4's list, not exempted.** A site list
must shrink when a surface disappears: leaving `app/(home)/page.tsx` in it
would have failed the build for the right reason while sending the next reader
to look for a tally that no longer exists.

Proven behaviour-preserving by a **paired** render against one fixture with the
Next cache cleared both times: **6 campaign cards, 1 category card, innerText
3,813 characters — identical before and after**, no page errors.

⚠️ And that measurement was **void twice** before it was valid, each time for a
different reason, and both read as a broken homepage:

1. The integration suite had **truncated the fixture database** between the
   seed and the probe (every file calls `clearDatabase()` in `beforeEach`), so
   the page correctly rendered nothing.
2. After re-seeding, `getHomepageData` is wrapped in `unstable_cache` with
   `revalidate: 300`, which was still **serving the empty result** — `docs/144`
   §5.2 word for word, met again. Only `rm -rf .next/cache` and a restart
   produced a real reading.

Site 6 is a different shape: it is not a count, it is a claim about where a
filter value is served. `/campaigns?status=archived` reported that `archived`
was handled by `/completed-campaigns`, which has never listed it. It now falls
through to `docs/45`'s "not applied" notice, which is true.

### 4.1 Three uses of the same two words that are NOT defects

Deliberately unchanged, and pinned by a control test so this rule cannot grow
into *"archived is banned everywhere"*:

- `db/schema.ts`'s `campaign_status` pgEnum lists every status.
- `notifications.ts`'s `NOTIFY_STATUSES` — a donor **should** be told when a
  campaign completes **or** closes. That is a different question.
- the admin `canCancel` predicate and `ALLOWED_TRANSITIONS`, where
  `completed: ['archived']` means *"FROM completed you may go TO archived"* —
  the opposite of *"completed includes archived"*.
- `PUBLICLY_VIEWABLE_STATUSES` still contains `archived` (`docs/118` §9, owner
  decision): a closed campaign keeps its page so a donor following an old link
  is told what happened.

---

## 5. What a visitor sees now

With `completedCount` at 0 the **whole tab strip disappears**, because
`campaigns/(index)/page.tsx:415` gates it on `completedCount > 0` — a
`docs/71` decision: *"the tab strip only earns its 66px when there is a second
tab worth taking"*, and with no completed campaigns it rendered a tab linking
to an empty page beside a count already stated one line above it.

So the fix removes the broken link **and** 66px of chrome above the first card.

### 5.1 Measured in a browser, paired

A production-shaped local fixture (14 `active` published + 1 `archived` that
completed nothing + 0 `completed`), each state measured with the same probe:

| | `/campaigns` strip | `/transparency` "Campaigns Funded" | `/completed-campaigns` |
|---|---|---|---|
| **defect restored** | `Active14 \| Completed1` | **1** | 1 card |
| **fixed** | absent | **0** | 0 cards |

⚠️ Note what the control state shows: with the defect restored *in the shared
constant*, `/completed-campaigns` lists **1** — the two ends agree, wrongly but
consistently. That is the structural property the fix buys. The production bug
required the two predicates to be **written separately**; one constant makes
them unable to disagree, so the only reproduction of the original symptom is to
hardcode a second definition, which is what §6's rules forbid.

### 5.2 ⚠️ The probe was broken and reported the same thing as a fixed page

The first run of that probe matched `/Completed\s+\d+/`. The rendered text is
`Active14\nCompleted1` — **no space** — so the regex never matched, and the
probe reported *"no Completed tab"* for the fixed state **and** for the state
with the defect restored.

Only the paired control exposed it: a measurement that gives the same answer
for both arms is not a result. Same class as `docs/135` §5 and `docs/134`'s
`innerText` blindness, met again in a new costume.

---

## 6. The checks, and the two that were wrong

`src/lib/completed-statuses.test.ts` (15 tests) and
`src/app/completed-campaigns/completed-count.integration.test.ts` (6 tests,
real Postgres).

The integration tests assert the **property**, not that the two ends agree: a
campaign inserted `archived` having completed nothing is **not counted** by the
badge query and **not listed** by the page query, while a genuinely `completed`
one is both. Asserting "the two ends agree" is a check that cannot fail once
both read one constant (`docs/119`'s note on exactly that trap).

The source rules took three attempts, and in each case **the rule was wrong,
not the code**:

- **v1** banned the token pair anywhere, and fired on the pgEnum,
  `NOTIFY_STATUSES` and the admin maps (§4.1).
- **v2** narrowed to a projection keyed `completed`, and still fired on
  `completed: ['archived']` in `ALLOWED_TRANSITIONS`.
- **v3** adds `IS_QUERY_LINE` (`campaigns.status`, `count(`, `sql`` `), so a
  transition map is out of scope by construction.

Comments are stripped before every sweep: the comments explaining this fix
necessarily quote the forbidden pair, so a raw-source match reports the fix as
the defect (`docs/116` §4).

### 6.1 Two injections did not fire, and both found a hole in the rules

- **Injection 4** restored
  `.where(inArray(campaigns.status, ['completed','archived']))` in the public
  stats route and **passed every rule** — that line carries no `completed:`
  key, because the projection is on a different line and a line-based
  projection rule cannot see a multi-line statement. Added **rule 2b**: a
  predicate mentioning `campaigns.status` may not hardcode the pair. It is
  precise rather than broad, because none of §4.1's legitimate uses mentions
  `campaigns.status` — they are not queries.
- **Injection 7** removed a surface's *use* of the constant while leaving the
  `import` in place, and rule 4's `toContain('COMPLETED_STATUSES')` was
  satisfied by the import line. Import lines are stripped first.

### 6.2 Injection results

8 injections, each restoring a piece of the real defect, sha256-verified clean
restore after every one (`docs/120` §11.1):

```
BASELINE unit: 0 failing / 44 collected | integ: 0 failing / 6 collected
PASS  1. THE ROOT CAUSE: archived counts as completed again: 3 failed, matched 2/2
PASS  2. the constant is emptied (anti-vacuity): 2 failed, matched 1/1
PASS  3. the badge hardcodes the old pair again: 3 failed, matched 1/1
PASS  4. the PUBLIC stats API hardcodes the old pair again: 2 failed, matched 1/1
PASS  5. /transparency "Campaigns Funded" counts archived again: 2 failed, matched 1/1
PASS  6. browse-params claims archived is served by /completed-campaigns: 1 failed, matched 1/1
PASS  7. a surface stops reading the constant: 1 failed, matched 1/1
PASS  8. the reason-derivation is defeated: 0 failed (expected 0 — a harmless edit must not fire)
FINAL CLEAN: unit 0 failing, integ 0 failing
```

Injection 8 is the anti-over-firing control: an unrelated export added to the
same file must **not** fail anything.

---

## 7. A stale test, and a sentence of copy

`browse-params.test.ts` asserted `completedRequested === true` for
`status=archived` — it encoded the defect, and it passed throughout. It now
asserts the honest outcome: `archived` is reported as **not applied**, with the
`unapplied` entry `{ key: 'status', value: 'archived' }`.

And `/completed-campaigns`' own FAQ said a completed campaign is one that
*"reached its goal **or was archived after completion**"*. That clause described
a set the page's query excludes, and `archived` is also what a **deleted**
campaign holds — so the sentence promised outcomes for campaigns that completed
nothing. Removed; the copy now describes exactly what the list contains.

---

## 8. Gate results

```
npm run lint          1 warning, pre-existing (unused `table` in review-gate.test.ts)
npm run typecheck     clean
npm run test:unit     8010 passed | 16 skipped   (276 files passed | 3 skipped)
npm run test:integration  315 passed             (33 files)
```

Before this change: 7995 passed / 275 files, and 309 passed / 32 files. The
deltas are exactly the two new files (15 unit + 6 integration).

---

## 9. The deploy, and what production says now

⛔ **The first release attempt FAILED, twice, and not because of this change.**
The image built and pushed
(`deployment-01M6384RGQT688PQR2WEBHEV0S`), then:

```
Running lastdonor release_command: /usr/local/bin/release-migrate
✖ Failed: error running release_command machine: error creating a
  release_command machine: failed to launch VM: no capacity available in arn
Error: release command failed - aborting deployment
```

`fly.toml:227` sets `release_command = release-migrate` (`docs/116` §8.4: **a
deploy does run migrations**), which needs a fresh ephemeral machine, and
Stockholm had no capacity. [VERIFIED after both failures] production was still
**v128**, one machine, health check passing — **an aborted release changes
nothing**, which is what makes retrying safe. `fly releases` records them as
v129 and v130 `failed`.

⚠️ Retrying does **not** need a rebuild: the image is already in the registry,
so `fly deploy --image <that tag>` skips the six-minute build and goes straight
to the release. That also keeps the database URL off the command line, since
`--prerender`'s build secret is only needed while building. It succeeded on the
first retry: **v131**, machine version 131, 1/1 checks passing.

### 9.1 Live verification (v131)

| | baseline (v128) | now (v131) |
|---|---|---|
| `/api/v1/stats` `campaignsCompleted` | **1** | **0** |
| `/api/v1/stats` `campaignsActive` (control) | 14 | 14 |
| `/campaigns` `nav[aria-label="Campaign status"]` | present | **absent** |
| `/campaigns` campaign cards (control) | 12 | 12 |
| `/transparency` "Campaigns Funded" | **1** | **0** |
| `/transparency` "Campaigns Live Now" (control) | 14 | 14 |
| `/completed-campaigns` cards (control) | 0 | 0 |
| sitemap campaign URLs / total | 14 / 56 | 14 / 56 |

The sitemap was read **twice** (`docs/119`: stale-while-revalidate means one
request reads as a failure) — `x-nextjs-cache: HIT` both times, 14 campaign
URLs, so the one build-time `EMAXCONNSESSION` read failure did not land on
either sitemap. ⚠️ **Which route it did land on is [UNKNOWN]**: the build log
prints the failure without naming the route, and `/transparency` (a 5-minute
baked route) answers with real figures, so if it was baked empty it has already
healed.

⚠️ **One of my verification controls FAILED and the control was the bug.** It
reported `/campaigns` serving **0** campaign cards. The subject was fine — 12
cards, `initialHasMore: true`, `initialCursor: "12"` in the RSC payload — and
the probe was `grep -c 'href="/campaigns/'` nested inside a `"$( … )"`, where
the pattern's own `"` closed the outer string. **Third broken probe of this
change**, after §5.2 and §4.0b's two void renders.

### 9.2 Bonus: `docs/145` reached production for the first time

That commit was pushed and never deployed, so this image carries it. Verified
live: page 1 holds **12** campaigns and `?page=2` holds **2**, with **0**
overlap; `tuan-nguyen` — the campaign `docs/143` §5 found orphaned — is on page
2 with a crawlable link; `rel="next"` on page 1 and `rel="prev"` on page 2;
canonicals self-reference (`/campaigns` and `/campaigns?page=2`); and
`?page=99` answers **200** reading *"There is no page 99. This listing has 2
pages."*

⛔ **A finding against my own `docs/145` work, reported not fixed:**
`/campaigns?page=99` is served **`index, follow`** with a self-referencing
canonical of `?page=99`, so an out-of-range page is an indexable empty page.
The right answer is `noindex, follow` when the requested page is beyond the
end — but `generateMetadata` runs no query and cannot know the total without
adding one, which is the **fourth concurrent query** `docs/145` §3 declined on
`docs/87` grounds. `page=` appears **0** times in the sitemap and nothing links
such a URL, so the exposure is a crawler probing parameters; Google would most
likely classify it a soft 404 itself. Recorded rather than fixed, because the
fix is a concurrency decision on the busiest public route.

### 9.1a The second deploy (v134), and the capacity failure is not rare

§4.0b and §4.0a shipped in a second release, which hit the **same** failure:
image built and pushed (`deployment-01M639V0Y0EPAY2NXTWXEBMNG7`), release
aborted on `no capacity available in arn`, then once more on the first retry,
and succeeded on the second — **v132 and v133 `failed`, v134 complete**, machine
version 134, 1/1 checks. So across two deploys the release-command machine
failed to launch **four** times out of six attempts. Each failure costs about a
minute and leaves production untouched.

⚠️ `fly machine list` shows **one** machine throughout, so no orphaned
release-command machine is holding the capacity — there is nothing of ours to
clean up, and retrying is the only lever on this side. Changing the region is a
topology decision and was not taken.

Live at v134: `/campaigns` 12 cards and no status nav; the homepage **6
campaign cards and 8 category cards**, zero console errors — the dead-query
removal is invisible, as §4.0b's paired local render predicted; all six
assertions in §9.1 still pass.

### 9.1b The build's `EMAXCONNSESSION` reads, and `/donate`

This build logged **two** `[build] database read failed … (EMAXCONNSESSION)
max clients reached in session mode` lines (the first logged one). The log does
not name the route, so **which routes they hit is [UNKNOWN]** — but all seven
baked routes (`docs/119` §2) were read twice afterwards and every one is
consistent with the database: sitemap 14 campaign URLs (`HIT`, `HIT`), blog
sitemap 0 (correct — `docs/123`, zero posts ever), `/transparency` real
figures, `/last-donor-wall` and `/cancelled-campaigns` empty (0 completed, 0
cancelled rows), `/campaigns/category/medical` 3 links. The five-minute routes
answered `STALE` then `HIT`, which is `docs/119`'s healing behaviour observed
again.

⛔ **And a pre-existing finding `/donate` surfaced, reported not fixed.** That
page serves *"not accepting donations"* and renders no form. That reads exactly
like the empty-prerender symptom CLAUDE.md warns about, and it is **not**:
[VERIFIED from production] `GENERAL_FUND_CAMPAIGN_ID`
(`d7fcb01f-468a-49e1-848f-bee7377a35ea`) matches **0 rows** — the general fund
campaign has never existed — so `generalFundIsDonatable()` is correctly
returning false and the page is doing precisely what `docs/42` designed it to
do rather than showing a form that would 500.

⚠️ I had **no pre-deploy baseline for `/donate`**, which is the `docs/119`
lesson I had just quoted; the question was settled from the database instead,
which is the stronger method and the one I should have reached for first.
Creating that row is a production write on a money path, so it is an owner
decision (Gate 8), not an audit's side effect.

### 9.3 And `docs/144` verified live, with a control

All **8** promoted categories list at least one campaign — community 1,
disaster 1, emergency 2, essential-needs 1, medical 3, memorial 1, military 3,
veterans 2, which is 14, every live campaign — while the two categories it
de-promoted, `family` and `education`, list **0**. `military` (tied for the most
campaigns on the platform) and `essential-needs` are linked from the homepage
for the first time.

---

## 10. What was NOT checked

- **No E2E run.** The E2E fixture seeds no `archived` campaign, so the suite
  cannot see this class; the browser verification in §5.1 was done by hand
  against a purpose-built fixture instead.
- **`completed_at` has no writer ratchet.** §2.2's rejected alternative rests
  on that column having exactly two writers, and nothing fails the build if a
  third appears. `published_at` has such a sweep
  (`campaign-publication-writers.ratchet.test.ts`); this one was judged not to
  earn its keep, and the dependency is recorded here instead.
- **Other count/list pairs were not swept.** This fix is about *completed*. The
  same class could exist for any figure rendered as a link — the active count,
  the category counts (`docs/144` chose the safe direction there deliberately),
  the admin tiles. Not examined.
- **Nothing retracts the archived row.** It is the PayHero test campaign and
  stays archived; it simply stops being counted as a success.
- ✅ **The out-of-range page's `robots` meta is FIXED by `docs/166`** (§9.2),
  and its stated blocker was answerable: the total is now a third
  `count(*) FILTER` over the scan the tab counts already run, so
  `generateMetadata` costs no additional query and the page body costs one
  fewer. ⚠️ §9.2 also under-stated the defect — with 8 campaigns against a
  page size of 12 there is ONE page, so every page above 1 was indexable and
  empty, not only `?page=99`. The `EMAXCONNSESSION` route is still
  unidentified (§9.1).
- **The query reduction in §4.0b is derived from source, not measured at the
  database.** `pg_stat_statements` is not enabled on the throwaway Postgres and
  the claim is syntactic (six query builders became three).
- **`campaigns.completed_at` has no writer ratchet**, as §2.2 depends on it
  having two. Recorded, not built.
