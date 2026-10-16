# 72 — The donate page and the checkout flow

**Date:** 2026-10-16
**Status:** UI implemented. **Two production blockers OPEN — the platform
cannot take a single donation.**
**Amends:** `docs/47` (the preset-ladder justification is withdrawn).
**Read with:** `docs/42` (receipt verification), `docs/59` (the fee ledger),
`docs/65` (no cron has ever run).

---

## ⛔ The finding that outranks everything else on this page

**LastDonor has never been able to accept money, and still cannot.**

Proven end to end against production, 2026-10-16:

```
POST https://lastdonor.org/api/v1/donations/create-checkout
     {"campaignId":"879d8858-…","amount":2500,…}
→ HTTP 500  {"code":"INTERNAL_ERROR","message":"Failed to create checkout session"}
```

Two independent faults, either of which alone is fatal:

### 1. `STRIPE_SECRET_KEY` on Fly is a placeholder

Read from inside the running machine (`flyctl ssh console`, the key itself
never printed), used to call Stripe:

```
stripe_mode  sk_test_
/v1/charges             401  Invalid API Key provided: sk_test_**********************************0000
/v1/checkout/sessions   401  Invalid API Key provided
/v1/webhook_endpoints   401
/v1/events              401
```

A key ending `0000` is the documentation placeholder. Every call this route
has ever made to Stripe has thrown `StripeAuthenticationError`.

### 2. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is empty in the deployed image

`Dockerfile:95` defaults it to `""` and `fly.toml:58` has it commented out.
The live `/donate` HTML contains no `pk_` string at all. `DonationForm`
already handles this honestly (`stripePromise` stays `null` and the payment
step says so), but it means Stripe.js could not mount even if the server key
worked.

`docs/46` recorded this one as **"NOT VERIFIED END TO END."** It is verified
now, and it is absent.

### The corroborating evidence nobody looked at

| Query | Result |
|---|---|
| `select count(*) from donations` | **0** |
| `… where source = 'real'` | **0** |
| `… where source <> 'real'` | **0** |

Zero donations of any kind, ever, on a site that has been live since
2026-10-07 and renders a donate button on every page.

### The system already knew

`GET https://lastdonor.org/api/v1/health` has been answering, this whole
time:

```json
{"status":"degraded",
 "checks":{"database":{"status":"ok"},
           "stripe":{"status":"error","error":"Payment service check failed"},
           "redis":{"status":"ok"}}}
```

The health endpoint detected it correctly and said so on every call. Nothing
was reading the endpoint. That is the same shape of failure as `docs/37`,
where a passing health check hid a wedged pool for three hours: **a check
nobody consumes is not monitoring.** Wiring `status: "degraded"` to an alert
is a separate, overdue piece of work.

### What is needed (only the owner can supply these)

1. A working **`STRIPE_SECRET_KEY`** (`flyctl secrets set`).
2. **`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`** as a **build arg**, not a
   secret — it is inlined at build time (`Dockerfile:95`), so setting it as
   a Fly secret would do nothing. Same shape as the Sentry DSN in `docs/38`.
3. A **`STRIPE_WEBHOOK_SECRET`** matching an endpoint that exists in the
   same Stripe account. One is set, but no endpoint can exist under a key
   that does not authenticate, so it must be re-derived.

Separately, **the general fund has no `campaigns` row** (`/donate` correctly
refuses to render a form for it, per `docs/42`). Creating that row is an
owner decision — it is a fundraising entity with a title and a goal, not a
config value — so it is flagged, not invented here.

---

## What changed in code for the blocker

A key Stripe refuses is not a failed payment; it is a deployment that cannot
take money. For three weeks the two were indistinguishable, and every donor
read **"Failed to create checkout session"** — wording that sounds
transient and invites a retry that can never succeed.

`create-checkout` now separates them:

| Condition | Before | After |
|---|---|---|
| Stripe rejects the credential | 500 `INTERNAL_ERROR`, generic message | **503 `PAYMENTS_UNAVAILABLE`**, "problem on our side, nothing has been charged, email support" |
| Any other Stripe failure | 500 `INTERNAL_ERROR` | unchanged |

The server log for the first case names the misconfiguration outright
instead of printing a stack trace. The error shape used to detect it
(`error.type === 'StripeAuthenticationError'`) was **checked against the
live Stripe API with a deliberately invalid key**, not assumed from memory:

```
constructor: StripeAuthenticationError
type:        StripeAuthenticationError
rawType:     invalid_request_error
statusCode:  401
```

Four tests pin it, including one asserting no `sk_`-shaped string can reach
the response body.

---

## Measurement: ours against GoFundMe's donate form

Live, 390×844, 2026-10-16. Their form reached at
`/f/<slug>/donate?source=btn_donate`; ours at `/campaigns/<slug>/donate`.

| | LastDonor | GoFundMe |
|---|---|---|
| Document height | **2,155px** | **1,593px** |
| Words | 184 | 144 |
| Sitewide footer | **yes, 25 links** | **none** |
| Header controls | logo + search + hamburger, then a second bar | back arrow, wordmark, "Sign in" |
| Chrome AFTER the pay button | **1,095px (51% of the page)** | **0px** |
| Running fee/total ledger | none | donation / fee / total due today |
| Suggested amount | none | one tile badged |
| Refund assurance block | none | "GoFundMe protects your donation" |

### Result, measured on the deployed page

| 390×844 | Before | After | GoFundMe |
|---|---|---|---|
| Document height | 2,155px | **1,477px** | 1,593px |
| Chrome below the CTA | 1,095px | **0px** | 0px |
| Focusable elements in suppressed chrome | — | **0** | — |

**−678px, and 116px shorter than GoFundMe** while carrying a fee ledger and
a refund block their page matches only partly. Desktop: 1,614px → 1,302px
(theirs 1,649px). The sitewide navbar and footer are untouched on every
other route, verified in the same run (`/` and `/campaigns/<slug>` still
report `display: block` with 23–27 focusable elements).

### The gap was furniture again, and worse than on `/campaigns`

More than half of our donate page sat **below the pay button**: a newsletter
signup and the full sitewide footer, 25 links competing with the single
action the page exists for. This is a checkout screen. GoFundMe strips its
own navigation down to two controls on this one route.

---

## What changed on the page

### 1. No sitewide chrome on a checkout route

The donate page root carries `data-checkout`; `Navbar` and `Footer` carry
`data-site-chrome`; one rule in `globals.css` hides the second inside the
first.

**Why CSS and not routing.** `Navbar` and `Footer` are mounted in the
**root** layout, so a nested layout cannot remove them. The alternatives
were both expensive:

- read the pathname on the server — needs `headers()` in the root layout,
  which makes **all 26 ISR pages dynamic** (`docs/26` §5);
- gate them on `usePathname()` in a client wrapper — hides them one paint
  late, after the chrome has already been shown.

A static rule costs neither: it is in the first stylesheet, so the chrome is
never painted. `:has()` is Baseline (Chrome 105, Safari 15.4, Firefox 121);
a browser without it shows the footer, which is the behaviour that already
existed. Verified after the change that the suppressed chrome is
`display: none` and contains **zero focusable elements**, so tab order is
not left with invisible stops in it.

### 2. "Still $X to go." instead of three statements of zero

The header of a checkout screen rendered, unconditionally:

> **$0** of $150,000
> *(an empty progress trough)*
> 0 people have donated

Three separate ways of saying *nobody has given to this*, on the one screen
whose job is to ask for a gift. GoFundMe states the gap instead — **"Still
$4,725 to go."** — which is the same arithmetic pointed forward.

Now: the remaining amount leads when there is progress to describe, and an
unfunded campaign gets the invitation `docs/47` and `docs/71` already settled
on everywhere else, with no bar drawn at zero and no donor count of zero.
The gap is clamped at zero so an over-funded campaign cannot report a
negative one.

### 3. A running ledger, where the 0% claim actually lands

GoFundMe's donate form carries this block and, on the monthly tab, its
middle line reads **"Recurring fee (5%)"**. Ours now reads:

```
Your donation              $100.00
LastDonor platform fee       $0.00
Total charged today        $100.00
```

The product's single strongest claim was previously three words of 11px grey
text under the button. It is now a line item, directly above the pay button,
in the same place the competitor prints a 5% deduction.

Two precision points:

- **Stripe's 2.9% + $0.30 is named in a footnote, not shown as a row.** It
  is real (`docs/59`), but it comes out of the payout, so putting it in a
  column headed "charged today" would misstate what the card is debited.
- **An unpayable figure reads as `$0.00`.** Typing 999999999 must not
  produce "Total charged today $9,999,999.99" beside an error saying the
  maximum is $100,000 — the same defect the submit button's copy was
  already fixed for.

### 4. One "Suggested" tile, and deliberately no pre-selection

GoFundMe badges exactly one amount and **does not select it**: their running
total still reads $0.00 on arrival. Mirrored exactly. A badge is a
recommendation a donor can ignore in one tap; a pre-filled amount is money
chosen on their behalf by a form they have not read yet. A test asserts no
tile is `aria-checked` on mount and that the submit button is still
disabled.

**And the badge broke the grid on its first deploy.** Measured on the live
page straight after shipping: row one 77px, row two **97px**, because only
the badged tile carried the extra line and the grid stretched its whole row
to match. Two rows of amount buttons at visibly different heights reads as
a layout fault, and GoFundMe's six are uniform. Fixed by taking the badge
out of flow (`absolute`) and reserving the same bottom padding on all six,
which makes them **85px each — 4px shorter in total** than the mismatched
version. Caught only because the tiles were re-measured after deploying
rather than eyeballed in the diff.

### 5. "Your donation is protected"

GoFundMe closes with *"We guarantee you a full refund for up to a year in
the rare case that fraud occurs."* Ours closes with the three situations
`/refund-policy` **actually commits to** — an unauthorised charge, a
campaign removed before funds are released, a campaign that fails
verification after you give — and **no time window at all**, because that
page sets none and inventing "up to a year" to match theirs would be a
refund promise the platform has not made. A test asserts the absence of a
window, so it cannot be added later without a decision.

---

## A correction to this project's own prior work

`docs/47` justified the descending preset ladder partly as mirroring
GoFundMe, citing `$1,000 / $500 / $350 / $100 / $50` observed on 2026-10-15.
Sampled five times today on the same campaign within one hour:

| Loads | Ladder | Badged |
|---|---|---|
| 4 | `$25 / $50 / $100 / $200 / $300 / $500` **ascending** | `$100` |
| 1 | `$300 / $200 / $100 / $50 / $25 / $10` **descending** | `$50` |

Neither matches the figures recorded yesterday, and the **dominant arm today
is ascending** — the opposite of what we copied. GoFundMe is A/B testing the
ladder, so "the market leader descends" was never a fact available on their
page.

Our order **stays descending**, now on the anchoring argument alone;
`docs/47` is amended and the code comment rewritten to say so. The general
lesson, which `docs/56` reached about fonts and `docs/59` about fees: **a
competitor's rendered page is evidence about one bucketed session.** An
experimenting competitor has to be sampled more than once before anything is
read off it. One load is an anecdote.

`SUGGESTED_AMOUNT` is `$100` because that is what four of five sampled loads
badge. That is a weak basis and it is the only external one available — this
platform has recorded no donations, so there is no mode of our own to
derive. Hence the word "Suggested": a recommendation we are making, with
nothing implying other donors chose it, because none have.

---

## Not done, and why

- **Payment-method chips (PayPal / bank transfer / card) before the form.**
  GoFundMe offers all three. We have no PayPal integration, and adding a
  processor is a vendor decision requiring its own ADR.
- **Rewriting the preset ladder for the monthly tab.** GoFundMe serves the
  same ladder on both tabs, so there is no gap to close; but our impact
  hints ("Week of groceries") are one-off framings being applied to monthly
  gifts, and `$1,000/mo` leads a ladder whose realistic monthly ceiling is
  lower. Recorded, not changed: it is an owner call about what to ask for.
- **The "Individual fundraisers are unaffected" line on `/donate`.** It is
  false *today*, but only because of the Stripe blocker above, and it
  becomes true the moment a working key is set. Encoding "is Stripe
  configured" into public copy would be the wrong fix for an operator
  problem.
