# 87 — The pool wedged a third time, and nobody could open the admin

**Date:** 2026-10-17
**Status:** Service restored. **⛔ Root cause still not established** — the
`docs/52` fix was deployed and did not prevent this.
**Read with:** `docs/37` and `docs/52` before touching `src/db/`.
**Also resolves:** the admin area had no users.

---

## How this was found

The question asked was "what next — do we start designing the admin
dashboards?" Checking the admin's actual state before answering turned up
two things, the second by accident.

---

## 1. There were no admins. At all.

**VERIFIED 2026-10-17 against production:**

| | |
|---|---|
| Users | 6 |
| `role = 'admin'` | **0** |
| `role = 'editor'` | **0** |
| `src/app/admin/layout.tsx:12` | redirects anyone who is not `editor`/`admin` to `/login` |

So **all 31 admin pages were unreachable by every account that existed**,
and had been since launch.

That mattered acutely, not theoretically. `docs/78`/`docs/79` closed the
review gate the previous day and moved 12 live campaigns into
`under_review`. With no admin, the queue had **no operator**, so:

```
campaigns: under_review  12
campaigns: active         0   ← the public /campaigns was empty
```

**This is the `docs/83` failure repeating, and the same author made it.**
`docs/83` was written hours earlier, about a verification flow that worked
and that nobody could reach, and its stated lesson was: *trace the path a
signed-in person clicks before calling an integration done.* The review
gate was verified at the API, the inserts and the tests. Nobody checked
that a human existed who could work the resulting queue. Tracing the path
for the organiser and not for the admin is the same omission in a new
costume.

### Fixed

`petermuchendu1000@gmail.com` promoted to `admin` — the owner's choice,
and the only non-donor account on the platform. There is **no
`super_admin`**: the `user_role` enum is `donor | editor | admin`, and
`admin` is the top of it.

Done by direct SQL, because the only UI for granting a role lives behind
the admin area that the grant exists to open. An `audit_logs` row
(`user.role_changed`, severity `warning`) records the change, the reason
and that the owner authorised it — a privilege grant that leaves no trace
is worse than the inconvenience of writing one.

**A JWT caveat that will waste someone's time otherwise:** the role lives
in the token, and `ROLE_REVALIDATION_INTERVAL.donor` is **3600 s**
(`src/lib/auth.ts:96`). A promoted user keeps `role: donor` for up to an
hour unless they sign out and in again. The comment there calls a stale
donor claim harmless because it can only hide a promotion — true for
security, and precisely what makes the promotion look broken.

### The admin itself is fine

All 30 admin routes walked against production as a real signed-in admin
(throwaway account, promoted, deleted after): **30 × HTTP 200**, 89 KB–140 KB
each, no render errors, no redirects. `/admin/campaigns` shows the 12
queued campaigns with titles and status filter tiles.

**Nothing in the admin needed designing. It needed a user.**

---

## 2. The connection pool wedged again, during the walk

Mid-walk, `POST /api/auth/register` started answering `500`. It had worked
twenty minutes earlier.

### Symptoms (VERIFIED)

```
/api/v1/health           503  16.1s   database: error, latencyMs 15003
/api/v1/campaigns        500  15.6s   INTERNAL_ERROR
/api/auth/csrf           200   0.6s   (no DB)
```

Five consecutive health probes, all `15001`–`15002 ms` — the configured
timeout exactly, never recovering. Fly logs showed `QueryTimeoutError`
with `code: 'DB_QUERY_TIMEOUT'` on every DB path: `/api/v1/campaigns`,
`/api/v1/notifications`, the middleware's `[auth] role lookup`, the stats
fetch, the health check.

### The database was healthy the whole time

This is the part worth keeping. Queried through the Supabase Management
API **while the app was timing out**:

```
state    n   oldest
idle     6   3 days 10:14:34
active   3   00:05:15
(null)   1
```

Ten connections, three active, nothing stuck, and my own SQL returned
instantly. **Postgres was fine. The application's pool could not reach
it.** Same signature as `docs/37` and `docs/52`.

### The `docs/52` fix was deployed and did not prevent it

`docs/52` added `pending.cancel()` on timeout so an abandoned query
settles and returns its slot, and concluded the wedge "can no longer
become permanent". The error text in these logs cites
`src/db/query-timeout.ts`, so that build is what was running — and the
wedge was permanent across five probes.

So the cancellation fix is **necessary but not sufficient**. Whatever
stalls the connection in the first place — unestablished in all three
incidents, and suspected Supavisor instability in both earlier ones — is
still unaddressed.

### Restart worked this time

`flyctl machine restart d8d1116b5161d8`. After it:

```
db ok 4–6 ms   (was 15001 ms)
/api/v1/campaigns  200 in 0.28–0.52s, six consecutive rounds
```

**This contradicts `docs/52` §4**, which states plainly that "restart is
not a remedy for this failure mode" because its leak re-formed inside one
page load. Here a restart cleared it and it stayed clear. Two readings fit
and the evidence does not separate them: either this is a *different*
trigger from `docs/52`'s leak, or `docs/52`'s fix removed the re-formation
while leaving the original stall. **Recorded as unresolved rather than
guessed.**

Health still answers `503` after recovery — that is the Stripe check
failing on the placeholder key (`docs/72`), not the database. Worth
knowing before someone reads a red health endpoint as a wedge.

---

## ⛔ Still open

- **Root cause of the stall, across three incidents.** Not established in
  `docs/37`, `docs/52` or here.
- **No alerting.** `docs/52` §6 flagged this and it is still true: all
  three incidents were found by a person looking at something else. This
  one was found while walking admin pages for an unrelated reason. The
  deep health endpoint reports `degraded` correctly and **nothing watches
  it** — and the cron Worker that could is itself undeployed (`docs/65`,
  `docs/66`).
- **`max: 5` connections** remains small (`docs/52` §6).
- **Whether restart is a remedy** now depends on which failure mode is in
  play, and there is no way to tell them apart from outside. Try a restart
  first; if the wedge returns within a page load, it is `docs/52`'s mode.

## Not done, deliberately

The 12 queued campaigns were **not approved**. They are automated drafts
about named real people (`docs/36`, `docs/79`), and publishing an appeal on
someone's behalf is an editorial act for the owner, not a side effect of an
engineering walk-through. They are one click each in `/admin/campaigns`,
now that an admin exists.

---

# AMENDMENT 2026-10-17 — fourth wedge, and the ROOT CAUSE, finally measured

It wedged again ~40 minutes after the restart above. That alone disproves
`docs/52`'s conclusion that the wedge "can no longer become permanent".
This time evidence was captured **before** restarting, which is what the
first three incidents never did.

## What was found

`pg_stat_activity`, while every app route was timing out at 15,002 ms:

```
pid=354263  state=active  conn_age=11:32:41  query_age=11:17:46  xact_age=11:17:46
            wait_event = Client/ClientRead
            query: select "id","title" from "campaigns" where "simulation_flag" = $1 ...

pid=355015  state=active  conn_age=11:19:28  query_age=11:16:45  xact_age=11:16:45
            wait_event = Client/ClientRead
            query: select "role" from "users" where "users"."id" = $1 limit $2
```

**Two backends with transactions open for 11 hours 17 minutes, both waiting
on `Client/ClientRead`.** That wait event means the server finished its work
and is waiting for the client to send the next message. The client never
did — it was gone. The backends sat in open transactions holding Supavisor
pool slots indefinitely.

The second query is the `[auth] role lookup` that `src/lib/auth.ts` runs in
middleware, so this is reachable from ordinary traffic.

## Proof of causation

The two backends were terminated with `pg_terminate_backend`, and **nothing
else was done — no deploy, no machine restart**:

| | before | after |
|---|---|---|
| health `database` | `error`, 15002 ms | `ok`, 21 ms → 3 ms |
| `POST /api/auth/register` | `500` | `201` |

That is the first demonstrated cause-and-effect across four incidents.

## Both earlier docs named the wrong fix

- **`docs/52`'s client-side `pending.cancel()`** cannot help. Cancelling
  requires a client; here the client is already gone. The fix is real and
  worth keeping, but it addresses a different failure.
- **`docs/37` §4 and `docs/52` §6 debated a role-level `statement_timeout`**
  and parked it because "migrations run as the same role". **That is the
  wrong GUC.** `statement_timeout` bounds a query that is *executing*; these
  queries were not executing, they were idle inside an open transaction. The
  setting that bounds this is **`idle_in_transaction_session_timeout`**, and
  the migration objection does not apply to it: a migration executing
  statements back to back is never idle-in-transaction, and if one ever were
  terminated the transaction rolls back cleanly.

## Fix applied

```sql
ALTER ROLE postgres SET idle_in_transaction_session_timeout = '5min';
```

VERIFIED applied 2026-10-17; `rolconfig` now carries it alongside the
pre-existing `search_path`. Supabase's own `supabase_auth_admin` role already
sets this to 60 s in this same database, so the practice has precedent here.

**Revert, if it ever harms a migration:**
`ALTER ROLE postgres RESET idle_in_transaction_session_timeout;`

This bounds the damage; it does not explain why a client disappears
mid-transaction in the first place. That is still open.

## ⛔ Still open after this

- **Why the client vanishes mid-transaction.** Unknown across four
  incidents. Candidates not yet tested: a Fly machine suspend/resume cutting
  sockets, Supavisor dropping the client leg, or a Node process exit between
  BEGIN and COMMIT.
- **`DATABASE_URL` port.** `CLAUDE.md` states the app uses the pooler in
  transaction mode on 6543 and that migrations use 5432. The copy available
  to this session points at **5432**. Whether the Fly secret the app actually
  runs on is 5432 or 6543 was NOT verified — Fly does not expose secret
  values. If the app is on 5432 (session mode) it pins one backend per
  client connection for its whole life, which would make this failure far
  easier to hit. **Verify before anything else here.**
- Alerting, still absent. This fourth wedge was found, once again, while
  doing something unrelated.

---

# AMENDMENT 2 — the fix above is INEFFECTIVE. Fifth wedge, and a fuller diagnosis

**Retracting the previous amendment's claim that this was fixed.** It was
not. A fifth wedge occurred roughly two hours later, with
`idle_in_transaction_session_timeout = 5min` in force.

## Why the fix does not fire

Captured during the fifth wedge:

```
pid=403655 usename=postgres state='active'  conn_age=00:24:03  xact_age=00:07:04
           wait=Client/ClientRead   select "id","total_released_amount",...
pid=404580 usename=postgres state='active'  conn_age=00:10:13  xact_age=00:07:27
           wait=Client/ClientRead   select "id","user_id","type","title",...
```

Both are `usename=postgres`, so the `ALTER ROLE` applies to them, and both
connections were opened **after** it was set. Transactions were 7 minutes
old — past the 5-minute bound — and were not terminated.

**The reason: `state = 'active'`, not `'idle in transaction'`.**
`idle_in_transaction_session_timeout` terminates only the latter. A backend
parked in `active` + `Client/ClientRead` is outside its scope.

## Nothing in PostgreSQL bounds this state

| setting | value (verified) | fires here? |
|---|---|---|
| `statement_timeout` | `120000 ms` | **No.** These ran 7–11 h. The timer is not armed while the backend waits for client input between extended-protocol messages. |
| `idle_in_transaction_session_timeout` | `300000 ms` (set above) | **No.** Wrong state. |
| `tcp_keepalives_idle` / `interval` / `count` | `1800 s` / `60 s` / `9` | **No.** The TCP peer is Supavisor, and Supavisor is alive and answering. There is no dead socket to reap. |

So the backend is healthy, its peer is healthy, and the transaction is
immortal. The abandonment is **inside Supavisor**: it holds a server leg
with an open transaction whose owning client is gone.

**`ALTER ROLE postgres SET idle_in_transaction_session_timeout = '5min'`
is being LEFT IN PLACE.** It is correct hygiene and bounds a genuine
neighbouring failure (a real idle-in-transaction leak), it has no observed
cost, and Supabase sets the same thing on its own auth role. But it must
not be recorded as the fix for this, because it is not.
Revert if ever needed: `ALTER ROLE postgres RESET idle_in_transaction_session_timeout;`

## Leading hypothesis, NOT yet proven

**Our own 15-second client timeout may be creating these.** `docs/52` added
`pending.cancel()`, which opens a second socket and sends a CancelRequest.
A cancelled extended-query sequence that never receives its `Sync` leaves
the backend exactly where we keep finding it: `active`, `Client/ClientRead`,
transaction open.

Circumstantial support: every stuck query found across both captures is an
ordinary page-load SELECT (`campaigns`, `users.role`, `notifications`,
payout totals) — precisely what is in flight when a page load times out.

This would make `docs/52`'s remedy a cause, which is the same shape as
`docs/52`'s own finding that the `docs/37` guard "was part of the cause".

**The experiment:** disable `pending.cancel()` (keep the reject), deploy,
and watch whether backends stuck in `active`/`ClientRead` stop appearing.
Cheap, reversible, and it settles the question. NOT done here.

## The only remedy available to us today

A watchdog that terminates backends by transaction age, since no GUC will:

```sql
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
WHERE datname = current_database() AND xact_start IS NOT NULL
  AND now() - xact_start > interval '5 minutes';
```

Run manually during each of the last two incidents; it restored service in
seconds both times, with no deploy and no restart.

It needs a scheduler. `pg_cron` is **not** installed in this database
(checked: `pg_extension` has no row for it), and our own cron has never run
(`docs/65`). Installing a database extension and giving it a
`pg_terminate_backend` job is new production infrastructure and an owner
decision, so it was NOT done unilaterally. It is the recommended next step.

## Correction to AMENDMENT 1

Amendment 1 flagged that `DATABASE_URL` might be on port 5432 (session
mode). `src/db/query-timeout.ts` records its findings as "verified against
the production pooler **on port 6543**", so the application is on
transaction mode; the 5432 URL is this session's own copy, used for
migrations. **Withdrawn as a concern.**

---

# AMENDMENT 3 — the cancel experiment, run

## The hypothesis was weaker than amendment 2 claimed

Amendment 2 proposed that `docs/52`'s `pending.cancel()` creates the
stuck backends. Before running it, the comment block already in
`src/db/query-timeout.ts` was re-read, and it records **five backends
sitting in `ClientRead` during the 2026-10-16 outage** — which predates
`cancel()`. The symptom therefore predates the suspected cause, and
cancel cannot be its origin. The experiment can only test whether cancel
makes them *worse* or *more permanent*. Stated here because amendment 2
oversold it.

## Setup

`DB_CANCEL_ON_TIMEOUT` (`src/db/query-timeout.ts`). Default ON, so an
unset, empty or malformed value leaves `docs/52` behaviour intact; only
the exact string `0` disables the CancelRequest. Read per call, so
reverting is removing one Fly secret with no build.

Set on Fly and deployed (release 56, digest `9048cdb637b2dd86`,
`Deployed`). VERIFIED present on the running machine.

## Measurement

Same probe both sides: 20 samples, 30 s apart, recording health latency,
backends with a transaction older than 2 minutes, and the subset of those
in `state=active` + `wait=ClientRead`.

| | baseline (cancel ON) | experiment (cancel OFF) |
|---|---|---|
| samples | 20 | 20 |
| db errors | 0 | 0 |
| latency min/median/max (ms) | 5 / 41 / 76 | 30 / 41 / 87 |
| backends stuck > 2 min | **0** | **0** |
| of those, in `ClientRead` | **0** | **0** |

Identical medians, no wedge on either side. **The result is null.**

## ⛔ What this experiment cannot settle

**Ten minutes is far too short.** The five wedges were 40 minutes to 2
hours apart, and the baseline window contained no wedge at all. A clean
experiment window therefore proves nothing: it is the expected result
whether or not cancel matters.

Treating a quiet 10 minutes as a pass would be the same error as
`docs/52`'s "can no longer become permanent", which was also concluded
from a short clean window and was wrong within a day.

**What would settle it:** leave `DB_CANCEL_ON_TIMEOUT=0` in place for
several hours of ordinary traffic and compare the count of
`ClientRead`-stuck backends against the same span with it unset. That
needs a scheduled sampler, which is the same gap `docs/65` describes.

## The better fix this points at

Since no GUC bounds an `active` + `ClientRead` backend (amendment 2), the
remedy that actually worked both times was terminating by transaction
age. A targeted predicate avoids the migration risk that made `docs/37`
park this:

```sql
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
WHERE datname = current_database()
  AND state = 'active' AND wait_event = 'ClientRead'
  AND xact_start IS NOT NULL AND now() - xact_start > interval '5 minutes';
```

A migration doing work is never in `ClientRead`, so this cannot touch
one. It still needs a scheduler: `pg_cron` is not installed, and our own
cron has never run. An in-process interval in the Next server would work
without new infrastructure. NOT built here — one change at a time during
an incident, which is `docs/52`'s own lesson.
