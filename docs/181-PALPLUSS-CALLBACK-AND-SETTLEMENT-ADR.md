# 181 — The Palpluss callback and settlement

**Status:** BUILT AND TESTED. **Still not routed, and still not reachable:**
no currency names `gateway: 'palpluss'`, and **nothing writes a row** for
this settlement to settle, because the initiate route is deliberately not
part of this change.

**Date:** 2026-11-24

---

## 1. What was decided

Three of the six items `docs/180` §7 left open:

| Built | File |
|---|---|
| The requests table | `palpluss_payment_requests` + `palpluss_request_status` (`migrations-v2/0014`) |
| The settlement path | `src/lib/services/palpluss-settlement.ts` |
| The callback route | `src/app/api/v1/donations/palpluss/callback/route.ts` |

Not built, and not started: the **initiate** route, the **float monitor**,
the **per-phone guard** wired to `MIN_PUSH_INTERVAL_MS`, and **B2C payouts**.

⛔ **So the loop is half-open, on purpose, and the half that is missing is
the half that creates rows.** Settlement is exercised by 23 integration tests
against real Postgres with hand-seeded rows — which is how `docs/162`
verified PayHero's terminal-row branch — but no donor can reach it. Anyone
picking this up next should build initiate, and §6 says what that costs.

⚠️ One happy accident worth knowing: when that route is written, the raise-cap
ratchet (`raise-cap.ratchet.test.ts`) will catch it automatically without
being edited, because it discovers money-in routes by searching for
`initiateStkPush(` and this client's function has the same name as PayHero's.

---

## 2. The settlement is PayHero's twin, deliberately

`payhero-settlement.ts` encodes five defects that were each paid for:
`docs/92` (a blank reference reads another merchant's transaction), `docs/158`
("nothing has been charged" said on the one branch that cannot know),
`docs/159` (a poll with no stop condition), `docs/160` (`unverifiable`
reported as `failed`) and `docs/162` (a donation lookup read and discarded).

Re-deriving those here would be re-paying for them, so the shapes are copied
and the comments say which doc each one is from. What follows is only what
**differs**.

### 2.1 The lookup key is THEIRS, not ours

PayHero's settlement takes our own `LD-…` reference. This one cannot:
[VERIFIED 2026-11-24, `docs/180`] `GET /v1/transactions/{id}` accepts only
Palpluss's own UUID, and our `accountReference` is not a lookup key there.

So the row is found by `palpluss_transaction_id`, which is **UNIQUE**:

- **Unique**, because it is the key a callback resolves by.

> ⚠️ **AMENDED 2026-11-24 by `docs/182` §2: this section also said NOT NULL,
> and that was wrong.** The column is now nullable; `migrations-v2/0015` drops
> the constraint. The paragraph below is kept as written so the reasoning can
> be read against the correction.
>
> > **Not null**, which is where it diverges from
> > `payhero_payment_requests.payhero_reference` — and `docs/158` is the whole
> > story of what that nullability cost. A row with no gateway reference is
> > exactly what a lost response leaves behind, and nothing can later
> > establish whether money moved. Making the column `NOT NULL` means initiate
> > must obtain the id before it writes anything, which is the honest
> > ordering.
>
> Two things were wrong with it. The `docs/158` argument is **PayHero's**:
> that rail's status endpoint 404s our own reference and offers no list, so a
> reference-less row there really is unverifiable forever. Palpluss has a list
> endpoint carrying `external_reference` on every row
> ([VERIFIED 2026-11-24]), so here the reference leads back to the
> transaction. And calling the forced ordering "honest" had it backwards:
> because Palpluss mints the id, NOT NULL forces **call → insert**, and a
> crash in that window leaves no row at all — no campaign, no donor, no
> amount, no quote — for a collection that may already have succeeded.

That column is also the isolation boundary. The tenant is shared with
`invest254` and `printpesa` (`docs/180` §3), and one of their transaction ids
matches no row of ours and is refused **before any network call** — so a
forged callback cannot even make us look up a stranger's payment.

### 2.2 Seven statuses, and a pure function to collapse them

PayHero documents three statuses; Palpluss documents seven. The judgement
lives in `classifyPalplussStatus`, a **pure function**, for the reason
`docs/162` §5.1 established by injection: *text cannot see which way a branch
points*, so a structural rule passed against a settlement whose condition had
been inverted. `docs/157` §4.1 fixed the same class the same way. The whole of
"is this money" is therefore one function, and 38 unit tests drive it.

| Palpluss | Class | Why |
|---|---|---|
| `PENDING`, `PROCESSING` | `pending` | not over |
| `SUCCESS` | `success` | the only value that books a donation |
| `FAILED`, `CANCELLED`, `EXPIRED` | `failed` | over, no money moved |
| `REVERSED` | **`reversed`** | money moved and came BACK |
| anything else | `unrecognised` | left pending, never an outcome |

⛔ **`REVERSED` is not folded into `failed`, and the pressure to fold it is
real** — both decline to book, and a donor sees no difference. What differs is
the RECORD: a reversal is a movement on the service account, and the day it
arrives for a collection already booked it is a refund nobody asked us for.
Merging them files that under "the payment did not go through" and loses it.
It gets its own audit event at `error`, where a plain failure is `info`.

⚠️ [UNVERIFIED by execution] no `REVERSED` has ever been seen on this tenant —
the 50 ledger rows are SUCCESS and FAILED only. It is in the published enum,
so it is handled rather than guessed at.

⛔ **An unrecognised status is NOT a failure.** Reading it as one marks a
payment dead the day Palpluss adds a value; the row stays pending so a later
read can resolve it, and the event is logged so somebody finds out.

### 2.3 A soundness hole in my own client, closed

`docs/180`'s client read the status as
`asString(...) as PalplussStatus` — a **cast**, which is a lie at the type
level: an unrecognised status compiled as a known one and would have been read
as whatever the fallback was. `TransactionSnapshot` now carries **`rawStatus`**
beside the narrowed `status`, and the settlement classifies the raw string.

⚠️ The narrowed field is kept for display and its doc comment says outright
not to branch a settlement on it, because it cannot represent "a value we do
not recognise" — an unknown status lands there indistinguishable from a
genuine `PENDING`. Injection 18 proves the distinction bites: pointing the
classifier at `status` instead of `rawStatus` fails 12 of 23 tests.

### 2.4 Three values in the status enum, not seven

`palpluss_request_status` is `pending | succeeded | failed`. It is **our
settlement lifecycle, not a mirror of Palpluss's vocabulary** — what the
collapse loses is kept in `failure_reason` as words.

⚠️ No `abandoned`. `payhero_request_status` carries one and [VERIFIED by
`docs/129`] nothing has ever written it, which left an organiser three filter
options that can never match. An enum value you do not write is a migration on
a live money table that buys nothing.

---

## 3. The callback: signed, and still not believed

Palpluss signs its callbacks (Standard Webhooks), which PayHero does not. The
route verifies — and still refuses to read the outcome from the body.

⛔ **A signature authenticates the SENDER, not the OUTCOME.** `docs/180`
measured Palpluss itself answering `success: true` with `resultCode: "0"` on a
transaction that settled `FAILED` twenty-nine seconds later. A body saying
SUCCESS is not evidence a donor paid, whoever sent it. So
`callbackTransactionId` returns the id and deliberately nothing else, and the
outcome comes from re-reading the transaction. `docs/81`'s shape, third
instance after Didit and PayHero.

### 3.1 Why unsigned is processed and invalid is refused

These are different states and conflating them breaks the route in one
direction or the other:

| Verdict | Meaning | Action |
|---|---|---|
| `unsigned` | no signature headers at all — the delivery domain is not registered in the Palpluss console | **processed**, logged at warn |
| `invalid` | headers present and wrong | **401, before any lookup** |
| `valid` | verified | processed |

Signing is configured **per domain**, and `lastdonor.org` is not registered on
the LastDonor tenant yet (`docs/180` §7, owner action) — so **today every
callback arrives unsigned**. Requiring a signature would refuse all of them.
Accepting a bad one would accept forgeries forever.

⚠️ Injection 20 is the one that makes this concrete: changing the refusal from
`verdict.kind === 'invalid'` to `verdict.kind !== 'valid'` — which reads like
tightening security — fails the test that pins today's real traffic.

It is survivable only because the body is not believed. Injection 21 plants
exactly the plausible shortcut (trust `transaction.status` when it says
SUCCESS, skip the lookup) and fails 7 tests.

### 3.2 The raw bytes

The route reads `await request.text()` and verifies over that. A
parse-then-restringify re-orders keys and drops whitespace, so the digest
would cover a different document and **every** verification would fail — with
nothing to see but a steady stream of refusals indistinguishable from an
attack. A test signs a body whose formatting a round-trip provably changes,
and asserts the fixture discriminates before relying on it.

### 3.3 Status codes

200 to almost everything, because Palpluss retries five times (10s, 30s, 1m,
2m) on non-2xx and a retry cannot turn a foreign transaction id into one of
ours. 5xx only where a retry has something to accomplish: an unset API key
(503) or a failed status read (500).

⚠️ `UNAUTHORIZED`/401 for a bad signature, where the Standard Webhooks
guidance suggests 400. Both are non-2xx and retried identically, so the choice
is only about what a log reader sees — and the `ApiError` union is
deliberately closed, so an `INVALID_SIGNATURE` member would be a second word
for a case it already has.

⚠️ The route must answer within **8 seconds** or Palpluss treats it as failed.
One status read fits; anything slower added here turns every callback into
five.

---

## 4. Verification

- **38 unit tests** — the classifier, and the route with its gateway stubbed.
- **23 integration tests against real Postgres**, because `docs/124` §5.1's
  rule is that a mock cannot refuse an insert for a reason of its own, cannot
  raise a foreign-key violation, and cannot lose a race. Only the gateway is
  stubbed.
- **Migration applied** to a throwaway Postgres 16 and read back: the table
  exists, `payment_provider` is `stripe payhero palpluss`,
  `palpluss_request_status` is `pending succeeded failed`.
- **26 injections, all behaving** — 24 fire, 2 MUST-PASS hold (a comment-only
  edit and a change to donor-facing wording, so the rules check properties and
  not today's copy). sha256-verified clean restore after every row.
- Gate: lint clean (one pre-existing warning elsewhere), typecheck clean,
  **8673 unit tests / 318 files**, **353 integration tests / 36 files** — the
  latter being CLAUDE.md's 330/35 plus exactly this change's 23 and 1, so
  nothing is silently skipped (`docs/89`).

### 4.1 `ALTER TYPE … ADD VALUE` in a transaction

Adding `'palpluss'` to `payment_provider` is an `ALTER TYPE … ADD VALUE`, and
drizzle wraps migrations in a transaction. Postgres permits adding a value
inside one but **not using it in the same transaction**. This migration only
adds it — nothing inserts a row with it — so it is fine, and that was
established by **running it**, not by reasoning about it.

### 4.2 Two real holes in my own tests, found by injection

**Row 12 — the CHARGE/CREDIT distinction was untested.** Every fixture was
same-currency (a KES campaign charged in KES), where charge and credit are the
same number — so swapping `creditedAmountMinor`/`creditedCurrency` for
`amount`/`currency` changed nothing and **passed**. That is `docs/168`'s
entire subject, untested by 21 green tests. Closed with a cross-currency case
using the real figures from `docs/168`'s first live cross-currency donation:
KES 650.00 charged, $5.00 credited, ~130 KES/USD.

**Row 17 — the lost-race path was unreachable.** `alreadySettled()` runs only
when a competing caller claims the row while we await the status read, and the
two-concurrent-callers test does not reliably produce it — so an injection
returning the **stale** local `request.donationId` instead of re-reading
passed. The window is real: `request` was read while the row was still
pending, so its `donationId` is null by definition, and reporting that says
"collected but not recorded" about a donation that exists — `docs/162`'s false
claim with its sign flipped. Forced deterministically by having the gateway
stub do what the winner would have done, which is exactly when it happens in
production.

⚠️ Two further rows misbehaved for reasons that were **mine, not the code's**:
row 16 targeted a `details` field when the property under test was `severity`,
and row 25's anchor contained backticks the shell ate. Both corrected and
re-run. A harness that scores a row whose file sha did not change reports a
hole where there is none (`docs/152` §5), so this one refuses to.

### 4.3 A contradiction inside one test file

My classifier tests listed `'success'` (lower case) as *unrecognised* in one
table while a second table asserted `'success' → success`. One file, both
halves of a contradiction — `docs/109`'s lesson (*"nothing compares two
assertions to each other"*), caught here only because both were in the same
run. **The code was right:** case is normalised on purpose, because the one
thing worse than an unrecognised status is a recognised one misread as
unrecognised, which leaves a settled payment pending forever.

### 4.4 A fixture value I invented, refused by Postgres

The lost-race test seeds a donation directly, and my first attempt wrote
`phaseAtTime: 'active'` — not a member of `donation_phase`. Postgres refused
it and the failure read like a defect in the settlement. `docs/128` §6's class
exactly; the value is now read out of the live enum
(`first_believers | the_push | closing_in | last_donor_zone`).

### 4.5 `clearDatabase` reaches the new table, and that is checked

`test/helpers.ts` does not NAME `palpluss_payment_requests`; it relies on
`TRUNCATE campaigns … CASCADE` reaching it through the FK, exactly as it does
for `payhero_payment_requests`. That is reasoning, and the
fixture-cleanup omission is a class `docs/121`, `docs/123`, `docs/139` and
`docs/157` each met — so there is a test for it, and Postgres prints
`truncate cascades to table "palpluss_payment_requests"` on every run.

---

## 5. Rejected alternatives

**Resolve the callback by our own `LD-…` reference.** The body carries
`external_reference`, so it looks available. Rejected: the status endpoint
cannot be called with it, so a row found that way would still need the
Palpluss id to verify anything — and the id is what the unique index and the
isolation boundary are built on.

**Reuse `payhero_request_status`.** Same three values today. Rejected: the
enum is named for the other rail, and sharing it would couple two money
lifecycles that have already diverged once (`docs/168` moved PayHero's
composite FK and not this one).

**Share one settlement module across both rails.** Tempting — the shapes are
near-identical. Rejected: the two gateways disagree about the lookup key, the
status vocabulary, the error envelope and the field casing, so the shared
function would be mostly branching on which rail it was called for. The twin
is duplicated prose, not duplicated decisions.

**Require a signature.** Would refuse every real delivery today (§3.1).

**Add `'palpluss'` to `GatewayCharge.provider` as a third literal.** Rejected
in favour of `(typeof paymentProviderEnum.enumValues)[number]`, so the
database enum is the single source and `tsc` enumerates call sites rather than
a second hand-written list drifting (`docs/144`).

---

## 6. Still open

- ⛔ **The initiate route.** Nothing writes a row, so nothing reaches this
  settlement. It needs: `quoteCharge` (`docs/168`), `checkRaiseCap` before the
  push (`docs/101`, and the ratchet will demand it), a per-phone guard
  respecting `MIN_PUSH_INTERVAL_MS` — **not** PayHero's `RETRY_COOLDOWN_MS`,
  which permits three pushes a minute where Palpluss allows two — and it must
  obtain the transaction id before inserting, because the column is NOT NULL.
  ✅ **BUILT 2026-11-24, `docs/182`.** The first three were right; ⚠️ the last
  clause was the finding — writing the route is what showed the `NOT NULL` was
  wrong, and the route now inserts FIRST (see §2.1's amendment above). The
  per-phone guard also had to grow to count BOTH rails, or adding this route
  would have doubled every per-number ceiling (`docs/182` §5).
- ⛔ **OWNER:** the LastDonor Palpluss tenant, and registering
  `lastdonor.org` as a webhook domain so deliveries are signed (`docs/180`
  §7). Until then `PALPLUSS_WEBHOOK_SECRET` is a secret for a signature
  nobody sends.
- ⛔ **OWNER:** whether KES routes here at all.
- No float monitor for this rail; the fee is prepaid and an empty wallet
  refuses collection before Safaricom is reached (`docs/180` §2.f).
- No status-poll route, so a donor has no way to watch a payment — and
  `docs/159` records that the donor's own poll is the only path by which a
  late settlement is ever discovered. Nothing sweeps
  `palpluss_payment_requests` either.
- The `REVERSED` branch, the `collected_unrecorded` branch and the
  amount-mismatch branch are all tested and **none has ever fired against
  real money**, here or on PayHero.
