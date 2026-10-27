# 125 — The money-in journey, and seven emails that spoke dollars

**Date:** 2026-10-27
**Journey:** 8 of the end-to-end walk (after `docs/124` account erasure)
**Status:** one defect class fixed; the headline blocker is owner-only
**Read before touching** `src/lib/email-templates.ts`, `notifications.ts`, or
adding any money figure to an email.

---

## 1. The journey, and whether anybody can give

Visitor → finds a campaign → gives → is thanked. Walked against production.

**[VERIFIED, four independent methods] Not one of the 14 live campaigns can
take a donation.**

1. **Database.** 14 `active` campaigns, **all USD**; 8 `under_review`; the only
   KES campaign is `archived`, so not donatable.
2. **Code.** `CURRENCIES.USD.gateway = 'stripe'` (`currencies.ts:172`),
   `KES.gateway = 'payhero'` (`:238`), `DEFAULT_CURRENCY = 'USD'` (`:252`).
3. **Health endpoint.** `stripe: {status: "error"}`, from
   `stripe.balance.retrieve()` (`health/route.ts:65`) — the same client and
   secret key `create-checkout` uses. `payhero: ok`.
4. **The public API, live.** A real `POST /api/v1/donations/create-checkout`
   for `antonio-rivera` answered **`503 PAYMENTS_UNAVAILABLE`**
   (requestId `af110da5-0a5c-41fc-bdcc-06df06f29ad0`) — a branch the route
   emits **only** on `StripeAuthenticationError` (`:318-339`).

⚠️ **Gate 3, the falsifier that mattered:** a *restricted* Stripe key can allow
`checkout.sessions.create` while denying `balance.retrieve()`, which would have
made the health check a false alarm and this whole reading wrong. The live
probe settles it: the route distinguishes authentication from every other
failure, and it reported authentication. Not a permission scope — the key
cannot authenticate at all. The probe was safe to run: `create-checkout`
performs **no database write** before the Stripe call (only a campaign read at
`:50`), and a Checkout Session is a quote, not a charge — none was created,
because auth failed first.

A fifth method, found while checking something else: **no Stripe publishable
key exists in the production bundle.** All 33 chunks the donate page loads were
downloaded and searched; the single `pk_test` hit is Stripe's own SDK regex
(token length 7, in a chunk that does not contain the donate form). So even
with a working secret key, `stripePromise` is `null` and the embedded checkout
cannot mount.

This is `docs/72` and `docs/118` §6, still true. **It is owner-only — a
credential.** Everything below is what the walk found that is *not*.

### 1.1 What the donor actually sees, and what they do not

The failure is reported honestly: the donor fills in amount, name and email,
presses Donate, and gets *"Card payments are unavailable right now. This is a
problem on our side, not with your card, and nothing has been charged."*
That copy is `docs/72`'s fix and it is accurate.

⚠️ I initially concluded the donor hits the *other* honest dead-end, the one in
`CheckoutStep` for a missing publishable key. **That was wrong**: it is gated
behind `step === 'payment' && clientSecret` (`DonationForm.tsx:739`), and
`clientSecret` only exists once `create-checkout` has **succeeded**. It is
reachable only in the configuration where the secret key works and the
publishable key is missing — not this one.

Two things are recorded, not fixed:

- **The form is offered before the rail is checked.** `docs/119`'s rule is
  *"a step may offer an action only if its target will accept it"*, and the
  donate page offers `create-checkout` on 14 campaigns that refuse it. The
  obvious guard is not available cheaply: a server-side read of
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is **not** a reliable proxy for what the
  client bundle received (Next inlines it at build; the server reads it at
  runtime, and the two can disagree), and probing Stripe per render puts a
  network call on an ISR page. Doing this properly needs a cached rail-health
  signal, which is a design decision, not a fix.
- **The working rail has no door.** M-Pesa is reachable only from a KES
  campaign, and the only one is archived — so `MpesaDonationForm` is
  unreachable in production. That follows from `DEFAULT_CURRENCY = 'USD'`,
  already an open owner item (`docs/118` §10.6).

---

## 2. ⛔ What the walk actually found: seven emails that spoke dollars

`src/lib/email-templates.ts:56` declared:

```ts
function formatCents(cents: number, currency: string = 'USD'): string
```

**Twelve call sites took that default.** A defaulted parameter is invisible at
the call site — `formatCents(p.amount)` reads exactly like a correct call —
which is why three separate currency sweeps walked past it.

The worst instance is not the default at all. `notifications.ts:451` called
`campaignCompletedEmail` with **no currency**, and
`notifyCampaignStatusChange` had **no `currency` field in its parameter
object** — the two admin routes that call it selected
`{ slug, goalAmount }` and never fetched the column. So the *"your campaign
reached its goal"* email, which goes to **every donor of that campaign**,
stated the goal in dollars whatever currency it was raised in.

**Measured, by executing the template** before the fix:

```
  campaignCompletedEmail({ goalAmount: 5_000_000 })   →  $50,000.00
  truth: 5,000,000 KES minor units                    →  Ksh 50,000.00
```

Roughly **130x**, in the email sent at the moment of maximum trust.

### 2.1 Gate 3 — can it fire?

Production has **0** `completed` campaigns, so it has not fired. But the path
is reachable and **has been exercised**: `audit_logs` holds 10
`campaign.status_changed` rows, all from a `zzpass2 probe` campaign on
2026-10-17, **two of which transitioned to `completed`**. No cron sets that
status; it is an admin action. So the defect is latent and armed — the same
shape as `docs/123` §3, latent only because a prerequisite (a KES campaign) is
off, and `docs/118` §10 has just made that prerequisite available.

### 2.2 Honest attribution

**`docs/122` §8 item 11 already recorded the `formatCents` default**, naming
three refund templates, reported-not-fixed. This pass adds the full
enumeration (**12** call sites, **7** templates) and one defect that item does
not cover: `campaignCompletedEmail`'s currency was never threaded at all.

### 2.3 ⚠️ And a correction to my own work in `docs/122`

`docs/122` §2 gave `notifyDonationRefund` a **required** `currency`, and
`notifications.ts:357` uses it for the in-app title. Line 354 hands the same
`p` to `donationRefundedEmail` — whose line 167 was `formatCents(p.amount)`,
one argument. **The notification got the currency and the email body did
not.** The test I wrote asserted `formatMoney(p.amount, p.currency` in
`notifications.ts`, which passed, and never looked at the template.

---

## 3. The fix

The root cause is the **default parameter**, so that is what was removed —
`tsc` then enumerated every site, which is the mechanism CLAUDE.md credits for
finding exactly this class (`docs/115`).

| | |
|---|---|
| `formatCents` | currency is now **required** |
| 5 templates | `currency?: string` → `currency: string` |
| 6 templates | gained a `currency` field they never had |
| `notifyCampaignStatusChange`, `notifyBulkRefundCompleted`, `notifyWithdrawalCompleted`, `notifyWithdrawalFailed` | gained a required `currency` |
| `admin/campaigns/[campaignId]/route.ts` | both selects now fetch `campaigns.currency` |
| `cancel/route.ts` | the campaign select fetches it, threaded through `processBulkRefund` → `sendDonorRefundEmails` |
| `similar-campaigns.ts` | each suggested campaign carries **its own** currency |

Three decisions worth keeping:

- **A suggested campaign renders in ITS currency, not the reader's.**
  `campaignCancelledRefundEmail` lists other people's campaigns to give to;
  rendering them in the reader's currency would misstate a stranger's total.
  Verified: a KES donor's email shows their own gift as `Ksh 50.00` and a
  suggested US campaign as `$1,000.00`.
- **The bulk-refund path uses the CAMPAIGN's currency**, which is every
  eligible donation's currency too — the composite FK on
  `(campaign_id, currency)` makes that a database guarantee (`docs/92`).
- **The two withdrawal emails derive from `PLATFORM_PAYOUT_CURRENCY`**, not a
  `'USD'` literal. Withdrawals are USD-only by design (`docs/121` §4), so this
  is correct today *and* follows the rail if it ever changes.

---

## 4. The rules, and the one that had to be added after an injection beat me

Four rules in `src/components/ui/money-currency.ratchet.test.ts` — the
existing currency ratchet, extended rather than a tenth file, because it
already owns this property.

1. No `formatCents` call with one argument (depth-aware scan, so a nested
   paren does not read as a second argument).
2. The helper declares no default currency.
3. No template declares `currency?`.
4. **`notifications.ts` never writes a currency literal.**

⚠️ **Rule 4 exists because Gate 4 caught the first three being insufficient.**
Injecting the original defect in a slightly different form —
`currency: 'USD'` hardcoded at the call site — **passed all 41 tests.** The
shape rules cannot see a wrong literal. `notifications.ts` is a dispatcher
that never knows a currency of its own, so a literal there is wrong by
construction whatever its value; derived constants
(`PLATFORM_PAYOUT_CURRENCY.toUpperCase()`) stay legal and are asserted to.

Re-run after rule 4, the same injection fails. Every rule is injection-proven
with a verified clean restore.

Behaviour, not only shape, is pinned in
`email-templates.transactional.test.ts`: a KES goal renders `Ksh 50,000.00`,
the **USD control** renders `$50,000.00` (without it, a template that ignored
the parameter and always printed shillings would pass), and the mixed-currency
suggestion case is asserted.

⚠️ **`Intl` emits a NON-BREAKING space (U+00A0)** between a multi-character
symbol and the number, so `toContain('Ksh 50.00')` with an ordinary space can
never match — while the `$` assertions pass, because `$1,000.00` has no space.
An assertion that cannot match is worse than none; the tests normalise U+00A0
first.

---

## 5. What was NOT checked

- **Nothing is deployed**, and the headline blocker is untouched: the 14 live
  campaigns still cannot take a donation until the Stripe credential is
  replaced or a KES campaign is created.
- **No email was sent.** The templates were executed and their output read;
  nothing was put through Resend.
- **The M-Pesa path was read, not run.** `initiate` → STK push → poll →
  `settlePayHeroRequest` → `recordGatewayCharge` was traced by reading and
  looks sound (a conditional UPDATE claims the request so exactly one caller
  settles, and the namespaced provider reference rides the unique index).
  Local Postgres was gone after a session restart and I did not rebuild it to
  exercise this, so **the one rail that works remains unexercised by any test
  I ran today**.
- **`email-adaptive.ts`** is in the ratchet's sweep but has no `formatCents`
  calls, so rules 1–3 are vacuous there today.
- **`create-intent`** (`src/app/api/v1/donations/create-intent/route.ts`) has
  the raise cap and creates a Stripe PaymentIntent, but has **zero UI callers**
  and sits behind middleware default-deny. Reported, not removed.
- **`/api/v1/health` answers 503 permanently** because Stripe is dead. Whether
  anything (an uptime monitor, Fly) reads it and is therefore permanently
  alarmed was not established.
