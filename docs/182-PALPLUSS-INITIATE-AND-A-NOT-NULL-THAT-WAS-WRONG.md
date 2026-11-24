# 182 — The Palpluss initiate route, and a NOT NULL that was wrong the next day

**Date:** 2026-11-24
**Status:** BUILT, NOT ROUTED. Nothing calls it until a currency names
`gateway: 'palpluss'`, which is still an owner action (`docs/180` §7).
**Supersedes:** the `NOT NULL` decision in `docs/181` / `schema.ts`.
**Read with:** `docs/180` (the rail, probed), `docs/181` (the settlement),
`docs/92` and `docs/168` (money, currency, presentment vs settlement),
`docs/158`–`docs/162` (what a payment route may claim).

---

## 1. What was asked, and what it turned out to need

"Build the initiate route." `docs/181` §6 had already listed what it needs:
`quoteCharge`, `checkRaiseCap` before the push, and a per-phone guard
respecting `MIN_PUSH_INTERVAL_MS` rather than PayHero's cooldown. All three
are here.

It also said, in one clause: *"and it must obtain the transaction id before
inserting, because the column is NOT NULL."*

**That clause is the finding.** Writing the route is what showed the column was
wrong, and the ordering it forced is the one thing PayHero's route explicitly
argues against.

---

## 2. ⛔ THE CORRECTION: `palpluss_transaction_id` is nullable

`migrations-v2/0015_palpluss_tx_id_nullable.sql`, one statement:

```sql
ALTER TABLE "palpluss_payment_requests"
  ALTER COLUMN "palpluss_transaction_id" DROP NOT NULL;
```

### 2.1 Why NOT NULL forces the wrong order

Palpluss mints that id. A `NOT NULL` column therefore makes the API call
happen **before** the row can exist. Compare the two windows:

| ordering | what a crash in the window leaves | recoverable? |
|---|---|---|
| **call → insert** (forced by NOT NULL) | nothing at all | **no** |
| **insert → call → update** | a row holding the campaign, the donor, the amount, the quote and our `LD-` reference, with no gateway id | **yes** |

In the first row, the donor's money may have been collected and the platform
has no record of who it was for, which campaign, or what the credit should be.
The Palpluss ledger would show `LD-XXXXXXXXX` SUCCESS for some number of
shillings and nothing could turn that into a donation.

`payhero/initiate/route.ts` makes exactly this argument in its own header,
and inverts it for its own rail:

> The row is inserted BEFORE the API call, then updated with PayHero's
> reference. […] if the process dies between the call and the write, a row
> with no `payhero_reference` is a visible loose end that reconciliation can
> find. The other order — call first, write after — loses the reference
> entirely on the same crash […] A payment nobody can look up is strictly
> worse than a row nobody has finished.

### 2.2 Why the `docs/158` argument did not transfer

`docs/181` justified `NOT NULL` like this:

> `payhero_payment_requests.payhero_reference` is nullable and `docs/158` is
> the whole story of what that nullability cost: a row with no reference is
> exactly what a lost response leaves behind, and nothing can later establish
> whether money moved.

The first half is true. The second half is true **of PayHero**, and it is what
makes the generalisation wrong: that rail's status endpoint 404s our own
`external_reference` and offers no list, so a reference-less PayHero row really
is unverifiable forever.

Palpluss is different, and this was probed rather than assumed.
[VERIFIED 2026-11-24, read-only, from the sandbox]

```
GET /v1/transactions            200  data.items ARRAY[20]
GET /v1/transactions?limit=2    200  data.items ARRAY[2]
```

Every row carries `external_reference` among its fields:

```
amount, callback_url, channel_id, created_at, currency, customer_name,
external_reference, phone_number, provider, provider_checkout_id,
provider_request_id, result_code, result_desc, status, tenant_id,
transaction_fee, transaction_id, type, updated_at
```

So on this rail **our own reference leads back to the transaction**, which is
why `account_reference` is `UNIQUE`: that mapping has to be one-to-one for the
recovery to mean anything.

⚠️ **There is no server-side filter on it**, and that was measured rather than
hoped for. `?externalReference=`, `?external_reference=` and
`?accountReference=` each returned the full 20 rows — identical to a
**fabricated-parameter control** — while `?limit=2` really did return two. So
"the filter is ignored" is distinguishable from "all parameters are ignored",
and recovery means paging the ledger, not a lookup. That is still the
difference between recoverable and lost.

⛔ The tenant may be shared with two other products (`docs/180` §3), so those
20 rows are real third-party customers' payments. The probe printed field
NAMES, row counts and HTTP statuses only — never a value.

### 2.3 What is unchanged

The `UNIQUE` index stays. It is the key the callback resolves by and the
boundary that stops another product's transaction id matching a row of ours
(`docs/181`). Only the obligation to have one at insert time is gone.

---

## 3. The route

`POST /api/v1/donations/palpluss/initiate`. Deliberately the twin of the
PayHero route: the shapes `docs/92`, `docs/101`, `docs/158`, `docs/168` and
`docs/121` arrived at were each paid for by a defect, and re-deriving them here
would be re-paying.

Order, and every step before the push can refuse for free:

1. key present → else 503, told to the donor as our problem (`docs/72`)
2. **a currency routes to this rail at all** → else 503 (see §4)
3. body parsed by `initiateMpesaSchema`
4. campaign looked up, with `realRaisedMinorSql` (`docs/101`)
5. the campaign's currency decides the CREDIT; `checkDonationAmount`
6. **`checkRaiseCap`** → 409 (`docs/101`)
7. **`quoteCharge`** → credit in the campaign's currency, charge in KES
   (`docs/168`); a stale rate REFUSES
8. the CHARGE checked against the rail's own bounds
9. phone normalised through `toPalplussMsisdn`
10. **`checkPhoneAbuseGuard(phone, 'palpluss')`** → 429 (see §5)
11. share attribution, never allowed to stop a payment (`docs/57`)
12. **`mintAccountReference()`**, then **INSERT**
13. `initiateStkPush`
14. **UPDATE** with the gateway's transaction id

A 200 means a prompt was queued. It does not mean money moved, and no donation
is recorded here — `docs/180` measured Palpluss answering `success: true` with
`resultCode: "0"` on a transaction that settled FAILED twenty-nine seconds
later.

### 3.1 The reference is 45 bits, and that is forced

`accountReference` is documented as 12 characters, so `LD-` leaves nine.
`ACCOUNT_REFERENCE_RANDOM_CHARS` is derived from `MAX_ACCOUNT_REFERENCE`
rather than written as `9`.

Nine base32 characters is **45 bits**, where PayHero's `LD-<uuid>` carries 122.
Base32 because 256 is an exact multiple of 32, so `byte & 31` is uniform — a
modulo over a 36-character alphabet would bias the first four letters, which is
a silly way to lose entropy from a value this short.

⛔ Which is why the gateway's transaction id stays server-side and **our**
reference is what the route returns. A future status poll resolves it against a
row we wrote, so a caller can only ask about its own payment; and 10^14
attempts is unreachable behind a 5-per-minute bucket. The rule to keep: this
reference must never become the key to anything that could be read by guessing.
`src/lib/validators/payhero.ts` states the same principle for the other rail.

### 3.2 `globalThis.crypto`, not `node:crypto`

`palpluss.ts` holds constants the donor's browser may yet need
(`MIN_PUSH_INTERVAL_MS`, the way `PROMPT_LIFETIME_MS` was needed — `docs/159`
§7, `docs/139` §7). A node builtin import would make the module unimportable
there, for a function the browser will never call.

---

## 4. `palplussChargeCurrency()` returns null, and that is today's answer

`payHeroChargeCurrency()` **throws** unless exactly one currency names its
gateway. That is right there — exactly one always has, so zero means the
currency table is broken. It is wrong here: **no currency names
`gateway: 'palpluss'` yet**, so zero is the live state and has to be a branch a
route can answer, not an exception it cannot tell from a real fault.

⛔ Not hardcoded to `'KES'`. What a rail charges is a fact about the currency
table, and `docs/136` §7 is about the one sentence in a module that was written
as prose rather than derived, and became false the day the thing started
working.

So the route's second check is "is anything routed to this rail", and it
answers 503 with an operator log. The integration test asserts that branch
**with the real function's answer**, so it is a measured state rather than an
assumption about an unreachable one.

---

## 5. ⛔ The abuse guard now counts BOTH rails, and not doing so would have
halved it

`src/lib/payhero-abuse-guard.ts` is now **`src/lib/mpesa-abuse-guard.ts`**.

The module's own header has always said the protected party is the phone
number. Per-rail counting silently **doubles** every ceiling in it the moment a
second rail exists: five pushes through PayHero and five through Palpluss is
ten prompts on one handset, which is the number that gets its owner blocked by
PayHero for 24 hours. Nothing would have failed. A control written to protect a
bystander would simply have halved in strength because of work in another file
— `docs/83` and `docs/121`'s shape.

So:

- the latest attempt is the newest **across both tables**
- `MAX_PUSHES_PER_NUMBER_PER_HOUR` counts **both**, which is a tightening and
  is the number the constant always claimed to be
- `checkPhoneAbuseGuard(phone, rail)` takes the rail as a **required**
  parameter, so `tsc` named every call site. A default would have been
  invisible at the call site, which is `docs/125`'s finding exactly.

### 5.1 The cooldown is per rail, and that is not a style choice

`cooldownMsFor(rail)`: PayHero 20s, Palpluss `MIN_PUSH_INTERVAL_MS` (60s).

Palpluss throttles at **two pushes per phone per minute** and reports a refusal
as `result_code: "17"` ("Rule limited.") rather than an HTTP error
(`docs/180` finding 6). PayHero's 20s permits three a minute — correct for
PayHero, and here it would let a donor's third tap be silently swallowed while
this platform believed it had sent a prompt. `palpluss.ts` already carried that
warning; this is it enforced.

The test asserts the **difference** with the same history in both arms, so a
single shared cooldown cannot satisfy it whichever value were chosen.

### 5.2 Four queries, not a UNION

Two rails x two rules, run sequentially. The pool is `max: 5` and the cap is
three **concurrent** (`docs/87`), which sequential queries never approach.

⛔ Deliberately **not** collapsed into a `UNION ALL`, which would halve the
round trips: the two `status` columns are different Postgres enum types, so a
union needs a cast, and a cast means a `sql` template on a money path.
`docs/101` (an unqualified identifier that made a cap silently never fire) and
`docs/107` (a bare `Date` that 500'd every load of a page) are both exactly
that, and neither was visible to anything but a real database. Two typed
queries and a comparison in TypeScript cannot have either defect.

---

## 6. ⛔ REPORTED, NOT FIXED: flipping a currency to Palpluss breaks every
donate page

This is the first thing to do before the owner's next step.

`src/app/campaigns/[slug]/donate/page.tsx:208` calls
`payHeroChargeCurrency()` **unconditionally** — not inside a branch keyed on
the campaign's rail — for every campaign on every load. That function throws
when no currency names `gateway: 'payhero'`.

So the moment `KES` moves to `gateway: 'palpluss'`, it finds zero and throws
during render. A throw in a server component is not a 500: it renders the
**error boundary inside a 200** (`docs/88` F9's shape, which a status-code
sweep cannot see), on the public donate page of **every live campaign at
once**. `payhero/initiate/route.ts:204` has the same call, where it would
surface as a 500.

### 6.1 Why it is not fixed here

The fix is not mechanical. It means deciding what that page shows when no rail
routes to a campaign's currency, which is a product question on the busiest
money surface — and that surface has no behavioural test. Doing it as a side
effect of this change is how a donate page breaks quietly.

### 6.2 What was done instead

`src/app/campaigns/[slug]/donate/charge-currency-premise.test.ts` turns the
runtime error boundary into a **build failure that names the remedy**. It costs
nothing today and cannot be walked into by accident.

It checks its own premise, so it relaxes rather than obstructs: if somebody
makes that page tolerate a missing charge currency, they will stop calling the
throwing derivation, rule 1 stops holding, and the file says so. `docs/127` and
`docs/148` §B.5 are the same shape.

⚠️ Injection **R18** flips `KES` to `gateway: 'palpluss'` — the owner's actual
next step — and the tripwire fires. That is the only evidence worth having
here.

---

## 7. Two gaps found while wiring the tiers

### 7.1 The Palpluss callback had no rate-limit tier

Shipped in `docs/181` with no entry in `rate-limit.ts`, so it fell through to
the `donations` tier: **10 per 60 s, keyed by IP**, and every Palpluss callback
arrives from Palpluss. Ten settlements a minute across the whole platform,
after which the provider's retries would be 429'd and settlements silently
deferred. `payhero_callback` has had 60/60 s from the start for exactly this
reason; nothing made the second one inherit it.

Now `palpluss_callback` (60/60 s) and `palpluss_initiate` (5/60 s), both before
the `/api/v1/donations` line — a prefix match is first-wins and a more specific
tier placed after a general one never fires (`docs/85`).

### 7.2 ⚠️ The in-memory fallback had NONE of the five M-Pesa paths

`ROUTE_LIMITS` — the table used when Upstash is unreachable — listed none of
them, and its catch-all is **100 per 60 s**. So whenever Redis is down the
deliberately tight 5/60 s initiate bucket became **twenty times looser**, and
`status`'s deliberately generous 120 became tighter. Production health has
reported `redis: error`, so this table is not hypothetical.

The blast radius is bounded and that is by design, not luck: the outer IP bound
was never the real control on `initiate`. The per-number guard is, and it is in
the database precisely because Upstash is best-effort here. But a fallback that
contradicts the tier it stands in for is not a fallback. All five are now
listed.

---

## 8. A rule that named one file

`src/app/api/v1/donations/payment-outcome-claims.test.ts` is the `docs/158`
rule: a payment refusal may only say "nothing has been charged" when we know
it. It read **one hardcoded path**.

The new route carries the identical four-kind copy down to the sentence, and
that rule would have gone green against it **without ever reading it** —
`docs/116` §4 exactly, where a review gate named two files and the third
insert published unreviewed campaigns in production; `docs/134`'s sweep for the
same reason; `docs/110` §9.2's rule that a third instance means a sweep.

It now **discovers** `**/initiate/route.ts` from disk and matches each to the
classifier **it imports**, executing that classifier on a real no-response
error. A route importing no classifier fails. A rail absent from the registry
fails. The registry is checked against the filesystem rather than the other way
round, which is what makes a third rail impossible to add silently.

### 8.1 ⚠️ And then it fired on correct code

The generalised rule immediately failed the new route's `configuration` branch
for having no reassurance in it. The route **does** reassure — it hoists the
sentence into one constant, because three separate refusals use it and four
near-identical promises about somebody's money is `docs/152`'s defect (a refund
paragraph fifty lines from the sentence that corrected it).

A rule that reads a branch as text sees `OUR_SIDE` and finds nothing. Left
alone it would have reported honest copy as missing and, worse, **pressured the
next author to duplicate donor-facing money copy in order to satisfy a test.**

So `expandStringConsts` inlines module-level string constants before matching.
Deliberately narrow: `const NAME = <string literals joined by +>;` at the start
of a line, whole-word occurrences only.

⛔ With an anti-vacuity control, because the "does NOT claim it" rule passes
trivially if the expander silently stops working. Injection **R11** makes it a
no-op and the control fires.

---

## 9. Verification

### 9.1 What was executed, not read

⚠️ **`docs/126` reads as if this were impossible**, and it is narrower than it
says. That doc states the node-environment integration suite "CANNOT LOAD"
`next/server`. The finding there was true of **NextAuth**, which imports it.
Measured 2026-11-24: a route handler importing `next/server` alone loads in
that suite fine. This route is public (`src/middleware.ts`), so it touches no
NextAuth — which is what makes it reachable.

That matters because `docs/107` §7 records that no route's data query is
executed by anything, and the PayHero twin has **no behavioural test at all**.
So `route.integration.test.ts` runs the real thing against a real Postgres: the
campaign lookup, `realRaisedMinorSql`, the cap, the FX snapshot read, the
per-phone guard, the insert, **the composite FK**, the update and the audit row.
`docs/124` §5.1 is the standing reason — a mock cannot raise a foreign-key or
NOT NULL violation, and two erasure routes shipped broken under exactly that
kind of green test.

Only two things are stubbed: `initiateStkPush` (it would ring a real handset)
and `palplussChargeCurrency` (null until an owner action, so the happy path is
otherwise unreachable and would ship untested on the day it becomes reachable).

**The ordering in §2 is proven by execution rather than by reading the file in
order**: the stub queries `palpluss_payment_requests` at the moment the gateway
would have been reached, and sees a durable `pending` row with
`palpluss_transaction_id` NULL and the donor's details on it. That is the only
way to observe what is durable at that instant.

### 9.2 Counts

| suite | result |
|---|---|
| typecheck | clean |
| lint | clean (one pre-existing warning in `review-gate.test.ts`) |
| unit | **8733 passed / 16 skipped**, 316 files passed + 3 skipped = 319 |
| integration | **375 passed**, 37 files |

Both deltas are reconciled to the test, against HEAD measured in a git
worktree. `docs/89` is explicit that an unexplained count delta is how 80
silently-skipped tests hid behind "5898 passed", so neither was waved through.

Integration: 353 → 375 and 36 → 37 files, which is exactly this change's one
new file.

Unit: 8673 → 8733, **+60**, of which my own four files are **+44**:

| delta | file |
|---|---|
| +25 | `src/lib/palpluss.test.ts` |
| +9 | `src/lib/mpesa-abuse-guard.test.ts` |
| +6 | `payment-outcome-claims.test.ts` |
| +4 | `charge-currency-premise.test.ts` (new) |
| **+11** | `test/security/api-response-audit.test.ts` |
| **+4** | `raise-cap.ratchet.test.ts` |
| **+1** | `public-campaigns.ratchet.test.ts` |

⚠️ The remaining **+16 are three EXISTING sweeps growing because they
discovered the new route by themselves**, which is the useful part of doing
this arithmetic: it is positive evidence that the route is being swept rather
than merely added. `raise-cap.ratchet` has four `it.each` blocks over
discovered money-in routes; `api-response-audit` discovers API routes from
`src/app/api` and added eleven assertions about this one.

⚠️ My first attempt to find that balance searched only `src/` for
discovery-driven test files and came up **5 of 16 short**, which read as
though something unexplained remained — the missing sweep lives in `test/`.
The per-file diff of two `--reporter=json` runs is the measurement that cannot
miss one.

### 9.3 Fixture defects, recorded because each read as a code defect first

- `payhero_payment_requests.channel_id` is **NOT NULL** and an `integer`, where
  this rail's is nullable `text`. Omitting it failed my fixture insert and
  read as the route being broken. `docs/128` §6's class: a fixture Postgres
  refuses is not evidence about the code.

### 9.4 Injections — 21 rows, all behaving

Every anchor was verified to occur **exactly once** before any row ran, the
harness refuses to score a row whose file sha did not change (`docs/152`: an
injection that did not apply reports exactly like a rule with a hole), and the
restore is **sha256-verified after every row** — `docs/120` §11.1,
`docs/155` §5.2 and `docs/159` §5.1 are three separate runs ruined by a
polluted baseline.

| row | mutation | verdict |
|---|---|---|
| R1 | the insert pre-sets the gateway id — **the shape `NOT NULL` forced** | FIRED (2) |
| R2 | the row is inserted already settled, not `pending` | FIRED (1) |
| R3 | the raise cap is computed and not acted on | FIRED (1) |
| R4 | the raise-cap import is removed | FIRED (1) |
| R5 | the FX quote is not persisted on the row | FIRED (1) |
| R6 | the route is dropped from the FX importer allowlist | FIRED (1) |
| R7 | the route is dropped from the eligibility allowlist | FIRED (2) |
| R8 | the middleware public entry is removed | FIRED (1) |
| R9 | the `unknown` branch claims nothing was charged | FIRED (1) |
| R10 | the `configuration` branch loses its reassurance | FIRED (1) |
| R11 | `expandStringConsts` becomes a no-op | FIRED (2) |
| R12 | one cooldown shared by both rails | FIRED (2) |
| R13 | the hourly ceiling counts one rail only — **the halving** | FIRED (1) |
| R14 | `newerAttempt` ignores the second rail | FIRED (2) |
| R15 | the reference is not random | FIRED (2) |
| R16 | a timeout is classified as `transient` | FIRED (4) |
| R17 | the charge currency guesses instead of refusing | FIRED (1) |
| **R18** | **`KES` flipped to `gateway: 'palpluss'` — the owner's next step** | **FIRED (1)** |
| R19 | the settlement drops its null-tx-id guard (typecheck) | FIRED (1) |
| R20 | MUST PASS: a comment-only edit to the route | did not fire |
| R21 | MUST PASS: the operator log copy is reworded | did not fire |

R20 and R21 are the half that matters as much as the other nineteen: the rules
check behaviour, not today's prose. R21 reworks an operator-facing log line
that four tests sit next to without asserting.

⚠️ **R1 is the production state of `docs/181` in effect**, and R18 is the
configuration change this rail is waiting for. Those two are the rows worth
re-running if any of this is revisited.

---

## 10. What is still not built

- ⛔ **The status poll.** `docs/159` is the reason it matters: nothing sweeps
  `palpluss_payment_requests`, so the donor's own poll is the only path by
  which a late settlement is discovered. The settlement already handles a row
  with no transaction id (`unverifiable`, §2), which is the state that poll
  would be the first caller to reach.
- ⛔ **Any UI.** No screen calls this route, because no currency routes to the
  rail. `docs/147` is the shape the donate page would need.
- ⛔ **A float monitor.** The service wallet is prepaid and a request debits
  it; an empty one refuses collection before Safaricom is reached. The route
  classifies that as `configuration` so a donor is not told to retry, but
  nothing watches the balance. `docs/150` is the shape one would take, and its
  own amendment is the warning worth re-reading first: a cooldown must be
  anchored on an event that happens only when an alert is actually sent.
- ⛔ **B2C payouts.** Money has never left this platform on any rail
  (`docs/113`).
- Owner actions, unchanged from `docs/180` §7: create the LastDonor Palpluss
  tenant, register `lastdonor.org` as a webhook domain so callbacks are
  signed, and decide whether KES routes here — **after** §6.

### 10.1 Cosmetic debt

Drizzle's auto-generated name for the `share_link_id` foreign key truncates at
Postgres's 63-character identifier limit
(`palpluss_payment_requests_share_link_id_campaign_share_links_id`), which
emits a `NOTICE` during migration. `payhero_payment_requests` has the same.
It is a name, not a semantic, and renaming it is a migration on a money table
for nothing.
