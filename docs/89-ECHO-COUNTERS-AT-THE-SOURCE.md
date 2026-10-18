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
