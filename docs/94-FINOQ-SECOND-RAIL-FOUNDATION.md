# 94 — FinoQ as a second payment rail: the currency foundation, and what the sales call did not establish

**Date:** 2026-10-19
**Status:** Foundation built and merged. ⛔ The FinoQ client itself is **NOT BUILT** — no credentials exist.
**Read with:** docs/72 (Stripe key is a placeholder), docs/81 (never ship an unexercised provider path), docs/84 (probe a provider, do not read about it), docs/47 (`Money` is the only renderer), docs/88 F4/F5 (five currency implementations, consolidated)

---

## Where this came from

Owner, 2026-10-19: *"I just got on a call with Payhero and they said they can cover over 30 african countries. So, we'll wire it in."* Followed by: *"they are now finoq.africa"*.

Two owner decisions were taken before any code:

1. **"Over 30 African countries" means local payment methods per country** — a donor in Lagos or Accra paying with their own country's rail. Not card acceptance, not bank settlement.
2. **FinoQ is a second rail alongside Stripe**, not a replacement.

Everything below follows from those two answers.

---

## What FinoQ is — verified, not read off a pitch

**Verified 2026-10-19.**

- **The rebrand is real.** FinoQ's own post, dated 26 Sept 2026, says "PayHero Africa is now FinoQ — same team, platform, and accounts", and that "API keys and webhooks keep working".
- **The platform is mirrored on the new domain.** `GET https://backend.finoq.africa/api/v2/bank_paybills` answers `401 {"status":401,"success":false,"message":"Unauthorized. Authentication required."}` — the v2 API is live there and auth-gated. `payhero.co.ke` 301s to `payherokenya.com`; `connect.payhero.africa` 308s to `connect.finoq.africa`.
- **`api.finoq.africa` is live but the published v1 paths are not.** `/v1/payments`, `/v1/providers`, `/v1/countries` and `/v1/discovery` each return `404 {"error_message":"Endpoint not found"}`. The developers page documents `POST /v1/payments` against a placeholder base URL (`https://api.example/v1/payments`), so the v1 surface is either elsewhere or not yet released.

### The only verifiable payment surface is Kenyan

The working, documented API is the PayHero v2 one:

```
POST https://backend.payhero.co.ke/api/v2/payments     (Basic auth)
{ amount, phone_number, channel_id, provider, external_reference?,
  customer_name?, callback_url?, credential_id?, network_code? }
```

`provider` accepts **`m-pesa`** or **`sasapay`**. `network_code` is `63902`, M-Pesa under SasaPay. There is **no country parameter and no currency parameter**. Example phone numbers are Kenyan.

There is nothing in this API with which to address a payer in Nigeria, Ghana or South Africa. **The API shape is the evidence, not the marketing copy.**

### The "30+ countries" figure is not substantiated by anything FinoQ publishes

- `payherokenya.com` says PayHero is built "for Kenyan Businesses" and "Trusted by companies and teams around Kenya", with a Nairobi address. No pan-African claim.
- The FinoQ developers page says "fifteen payment providers" and names **no country count**.
- No country list, licence list or partner network is published anywhere reachable.
- The single pan-African claim found is a January 2026 marketing post about "cross-border payments across Africa", with no corridors named.

**Assumed, not verified — the most likely origin of the number:** PAPSS (Afreximbank's Pan-African Payment and Settlement System) is documented as operating in *"more than 30 African countries across all five regions"*. That is a bank-to-bank settlement network, not consumer checkout. If FinoQ reaches 30+ countries via PAPSS or a similar upstream, that is a very different product from a donor paying with mobile money.

This codebase has hit this exact shape twice before: GNews claimed 37 countries and Egypt was the only African one (docs/90); TalkNTalk's delivery-code table was Africa's Talking' verbatim, so it resold the same upstream and was no redundancy at all (docs/86).

**Open, and only FinoQ can close it:** a written list of countries, the local method in each, the settlement currency, and the API by which a non-Kenyan payer is addressed.

---

## What was built, and why it needed no credentials

docs/81 forbids shipping an unexercised provider path, and no FinoQ credentials exist. So the client was **not** built.

What *was* built is the part that is a prerequisite regardless of FinoQ's final API shape, is entirely inside our own system, and is provable offline. This is the docs/82 pattern exactly: phone normalisation was built, tested and merged *before* any SMS provider existed, because it was the part that could be proven.

### 1. Every amount in this system was USD by assumption, and nothing recorded it

`create-checkout` hardcodes `currency: 'usd'`. `donations.amount` was a bare `integer`. `centsToDollars` hardcoded `'USD'`. The Organization JSON-LD declares `areaServed: United States`.

That assumption was **correct** while Stripe was the only rail, and entirely unwritten down. A second rail makes it false, and the failure is silent: `SUM(amount)` on `/transparency` and the homepage would add shillings to dollars and publish the result as dollars, on the page whose entire purpose is honest numbers.

**`src/lib/utils/currency.ts` is now currency-aware**, with USD defaults so all 40 existing call sites are unchanged and still correct. It was extended rather than replaced: docs/88 F4/F5 consolidated five currency implementations into this module, and adding a sixth beside it would undo that.

### 2. The 100× bug, caught before it could move money

**Verified** from FinoQ/PayHero's published API: the STK-push body carries a bare `amount` with examples of `100` and `10`, and their integration guides use **"KES 1"** as the test amount — not 100.

**FinoQ takes whole shillings. We store minor units (cents). Stripe takes minor units.**

Passing our stored amount straight to FinoQ would charge every Kenyan donor **one hundred times** what they agreed to. `toProviderUnits(minorUnits, currency, provider)` owns this conversion, and is tested.

It **throws rather than rounds** when a conversion is not exact. 1,250 minor units is KES 12.50, and there is no honest way to send that as an integer number of shillings — the caller must constrain the input, and that must not be decided by a rounding mode nobody reads at the call site.

The exponent is a **table, not a constant `2`**. UGX, RWF and XOF are zero-decimal currencies; on those, dividing by 100 silently inflates every figure 100×. A pan-African rail will meet them.

### 3. `donations.stripe_payment_id` was `NOT NULL`, which a second rail cannot satisfy

A FinoQ donation has no Stripe id. The column could not stay `NOT NULL` without inventing a fake one — and that column carries `idx_donations_stripe_payment_id`, which CLAUDE.md calls *the only replay protection against duplicate Stripe webhooks* and says never to drop.

The migration (`migrations-v2/0005_tearful_purifiers.sql`, six statements) **does not drop it**:

- `stripe_payment_id` becomes nullable. Postgres unique indexes permit multiple NULLs, so FinoQ rows neither collide nor weaken it, and Stripe replay protection is **unchanged**.
- A new CHECK, `donations_stripe_id_present`, preserves the guarantee the `NOT NULL` used to give: `provider <> 'stripe' OR stripe_payment_id IS NOT NULL`.
- `provider` (default `'stripe'`) and `provider_reference` are added, with `uniqueIndex(provider, provider_reference)` giving replay protection on **every** rail. Both our providers redeliver webhooks.
- `currency` is added, default `'usd'`.

**Every default is chosen so no backfill is needed** and existing code writes correct rows.

### Why now: the money tables are empty

**Verified** against production, 2026-10-19: `donations` 0 rows, `refund_records` 0 rows, `campaigns` with a non-zero `raised_amount` 0 rows. Because of docs/72 the platform has never taken a payment.

This is the cheapest moment this change will ever be made — no backfill, no reconciliation, no risk of mis-stamping historical rows with a currency guessed after the fact. Every day of delay makes it harder.

**Validated** the way docs/34 requires: the generated migration was run against the live database inside `BEGIN … ROLLBACK`, reported `migration applied cleanly`, and a follow-up query confirmed the rollback left `currency`, `provider` and `provider_reference` absent from the live schema.

---

## Rejected

**Building the FinoQ client now.** docs/81 is explicit, and docs/76 and docs/77 are both about code paths that could never run. With no credentials the client cannot be probed, and docs/84 shows what probing this class of provider turns up that documentation does not: a *failed* Africa's Talking send answers HTTP 201, its 4xx bodies are `text/plain` so `res.json()` throws, and it silently reinterprets local phone numbers. FinoQ will have its own set. Guessing them produces code that compiles and loses money.

**Adding a `currency` column to all ten integer money columns.** `goal_amount`, `raised_amount`, `total_released_amount` and the rest belong to a *campaign* and would inherit currency from it, not carry their own. Stamping ten columns speculatively, before the campaign-currency model is decided, is the kind of change that gets half-reverted. `donations` is where a second rail actually writes.

**A separate `src/lib/money/` module.** Cleaner in isolation, rejected because docs/88 F4/F5 exists precisely because this codebase once had five currency implementations and `/admin/payouts` rendered `$1,250.5` next to `/admin`'s `$1,250.50` for the same row.

**Rounding in `toProviderUnits` instead of throwing.** A rounding mode invisible at the call site, moving real money. Refusing is louder and correct.

---

## ⛔ Still open

1. **FinoQ credentials.** API username, password/secret, and `channel_id`. Sandbox is enough to start. Until then the client cannot be written, per docs/81.
2. **The written country list.** Which countries, which local method in each, which settlement currency, and the API that addresses a non-Kenyan payer. Nothing FinoQ publishes answers this, and the whole premise of the integration rests on it.
3. **Per-currency minimum donation.** `donations_amount_check` is `amount >= 500` — 500 **minor units of whatever currency the row is in**. As $5.00 that is the documented floor; as KES 5.00 it is about four US cents. Deliberately left unchanged: the smallest donation worth taking in each market is a product decision, not something to guess in a CHECK constraint.
4. **`areaServed: United States`** in the Organization JSON-LD (`layout.tsx:29`) contradicts a Kenyan payment rail. docs/82 parked the same tension at `SMS_DEFAULT_REGION` defaulting to KE. It now needs resolving rather than parking.
5. **The checkout flow is redirect-shaped.** Stripe Checkout redirects out and returns; M-Pesa STK push sends a prompt to the donor's phone and answers on a callback. That is a different UI state machine — pending, polling, timed out, user-cancelled-on-handset — not a different API key. `DonationForm`, the donate pages and the confirm route (docs/42) all assume redirect-and-return.
6. **docs/72 is still open.** The Stripe key on Fly is the `sk_test_…0000` placeholder, so the *first* rail has never taken a payment. Wiring a second before the first works means two unexercised paths at once. Fixing docs/72 is the higher-value move.

---

## Read this before

- Writing the FinoQ client (read docs/84 first — probe, do not read)
- Totalling donation amounts anywhere: group by currency, or call `assertSingleCurrency`
- Converting an amount for any payment provider: use `toProviderUnits`, never `/100`
- Adding a currency: add its exponent to `MINOR_UNIT_EXPONENT` and confirm the provider's unit convention
