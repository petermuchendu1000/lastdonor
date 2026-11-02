# 168 — A campaign's currency is not its payment rail

**Status: DEPLOYED as v173, 2026-11-02, and it has taken real money.**
M-Pesa receipt `UK2JG0GO0Z`: a donor charged **Ksh 650.00**, the USD campaign
`keisha-wallace` credited **$5.00**. The first cross-currency donation in this
platform's history, and the first donation ever to one of the eight live
campaigns.

---

## 1. The defect, reported by the owner

> *"I tried to donate but received the error that card payments are not
> available right now! I want to donate - we already have payhero!!!!"*

[VERIFIED by reproduction] on `/campaigns/keisha-wallace/donate`:
**"Card payments are unavailable right now."**, zero M-Pesa inputs, and
**zero donation API calls** — `docs/161`'s refuse-before-collecting working
correctly, on a rail that could never work.

It was wider than one page. [VERIFIED from production] **all 8 live campaigns
are USD, with 0 raised and 0 donations between them**, and both rails refused
them:

| probe | result |
|---|---|
| USD campaign → card rail | **503 `PAYMENTS_UNAVAILABLE`** (dead Stripe credentials, `docs/125`) |
| USD campaign → M-Pesa rail | **400 `WRONG_PAYMENT_RAIL`** |
| KES fund → M-Pesa rail | **succeeded** ← the control |

**Not one live campaign had a working way to receive money.**

Falsification attempted: *would a KES campaign also fail?* No — one collected
successfully the same morning. Did not falsify.

## 2. Root cause

`CURRENCIES[campaign.currency].gateway` decided **two different questions at
once**: what the appeal is denominated in, and which processor may collect it.

The rail settles that second question on its own. [VERIFIED] `payhero.ts:503`
sends `amount` with **no currency field at all** — M-Pesa charges KES and that
is a property of the channel, not of the request.

## 3. What everyone else does

Researched rather than invented, per the owner's instruction *"research what
others do and implement the same — we are not inventing the wheel"*.

[Stripe](https://docs.stripe.com/currencies) names **three** currencies and
keeps them apart: the payment method's, the **presentment** currency (the
charge), and the **settlement** currency (what the account receives).
*"If the charge currency differs from your settlement currency, Stripe
converts the charge to your settlement currency."*

[GoFundMe](https://support.gofundme.com/hc/en-us/articles/360001992827) is the
closer analogue: *"Enter the amount you'd like to donate in the GoFundMe's
currency. You'll then be charged the equivalent of that amount in your own."*

Two details that shaped the design:

- **Rate locking.** Stripe's [FX Quotes API](https://docs.stripe.com/connect/currencies/fx-quotes-api)
  exists *"to reduce any uncertainty around changing exchange rates"*, with
  `lock_duration` of `five_minutes` or `hour`.
- **Refunds use the live rate at refund time**, not the original.
- **Minimums are enforced after conversion**: *"Charges requiring conversion
  into your account's default settlement currency must meet the equivalent
  minimum of the settlement currency."*

## 4. The decision

`campaigns.currency` stays the **denomination**. The rail charges in its own
currency. `payhero_payment_requests` records **both legs**:

| column | meaning |
|---|---|
| `currency` / `amount` | the **CHARGE** — what PayHero collects (KES) |
| `credited_amount_minor` / `credited_currency` | the **CREDIT** — what the campaign receives |
| `fx_rate_micro`, `fx_margin_bps`, `fx_quoted_at` | the quote, so it is reproducible |

⛔ **The composite FK MOVED, it was not given up.** From
`(campaign_id, currency)` to `(campaign_id, credited_currency)`. The database
guarantee that *a campaign is only ever credited in its own currency* is
unchanged; only the column carrying it moved. `donations` is untouched and its
own FK still holds.

Two properties made this cheaper than it looked:

- **The amount-match guard needed no change.** `payhero-settlement.ts:266`
  compares `request.amount`/`request.currency` against what PayHero reports,
  and both are still the charge.
- **`recordGatewayCharge` is handed the CREDIT**, so its currency guard
  (`payment-service.ts:793-831`) compares credit against `campaigns.currency`
  and still writes a `critical` `donation.currency_mismatch` on divergence.

### 4.1 Direction: the donor enters the campaign's currency

GoFundMe's model, and the cleaner arithmetic: the campaign is credited
**exactly** what the donor chose, and the rounding is absorbed by the charge.
Rounding is **UP**, never to nearest, so we can never collect less than the
credit is worth; the residue is at most one whole shilling (~US$0.008).

⛔ `bigint` for `fx_rate_micro`, not `integer`. int4 caps at a rate of
**2,147 per USD** — fine for KES at ~130 and silently wrong the day a currency
like IDR (~15,000/USD) becomes collectable. Same class as the hardcoded `100`
that `fx-convert.ts` records surviving a mutation test.

## 5. The margin is 0 basis points

Owner decision, 2026-11-02. **Not timidity.**

[VERIFIED live] the platform promises, in **five** surfaces:

- `/donate`, `/donor-faq`: *"We take 0%. The company that moves the money
  charges a fee to do it, and **we receive no part of that fee**."*
- `/refund-policy`: *"0% platform fees … and no processing fee is deducted."*
- the **Organization JSON-LD on every page**
- the **FAQPage structured data** Google republishes
- **the share-card image** (`og/page/route.tsx:123`) — "0% Platform Fees"

and `fee-claims.test.ts:89` asserts the claim must remain.

⛔ **There is no third-party FX cost to pass through.** PayHero collects KES
into a KES wallet and performs no conversion. Any spread would therefore be
LastDonor revenue, making *"we receive no part of that fee"* false.

**Raising `FX_MARGIN_BPS` is a copy change first and a code change second.**
For reference: Wise **0%** (fee charged separately), Stripe **1%** (published),
PayPal **3–4.5%**.

⚠️ Disclosure copy was tested against `RATE_PATTERNS` with three failing
controls: *"Charged in KES at 129.94 KES per USD, the mid-market rate with no
conversion margin"* passes all three.

## 6. The FX boundary, crossed deliberately and tightened

`fx-display-only.ratchet.test.ts` exists because *"an exchange rate is the one
tool that makes violating one-currency-per-campaign feel reasonable"*. That is
still right. What changed is that a rate now legitimately decides a charge.

- **`fx-quote.server` is listed in `FX_MODULES`.** The cheap move would have
  been to leave it out so nothing tripped rule 1 — that is evading the
  mechanism, not satisfying it. The boundary must be able to see the new door.
- **Rule 2 is STRICTER, not relaxed**: from *"no FX importer writes money"* to
  *"a file that sees a rate and writes money must **persist** the quote"*. The
  hazard was never that a rate reaches a money write; it is that it does so
  **unrecorded**.
- **Rule 3 is untouched and load-bearing**: `payment-service.ts` may still not
  import FX at all. Re-reading the rate at settlement would move the credit
  after the donor had agreed to the charge.
- **Staleness refuses the charge.** A display can skip a figure; a charge
  cannot invent one. Past `MAX_FX_AGE_HOURS` the route answers `FX_UNAVAILABLE`
  and nothing is asked for.

`fx-charge.ts` is deliberately **not** an FX module: it reads no snapshot and
holds no rate, taking numbers and returning a number. That is what lets the
client form state the charge while the donor types, from a rate passed as a
prop by an allowlisted server page.

## 7. Rejected alternatives

**Convert the 8 campaigns to KES.** Recommended by me, and **wrong** — the
owner rejected it correctly. USD is the global denomination and the whole point
of the FX layer; converting the campaigns makes the platform Kenya-only. It
also needed a goal re-denomination, and one campaign (`david-nwosu`, $150,000)
exceeded KES's `maxGoalMinor` of Ksh 10,000,000.

**Convert at capture with no schema change.** Blocked by the amount-match
guard: the request row holds one amount and one currency, FK-forced to the
campaign's, so it would have claimed `USD 0.38` while PayHero reported `50` —
**every converted donation rejected and not recorded**.

**"Just convert 50 KES to USD."** KES 50 = **$0.38**, below USD's `$5.00`
floor, so that exact donation is refused by `checkDonationAmount` before FX is
reached. A Kenyan donor must pay **~KES 650** to meet the USD minimum. Stripe
behaves the same way.

**A margin.** See §5.

## 8. Verification record

| | |
|---|---|
| migration, reproduction | drizzle's generated SQL **FAILS** (`23502`) on the 6 existing rows; the hand-edited one applies, backfill **6/6**, subject inserts, **2 controls reject** |
| migration, real migrator | full chain applied from scratch, then **329 integration tests / 0 failed** |
| migration, production | vs baseline: rows 6 → **6**, credited cols 0 → **2**, fx 0 → **3**, old FK **gone**, new FK **present**, migrations 13 → **14**, backfill **6/6** |
| unit | **8316 passed / 0 failed / 16 skipped**, 300 files |
| live before/after | same call: v172 **`WRONG_PAYMENT_RAIL`** → v173 **`"The smallest donation is $5.00"`** |
| live money | Ksh 650 charged, **$5.00** credited, `raised_amount` 0 → 500, **0 critical audit rows** |

**Mutants killed**: booking the charge instead of the credit (1 test);
reverting the button to the campaign amount (1); dropping the disclosure (1);
reverting the charged total (ratchet).

## 9. ⚠️ Gate 4 found two holes in my own rule

The "must persist the quote" rule v1 was `src.includes('fxRateMicro')`.
Injecting `fxRateMicroX:` **did not fire** — two known traps at once:

- the original is a **substring** of the mutant (`docs/149` §5.1, `<LocalAmount`
  matching `<LocalAmountXX`);
- the route's own **comment names the key**, so deleting the property outright
  would also have passed (`docs/116` §4).

Both lessons were read earlier in the same session. Fixed by stripping comments
and requiring a **property assignment**; an anti-vacuity row now guards the
stripper, and all three injections fire.

⚠️ A currency ratchet also disagreed, and **its premise had drifted, not the
code**: it required `currency={currency}` on every `<Money>` on the stated
grounds of *"a form that only ever collects a non-USD currency"*. Replaced with
a narrower rule (two permitted names where any variable named `currency` used
to pass) plus a new one pinning that the charged total is in the billed
currency while the donation line is not.

## 10. ⛔ PayHero's fee is BANDED, not flat — corrects docs/92 and docs/147

Both record *"flat KES 8.9"*. That was inferred from KES 50 collections only.
[VERIFIED across **1,075 paired collections** on the live ledger]:

| fee KES | n | amount range |
|---|---|---|
| 8.90 | 891 | 50 .. 472 |
| **12.90** | 102 | **500 .. 900** |
| 17.90 | 52 | 1,000 .. 1,300 |
| 22.90 | 10 | 1,500 .. 2,000 |
| 27.90 / 42.90 / 52.90 / 82.90 | 1 each | 3,000 / 5,000 / 10,000 / 29,149 |

This test cost **12.90**.

⛔ **Consequence, reported and NOT fixed**: `payhero-float.ts`'s
`PAYHERO_FEE_PER_COLLECTION_KES = 8.9` overstates remaining capacity above
~KES 472 — it reported 154 collections where the 12.90 band gives 106. The
alert fires **late, not never**, since the threshold is in major units. Left
alone deliberately: it is a separate defect and Gate 6 forbids widening scope
mid-change.

⚠️ Small-fee outliers in the ledger (0.00, 0.09, 1.80, 2.46, 2.90) break the
banding and are **[UNKNOWN]** — likely another product on a different channel.

## 11. What was NOT checked

- **The success screen says "You gave $5.00"** while Ksh 650 left the phone.
  Both are true — that is what the campaign received — and both pre-pay
  surfaces state the charge, so this was judged defensible and left alone. It
  is a legitimate thing to disagree with.
- **CI has not run** on `de31d4e`. Lint, typecheck, unit and integration were
  run locally; the E2E suite and a CI build were not.
- **The other 7 USD campaigns** are now collectable; one was tested.
- **Refund behaviour across currencies** is unexercised. Stripe uses the live
  rate at refund time; this platform has no PayHero refund API at all
  (`docs/122`), so a cross-currency refund remains a hand-settled return with
  no decided rate policy.
- **`DEFAULT_CURRENCY` is still USD**, so a new campaign is still created in a
  currency whose card rail is dead — now collectable over M-Pesa, but the
  underlying `docs/118` §10.6 question is untouched.
