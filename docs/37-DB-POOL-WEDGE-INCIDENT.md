# 37 — Database Pool Wedge: Incident and Fix, 2026-10-14/15

First production incident. A total outage of every dynamic page, lasting hours,
with a **passing Fly health check**, found only because the owner asked an
unrelated question ("I don't see any campaigns").

---

## 1. Timeline — verified

| Time (UTC) | Event |
|---|---|
| 2026-10-14 18:16 | Machine `d8d1116b5161d8` launched, release v1. |
| 18:18 | `/api/v1/health` reports **`database: ok, latencyMs: 45`**. All 12 public pages 200. |
| 18:33 | Deploy #5 (the `lastdonor.org` origin). Machine updated, uptime clock restarts. |
| 18:38–19:18 | Repeated `Failed to find Server Action "y"` — stale client tabs against redeployed server actions. Harmless, unrelated. |
| 20:49 | Last log line of any kind: the Upstash-absent locks warning. |
| 2026-10-15 00:04 | `/api/v1/campaigns` and `/api/v1/health` hang: **35s+, HTTP 000, zero bytes, nothing logged.** `/api/v1/live` answers in 0.5s. |
| 00:05 | Database verified healthy *from inside the same machine*: `count(campaigns)` in **15ms**, `count(news_items)` in 23ms, `statement_timeout` `2min`, user `postgres`. Supabase project `ACTIVE_HEALTHY`, Management API `select 1` in 1.2s. |
| 00:08 | `fly machine restart`. |
| 00:09 | Fully recovered: `/api/v1/health` 503 in 0.77s with `database ok, 5ms`; `/api/v1/campaigns` 200 in 0.47s. |

**Duration: at least 3h15m, and possibly from 20:49.** It cannot be bounded more
tightly, because nothing was logged and nothing alerted.

---

## 2. Cause

**Trigger (assumed, strongly evidenced).** Transient Supabase pooler
instability. An earlier probe through the same pooler returned
`57014 canceling statement due to statement timeout` **in 74ms**, while the
session's `statement_timeout` was `2min`. A 74ms cancel cannot come from a 2min
timeout, so the cancellation originated in Supavisor, not Postgres. Marked
assumed: Supavisor-side logs are not available to us.

**Amplifier (verified, and the actual defect).** `postgres.js` 3.4.8 has
**neither a client-side query timeout nor a pool-queue timeout.** With `max: 5`
in `src/db/index.ts`, five connections left unrecoverable by that event exhaust
the pool, and every subsequent request waits on the queue **forever**. Hence
hangs rather than errors, and hence nothing logged — no code path was reached.

**Why monitoring did not catch it.** Fly's health check is `/api/v1/live`, the
shallow process-only probe. That choice is correct and deliberate (`docs/26` §1,
`docs/32` §11, audit R-09: pointing Fly at the deep endpoint would kill the whole
fleet during a Stripe blip). But it means **a dead database is invisible to
Fly**, by design. Nothing else was watching: no Sentry DSN, no external uptime
monitor. That gap is the real lesson, and it is still open — see §5.

---

## 3. Fix applied

`src/db/query-timeout.ts` bounds every query client-side, wrapping
`client.unsafe` — the single chokepoint every drizzle query passes through
(`drizzle-orm/postgres-js/session.js` lines 31, 39, 59, 91, 94), the same seam
`build-phase.ts` already uses. Budget 15s, overridable via
`DB_QUERY_TIMEOUT_MS` (clamped to 1000–120000; anything else logs and falls
back rather than being honoured silently).

A wedged pool now fails **fast and loudly**: the deep health endpoint reports
`degraded` within a second instead of hanging, so any external monitor can see
it. 14 unit tests, including that `.values()` is bounded, that a healthy query is
untouched, and that `begin` is never intercepted.

### 3a. What was tried first and does NOT work — do not re-add it

Passing the settings to the driver, which is the obvious fix:

```ts
connection: { statement_timeout: 30000, idle_in_transaction_session_timeout: 30000 }
```

**Supabase's Supavisor pooler in transaction mode silently ignores these.**
Verified against the production pooler on port 6543 on 2026-10-15: the values
read back as `2min` and `0`, unchanged, and `SELECT pg_sleep(45)` ran to
completion with a 30s timeout configured. **Ignored, not rejected** — so it
would have read as protection while providing none. This is the more dangerous
outcome and the reason it is recorded here rather than left as a code comment.

---

## 4. Rejected, and one deferred to the owner

**`ALTER ROLE postgres SET statement_timeout`.** The only mechanism that can
actually cancel a stuck *server-side* query, since it is enforced by Postgres
and therefore immune to the pooler ignoring session settings. **Deferred, not
rejected:** migrations run as the same `postgres` role, and the `docs/34`
baseline is 179 statements in one transaction, so a role-level cap risks
aborting a deploy's schema apply. Doing it safely means a separate role for the
application, or clearing the timeout in the migration path. Owner's call.

**Raise `max` above 5.** Rejected: it buys time proportional to the number of
connections and then wedges anyway. It treats the symptom and costs pooler
connections, which are the scarce resource on this plan.

**Retry/reconnect on error in the data layer.** Rejected for now: the
connections were not erroring, they were silently unusable, so there was no
error to retry on. The timeout above is what converts that into an error; a
retry layer becomes meaningful only once it exists, and would be a follow-up.

**Point Fly's health check at `/api/v1/health` so a dead DB restarts the
machine.** Rejected, firmly. It would have auto-recovered *this* incident, and
it is exactly the trap `docs/32` §11 documents: that endpoint 503s on any
dependency failure, including a Stripe blip, so Fly would kill every machine
simultaneously during an outage it could not fix. An outage caused entirely by
the monitoring is worse than this one.

---

## 5. Still open — this incident is not fully mitigated

1. **Nothing watches the database.** No `SENTRY_DSN`, no external uptime
   monitor. A fast error is only better than a hang if something is listening.
   An external check on `/api/v1/health` is the cheapest fix and is **not done**.
2. **No automatic recovery.** Recovery was a manual `fly machine restart`. A
   wedged pool will still need one, now with a loud error rather than silence.
3. **Root cause is inferred, not confirmed.** The 74ms cancel points at
   Supavisor; we cannot see its logs to prove it.
4. **One machine.** No second instance to absorb this, and `docs/26` §5 forbids
   scaling past one until the shared ISR cache handler exists.
