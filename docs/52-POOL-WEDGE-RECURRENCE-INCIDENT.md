# 52 — The pool wedge recurred, and the guard was part of the cause

Incident 2026-10-16, ~00:50Z to ~01:16Z. Second occurrence of `docs/37`.
**Read with `docs/37`; this one amends it.**

---

## 1. Symptom

Every database-backed route returned at **~15.3–15.5s** or 500'd:

| Route | During | After fix |
|---|---|---|
| `/` | 200 in 15.31s, shell + "Loading…", no content, **no `<h1>`** | 200 in 0.43s |
| `/campaigns` | 200 in 15.47s | 200 in 0.31s |
| `/blog` | 200 in 16.04s | 200 in 0.32s |
| `/campaigns/alicia-reeves` | **500** in 4.86s | 200 |
| `/api/v1/live` | 200 in 0.66s | 200 |
| `/about` | 200 in 0.50s | 200 |

`/api/v1/live` is the Fly health check and does not touch the database, so
the machine stayed green throughout — the same blind spot as `docs/37`, and
still the correct probe choice (`docs/32` §11).

## 2. What it was not

Ruled out by measurement, during the outage:

| Hypothesis | Evidence against |
|---|---|
| Database down or slow | Supabase `ACTIVE_HEALTHY`; `count(campaigns)` in **1.3s** from this sandbox |
| Network path broken | TCP to the pooler opened in **11ms** from inside the Fly container |
| DNS | resolved to `13.60.109.208`, `16.16.102.12` |
| Connection limit | **19 of 60** connections used |
| Blocking locks | `pg_blocking_pids` → **0 blocked** |
| Bad pool config | the **same** config (`max:5`, `prepare:false`) ran **8 concurrent queries in 72ms** from inside the same container |
| A deploy's code diff | `/blog` and the campaign detail page also failed, and neither was touched by it |

`pg_stat_activity` showed **five** backends `state=active`,
`wait_event=ClientRead`, ages 117–177s. `ClientRead` means Postgres had
finished and was waiting on the client. **The database was answering; the app
was not listening.**

## 3. Cause

`withQueryTimeout` (added after `docs/37`) raced each query against a 15s
timer. When the timer won it rejected the caller **and did nothing else**.
`postgres.js` has no implicit cancellation, so the query kept its pool
connection.

With `max: 5`:

1. Five queries time out → five connections never return to the pool.
2. The pool is now empty. Every later query waits in the queue.
3. Queue waits exceed 15s → they time out → more stuck connections.
4. Permanent, self-reinforcing.

**The guard converted an unbounded hang into a fast error for the caller
while still leaking the connection that caused it** — it made the symptom
legible and the failure permanent. `docs/37` correctly identified
`postgres.js`'s missing query timeout as "the amplifier"; the fix for it
became the next amplifier.

This is why **restarting the machine did not help**: a restart gives a clean
pool, but the first homepage render fires enough concurrent queries to
exhaust five slots again. The wedge re-formed inside one page load.
Terminating the five stuck backends with `pg_terminate_backend` did not help
either — the client-side connections were still checked out of the pool.

## 4. Fix

`bound()` now calls `pending.cancel()` before rejecting.
`postgres.js` exposes `cancel()` on a pending query
(`postgres/src/query.js:52`, typed at `types/index.d.ts:608`); it opens a
second socket and sends a CancelRequest, so the server stops and **the driver
settles the query, which is what returns the connection to the pool.**

Best-effort by design: a `cancel()` that throws must not mask the timeout,
and a pending query without `cancel` behaves exactly as before. Both are
tested.

### Verified after deploy

- `/`, `/campaigns`, `/blog`: **0.31–1.47s**, five consecutive rounds.
- **30 concurrent homepage loads: 30 × HTTP 200, avg 0.62s, max 1.40s.**
  The previous build wedged within a single load.
- Homepage LCP **712ms** mobile / 1012ms desktop, CLS **0**.

## 5. Tests

Four added to `src/db/query-timeout.test.ts`, 18 total. The regression guard
is `cancels the underlying query on timeout, so the pool slot is released`,
which **fails against the previous implementation**. Also covered: a query
that settles in budget is not cancelled; a throwing `cancel()` still reports
the timeout; a pending query with no `cancel` still times out.

## 6. Still open

- **`max: 5` is small.** Cancellation removes the leak, but five slots is
  little headroom for a page that fires several queries per render. Not
  changed here: one fix at a time during an incident.
- **A role-level `statement_timeout` is still the only thing that bounds a
  server-side query the client has abandoned.** Unchanged owner decision from
  `docs/37` §4, because migrations run as the same role. Cancellation makes
  it much less urgent, not unnecessary.
- **Why the pooler stalled in the first place** is still not established, here
  or in `docs/37`. Both times the trigger looked like transient Supavisor
  instability. What has changed is that it can no longer become permanent.
- **No alerting.** Both incidents were found by a human looking at the page.
  The deep health endpoint reports `degraded`, but nothing watches it.

## 7. Amendment to `docs/37`

`docs/37` says a machine restart "cleared it instantly". That was true of the
first incident and **was not true of this one**: restart and backend
termination both failed, because the leak re-created the condition
immediately. Restart is not a remedy for this failure mode.
