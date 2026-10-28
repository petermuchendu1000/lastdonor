# 136 — The simulation journey, and a "not deployed" that was

**Date:** 2026-10-28
**Status:** **NO CODE CHANGE.** One safety property verified four ways, two
documentation claims corrected, one suspicion of mine refuted.
**Sub-journey:** admin journey, part 8 of 10 (SIMULATION)

---

## 1. Why this area was walked next

It is the only remaining admin surface that writes **money-shaped** data. Seed
donations blend into `campaigns.raised_amount` (`docs/33`), `docs/41` gave the
engine a fail-closed `SEED_DONATIONS_OPT_IN` sentinel, and `docs/116` §8
recorded that `simulation.max_concurrent` had been sitting at its default of
10 purely because no row existed — an *accidental* guard — and is now **100**.
That reads like live risk, so it was checked before the quieter areas.

It is not live risk. The whole surface is inert, and §2 is the evidence.

---

## 2. The simulation engine is inert in production — four independent checks

The question is not "is the switch off" but "has anything been written". Both
are answered:

| # | Check | Result |
|---|---|---|
| 1 | Is `simulate-donations` scheduled? | **No.** `CRON_JOBS` holds 12 jobs and it is absent, with `cron-schedule.ts:56` stating it is "deliberately ABSENT" |
| 2 | Is the opt-in sentinel set? | **No.** Not in `fly secrets list`, not in `fly.toml` |
| 3 | Is `simulation.enabled` on? | **No.** No row in `site_settings`, and the default is `false` (`settings.ts:129`) |
| 4 | **What actually exists?** | **`donations WHERE source='seed'` = 0** |

Check 4 is the one that matters, and it is the one `docs/33` would want: not a
switch position but the consequence. Extending it to what the public sees, all
**14** active campaigns report:

```
raised_amount = 0   donor_count = 0   seed_donation_count = 0   real rows = 0
```

So no campaign page displays a fabricated total, because no fabricated
donation has ever been written. `docs/33`'s disclosure question is dormant
rather than resolved — it would become live the moment checks 1-3 are
reversed.

⚠️ **A correction I nearly carried in.** `docs/130` records "a campaign showing
$2,500 raised with ZERO real donations". That was its **local E2E fixture**,
not production, and it would have been easy to repeat here as a production
fact. Measured, production is all zeros.

### 2.1 And `max_concurrent = 100` is bounded by `docs/116` §4

[VERIFIED] the setting is read by `news-feed/[id]/create-campaign/route.ts:19`,
`news-pipeline.ts` via `volume-guards.ts`, and `publish-campaigns/route.ts:108`
— it is a **campaign-creation volume guard**, not a donation one. Since
`docs/116` §4 made every pipeline insert `under_review`, raising it widens the
**review queue**, not what goes public. Production holds 9 `under_review`
against 14 `active`, which is consistent with that.

That is not "the guard is gone, therefore danger" as `docs/116` §8's wording
might suggest on a fast read; it is "the guard is gone, and the thing it
accidentally guarded is now guarded on purpose somewhere better".

---

## 3. ⛔ `docs/106` said "not deployed". It is deployed.

`screen-documents` — the AI pre-screening of identity documents — is in
`CRON_JOBS` at `*/5 * * * *`, and [VERIFIED live against v118]:

```
/api/v1/cron/screen-documents -> 401   (served, auth required)
/api/v1/cron/blog-refresh     -> 401   (served)
/api/v1/cron/not-a-real-job   -> 404   (the control)
```

The 404 control is what makes the 401 mean something (`docs/104` §5.1a).

What was true, and is no longer, is the status line: **built, not deployed**.
The code is in the image and on a five-minute schedule. What it has never done
is *work*: `verification_documents` holds **0 rows**, so every run takes the
idle path and returns.

⛔ The distinction is not pedantry on a system that reads people's identity
documents. "Not deployed" reads as "cannot run". The truth is that it will
screen the first document anybody uploads, under the auto-approve decision
`docs/106` records. `docs/106`'s header is amended.

This is the `docs/77` shape — a status line that stayed wrong after the world
moved — and it is why `docs/77`'s row was corrected two days late.

### 3.1 `docs/108` carried the same wrong word, and the probe that found it does not generalise

Checking whether `docs/108` (trust networks) had drifted the same way: it had.
Its header said **"BUILT, NOT DEPLOYED"**. [VERIFIED] all seven
institution/vouch routes appear in the build's own route table, so they ship
in every image. What is true is that the feature is **unused**: [VERIFIED in
production] `trusted_institutions` 0 rows, `institution_vouches` 0 rows, 0
campaigns with `verification_source='institution_vouch'`. Header amended.

⛔ **And the method that settled `screen-documents` does NOT work here.** The
`docs/104` §5.1a probe depends on a fabricated path answering 404, and that
holds for cron routes. It does not hold for the admin surface, because the
middleware is default-deny:

```
/api/v1/admin/institutions        -> 401
/api/v1/admin/fabricated-not-real -> 401   ← the control, same answer
/admin/institutions               -> 307
/admin/fabricated-not-real        -> 307   ← the control, same answer
```

Both controls return the same status as the real route, so the probe
distinguishes nothing. Had I skipped the control I would have read "401 means
served" and reported a verified fact that the evidence does not support. The
build route table is what settles it for admin routes.

⚠️ The general form, worth carrying: **"not deployed" and "not used" are
different claims**, and a doc that says the first when it means the second
reads as "this cannot run" about a feature that can.

---

## 4. ⚠️ My own suspicion, refuted twice

`screen-documents` has written **neither** `cron.screen_documents` nor
`cron.screen_documents_failed`, ever, while 8 of the 12 scheduled jobs have
`cron.*` rows. I took that for the `docs/123` defect — a job returning
`ok: true` and recording nothing — and it is not:

1. `route.ts:56-57` carries the reasoning explicitly: *"No audit row for an
   idle run. This fires every five minutes; a row each time would bury the
   rows that mean something (docs/66)."* A decision, not an omission.
2. `scheduled-skips-are-recorded.test.ts` — the rule `docs/123` wrote, which
   **derives its job list from `CRON_JOBS`** — passes **7/7** against this
   code. It already distinguishes a configuration skip (must leave a row) from
   quiet (need not), the same way it deliberately exempts the lock skip.

So the silence is correct. Recorded because the suspicion was reasonable and
the refutation is the useful artefact.

### 4.1 The limitation that remains, stated honestly

⚠️ **A job that writes nothing when idle is indistinguishable, from the
database, from a job that never ran.** For `screen-documents` the audit trail
cannot tell those apart; the 401 probe proves the route is *served*, not that
the Worker *calls* it. `CLAUDE.md` states that every job in `CRON_JOBS` is
observed firing in production — for this one that claim cannot rest on audit
rows, and `docs/66` notes the Worker logs the HTTP status and never reads the
body.

⚠️ **RESOLVED 2026-10-28, later the same day — it is [VERIFIED], and the
method is the useful part.** `workers/cron/wrangler.toml` sets
`[observability] enabled = true`, so the Worker's logs are queryable through
Cloudflare's API and nobody had tried:

```
POST /accounts/{id}/workers/observability/telemetry/query
  { queryId, timeframe:{from,to},
    parameters:{ datasets:["cloudflare-workers"],
                 filters:[{key:"$metadata.service", operation:"eq",
                           value:"lastdonor-cron", type:"string"}] },
    view:"events", limit, dry:false }
```

⚠️ Both `queryId` **and** `parameters` are required — `queryId` alone returns
`"Query not found"`, and `parameters` alone returns a Zod error naming
`queryId`. It took three shapes to find that.

The answer, from the Worker's own output:

```
11:25:04  [cron] 2026-10-28T11:25:03.916Z dispatching 2: update-phases, screen-documents
11:25:05  [cron] screen-documents ok 200
11:25:05  [cron] update-phases ok 200
```

Over the window the API returns (200 events, which truncates the 6h request,
so these are **floors**): `update-phases` 46, **`screen-documents` 46**,
`ingest-news` 7, `publish-campaigns` 7, `verification-reminders` 1,
`blog-generate` 1 — and **zero** `REJECTED`, `failed` or `threw` lines.

Two things follow beyond the immediate answer:

1. `docs/66`'s "the Worker logs the status and deliberately never reads the
   body" describes what the Worker *does*; it does not mean the log is
   unreadable. **A cron question that the database cannot answer is now
   answerable**, and this is the way to do it.
2. The deployed bundle can be read directly too
   (`GET /accounts/{id}/workers/scripts/lastdonor-cron`), which is how
   "`screen-documents` is in the deployed schedule" was verified rather than
   inferred from the deploy date — and how `simulate-donations`'s single
   occurrence in that bundle was confirmed to be **inside a comment**, not a
   job entry. That is a fourth, independent confirmation of §2's lock 1.

---

## 5. ✅ `docs/123`'s inference is now VERIFIED from production

`docs/123` diagnosed the silent `blog-generate` by **elimination** across three
indistinguishable paths and marked the cause [INFERRED], which it flagged as
the point of the whole doc. Its fix — writing a row that names the reason — has
now fired:

```
blog_pipeline_skipped  2026-10-28 08:00:04Z
  reason: 'BLOG_PIPELINE_ENABLED is not "true", so no post was generated.
           Set it on the Fly app to enable blog auto-generation.'
```

So the inference was right, and it is now a fact with a row behind it. Two of
the other three formerly-silent jobs are also confirmed running:
`blog_topics_discovered` (12 rows, latest today 06:00) and `blog_refresh_check`
(3 rows, latest 2026-10-25 — which is **on schedule**, its cron being
`0 10 * * 0`, Sundays).

---

## 6. What was NOT checked

- **Whether the Worker actually invokes `screen-documents`** (§4.1). The route
  is served; the call is unobserved.
- **The screening path itself.** Zero documents exist, so no screening
  decision has ever been made in production. `docs/106`'s safety argument —
  that approving a document writes only `verification_documents` and can never
  advance `campaigns.verification_status` — was **not** re-verified here; it
  is re-read, not re-executed.
- **The admin simulation screens were not pressed.** `/admin/simulation`,
  `/admin/simulation/fund-pool` and `/admin/simulation/analytics` are all
  gated to `admin` and all their routes are `['admin']` [VERIFIED by reading],
  but no control on them was clicked. `docs/88` F9 covers that screen's three
  blockers; `docs/115` §7 and `docs/129` cover fund-pool disbursing nothing.
- **Turning simulation on** to watch the engine write — that is a production
  write of money-shaped data and Gate 8 forbids it without an instruction.

---

## 7. ⛔ THE DEFECT THIS TURNED UP: a remedy that was wrong at the worst moment

Rendering `/admin/simulation` as an admin — item 4 of the open list, and the
step `docs/88` F9 warns cannot be skipped, because that screen once returned
**200 with the error boundary inside it** — the three blockers display
correctly. The third one's remedy did not:

> **3. No cron job has run recently, so nothing is driving any schedule.**
> *To clear it:* "Deploy the Worker in workers/cron. **It is built and tested
> but has never been deployed, so none of the nine scheduled jobs has ever run
> in production.**"

[VERIFIED three ways]

1. **Code.** `simulation-readiness.ts:136-141`: `title` and `detail` are
   computed, but `fix` is a **static string** with no condition — it cannot
   vary.
2. **Production.** The Worker *is* deployed (`lastdonor-cron`, modified
   `2026-10-25T07:40:05Z`) and jobs *are* running (§4.1's log). Both halves of
   the sentence are false, and `CRON_JOBS` holds **12**, not nine.
3. **Execution.** The walk rendered that exact sentence on screen.

**Falsification attempt:** *"it is unreachable, therefore harmless."* It
failed. The blocker renders **only** when the scheduler has been quiet for
three ticks — which is the incident — and at that moment it told the operator
to perform a first-time deploy that happened ten days ago, while denying any
job had ever run. The real causes then are a stopped trigger or a
`CRON_SECRET` mismatch, and the Worker already logs the latter loudly
(`workers/cron/src/index.ts:58-63`).

### 7.1 The module states the rule it broke

```
 * ── Why this is computed and not written as copy ──
 * A hardcoded "this does not work yet" banner becomes a lie the day it
 * starts working, and nobody deletes a stale warning.
```

Three blockers obey that; the fourth string is prose. Item 3 of the module's
own header had gone stale the same way and is corrected too.

### 7.2 The fix, and the rules that bite

The remedy now derives the job count from `CRON_JOBS.length` and the cadence
from `TICK_MINUTES`, and points at what is actually diagnostic: the trigger,
`wrangler tail`, and the silent `CRON_SECRET` mismatch. Three rules in
`simulation-readiness.test.ts`, all injection-proven:

| Injection | Result |
|---|---|
| the ORIGINAL stale sentence restored | **FIRED** (3 rules) |
| job count hardcoded as "nine" | **FIRED** |
| **CONTROL** the remedy emptied out | **FIRED** (3 rules) |

The control matters: without it, deleting the remedy would satisfy "says
nothing false".

⛔ **Blast radius is text only** — `getSimulationReadiness` has one real caller
(`admin/simulation/page.tsx:9`) plus a type import, no test pinned the old
string, and the `SCHEDULER_STALE_AFTER_MS = TICK_MINUTES * 3` invariant
(tolerance 15 min must exceed the 5 min tick) is untouched and holds.

---

## 8. The trust network, finally exercised

Item 5. `docs/108`'s logic passed 28 unit and 17 integration tests, and no
vouch had ever been recorded anywhere. One has now been, through the real
admin API against a production build: institution created → vouch recorded →
revoked. **13/13.**

The part worth having is not that it worked; it is that `docs/108`'s central
safety claim — *a vouch grants `identity_verified` and NOTHING else* — is now
proven **by execution** rather than by a test asserting the shape of a
`.set()`:

| column | before | after vouch |
|---|---|---|
| `verification_status` | unverified | **identity_verified** |
| `verification_source` | null | **institution_vouch** |
| `status` | unchanged | **unchanged** |
| `raised_amount` | unchanged | **unchanged** |
| `total_released_amount` | unchanged | **unchanged** |
| `goal_amount` | unchanged | **unchanged** |

Revoking reversed the verification and left `status` untouched. ⚠️ Local
only — production still holds 0 institutions and 0 vouches, so the path is now
proven in a browser against real Postgres, and still never used in life.

---

## 9. The admin probe, decided

Item 3 is not fixable and does not need fixing; it needs recording so the next
session does not repeat it. §3.1 holds it: **the `docs/104` §5.1a 401-vs-404
probe works for cron routes and not for the admin surface**, because the
middleware is default-deny and answers before routing. For admin routes the
build's route table is the evidence. Both controls returning exactly what the
real route returns is the only reason that was caught.
