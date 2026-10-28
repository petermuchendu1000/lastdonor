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

[UNKNOWN] whether `screen-documents` fires. What would establish it: the
Worker's own log, or one pending document. Not fixed, because the noise
argument in its comment is sound and the cheap remedy (a low-frequency
heartbeat row) is a judgement call about log volume, not a defect.

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
