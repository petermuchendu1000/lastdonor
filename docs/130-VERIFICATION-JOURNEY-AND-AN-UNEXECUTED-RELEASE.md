# 130 — The verification journey, and a money release nothing executed

**Date:** 2026-10-28
**Journey:** admin, sub-journey 2 of 10 (verification), after `docs/129` money
**Status:** one gap closed — the lump-sum release is now executed by tests and
was proven end to end through the real admin UI. Three suspected defects were
mine, not the product's.
**Read before** touching `src/db/release-amount.ts`, `approve_t2`, or the
verification queue.

---

## 1. The journey

`/admin/verification`, `/admin/screening`, `/admin/info-requests`, walked at
1440px and 390px signed in as a real admin, with the approval actions
**exercised** against a local throwaway Postgres. No production row was
written.

This is the journey that decides money: `approve_t1` grants
`identity_verified`, which lifts the `docs/101` raise cap; `approve_t2` grants
`fully_verified`, which is the only status `withdraw/route.ts` accepts — and
it **releases money in the same transaction** (`docs/108` refused to let a
third party's word reach it for exactly this reason).

---

## 2. ⛔ The finding: the most consequential money statement was executed by nothing

### 2.1 Understanding

`verification/route.ts` sets `campaigns.total_released_amount` on
`approve_t2`, inside a transaction, under a `FOR UPDATE` lock taken at
`:198-203` with the transition re-validated under that lock at `:208`.

The release figure was an inline `sql` template at `:183-191`.

### 2.2 Evidence

The only test covering it — `verification/route.test.ts` — does
`vi.mock('@/db', …)` at `:158` and then **re-implements the statement in
JavaScript**: it regex-matches the SET expression at `:70`, sums a fake array
at `:78`, and applies `Math.min` when it sees `LEAST` at `:84`.

So it verified the expression's SHAPE and the test's own arithmetic. It could
not verify that Postgres accepts the statement, that `LEAST` clamps as
assumed, or that `campaigns_released_lte_raised` survives it. `docs/124` is
the same lesson from the other side: **a mock cannot raise what only the
database can.** `docs/107` §7 names the gap for admin generally; this is its
most consequential instance.

### 2.3 ⚠️ Root cause, and the falsifier that held

**Falsifier: "then the statement is probably wrong — this is a live money
defect."** Run first, before any conclusion: the expression executed against a
real Postgres across five scenarios.

| scenario | raised | released | expected |
|---|---|---|---|
| 2 real (1000+500) + 1 seed (38000) | 39,500 | **1,500** | 1,500 |
| a refunded real donation | 1,500 | 1,000 | 1,000 |
| seed only | 38,000 | **0** | 0 |
| no donations at all | 0 | 0 | 0 |
| `LEAST` clamp, raised zeroed | 0 | 0 | 0 |

**The falsifier held: the code is correct.** The gap is in the testing, not
the behaviour. Severity is therefore *an untested money path*, not *a wrong
payout* — and saying so is the difference between a real report and an
inflated one.

### 2.4 The fix: relocation, not semantics

The statement moved to `src/db/release-amount.ts` **so a test can run it**.
The route cannot be loaded by the node-environment integration suite — it
imports NextAuth, which imports `next/server` (`docs/126`). Same move and same
reason as `docs/107` (`report-periods.ts`, "SO THAT A TEST COULD RUN IT") and
`docs/126` (`auth-lockout.ts`).

⚠️ A relocation of a money statement is only safe if it is the same statement,
so the rendered SQL is pinned in the test. It renders:

```sql
LEAST(( SELECT COALESCE(SUM("donations"."amount"), 0)::int
        FROM "donations"
        WHERE "donations"."campaign_id" = $2
          AND "donations"."source" = 'real'
          AND "donations"."refunded" = false
      ), "campaigns"."raised_amount")
```

### 2.5 The tests, and what each would have to see to fail

`release-amount.integration.test.ts`, **10 tests** against a real Postgres,
calling the REAL function — a replica would be the `docs/101` trap in test
form, which is precisely what the existing test does wrong.

It asserts the audit-P0 regression (a blended campaign releases the real total
only), the refunded exclusion, a seed-only campaign releasing **nothing**,
`COALESCE` giving 0 rather than NULL (a NULL makes `released <= raised` NULL,
which Postgres treats as satisfied, so the CHECK would not catch it), the
`LEAST` clamp, **cross-campaign leakage**, the **concurrent** case (three
approvals at once leave one correct figure — the expression SETS an absolute
sum rather than incrementing, and an increment here would double a payout),
and a control that it is not simply always zero.

| injection | tests failed |
|---|---|
| release `raised_amount` (**the original audit P0**) | 4 |
| drop `source = 'real'` | 3 |
| drop the refunded filter | 2 |
| drop the `LEAST` clamp | 9 |
| drop `COALESCE` | 2 |
| break the campaign correlation | 1 |
| increment instead of an absolute set | 1 |

Every restore verified clean. The last two fail exactly one test each — the
two written for them.

### 2.6 ✅ Proven end to end through the real UI

Approving through `/admin/verification`'s own menu, on a campaign showing
**$2,500 raised with zero real donations**:

```
PATCH 200 … {"verificationStatus":"identity_verified","action":"approve_t1"}
PATCH 200 … {"verificationStatus":"fully_verified","action":"approve_t2"}

campaign:  raised=250000  released=0
audit:     verification_approve_t2  released=0  blended=250000
```

It released **0**, not 250,000. The audit row carries both figures, which is
what makes the decision checkable afterwards.

Gate: lint clean (0 errors, 1 pre-existing warning), typecheck clean,
**7,711 unit passed / 16 skipped (264 files)**, **301 integration passed
(31 files)** — up from 291/30, which is the ten tests above.

⚠️ The extraction left `sql` and `donations` imported but unused in the route;
lint went 1 → 3 warnings and caught it. Removed. Before removing them I
checked for tests that read that route as TEXT, because this codebase has
several — `test/security/oblique-p9-12.test.ts:70-83` reads exactly this file
and asserts `verificationReviewerId`, an audit log and
`requireRole(['admin'])`. All still present; that file and the route's own
test pass (18/18).

---

## 3. ⚠️ Three things that looked like defects and were mine

Recorded because each cost time and each would have been a false report.

**`/api/v1/admin/verification-documents/<id>` answered HTTP 500** on both
device legs, reproducibly. That is `docs/88` F2's screen, where an admin could
not open any identity document. The server log settles it:
`StorageNotConfiguredError: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must
both be set` — my sandbox sets neither, and the error says of itself "This is
a deployment configuration problem, not a caller error." `docs/88` F2 proved
that path live (302 → 200 `application/pdf`). **Not a defect; unexercised
here.**

**`/admin/verification` showed "0 Pending review"** with a `pending` document
seeded. The queue filters on `verification_status NOT IN
('unverified','verified')` and counts pending as `IN
('documents_uploaded','submitted_for_review')`. Every E2E-fixture campaign is
the `unverified` default, so **0 was correct for my fixture.** The fixture now
puts one campaign in the queue — without which the Approve and Reject controls
never render and the walk measures an empty screen.

**"No approve control on the queue"** — they are `DropdownMenuItem`s
(`VerificationQueue.tsx:510-530`), absent from the DOM until the row menu is
opened. My harness, not the product.

⚠️ **And a correction to my own reasoning.** I suspected the `docs/101`
unqualified-identifier trap here, because this expression interpolates
Columns into a `sql` template. Rendering the SQL showed the columns come out
**qualified** (`"donations"."amount"`), so the trap does not apply and the
existing test's regex matches reality. I should have rendered the SQL before
reasoning about how drizzle emits it.

---

## 4. Also found, minor and not fixed

The row menu labels and the dialog labels differ for the same action: the menu
says **"Approve Identity (T1)"** and **"Approve Full (T2)"**, while
`ACTION_LABELS` (`VerificationQueue.tsx:127-131`) — used for the dialog title
(`:585`), the confirm button (`:647`) and the success toast (`:306`) — says
**"Approve Tier 1 (Identity)"** and **"Approve Tier 2 (Full)"**. Both are
comprehensible and name the same tier. Cosmetic; recorded, not changed.

---

## 5. What was NOT checked

- **No production row was written** and no production verification was
  performed. Every write was against local `ldadmin`.
- **`reject` and `request_info` were not exercised.** Only the two approve
  actions were. `request_info` reaches `notifyInfoRequest` and a deadline
  field, and belongs with `/admin/info-requests`, which was loaded but whose
  write actions were not pressed.
- **The document-open path could not be exercised** (§3), so `docs/88` F2's
  fix rests on its own live verification, not on anything here.
- **`/admin/screening`'s write actions were not pressed.** `docs/106` is
  BUILT, NOT DEPLOYED, and the screening cron was not run.
- **The `FOR UPDATE` lock was not tested under contention through the route.**
  The expression's concurrency is tested directly; the route's lock is not,
  because the integration suite cannot load the route (§2.4).
- **No axe/WCAG run** on any verification screen.
