# 174 — Round up at the moment of giving

**2026-11-05.** The owner asked for automated recurring micro-donations —
the Acorns model: round up everyday purchases, accumulate the spare change
in a LastDonor balance, and distribute it algorithmically to vetted but
unfunded campaigns.

**What shipped is one quarter of that**, and the other three quarters are
recorded here with the reason each is not built.

---

## 1. Why the full feature is not buildable on this platform today

The idea needs four mechanisms. [VERIFIED] three do not exist and one is a
stub:

| # | Mechanism | State | Receipt |
|---|---|---|---|
| A | See a user's transactions | **absent** | no Plaid/TrueLayer/Mono/Okra in `src/` or `package.json`; `payhero.ts` exports only `initiateStkPush`, `getTransactionStatus`, `getWalletBalance` |
| B | Charge them again later | **exists, dead rail** | `create-checkout:238` `mode: isRecurring ? 'subscription' : 'payment'`; `donations/webhook:81` handles `invoice.payment_succeeded`. Live health: `stripe: error` |
| C | Hold a donor balance | **absent** | no balance/wallet/ledger table among the 38 in `schema.ts` |
| D | Distribute algorithmically | **stub** | `fund_pool_allocations` has exactly that shape; production holds **2 rows, both `pending`, 0 targeted, 0 disbursed** |

### 1.1 The falsifier changed the claim

I was forming *"there is no recurring collection at all"*. Checking for
subscription-renewal handling **refuted it**: `payment-service.ts:130-158`
resolves invoice → subscription → metadata and writes the donor context back
to the PaymentIntent. Recurring donation infrastructure is real and
reasonably complete.

The narrowed statement: **all of it is Stripe, and Stripe is down.** On the
rail that works, `validators/payhero.ts:20-23` says it outright —

> *"No `isRecurring`. An M-Pesa STK push is a **single authorised debit, not
> a mandate**. There is nothing behind it to charge again."*

[VERIFIED in production] all **6** donations ever taken are
`is_recurring = false`, `provider = payhero`.

### 1.2 ⚠️ A correction the owner made, and what it changed

I first framed the balance as *"the platform would hold funds"*. The owner
corrected it: LastDonor never takes possession — money sits with the PSP.
**That is right**, and I should have verified where funds land before using
the word custody. There is no bank account in the code and no balance table.

Checking it refined the PayHero half:

- [VERIFIED `docs/92`:254-255] a collection *"settled to the configured
  payment channel — the National Bank paybill"*, while the service wallet was
  **debited** the fee.
- [VERIFIED by probe, `payhero.ts:700` comment] `wallet_type=payment_wallet`
  **404s**. The only readable wallet is `service_wallet` — the fee float,
  which goes *down* on a collection.
- [VERIFIED `docs/92`:283-287] that channel is paybill **547700**, on an
  account **shared with BETWOIN LTD**.

So there is no per-user wallet primitive on the working rail to accumulate
into, and the destination is a shared account. That is a statement about
where money lands, not a legal opinion. ⛔ Who owns paybill 547700 and how
LastDonor's share is reconciled is **[UNKNOWN]** and is a question about the
owner's banking arrangement.

### 1.3 The fee structure is what decides the design

[VERIFIED `docs/168` §10, across **1,075 paired collections**] the PayHero
fee is per *collection* and **banded**: 8.90 for KES 50..472, 12.90 for
500..900, 17.90 for 1,000..1,300.

Two consequences fall straight out, and they point in opposite directions:

- **A standalone KES 50 round-up is terrible.** It is its own collection, so
  it costs 8.90 — **17.8% of the gift** — and every STK push needs the
  donor's PIN. The *friction-free background accumulation* the model is named
  for is exactly what M-Pesa cannot do.
- **Rounding up an existing donation is nearly free.** KES 650 → 700 stays
  inside the 500..900 band, so the fee does not move at all.

⚠️ *Nearly*, not always: 450 → 500 crosses a band and costs the float a
further 4.00. ⛔ That is why **no fee claim appears in the UI** — "this costs
nothing extra" is not true at every amount, and `fee-claims.test.ts` forbids
a rate on a user-facing surface regardless.

---

## 2. What shipped

A control under the amount field on `MpesaDonationForm`: *"Round up to
Ksh 700.00"*. Taking it sets the amount field and nothing else.

**No balance, no mandate, no second charge, no new vendor, no schema
change.** The POST body is identical in shape to today's; the donor
authorises one debit for the figure they can see.

### 2.1 It rounds the CREDIT, never the CHARGE

⛔ The load-bearing decision. [VERIFIED] the donor enters an amount in the
**campaign's** currency (`initiate/route.ts:168` — *"`data.amount` is the
CREDIT"*) and `quoteCharge` at `:205` derives what the phone is debited.

Rounding the **charge** would take more from the donor and credit the
campaign the same. That difference is a spread — LastDonor revenue — and the
platform promises *"We take 0%… we receive no part of that fee"* in five live
surfaces, which is why `FX_MARGIN_BPS` is 0 (`docs/168`). Rounding the credit
means every unit of the increase reaches the campaign and the charge
re-derives through the existing quote.

A mutation pins it: pointing the control at `billedMinor`/`billedCurrency`
instead fails the cross-currency test.

### 2.2 ⛔ The floor tile is never offered a round-up

Found by a test that expected every preset to be silent and was not. The
KES 50.00 floor is not a multiple of KES 100.00, so the bare arithmetic
offered to round it to KES 100.00 — **doubling the smallest gift the platform
accepts**, aimed at the donor who chose the cheapest tile.

Correct arithmetic, bad behaviour. `roundUpOffer` now withholds any offer
below one full step: you cannot round to the *next* round figure before
reaching the first one. The rule is derived from the step rather than from an
invented percentage.

⚠️ **Accepted limitation, not solved**: an amount just above a step
(Ksh 101.00) still rounds to Ksh 200.00, a large relative jump. Any
round-to-next-multiple has that property near a boundary. Left because the
offer states the exact figure, is opt-in, and can be ignored.

### 2.3 The bounds it must respect

`withinBounds` gates `canSubmit`, so **an offer above `maxDonationMinor`
would hand the donor a tile that disables the pay button** — worse than no
feature. The offer is withheld for: a currency with no step, an amount
already round, an amount outside the donation bounds, a rounded figure above
the maximum, and one whose **converted charge** would fail the charge-side
check at `initiate/route.ts:235`.

### 2.4 ⚠️ A Gate-4 problem in my own module

With today's constants the maximum guard **cannot fire** through
`roundUpOffer`: KES 25,000,000 / 10,000 = 2,500 and USD 10,000,000 / 100 =
100,000, both exact, so `Math.ceil` of any in-bounds amount lands on or below
the maximum. A test driven only through the public function would have passed
with the guard deleted.

The arithmetic was split into `nextRoundFigure(amount, step, max)` so the
branch is reachable and provable, and a test pins the divisibility fact — if
a future `maxDonationMinor` stops dividing evenly, the guard is already there
and already tested.

---

## 3. Rejected, with reasons

- **Round up the charge** — a spread; falsifies the 0% promise (§2.1).
- **Accumulate then charge once** — better economics (one fee instead of
  many), and it is precisely what creates a donor balance. No wallet
  primitive exists on the working rail (§1.2).
- **Step of KES 50 instead of 100** — 650 is already a multiple of 50, so the
  headline case would offer nothing.
- **A percentage cap on the increment** — an invented threshold; the
  one-step rule is derived from the step itself (§2.2).
- **Round-ups on `DonationForm`** — the card rail answers 503 to everybody
  (`docs/161`). Out of scope rather than half-built.

---

## 4. Verification

- **24 unit tests** on the decider; **7 mutations, 6 killed + 1 must-pass**:
  `ceil`→`round` (4 failed), drop floor rule (2), drop max guard (1), drop
  charge guard (1), drop already-round (3), drop min bound (1), comment-only
  (24 passed). sha256-verified restore.
- **4 DOM tests** proving the control is *wired*, not merely correct — *"a
  resolver that is correct and uncalled is the defect"* (`docs/170` §11.4).
  **4 mutations**: control never renders (2 failed), click does not set the
  amount (2), rounds the charge instead (1), comment-only (35 passed).
- ⚠️ **Two of my own test expectations were wrong, not the code**: `$4.30` is
  below USD's `minDonationMinor: 500`, and the floor-preset case in §2.2.
- Gate: lint 0 (1 pre-existing warning), typecheck 0, unit **8477 passed /
  16 skipped across 308 files**.

⚠️ Gate 7's concurrency and provider-timeout cases **do not apply and are not
faked** — the decider is pure, with no I/O and no shared state. The nearest
real analogues are covered: idempotence (taking the offer twice) and the
no-conversion path where `charge` is null.

---

## 5. UNCHECKED

- **Not deployed.** Production is v176; this is committed only.
- **No browser render.** The control is proven by jsdom execution, not by
  sight, and **not at 390px** — `docs/151` walked this form at phone width
  and that measurement has not been repeated with the new control.
- **The raise cap is invisible to the client.** `Props` carry no cap
  information, so a round-up can push a donation over `unverifiedCapMinor`
  and earn a `409 CAP_EXCEEDED`. That refusal is honest and names the cap
  (`docs/147` §11), no money moves, and with every campaign near zero raised
  it cannot bite today — but it is a real edge and is not handled.
- **No measurement of whether donors take the offer.** Nothing records that
  an amount arrived via the control rather than the keyboard, deliberately:
  it would mean a new column on a money table for a feature with no usage
  yet.
- Whether PayHero supports mandates or disbursement remains **[UNKNOWN]**
  (`docs/113` §3).
