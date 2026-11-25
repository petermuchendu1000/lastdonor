# 183 — The Palpluss status poll, and six tiers nothing was guarding

**Date:** 2026-11-25
**Status:** BUILT, NOT ROUTED, NOT WIRED TO ANY SCREEN. Nothing polls it until
a currency names `gateway: 'palpluss'` *and* `MpesaDonationForm` is pointed at
it — see §5, which is now a build failure rather than a note.
**Read with:** `docs/180` (the rail, probed), `docs/181` (the settlement),
`docs/182` (the initiate route and the nullable id),
`docs/158`–`docs/162` (what a payment route may claim).

---

## 1. What this closes

`docs/182` §10 listed the status poll first among what was still missing, and
gave the reason that matters:

> ⛔ **The status poll.** `docs/159` is the reason it matters: nothing sweeps
> `palpluss_payment_requests`, so the donor's own poll is the only path by
> which a late settlement is discovered.

So this is not a convenience. With the callback alone, a delivery that is
lost — or merely unsigned and therefore unprovable, which is every delivery
today (`docs/180` §7) — leaves a collected payment with no donation row and
nothing that will ever look again.

`GET /api/v1/donations/palpluss/status?reference=LD-XXXXXXXXX`. The three
loop halves on this rail are now all present: initiate writes the row,
the callback and this poll both settle it through the one
`settlePalplussRequest`, and whichever arrives first books the donation.

---

## 2. What a caller may ask about

Only OUR reference, and only in the exact shape `mintAccountReference()`
produces. `src/lib/validators/palpluss.ts` derives that shape from the
minting constants rather than writing `{9}`:

```ts
const REFERENCE_PATTERN = new RegExp(
  `^${LASTDONOR_REFERENCE_PREFIX}[A-Z2-7]{${ACCOUNT_REFERENCE_RANDOM_CHARS}}$`,
);
```

### 2.1 Why not reuse `payheroStatusQuerySchema`

The *principle* is identical and is already stated there — a caller may ask
only about a reference this platform minted. What differs is the shape: a
PayHero reference is `LD-<uuid>`, so that schema bounds the length and nothing
more, while a Palpluss reference is exactly 12 characters because the gateway
documents that limit, so the whole value can be pinned.

⛔ **And pinning it is worth the second schema.** This reference carries only
45 bits (`docs/182` §3.1) — forced by that limit, not chosen — so the cheapest
possible refusal of anything that could not have been minted here is wanted:
before a database lookup, and well before any outbound call.

The one input that must never be accepted is **Palpluss's own transaction
id**. It is the key to `GET /v1/transactions/{id}` on a tenant that may be
shared with another product, and a blank or traversing value reads that whole
ledger with HTTP 200 (`docs/180` finding 1). The poll resolves our reference
to a row and reads the gateway id *out of that row*, never from the caller.
A test drives the UUID shape explicitly for that reason.

### 2.2 What the response may not contain

- **No `failure_reason`.** It is not selected at all. On this table it is an
  OPERATOR field: the initiate route writes *"Reconcile by matching this row's
  account_reference against external_reference in Palpluss's transaction
  list"* into it (`docs/182` §3), and the settlement writes the gateway's own
  wording. ⚠️ Not selecting it also avoids the dead select `docs/159` found on
  the PayHero twin, where the column is read **zero** times.
- **No gateway identifier**, for §2's reason.
- **No donor details and no phone number.** A 45-bit reference is guessable in
  principle, so the payload answers only what a donor needs to watch their own
  payment resolve.
- **The CHARGE, not the credit.** `amount`/`currency` are what left the
  donor's phone, not what the campaign is credited (`docs/168`).

---

## 3. The states it can answer, and why each is that one

| state | when | `keepPolling` |
|---|---|---|
| `succeeded` | settled AND a donation row exists | false |
| `collected_unrecorded` | settled and **no** donation row | false |
| `failed` | the gateway reported FAILED/CANCELLED/EXPIRED | false |
| `reversed` | money moved and came back | false |
| `pending` | the prompt could still be answered | **true** |
| `pending` | unverifiable, or no gateway id on the row | false |

Three of those are `docs/158`–`docs/162` restated rather than re-derived, and
the fourth is new.

### 3.1 `succeeded` is decided by a donation row, through the shared decider

`claimForSettledCollection` from `mpesa-prompt.ts`, keyed into an answer
table. ⛔ Not a ternary: `docs/162` §5.1 found that an injection which
INVERTED that judgement passed every structural rule, because text cannot see
which way a branch points. Keyed by the claim there is no condition left to
invert.

Three branches here can answer for a settled collection — the terminal-row
early return, `case 'recorded'` and `case 'already_settled'` — and on the
PayHero twin all three read `status` alone, which is how a donor came to be
thanked for a donation that did not exist.

### 3.2 `unverifiable` is `pending`, never `failed`

`docs/160` verbatim. The client's `failed` screen heads *"Your donation was
not completed"* and then appends, **unconditionally**, three ordinary causes —
and on the amount-mismatch path this platform's own audit row reads *"Money
moved but no donation row was written"*, so that sentence would be addressed
to somebody whose balance had just been debited.

### 3.3 A row with no gateway id stops the poll and claims nothing

This is the state `docs/182` §2 created deliberately by making
`palpluss_transaction_id` nullable, and **this route is its first reachable
caller** — the callback cannot reach it, because it arrives carrying the very
id such a row lacks. The settlement's guard for it was written in that change
and had no caller until now.

⛔ The assertion that matters is that the gateway is **not called**.
`getTransactionStatus` refuses a non-UUID before building a URL precisely
because a blank id reads another tenant's ledger; the route must not reach it.

⚠️ `pending`, not `failed`: `docs/159` §6 corrected the PayHero settlement for
saying *"nothing was charged"* about a reference-less row. A push may well have
been sent. And the loose end is recoverable by hand, because
`GET /v1/transactions` returns `external_reference` on every row
(`docs/182` §2.2).

### 3.4 ⛔ `reversed` is its own state, and that is the one new judgement

Money moved and came **back**. Neither existing state fits:

- `failed` means no money ever moved. The client says exactly that and then
  appends *"the prompt was cancelled, it timed out, there was not enough in
  the M-Pesa balance"* — **none of which is true of a reversal**. Routing it
  there would be `docs/160`'s defect on a new input: an outcome we understand
  perfectly well, told through a screen that invents reasons.
- `collected_unrecorded` opens *"Your payment went through"*, which for a
  reversal is false.

⚠️ **[UNVERIFIED by execution]** no REVERSED has been observed on this tenant
(`docs/180`: 50 ledger rows, SUCCESS and FAILED only), and reaching it *on
this path* additionally requires the reversal to land before we ever settled.
It is handled because it is in Palpluss's published status enum, not because
it has happened.

---

## 4. ⛔ REPORTED, NOT FIXED: a re-poll of a reversed row reads as `failed`

The answer above is the FIRST poll, the one that discovers the reversal. The
settlement writes the row `status: 'failed'` with a reversal `failure_reason`,
so a later poll takes the terminal-row branch and answers `failed` — the
screen that invents three causes.

⚠️ There is no cheap honest fix, and each candidate was rejected:

- **A fourth `palpluss_request_status` value.** A migration on a live money
  table for a path never observed on this tenant. `docs/129` refused exactly
  this for `withdrawal_status`'s three unwritten values, on proportion.
- **Reading `failure_reason` to discriminate.** That column is operator text
  this route deliberately never selects (§2.2), and matching prose on a money
  path is how `docs/101` and `docs/107` happened in SQL.
- **Carrying the reason through `already_settled`.** Possible, and it widens
  the settlement's return type for one unobserved case.

So it is recorded rather than half-fixed. The honest statement of the limit:
**on this rail a terminal failure and a terminal reversal are the same row,
and only the poll that witnessed the transition can tell them apart.**

---

## 5. ⛔ The contract gap, turned into a build failure

The shared `MpesaDonationForm` has no `reversed` branch. An unhandled terminal
state falls through to its `keepPolling === false` check and renders the
`unresolved` screen, headed *"We could not confirm this payment"* — about an
outcome the server has just confirmed exactly.

That is harmless **only while no client polls this route**, which is today's
state: the form fetches `/api/v1/donations/payhero/status` and nothing else.
So the rule is derived from who fetches what:

> for each status route, every **non-`pending`** state it can answer must be
> explicitly tested by any client that fetches it.

It is vacuous for a route nothing polls, and **arms itself the moment the form
is pointed at one**. `docs/138`'s auto-relaxing rule-1 shape, inverted.

⚠️ `pending` is exempt deliberately: it is the fall-through by design — the
client keeps polling unless told to stop — so requiring an explicit test for
it would fail correct code.

⚠️ And it carries an anti-vacuity control, because the rule `return`s for an
unpolled route: at least one status route must actually be polled, or the
whole thing is inert.

---

## 6. A rule that named one file, for the third time in three days

`collected-unrecorded-claims.test.ts` was the `docs/162` guard. It read
**one hardcoded path** and lived beside it in `payhero/status/`:

```ts
const ROUTE = readFileSync(join(ROOT, 'src/app/api/v1/donations/payhero/status/route.ts'), 'utf8');
```

This route carries the identical three-branch structure, the same
`succeededOrUnrecorded` helper and the same answer table — so that rule would
have gone green against it **without ever reading it**.

It now discovers `**/status/route.ts` from the donations tree and derives each
route's table from its own `.from(…)`, so it knows neither schema name. Moved
to `src/app/api/v1/donations/settled-collection-claims.test.ts`, beside the
sibling sweep.

⚠️ **This is the third instance in three days**, which is the thing worth
recording rather than the fix:

| day | rule | named |
|---|---|---|
| 11-24 | `payment-outcome-claims` (`docs/182` §8) | one initiate route |
| 11-25 | `settled-collection-claims` | one status route |
| 11-25 | the M-Pesa rate-limit tiers (§7) | nothing at all |

`docs/110` §9.2's rule is that a third instance means a sweep. The general
form, stated once: **a guard written while one implementation exists names
that implementation, and the second implementation is invisible to it.** The
cure is always the same — discover the inputs from disk and derive the
per-input facts from the input.

---

## 7. ⛔ Nothing guarded any of the six M-Pesa rate-limit tiers

Found while adding the seventh. [VERIFIED] no test referenced
`payhero_initiate`, `payhero_status`, `payhero_callback`,
`palpluss_initiate` or `palpluss_callback` anywhere.

All six sit under `/api/v1/donations/`, and BOTH lookups match by prefix in
order, so a narrower entry must come first in each. `docs/85` established that
rule for the `sms` tier and **pinned it by test**; the M-Pesa tiers had the
identical hazard and nothing at all. It had already bitten twice, both found
by reading rather than by a failure:

- `docs/182` §7.1 — the Palpluss callback shipped with no entry anywhere, so
  it fell through to `donations` at 10/60 s keyed by an IP that is always
  Palpluss's. Ten settlements a minute platform-wide.
- `docs/182` §7.2 — the in-memory fallback listed **none** of them against a
  100/60 s catch-all, so the deliberately tight 5/60 s initiate bucket was
  twenty times looser whenever Upstash was unreachable.

`src/lib/rate-limit.mpesa.test.ts` closes it. The path list is **discovered**:
a directory under `donations/` holding a `callback/route.ts` is a rail, and
every route beneath it must be declared with a tier. A seventh path fails
until somebody decides what its bucket is — which is precisely the decision
nobody had made for the callback.

### 7.1 ⚠️ The first version of that test could not see half of what it guards

It asserted, for every path, that exhausting the declared ceiling produces a
429. That works only where the ceiling is **below** the fallback catch-all.

Both `status` polls are 120 against a catch-all of 100, so a missing fallback
entry makes them *tighter*, not looser — and exhausting 120 proves nothing
about which entry matched. Injection **R11** deleted the status entry and the
test stayed green.

The discriminator for that direction is a request **past** the catch-all: it
can only be allowed if the route's own looser entry matched. Both directions
are now asserted, with a control that each filtered list is non-empty — since
if every M-Pesa bucket drifted to one side of 100, one rule would pass over
nothing.

---

## 8. `payhero-prompt.ts` is now `mpesa-prompt.ts`

Every export in it is a fact about M-Pesa or a judgement about our own rows,
not about a gateway: `PROMPT_LIFETIME_MS` is Safaricom's prompt (and
`mpesa-abuse-guard.ts` already re-exported it for both rails),
`COLLECTED_UNRECORDED_MESSAGE` says only what happened to the donor's money
and names no gateway, and `claimForSettledCollection` reads a donation link.

Two rails import it now, which is the point: a second copy of any of the three
is a second answer to one question (`docs/146`). Same rename and same reason as
`payhero-abuse-guard.ts` → `mpesa-abuse-guard.ts` the day before
(`docs/182` §5).

⚠️ Unlike that one, **no behaviour changed here** — only the name and the
doc comments that said "PayHero" where they meant "the gateway".

---

## 9. Verification

### 9.1 Executed, not read

`route.integration.test.ts` runs the real route against a real Postgres: the
validator, the lookup, the settlement, the composite FK, `recordGatewayCharge`
and the donation insert. Only `getTransactionStatus` is stubbed.

`docs/124` §5.1 is the standing reason — a mock cannot refuse an insert for a
reason of its own, cannot raise a foreign-key violation and cannot lose a
race — and `docs/107` §7 records that no route's data query is executed by
anything.

The fixture mints references with the **real** `mintAccountReference()`, so
the validator is exercised against the values production produces rather than
against a handwritten sample that might agree with a wrong pattern.

### 9.2 Counts

| suite | result |
|---|---|
| typecheck | clean |
| lint | clean (one pre-existing warning in `review-gate.test.ts`) |
| unit | **8779 passed / 16 skipped**, 318 files passed + 3 skipped = 321 |
| integration | **392 passed**, 38 files |

Both deltas reconciled to the test against the previous measured state
(`docs/182`: 8733 and 375), because `docs/89` is explicit that an unexplained
count delta is how 80 silently-skipped tests hid behind "5898 passed".

Integration: 375 → 392 and 37 → 38 files — exactly this change's one new file.

Unit: 8733 → 8779, **+46**:

| delta | file |
|---|---|
| +17 | `src/lib/rate-limit.mpesa.test.ts` (new, §7) |
| +11 | `test/security/api-response-audit.test.ts` |
| +10 | `settled-collection-claims.test.ts` (16 → 21 and generalised, §6) |
| +8 | `src/lib/validators/palpluss.test.ts` (new) |

⚠️ The **+11** is the existing API sweep discovering the new route by itself,
which is the useful part of the arithmetic: it is positive evidence that the
route is being swept rather than merely added. It is the same +11 `docs/182`
§9.2 recorded for the initiate route, from the same sweep.

### 9.3 Injections — 14 rows, all behaving

Anchors verified unique before any row ran; the harness refuses to score a row
whose file sha did not change (`docs/152`), and the restore is sha256-verified
after every row (`docs/120` §11.1, `docs/155` §5.2, `docs/159` §5.1).

| row | mutation | verdict |
|---|---|---|
| R1 | the null-gateway-id guard is dropped | FIRED (2) |
| R2 | an unverifiable outcome is reported as `failed` — **`docs/160` regression** | FIRED (1) |
| R3 | a reversal is reported as `failed` | FIRED (1) |
| R4 | the terminal success branch bypasses the decider | FIRED (2) |
| R5 | the operator `failure_reason` is sent to the donor | FIRED (2) |
| R6 | the uncheckable row keeps the donor polling | FIRED (1) |
| R7 | the validator accepts any non-empty string | FIRED (5) |
| R8 | the validator refuses everything | FIRED (4) |
| R9 | the middleware public entry is removed | FIRED (1) |
| R10 | the `palpluss_status` tier mapping is removed | FIRED (1) |
| **R11** | **the `palpluss_status` fallback entry is removed** | **FIRED (1)** |
| R12 | the poll bucket is tightened to the donations ceiling | FIRED (1) |
| R13 | MUST PASS: a comment-only edit to the route | did not fire |
| R14 | MUST PASS: the operator log wording is changed | did not fire |

⚠️ **R11 is the row that earned §7.1.** It passed on the first run — the hole
was in my test, not in the code — and fires only against the both-directions
rule. R8 matters for the same reason in reverse: it proves the
accepts-what-we-mint control is load-bearing, since a schema that refuses
everything would otherwise satisfy every refusal rule in the file.

R13 and R14 are the half that matters as much as the other twelve: the rules
check behaviour, not today's prose. R14 rewords an operator-facing log line
that seventeen tests sit next to without asserting.

### 9.4 Two of my own assertions were wrong, not the code

⚠️ **A phrase match cannot tell a conditional from a claim.** I asserted that
the expired-prompt message must not contain *"went through"*, and it failed on
correct copy: the message reads *"If your phone says it went through, email
support"* — which is the platform **declining** to claim an outcome.
`docs/152`'s "the qualifier must precede the claim" and `docs/140`'s date rule
are the same shape. The phrase stays forbidden on the *reversal* message,
where it would be a bare claim with no reason for a conditional, and that
asymmetry is written down beside both.

⚠️ **And two rows pinned copy rather than the property.** `/not heard back/i`
and `/sent back|returned/i` would each have failed the first time somebody
improved the wording — `docs/160` §5.2, and `docs/163` §5.2 where exactly that
happened to me. Both now assert the property: a stopped poll must say
*something* (the live case sends `null`), it must claim neither outcome, and
the reversal message must differ from the two it is not.

---

## 10. What is still not built

- ✅ **RESOLVED 2026-11-25 by `docs/184`.** This read: *"Any UI.
  `MpesaDonationForm` fetches the PayHero paths. Wiring it means choosing the
  rail from the campaign's currency and adding the `reversed` branch §5 now
  demands."*

  Both halves happened, and ⚠️ **the first half is phrased wrongly here**: the
  rail must come from the **billed** currency, not the campaign's. They are the
  same for a KES campaign and differ for the USD ones — which is all of the
  live ones — so taking the campaign's would have sent every cross-currency
  donor to a refusal screen. `docs/184` §2 has the invariant and §7.1 row 3 is
  the injection that distinguishes the two spellings, which no text rule can.

  §5's rule did arm, exactly as designed, and is recorded firing in
  `docs/184` §4. The rail decider is `src/lib/mpesa-rail.ts`.
- ⛔ **A float monitor for this rail** (`docs/182` §10, `docs/150`'s shape).
- ⛔ **The `reversed`-on-re-poll limit** of §4.
- ⛔ **Nothing sweeps `palpluss_payment_requests`.** The poll is now the path
  by which a late settlement is found, which is exactly why it exists — but a
  donor who closes the tab still leaves a row nothing will revisit. The same
  is true of the PayHero table and has been since `docs/159`.
- Owner actions, unchanged: the LastDonor Palpluss tenant, registering
  `lastdonor.org` as a webhook domain so callbacks are signed, and deciding
  whether KES routes here — **after** `docs/182` §6's donate-page trap.
