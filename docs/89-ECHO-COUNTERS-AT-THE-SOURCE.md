# 89 — The echo counters, incremented where the rows are written

**Status:** Fixed and deployed 2026-10-18. Supersedes the "echo columns
are BROKEN" warning CLAUDE.md has carried since 2026-10-14.

## How it surfaced: a prediction that was wrong

Before the first scheduled `reconcile` run, a baseline was taken at
01:14Z with an explicit prediction: **exactly one** echo-column fix,
campaign `keisha-wallace`, `update_count` 0 against 1 real row.

Reconcile was then run by hand at 02:07Z rather than waiting for 04:00.
It reported:

```json
{"discrepancies":0,"archived":0,"fundPoolAlerts":0,
 "echoColumnFixes":4,"activeCampaignDrifts":0,"errors":[]}
```

Four, not one. Everything else matched. The prediction was wrong and
the reason matters more than the number.

## Why four

| what | when |
|---|---|
| baseline taken, 1 campaign drifting | 01:14Z |
| `campaign_updates` row written | 01:45:28Z |
| another | 01:50:28Z |
| another | 01:55:28Z |
| reconcile run, 4 fixes | 02:07Z |

Three organiser updates were written in the intervening 53 minutes by
`update-phases`, which runs every five minutes **and had started
running two hours earlier**, when the cron Worker was deployed
(docs/66). None of the three touched `update_count`.

So the dataset moved under the prediction, and it moved because of a
change made earlier the same night. A dormant defect became a live one
the moment the thing that writes rows started running.

## The defect itself (known since 2026-10-14, now load-bearing)

`campaigns.update_count`, `message_count` and `seed_donation_count`
exist to keep listing queries off an N+1. **Nothing incremented them.**
Ten insert sites wrote rows and left the counters alone; the only
writer was `cron/reconcile`, repairing them after the fact.

Nightly repair is not a fix. Between two runs the counters are simply
wrong, and `src/lib/email-adaptive.ts` prints `updateCount` straight
into a recipient's inbox. At the observed rate - three updates an hour
with twelve campaigns and no donations yet - the number is wrong for
most of the day.

## The fix

`src/lib/echo-counters.ts` exports `insertCampaignUpdate` and
`insertCampaignMessage`. Each inserts the row and increments the
counter, and takes an optional transaction handle so callers already
inside one commit or roll back both together (`payment-service`,
`simulation-engine`). The increment is `SET x = x + 1`, evaluated by
Postgres against the current row, so concurrent inserts cannot lose a
count the way a read-modify-write in application code would.

All ten call sites now go through it: 7 update inserts (admin route,
user-campaigns route, organizer-generator, payment-service,
simulation-engine ×5) and 3 message inserts.

**Why a helper rather than ten careful call sites.** Ten places that
must each remember a second statement is the arrangement that produced
the bug. One function that cannot insert without incrementing is the
arrangement that cannot. A ratchet in `echo-counters.test.ts` fails the
build if any file calls `.insert(campaignUpdates)` or
`.insert(campaignMessages)` directly again.

`reconcile` step 5 stays as the backstop, and should now find nothing.

## A second finding: 80 tests had silently stopped running

Adding `echo-counters.ts` broke **five existing test suites at once**,
because the module imports `server-only` (correctly) and those suites
did not mock it. Every one failed at collection.

A file that fails to collect contributes zero tests, so the summary
line read:

```
Test Files  5 failed | 166 passed (171)
Tests       5898 passed (5898)
```

**"5898 passed" and not one failure listed**, while 80 tests had
stopped running. Reading only the `Tests` line would have called that
green.

Fixed at the root: `vitest.config.ts` now aliases `server-only` to
`test/stubs/server-only.ts`. The guard still does its job in the build
and is no longer a tripwire that every new server module can spring.
Tests previously worked around it one file at a time with
`vi.mock('server-only', () => ({}))`, which only ever protected the
files someone remembered.

Also: `pool-fanout.ratchet.test.ts` was given an explicit 60s budget.
It is a whole-repo AST walk that took 4.6s of the default 5s and
tipped over the moment a file was added.

## One stale assertion, corrected rather than deleted

`simulation-engine.transaction.test.ts` asserted the donation write
performs exactly three operations in its transaction. It now performs
four: the fourth is the `message_count` increment, in the same
transaction as the row it counts. The test's intent - everything in ONE
transaction - is unchanged and now stronger, so the count was updated
and the reason written into the test.

---

# Running every cron by hand, 2026-10-18 02:42Z

The owner asked for all of it now rather than waiting for 04:00. Every
job invoked directly with the cron secret.

| job | status | time | result |
|---|---|---|---|
| `update-phases` | 200 | 0.6s | 5 checked, 0 updates |
| `reconcile` | 200 | 0.7s | **all zeros, including `echoColumnFixes: 0`** |
| `ingest-news` | 200 | 0.8s | 6 fetched, ⛔ `GNEWS_API_KEY` not set |
| `publish-campaigns` | 200 | **124.7s** | 2 qualified, 0 published |
| `fetch-news` | **timeout** | >290s | no audit row at all |
| `blog-topics` | 200 | 3.2s | 3 new topics |
| `blog-generate` | 200 | 0.6s | skipped, `BLOG_PIPELINE_ENABLED` unset |
| `blog-refresh` | 200 | 0.9s | nothing stale |
| `send-newsletter` | 200 | 1.0s | skipped, CAN-SPAM gate held |
| `simulate-donations` | **403** | 0.5s | fail-closed gate held |

`echoColumnFixes: 0` is the result that matters: the counters are
maintained at the source now, and reconcile found nothing to repair.
Both fail-closed gates refused correctly, with 3 live newsletter
subscribers on the other side of one of them.

## `fetch-news`: a budget I broke earlier the same night

It returned nothing in 290 seconds and wrote no audit row. Re-run with
a 15 minute budget it finished in **150s** (the first was a cold run
against an empty dedup set), so it was close to the edge and I had
pushed it over.

`MAX_NEW_ARTICLES_PER_RUN` carries the arithmetic in its own comment:
*"40 bodies at 5-wide plus 40 classifications at 5-wide is 16
sequential waves, which fits `maxDuration = 300` with headroom."*
Hours earlier, fixing pool fan-out (docs/87 amendment 5), I narrowed
the body batch from 5 to 3 — because each item in that batch also did
an `UPDATE`, so the batch size was simultaneously an HTTP fan-out and
a count of pooled connections. At 3-wide the body stage becomes 14
waves instead of 8.

One knob could not serve both: HTTP wants width, the pool wants
restraint. They are separated now. Bodies are fetched **8-wide with no
database involved**, then written in **one** `UPDATE ... FROM (VALUES
…)` — a single connection and a single round trip however many
articles came back. Faster than the original 5-wide version and
easier on the pool than either.

## What the run exposed: the AI ladder is entirely dead

`fetch-news` fetched **1,461 articles** and classified **9**. Thirty-two
identical errors:

```
404 This model is unavailable for free. The paid version is available
now - use this slug instead: meta-llama/llama-3.3-70b-instruct
```

Probed directly against OpenRouter, every rung fails:

| rung | result |
|---|---|
| `qwen/qwen3-coder` (paid primary) | **402** Insufficient credits, never purchased |
| `nvidia/nemotron-3-nano-30b-a3b:free` | **404** withdrawn from the free tier |
| `meta-llama/llama-3.3-70b-instruct:free` | **404** withdrawn from the free tier |
| `openrouter/free` (meta-router) | **429** free-models-per-day exhausted |

`OPENROUTER_API_KEY_FALLBACK`, which `.env.example` documents, is not
set — there is one key, not two.

**Why nobody saw it:** audit rows show these errors only on
2026-10-18. Before today the pipeline had no scheduler (docs/65), so a
dead model slug sat in configuration harming nothing. A slug is a
dependency on someone else's catalogue and it decays silently.

**Fixed what code can fix.** The two dead `:free` slugs are replaced
with models from OpenRouter's live list, each returning 429 rather
than 404, which proves the slug resolves:

- `FALLBACK_MODEL = nvidia/nemotron-3.5-lightning:free`
- `TERTIARY_MODEL = xingchen-agi/xing4.0-29b-a4b:free`

**Slug-verified, not output-verified.** The daily free quota was
exhausted, so no completion could be obtained to confirm either model
returns parseable JSON for the classifier. Check that before trusting
a classification run. Recorded plainly because docs/81 is explicit
that shipping an unexercised provider path is how docs/76 and docs/77
happened; the difference here is that the slugs being replaced are
*provably dead*, so the change is strictly an improvement either way.

⛔ **OWNER DECISION, no code fixes it.** The account has never
purchased OpenRouter credits, and the free tier is rate-limited to
exhaustion. OpenRouter's own message: *"Add 10 credits to unlock 1000
free model requests per day."* Until then the news pipeline fetches
1,400 articles a run and classifies almost none of them, blog
generation cannot run, and organiser updates will fail once the daily
quota is gone.

⛔ **Also unset: `GNEWS_API_KEY`**, so `ingest-news` loses one of its
three sources on every run and logs a `pipeline.source_failures` row.
RSS and FEMA still work.
