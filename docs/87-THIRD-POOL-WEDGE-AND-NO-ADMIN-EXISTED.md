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
