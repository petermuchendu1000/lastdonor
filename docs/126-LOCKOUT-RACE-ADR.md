# 126 — The account lockout got weaker the harder it was attacked

**Date:** 2026-10-28
**Journey:** 9 of the end-to-end walk (sign-in and credentials), first finding
**Status:** fixed, deployed, verified against production
**Read before touching** `src/lib/auth-lockout.ts`, `authorize()` in
`src/lib/auth.ts`, or the `auth` rate-limit tier.

---

## 1. Understanding

`recordFailedAttempt` was a read-modify-write across an `await`
(`src/lib/auth.ts:297-325` before this change):

```ts
const [user] = await db.select({ failedLoginCount … })          // :298-305
…
await db.update(users).set({ failedLoginCount: user.failedLoginCount + 1 })  // :321-324
```

`LOCKOUT_THRESHOLD = 5`, `LOCKOUT_WINDOW_MS = 15 min`. Called from exactly one
place: `authorize()`'s invalid-password branch (`auth.ts:434`).

Two failed sign-ins that interleave between those statements both read *N* and
both write *N+1*. One increment is lost. The attacker chooses the concurrency,
so **the control got weaker the harder it was attacked.**

---

## 2. Evidence

### 2.1 Executed against a real Postgres, with both controls

| | recorded | locked? |
|---|---|---|
| sequential ×10 (negative control) | **10** | — |
| 5 concurrent failed attempts | **2** | **no** (threshold 5) |
| 10 concurrent | **1** | no |
| 20 concurrent | **1** | no |
| atomic increment ×10 (positive control) | **10** | — |

The sequential control shows the harness counts. The atomic control shows the
loss belongs to the statement shape and not to the test.

### 2.2 The falsification attempt, and why it failed

**"What would most likely falsify this?"** → *the IP limiter already caps
attempts below 5, so the lockout is unreachable and the race is moot.*

Run: the binding tier is `auth`, and it is
`Ratelimit.slidingWindow(10, '60 s')` (`src/lib/rate-limit.ts`), reached via
`getLimiterTier`'s `/api/auth` branch (`:553`). **Ten attempts a minute from
one IP against a threshold of five.** The limiter is *above* the threshold, so
it never subsumed this control — the lockout was the binding one, and
parallelism defeated it. The limiter is also keyed per IP, so more addresses
multiply it.

### 2.3 The live database, read rather than assumed

`users_failed_login_nonneg` is `CHECK (failed_login_count >= 0)` — read from
`pg_constraint` **in production**, not from a migration file. An increment
cannot violate it, which is why this fix needs no schema change.
`failed_login_count` is `integer NOT NULL default 0`;
`failed_login_window_start` is `timestamptz` nullable.

---

## 3. Root cause — [VERIFIED]

Lost updates: **the branch deciding which window applies and the write acting
on it were separate statements.**

---

## 4. The fix

One statement. The window decision moved out of TypeScript and into a `CASE`,
because that *is* the root cause — a branch and its write have to be atomic:

```sql
SET failed_login_count = CASE WHEN <window expired or null> THEN 1
                              ELSE failed_login_count + 1 END,
    failed_login_window_start = CASE WHEN <same> THEN $now
                                     ELSE failed_login_window_start END
```

In an UPDATE's SET list every right-hand column reference reads the row's
**pre-update** value, so both arms see the same window start and cannot
disagree with each other.

⚠️ `sql.param(value, column)` and **not** `${cutoff}`: a bare `Date` in a `sql`
template binds a parameter with no encoder and throws inside the driver
(`docs/107`). This statement interpolates two Dates, so that trap was one
keystroke away — and injection 2 below confirms it is live.

### 4.1 Why the code moved to its own module

`src/lib/auth-lockout.ts` now holds `checkAccountLocked`,
`recordFailedAttempt`, `clearFailedAttempts` and the two constants; `auth.ts`
imports them.

This is larger than a one-line diff and it is the point: **`auth.ts` imports
NextAuth, which imports `next/server`, which the node-environment integration
suite cannot load** — so nothing could ever execute this SQL, which is exactly
how a read-modify-write survived in a file covered by 47 unit tests. Same move,
and same reason, as `docs/107` relocating a query into `report-periods.ts`
"so that a test could run it".

⚠️ `auth.enumeration.test.ts:572` reads the owning file as **text** to check
that the password-reset route clears the same columns `clearFailedAttempts`
writes. Its subject moved with the function, so it now reads
`auth-lockout.ts`. The assertion is unchanged — only what it points at.

⚠️ There is an unrelated `recordFailedAttempt` in
`src/app/api/v1/admin/settings/verify-security/route.ts:28` — in-memory, for
the admin step-up check. Same name, different thing, untouched.

---

## 5. The tests, and what each would have to see to fail

`src/lib/auth-lockout.integration.test.ts`, **11 tests**, calling the real
functions against a real Postgres — not a replica of their SQL, which would be
the `docs/101` trap in test form (proving what I believe the code does rather
than what it does).

- **The security property itself**: five concurrent attempts leave
  `checkAccountLocked` returning **true**. Before the fix it returned false.
- **Its control**: four concurrent attempts must leave it **false** —
  otherwise "locks after five" would also be satisfied by locking everybody
  always, which is a denial of service, not a control.
- **Both window boundaries**: an attempt inside the window increments and
  preserves `windowStart`; an attempt after it resets to 1 and does **not**
  carry the old count over (an honest user who mistyped weeks ago must not be
  locked by one slip today). A `NULL` window start counts as fresh.
- **The concurrent expired-window case**, which the split read/write could get
  wrong in the other direction: some callers taking the new-window arm while
  others increment, so the carried count depended on scheduling.
- **The cheapest and most important one**: that the statement *runs at all* —
  the `docs/107` Date trap.
- Constants are **imported, not mirrored**, so the test cannot assert
  yesterday's policy.

⚠️ The race assertion runs **three rounds**. A race is probabilistic: one round
could in principle serialise, and a single-round assertion would then fail in
CI for a reason unrelated to the code.

### 5.1 Injection results — all four fire, every restore verified

| injection | fails |
|---|---|
| restore the read-modify-write | 3 tests; rounds read `1,1,1` where 10 is required, and the five-at-once lock property fails |
| drop `sql.param` for a bare `Date` | **10 of 11**, with `TypeError: The "string" argument must be…` |
| never start a new window | 2 — the expired-window tests |
| always start a new window | 5 — every counting test |

---

## 6. Result

Deployed as **v113**. lint clean, typecheck clean, **7,691 unit passed / 16
skipped (262 files)**, **281 integration passed (29 files)**.

---

## 7. What was NOT checked

- **Whether production has ever actually been brute-forced.** I did not read
  authentication logs; `logAuthFailure` writes to the console, and I have no
  access to Fly's log history from here. So the exposure is [VERIFIED] and any
  claim about exploitation would be [UNKNOWN].
- **Multi-machine behaviour.** Fly currently runs **one** machine, so the race
  was bounded by one process's pool of 5. With more machines the window is
  wider. The fix is atomic in the database, so it is correct either way, but I
  measured only the single-machine case.
- **An unrelated pre-existing flake**, recorded honestly:
  `simulation-engine.test.ts` → *"allows donations at exactly 48 hours minus
  1ms"* failed once in a full-suite run and passes 26/26 in isolation, **both
  with my changes and at HEAD without them**. A real-clock boundary that tips
  under load. Not caused by this work, not fixed by it, and out of scope.
- **The rest of Journey 9** — register, the sign-in screen itself, forgot
  password and reset — are inventoried but not yet walked.
- **The lockout is per-email, not per-IP**, so anyone who knows an address can
  lock it for fifteen minutes. That is a deliberate and conventional trade-off,
  not a defect, and it is unchanged by this work — recorded so it is not
  mistaken for an oversight.
