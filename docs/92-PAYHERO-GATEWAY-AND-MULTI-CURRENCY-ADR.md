# 92 — The PayHero/FinoQ M-Pesa gateway, and a multi-currency ledger

**Date:** 2026-10-21
**Status:** **DEPLOYED AND TAKING MONEY.** Released as **v85** on 2026-10-21.
Two real KES 50 donations collected over M-Pesa and recorded — the first in
this codebase's history — the second of them through the deployed donate page
in a real browser. Three named gaps remain open; see *Still open*.
**Supersedes:** the blocker in `docs/72` ("LastDonor has never been able to
accept money, and still cannot") on the KES rail only. Stripe is still dead.
**Amends:** `docs/82` (the KE/US tension it parked is now resolved — both),
`docs/47` (`Money` takes `minor` + `currency`, not `cents`).
**Read with:** `docs/41` (one writer for donation accounting), `docs/81` (a
webhook with no shared secret), `docs/84` (probing a provider rather than
reading about it), `docs/85` (an IP limit does not protect the thing at risk),
`docs/72` (a retryable-sounding message for a permanent fault).

---

## What was decided

1. **A multi-currency ledger**, not a single currency and not FX at capture.
2. **PayHero/FinoQ collects KES over M-Pesa**; Stripe keeps USD.
3. **A campaign has exactly one currency**, fixed once money arrives, enforced
   by a composite foreign key rather than by convention.
4. **The PayHero callback has no shared secret** and is never believed; the
   outcome is re-fetched over our own authenticated call.
5. **LastDonor's money is isolated by a minted reference namespace**, because
   the PayHero account is shared with another company.
6. **Per-phone-number abuse limiting**, in the database, because the party at
   risk is a bystander's phone and not us.

### Why multi-currency, and why now

The owner's direction, 2026-10-21: *"soon, we'll go global, so, use multiple
currency and countries. Payhero has finoq which covers most of african
countries. The rest of the world will be served by Stripe (we're working on
paperwork)."*

The alternatives were put with their costs, and these were rejected:

| Rejected | Why |
|---|---|
| **KES becomes the only platform currency** | Coherent, cheap, and wrong for a platform that intends to serve the rest of the world through Stripe. It would have had to be undone. |
| **Convert KES to USD cents at capture, storing the rate** | Preserves the USD invariant and touches no aggregate, but introduces an FX rate source and rounding into a ledger that has none, and makes payouts impossible: a Kenyan organiser cannot be paid USD through Stripe Connect. Worst of both. |
| **PayHero as a wallet top-up only, not attributed to campaigns** | Smallest blast radius and fully honest, but a donor could not fund a campaign, so it does not finish the issue. |

**Done now because the ledger was empty.** Verified against production before
the migration: `donations` 0 rows, `campaign_withdrawals` 0,
`refund_records` 0, `fund_pool_allocations` 0, and all 18 campaigns at
`raised_amount` 0. There was no money data to migrate. That will not be true
again, which is the entire reason this was not deferred.

### The invariant that replaces "there is no FX anywhere"

`src/lib/validators/payout.ts` used to say the ledger was USD cents end to end
and that nothing converted currency. The second half still holds. The first is
replaced by:

> **A campaign has exactly one currency. Every donation to it, every release
> and every withdrawal is in that same currency. Two currencies are never
> added together anywhere.**

That is what keeps `raised_amount += amount` correct arithmetic and the
`campaigns_released_lte_raised` CHECK meaningful. Where a cross-currency total
is genuinely wanted (platform statistics), it must be reported per currency,
never summed.

**Enforced in the database, not by convention.** `donations` carries a
composite foreign key on `(campaign_id, currency)` referencing
`campaigns (id, currency)`. Postgres has no cross-table CHECK and this project
has no triggers, so a composite FK buys the guarantee from machinery already
in use. Two consequences, both wanted:

- a KES donation against a USD campaign fails outright, instead of adding
  shilling minor units into a dollar total and corrupting every figure derived
  from it;
- a campaign's currency becomes **immutable once any donation exists**,
  because the UPDATE would orphan those rows.

`payhero_payment_requests` carries the same composite FK.

### Minor units, not cents

`src/lib/money/currencies.ts` carries each currency's ISO 4217 **exponent**
rather than assuming 2. KES happens to be a 2-decimal currency, so the first
non-USD currency could have been bolted on without this. It is built anyway:
four currencies in the intended African footprint — **UGX, RWF, XOF, XAF** —
are zero-decimal, and dividing those by 100 understates them 100×. The bug
would be introduced by whoever adds UGX, long after the person who left the
exponent implicit stopped looking.

`getCurrency` **throws on an unknown code rather than defaulting to USD.** A
fallback would be invisible: a shilling figure with a dollar sign still looks
like money.

---

## What PayHero actually does

Every claim in this section was **probed against the live API on 2026-10-21
with this account's credentials**. None of it is from the published docs, and
four of the behaviours contradict or are absent from them.

### Authentication — verified

`Authorization: Basic base64(api_username:api_password)`. Established by
trying all four plausible constructions against `GET /api/v2/wallets`:

| Construction | Result |
|---|---|
| `base64(username:password)` | **200** |
| `base64(username:api_secret)` | 401 `Unable to perform request` |
| the API secret, raw | 401 `given auth not correct` |
| the API password, raw | 401 `given auth not correct` |

**The API secret PayHero issues is not used by v2 at all**, and it is not a
webhook signing key either, because the callbacks carry no signature.
`.env.example` says so explicitly so nobody adds a `PAYHERO_API_SECRET`
expecting it to do something.

### Trap 1 — `success: true` does not mean the payment succeeded — verified

It reports that the API call worked. The payment outcome is in `status`, and
the two disagree:

```
{"success":true, …, "status":"SUCCESS", "provider_reference":"UJLJ8B7LT3"}
{"success":true, …, "status":"FAILED",  "amount":800}
```

Fourteen real settled payments on this account returned
`success:true / status:"SUCCESS"`; a failed one returned
`success:true / status:"FAILED"`. **A client that reads `success` books failed
payments as paid.** Only `status` is read, and anything that is not exactly
`SUCCESS` is not money. An undocumented status maps to `UNKNOWN` and leaves
the payment pending rather than being guessed at.

### Trap 2 — a blank reference returns another merchant's transaction — verified

`GET /api/v2/transaction-status` with the `reference` parameter **missing, set
to `""`, or set to a single space** answered **HTTP 200** four times in a row
with a stable record belonging to a different merchant:

```
{"success":true,"merchant":"peterkimari","phone_number":"0722468260",
 "amount":800,"status":"FAILED","external_reference":"Pay"}
```

Our own rows read `merchant:"muchs"`, and `0722468260` appears **0 times in
600** of this account's own transactions. It is not a random row and it is not
ours. Since that record's `status` is `FAILED`, the failure mode is *reading a
stranger's outcome as the answer about our donation* rather than a clean
error. `?reference=0` correctly 404s, so it is specifically the blank case.

`getTransactionStatus` refuses a blank reference **before a request is built**,
so no network call can be made without one. Reported upstream; not relied on
being fixed. A test asserts the refusal and names the reason, so nobody
reinstates a fallback.

### Trap 3 — `external_reference` is not a lookup key — verified

Querying `transaction-status?reference=<our own external_reference>` returns
404, even for a payment that settled and whose `external_reference` is visible
in `GET /api/v2/transactions`. Only PayHero's own `reference` and the M-Pesa
code resolve.

**Design consequence:** the reference returned at initiation *must* be
persisted or the payment becomes permanently unverifiable. That is the first
of three reasons `payhero_payment_requests` exists, and why an initiation
response without a reference is treated as a hard failure rather than a
pending row nobody could ever settle.

### Trap 4 — three error shapes, and `text/plain` carrying JSON — verified

```
401 application/json  {"status":401,"success":false,"message":"Unauthorized. …"}
400 text/plain        {"error_code":"invalid_argument","error_message":"…","status_code":400}
400 application/json  {"error_code":"request_failed","error_message":"Failed to perform request. Please try again","status_code":400}
404 application/json  {"error_message":"Endpoint not found"}
```

So the message key is `error_message` **or** `message`, and `Content-Type`
cannot be trusted to decide whether to parse. Bodies are read as text and
parsed opportunistically; a non-JSON 502 produces a clean `PayHeroApiError`
rather than a JSON parse error that hides the cause. This is the same trap
`docs/84` recorded for Africa's Talking.

### A retryable-sounding message for a permanent fault — verified

An unregistered `channel_id` answers 400 `request_failed` with **"Failed to
perform request. Please try again"**. Trying again cannot create a payment
channel. This is the `docs/72` trap in PayHero form, where a dead Stripe key
produced "Failed to create checkout session" and invited a retry that could
never succeed. `classifyInitiationFailure` separates `configuration` from
`rejected` and `transient`, so a donor is never told to retry into a wall.

### Abuse protection, which constrains testing — documented by PayHero

More than 10 successive failed or cancelled STK requests to the **same phone
number** blocks that number for **24 hours**. Over 50 failed requests
account-wide in a 6-hour sliding window restricts the account for 4 hours; 500
for 24 hours; 1000 for 72 hours. **A cancelled prompt counts.** This is why
`initiateStkPush` validates everything it can locally before spending a
request, and why the live test budget was treated as scarce.

### What the live collection added — verified 2026-10-21T03:39Z

Three facts no documentation gave us:

- **The initiation response echoes `external_reference`.** Undocumented, and
  useful: it confirms at initiation that the reference PayHero recorded is the
  one we minted.
- **`CheckoutRequestID` is populated at initiation and empty in the status
  response** for the same payment (`ws_CO_21102026063859220713572703` →
  `""`). It cannot correlate the two; `reference` is the only durable link.
- **The callback never arrived and the donation settled anyway.** It was
  addressed to `lastdonor.org`, where this branch is not deployed, so
  PayHero's POST went nowhere and the status poll settled the payment unaided.
  That is exactly the independence the poll path was built for, demonstrated
  by accident on the first real payment.

---

## Two corrections to this project's own work, made by the live test

### The published fee table does not match what this account is charged

`GET /api/transaction_fees` (no authentication) advertises **KES 6** for the
50–499 band. Measured against this account's own ledger:

| | |
|---|---|
| published tier for KES 50 | KES 6 |
| **actually charged on our KES 50 collection** | **KES 8.9** |
| actually charged on two earlier KES 200 collections | KES 8.9 |

So the fee is a **flat KES 8.9**, not tiered. The absorbed cost at the KES 50
floor is therefore **17.8%**, not the 12% first documented — 8.9% at KES 100,
1.8% at KES 500.

This is the `docs/66` lesson again, which that doc stated as *measure the path
the actual calls take*: there, an IP allow-list was advised from a `curl`
measurement while the real calls egressed from a different address.

### The service wallet is a fee float, not collected funds

First written here as "collections raise this number". They lower it:

```
before the KES 50 collection ....  2248.0
after it ........................  2239.1    (down 8.9, not up 41.1)
```

The KES 50 settled to the configured payment channel — the National Bank
paybill — and the service wallet was **debited** the KES 8.9 fee.

Two consequences:

1. It can never be a LastDonor figure, on any page or in any report. It is
   not our money and it is not donation money.
2. **It is an operational ceiling on collecting at all.** At a flat KES 8.9
   per collection, a float of 2,239 buys roughly **250 more donations** before
   collections start failing for want of fee credit — for a reason no donor
   could act on. `/api/v1/health` now reports a low float as an error while it
   is still fixable.

**The health endpoint publishes no figures.** It is in `PUBLIC_API_ROUTES`,
and the balance belongs to an account shared with BETWOIN LTD, so publishing
it would leak another company's operating float to anyone who curls the URL.
Only a derived collection count crosses the boundary, and two tests assert
that the balance never appears in the response body.

---

## Isolation from BETWOIN LTD

The PayHero account is **shared with another of the owner's companies**:
792 transactions, real inbound M-Pesa from roughly eight recurring numbers
unrelated to LastDonor, merchant name `muchs`, and one bank channel (12226,
National Bank paybill 547700). The owner confirmed the provenance:
*"The other traffic comes from BETWOIN LTD which is my other company"*, and
asked for *"a serious isolation approach"*.

This is the `docs/86` pattern, where the Africa's Talking app in use belongs
to another product — but it is **not** the same failure. PayHero's
`callback_url` is **per request**, not one-per-app, so sharing does not break
callbacks the way it broke SMS delivery reports.

The isolation is four rules, each enforced in code with tests:

1. **Every LastDonor reference is minted as `LD-<uuid>`.** `initiateStkPush`
   refuses anything else at the one place a reference reaches the wire.
2. **A callback is acted on only if its `ExternalReference` matches a row this
   platform wrote.** Anything else — BETWOIN's traffic, a replay, a forgery —
   resolves to no row and is refused *before any network call*, so this route
   cannot be used to probe their transactions either.
3. **The status poll accepts only our reference, never PayHero's.** Handing an
   arbitrary caller's string to PayHero's status endpoint would expose a shared
   account, and that endpoint already leaks a stranger's transaction on a blank
   reference.
4. **Account-wide figures are never LastDonor figures.** The service wallet is
   shared, so BETWOIN's fees draw on the same float.

The settled amount is also checked against the amount requested before
anything is booked. A mismatch is `critical` and **not** recorded, because on
a shared account an amount mismatch is also what a reference collision would
look like.

---

## Why the callback has no shared secret

PayHero signs its callbacks with **nothing**: no HMAC, no shared secret, no
timestamp. The API secret is not a signing key (see *Authentication*). So
there is nothing to verify a body against, and a design that trusted the body
would let anyone who learns the URL assert a donation by POSTing
`{"response":{"Status":"Success","Amount":500000}}`.

The route therefore reads **one** value from the body — the
`ExternalReference` we minted — and `settlePayHeroRequest` asks PayHero over
our own authenticated call what actually happened. This is exactly the shape
`docs/81` settled for the Didit webhook, for the same reason.

What it buys:

- no secret to configure, rotate or leave unset, so the failure mode where an
  unset secret silently disables payments cannot happen;
- a forged request cannot assert an outcome — the worst it can do with a real
  reference is make us re-read a status we are entitled to read;
- a reference that is not ours changes nothing, which is also rule 2 above.

What it costs: one outbound call per callback.

It answers **200 to almost everything**, because a provider that receives a
4xx or 5xx retries, and retrying cannot turn an unknown reference into a known
one. Only a genuine failure on our side returns 5xx, so that a retry has
something to accomplish.

---

## Settling is single-shot

The callback and the donor's own status poll race routinely. Both call the
same `settlePayHeroRequest`, which claims the row with
`UPDATE … WHERE status = 'pending' RETURNING` — the pattern `docs/41`
established for refunds. Of two concurrent settlements exactly one gets a row
back, so exactly one records a donation. The unique index on
`donations.stripe_payment_id` is the durable backstop underneath.

### One writer, two gateways

`processPaymentTransaction` and every side effect now take a provider-neutral
`GatewayCharge` instead of a `Stripe.PaymentIntent`. `recordGatewayCharge` is
the shared entry point; `processPaymentSuccess` is a thin Stripe adapter onto
it with an unchanged signature, so the webhook route, the confirm route and
their tests were untouched.

`docs/41` established one writer for donation accounting after four
independent refund implementations had drifted apart, three of them wrongly. A
second gateway carrying its own copy of the campaign-tally, single-shot
completion, fund-pool, echo-counter, receipt and notification logic would have
recreated that, in the half of the code that moves money.

### `stripe_payment_id` is now the provider-reference column

Deliberately **not renamed**, and this is recorded as debt rather than
defended. Its unique index is the only durable protection against a duplicate
webhook creating a second donation row, CLAUDE.md forbids dropping it, and the
rename is a 20-file mechanical change with no functional benefit to this work.
Values are namespaced per provider so two gateways can never collide:
`pi_…` (Stripe), `payhero_…` (PayHero), `seed_…` (fabricated rows — the
precedent, set in `src/lib/seed/simulation-engine.ts`). **Read `provider` to
know which; never pattern-match the prefix.**

---

## Three guards that stop a materially wrong amount of money

1. **Withdrawals now check the campaign's currency, not only the connected
   account's.** The existing guard compared the Connect account's settlement
   currency against `PLATFORM_PAYOUT_CURRENCY`, which was complete while every
   campaign was USD. A KES campaign whose creator happens to hold a
   USD-settling account passed it, and `amount` — KES minor units — would go
   to `transfers.create` under `'usd'`. **KES 100,000 raised would pay out
   US$100,000, roughly 130× the money that exists**, from a platform balance
   that does not hold it.

2. **Every refund path checks the provider before calling Stripe.** All four
   sites would have handed a `payhero_<reference>` to
   `stripe.refunds.create`. PayHero exposes no refund API, so those are
   reported as needing a manual refund: the ledger is still corrected, but
   nobody is told the donor has been paid back when they have not.

3. **`create-checkout` refuses a campaign Stripe is not the rail for.** It
   hardcoded `currency: 'usd'` on both line-item branches; a KES campaign's
   `unit_amount` would have been charged as dollars, roughly 130×, and
   recorded against a shilling ledger with no FX layer to reconcile it.

Guard 3's sibling in the write path was **found by a test, not by reasoning**.
Checking only that the charge and campaign currencies *agree* let `'' === ''`
through, and the first thing to fail was then `formatMoney` **inside** the
transaction, after the donation row had been inserted — losing a real donation
to a rollback whose error message was about string formatting. Both must now
also be *supported*.

---

## Protecting a bystander's phone

`POST /api/v1/donations/payhero/initiate` must be callable by a guest; guest
donation is a core product requirement and the Stripe checkout route is public
for the same reason. But unlike a card checkout, **this endpoint makes a phone
number supplied in the request body ring.** The obvious abuse is not fraud
against us:

> An attacker posts a stranger's number repeatedly. The stranger's handset
> fills with M-Pesa prompts they did not ask for. After 10 unanswered ones,
> PayHero blocks that number from receiving STK pushes **for 24 hours** — so
> the attacker has also denied a real person the ability to pay for anything
> through any merchant on that provider. At 50 unanswered pushes in 6 hours,
> PayHero restricts **our whole account**, taking down the platform's only
> working payment rail.

**An IP rate limit does not address this.** The protected party is the phone
number, and a distributed caller changes IP freely while the victim's number
stays the same. `docs/85` reached exactly this conclusion about six-digit
codes — *"an IP rate limit does NOT protect a six-digit code"* — and put the
counter on the row.

So `src/lib/payhero-abuse-guard.ts` counts **per number**, in the database
rather than in Redis: Upstash is best-effort in this codebase and a limit that
evaporates is not a limit on something that ends in a 24-hour block for a
bystander. Three rules:

| Rule | Value |
|---|---|
| One live prompt at a time | while `pending` and younger than `PROMPT_LIFETIME_MS` |
| Cooldown after a resolved attempt | 20s |
| Ceiling per number per hour | **5** |

The ceiling is deliberately **below** PayHero's 10: ours is a guard, theirs is
a punishment, and this platform must never be the thing that gets a bystander
blocked for a day.

### Rate-limit tiers, and an ordering trap

All three routes needed their own tier **placed before the
`/api/v1/donations` line in both lookups** — the trap `docs/85` records for
`sms` sitting ahead of `/api/v1/users`, since prefix matching is first-wins
and a more specific tier placed after a more general one never fires.

| Route | Tier | Why |
|---|---|---|
| `initiate` | **5/60s** | Tightest on the platform, alongside `sms`. The outer bound only; the real control is per number. |
| `status` | **120/60s** | An honest donor polling a three-minute prompt every 5s makes ~36 requests. Under the `donations` tier (10/60s) they would be 429'd mid-payment — the same defect the `sms` tier once had, where five requests of ordinary use tripped a five-request limit. |
| `callback` | **60/60s** | Provider traffic. Note the path says `callback`, not `webhook`, so it is **not** covered by the blanket `/webhook` exemption in `checkRateLimitAsync` — deliberately. |

---

## The donate page

The campaign's currency chooses the rail, because the rails are not
interchangeable. Offering both and letting the server refuse would show a
donor a payment method that cannot work for the campaign in front of them.

`MpesaDonationForm` is a separate component rather than a branch inside the
1,000-line Stripe form, which is built around `loadStripe` and
`EmbeddedCheckout` — neither of which can participate in an STK push.

**The waiting screen is the design problem.** Nothing happens until the
donor's attention moves from the page to their handset. Research on payment
waits is consistent about where the damage comes from: not slowness, but not
knowing whether to wait or walk away, and a payment step that looks
unresponsive reads as a failure and shows up as drop-off rather than as a
declined payment. So:

- **"Check your phone"** is the heading, with the amount restated beside the
  instruction;
- a **live elapsed counter**, and deliberately **not a progress bar** — a bar
  would be a lie, because we know neither how long the donor will take nor how
  long the prompt lives;
- an explicit **"do not start another payment"**, which matters more here than
  on a card form: a second request is a second prompt on their handset, and
  two unanswered prompts are two of the ten.

The submit button carries the `useRef` latch `docs/42` put on the Stripe one,
because React state is not synchronous and two taps in a tick both read the
old value. A test taps three times and asserts exactly one request.

**Failure copy names no single cause.** PayHero reports a cancelled prompt, an
expired prompt and insufficient funds all as the one value `FAILED`. Picking
one would mean telling a donor something they may know to be wrong, which is
worse than telling them nothing.

### `Money` takes `minor` and `currency` (amends `docs/47`)

`cents` was accurate while the ledger was USD-only and becomes a 100× lie the
moment a zero-decimal currency is enabled. Renamed across all 18 call sites.
`currency` defaults to USD — correct for every figure rendered before this,
wrong for every figure afterwards — so
`src/components/ui/money-currency.ratchet.test.ts` counts the call sites that
omit one, caps them at the current 18, and fails the build if that grows.

---

---

## Deployed, and tested through a browser

Released as **v85**, 2026-10-21, from `claude/sharp-carson-c92fuf` via
`flyctl deploy`. `PAYHERO_API_USERNAME`, `PAYHERO_API_PASSWORD` and
`PAYHERO_CHANNEL_ID=12226` were staged with `--stage` first, so the deploy was
the only restart. The `release_command` migration step **completed
successfully as a no-op**, as predicted: all seven journal entries were
already applied and `max(created_at)` already equalled the newest `when`, so
drizzle had nothing to do.

Two deploy-time obstacles, both environmental rather than code:

- **Depot's builder failed TLS**: `x509: certificate signed by unknown
  authority`, because this sandbox's TLS-inspecting proxy re-terminates the
  gRPC connection and flyctl's Go client was not reading the proxy CA.
  `SSL_CERT_FILE=/root/.ccr/ca-bundle.crt` plus `--depot=false` (Fly's own
  remote builder) deployed cleanly.
- **Playwright's pinned browser was absent**: the project pins a newer
  `@playwright/test` than the image's Chromium (it wanted
  `chromium_headless_shell-1208`; the image has `1194`). Launched with an
  explicit `executablePath` rather than downloading one.

### Verified on production after the deploy

| Check | Result |
|---|---|
| `/`, `/campaigns`, `/donate`, `/how-it-works`, `/login` | 200, no regression |
| `/api/v1/health` | `degraded` — `database` ok, **`payhero` ok**, `redis` ok, `stripe` error (the known dead key) |
| `POST /payhero/initiate` with no body | 400 `VALIDATION_ERROR` — reachable, not 401 from default-deny |
| `GET /payhero/status` with no reference | 400; with an unknown reference, 404 |
| **Forged callback** `{"Status":"Success","Amount":9999999}` | **ignored** — `{"ignored":"unknown reference"}` |
| Callback with a BETWOIN-shaped reference (`INV-009`) | ignored |

The forgery result is the one worth keeping: the production endpoint accepts
an unauthenticated POST claiming a nine-million-shilling success and records
nothing, because the reference is not one it minted. Both attempts are in the
production log as `[payhero/callback] reference is not one of ours; ignoring`.

### The browser test

Real Chromium, 390×844, against `https://lastdonor.org`:

```
document height            1,333px
visible "$" amounts        NONE
preset ladder              Ksh 2,000 / 1,000 / 500 / 200 / 100 / 50
pay button                 "Send M-Pesa request for Ksh 50.00"
fee ledger                 Your donation Ksh 50.00 | platform fee Ksh 0.00
                           | Total charged today Ksh 50.00
console errors             none
```

No console errors matters more than it looks: `docs/63` and `docs/64` record
that the CSP blocks `unsafe-eval`, so a client component that fails to hydrate
is silently inert. The preset tiles responded to a real click, so this form
hydrates on the deployed CSP.

Then, with the owner holding the handset:

```
POST /payhero/initiate   200  {reference: LD-fcc5ff1d-…, status: QUEUED}
                              waiting screen rendered after 2,376ms
GET  /payhero/status     200  pending
GET  /payhero/status     200  pending
GET  /payhero/status     200  pending
GET  /payhero/status     200  succeeded
                              settled after 17.4s, 5 API calls total
```

Database afterwards: a second `donations` row,
`stripe_payment_id = payhero_UJLJGAURG3`, `provider = payhero`,
`currency = KES`, `amount = 5000`; its collection request `succeeded` and
linked to it; the campaign at `raised_amount 10000`, `donor_count 2`.

**Exactly one donation per push, with both the callback and the poll live.**
That is the single-shot claim holding under the real race rather than only in
a unit test.

### What the deploy did NOT settle

**Whether PayHero ever POSTs the callback is still unproven, and the earlier
claim that it does not was too strong.** The callback route only logs on the
path where it *ignores* a reference; a callback it successfully acts on
returns 200 silently. So the absence of a log line is not evidence of absence.
What is established: the endpoint is reachable from the internet, it rejects
forgeries, and **the status poll settles payments entirely on its own** — now
twice. Treat the poll as the primary mechanism and the callback as an
accelerator, which is how the code is already written. Settling this needs a
log line on the success path.

**The donation receipt email is still untested.** Production holds its own
`RESEND_API_KEY` whose value cannot be read, and neither of the two
collections was recorded through `recordGatewayCharge`'s receipt path in a way
that was observed sending — the first was a script, and the second's receipt
outcome was not checked in the logs.

### A pre-existing production fault found while reading the deploy logs

```
[auth] role lookup failed: QueryTimeoutError: Database query exceeded 15000ms.
  The connection pool may be wedged; see src/db/query-timeout.ts and docs/37.
  at .next/server/src/middleware.js
```

Nine occurrences in nine minutes, roughly once a minute. **Not caused by this
work:** `src/lib/auth.ts` is untouched by this branch (an empty
`git diff main..HEAD` against that path) and the message predates it.

It is also **not** the `docs/87` wedge. Checked while it was happening:
every backend was `idle` with no open transaction (`xact_start` null), where
the wedge signature is `state=active` + `Client/ClientRead` with a transaction
open for hours. And the database is not slow — the exact `readRole` query
plans and executes in **0.126 ms** on a 184 kB, 7-row table, with zero queries
active over one second.

So a 15-second client-side timeout is firing on a query the database answers
in a fraction of a millisecond, from **middleware specifically**. The build
warns that middleware bundles `src/db/index.ts` through `src/lib/auth.ts`
("A Node.js module is loaded ('stream') which is not supported in the Edge
Runtime"), which is the obvious place to look: a per-request middleware
context cannot reuse the module-level pool the way a route handler does.

### FIXED 2026-10-21, released as v89

Two changes, because there were two defects.

**Root cause: middleware no longer queries the database.** `readRole` returns
before touching it when `NEXT_RUNTIME === 'edge'`. `undefined` already meant
"could not tell" and the existing role claim is kept, so the behaviour is
unchanged — it just costs nothing instead of 15 seconds and a cancelled
connection. Revalidation is not lost: `auth()` runs in 69 files under
`src/app`, all Node runtime, which is also the only place a privileged action
can happen. Checked against `'edge'` explicitly rather than for the absence of
`'nodejs'`, so an unset variable still does the real lookup.

**The amplifier, which was the more dangerous half.** The fail-open branch
read "keep the claim but do NOT advance `roleCheckedAt`, so the next request
retries". With a lookup that can never succeed, **every** request spent the
full 15-second budget and then a cancel — the cost scaled with traffic rather
than with the 60-second revalidation interval, so a single admin tab made it
continuous. A failed lookup now backs off 30 seconds, bounding it to one
attempt per session per 30s however much traffic arrives. 30s is deliberately
under the 60s interval so a recovered database is picked up by the next
request; `roleCheckedAt` is still not advanced, for the same reason.

Security is unchanged in kind: the fail-open window goes from "up to one
interval" to "up to one interval plus one backoff", and the argument already
in the code covers it — every privileged route needs the same database, so a
window in which it is unreachable grants no usable capability. Expiry and the
deleted-user case are checked before any of this; tests pin both.

**Evidence it worked, and its limit.** Before the fix the failure was exactly
one per minute at `:00`, 05:40:00 through 05:48:00. The new machine started
05:48:20Z and `05:49:00Z` — the next minute boundary, inside the same log
window — has no failure. That is **one** clean boundary, not a long
observation: `flyctl logs --no-tail` returned a fixed buffer that would not
advance past 05:49:09Z, so a longer window was not available in that session.
The mechanism is established by the code path and 13 tests; the production
evidence is one data point consistent with it.

`readRole` catches it and returns `undefined`, so it degrades rather than
failing a request — every page still answered 200 and the donation completed
through it. **Deliberately not fixed here.** It sits in the auth and pool
core, which has produced three incidents (`docs/37`, `docs/52`, `docs/87`),
and `docs/52` happened precisely because a half-understood guard was added to
that code. It needs its own investigation.

---

## Numbers, and whether they are measured or assumed

| Value | Status |
|---|---|
| KES ceiling 250,000 per transaction | **Verified** — Safaricom published tariff, 2026-10-21. A larger push cannot succeed, so offering it would produce a failure the donor cannot act on. |
| KES daily limit 500,000 per subscriber | **Verified**, same source. Not knowable from our side; handled in failure copy. |
| PayHero fee: flat KES 8.9 | **Measured** on this account, 2026-10-21. Contradicts the published table (KES 6). |
| KES floor 50 | **Decision**, now at a known cost of 17.8% absorbed. |
| `PROMPT_LIFETIME_MS` = 3 min | **ASSUMED.** Published STK timeout figures disagree — 30s, 60s, "about 90", "1–3 minutes depending on the handset" — and none is from Safaricom's own documentation. Set at the long end: too long costs a donor a wait, too short costs two prompts on one handset. The live test settled in 18s because the owner approved quickly, so it **measured nothing**. |
| Poll interval 5s | Convention from current M-Pesa integration guidance, not measured. |
| Fee float ≈ 250 collections remaining | **Derived** from the measured flat fee and the observed balance. |

---

## Still open

1. **Production runs code that is not on `main`.** v85 was deployed from
   `claude/sharp-carson-c92fuf`, so production is ahead of `main` until that
   branch is merged. That drift is the one thing left from the deployment
   step, and it is deliberate: the branch was deployed and proven first, and
   merging is the owner's call.
2. **A KES campaign cannot be paid out.** Stripe Connect cannot settle KES,
   and the withdrawal route now correctly refuses a non-USD campaign. A KES
   campaign can be funded and not withdrawn. PayHero exposes a withdrawal
   endpoint (`POST /api/v2/withdraw`) which has **not** been probed or built —
   `docs/81` forbids shipping an unexercised provider path.
3. **18 `<Money>` call sites still default to USD.** `CampaignCard`,
   `SidebarDonationSummary`, `DonorFeed`, `ImpactTiers` and the admin payout
   screens read amounts off campaign rows. While every live campaign is USD
   they are correct; **the first published KES campaign makes them print
   shilling figures with a dollar sign.** No KES campaign is live (the gateway
   test campaign is archived), so nothing is wrong today. Must close before
   one goes public.
4. **The real prompt lifetime is unmeasured**, as above.
5. **`areaServed: United States`** in `src/app/layout.tsx`, and
   `/terms` stating a `$5.00 USD` minimum and `$100,000.00 USD` maximum, are
   now incomplete rather than merely in tension with
   `SMS_DEFAULT_REGION=KE` (which is what `docs/82` parked). The platform
   collects shillings. Correcting public legal copy is an owner decision and
   is flagged, not invented here.
6. **PayHero's blank-reference leak** is reported upstream and unfixed. The
   client guards against it; nothing else should rely on it being fixed.

### Credential audit, 2026-10-21 — and one verdict of mine that was wrong

Checked at the start of the session, **re-checked properly afterwards.** The
first pass got the Cloudflare verdict wrong and did not distinguish "this key
is dead" from "this is not the key production uses".

| Credential | Verdict | Evidence |
|---|---|---|
| Cloudflare API token | **VALID AND ACTIVE** | Corrected. It is an **account-owned** token (`cfat_` prefix), which verifies at `GET /accounts/{id}/tokens/verify` — **200, `"This API Token is valid and active"`**. My first pass called `/user/tokens/verify`, which is for user-owned tokens and answers **401 `Invalid API Token`** for this one. The 401 was my wrong endpoint, not a dead key. Confirmed working against `/accounts/{id}`, `/workers/scripts` and `/r2/buckets`. |
| R2 S3 credentials | **VALID** | `ListBuckets` 200. The access key id is the Cloudflare token's own id, which is how R2 derives S3 credentials. Buckets are `nostrel-kyc` and `pantheons-web-staging-opennext-cache` — neither is LastDonor's, consistent with uploads going to Supabase Storage (`docs/68`), not R2. |
| `RESEND_API_KEY` (as supplied) | **Rejected by Resend** | `400 {"statusCode":400,"message":"API key is invalid","name":"validation_error"}`, consistently, from three different clients. |
| `RESEND_API_KEY` (production) | **Exists, and is a different key** | Fly's `lastdonor` app has 29 secrets set, `RESEND_API_KEY` among them. Values are not readable, so the two cannot be compared directly — but production having its own means the supplied key is most likely **stale or rotated rather than production's**. This reconciles with `docs/73`, which found the production key working and all 7 emails delivered; **that finding is NOT overturned.** |
| Upstash credential (as supplied) | **Wrong credential type** | `401 token contains an invalid number of segments` from the management API. |
| Upstash (production) | **Set and in use** | `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are both set on Fly. These are what rate limiting and cron locks actually read, so neither is degraded. |
| `PAYHERO_*` | **NOT SET on Fly** | None of `PAYHERO_API_USERNAME`, `PAYHERO_API_PASSWORD`, `PAYHERO_CHANNEL_ID` exists in production's 29 secrets. This is a deployment prerequisite, not a fault. |
| Namecheap | Reached the API | Refused only for an IP allow-list, expected from a sandbox. |

**Why the first Resend pass could have been an edge block rather than a key
verdict, and how that was ruled out.** On re-test, `api.resend.com` answered
`403` with the bare body `error code: 1010` — which is *Cloudflare's* block
page, not Resend's JSON, so those requests never reached Resend at all.
Setting any ordinary `User-Agent` got through, after which Resend itself
returned the `400 API key is invalid` above. The sandbox's default
user-agent-less request is blocked at Resend's edge on browser signature.

That is the `docs/90` shape — where the same probe reported 49 live feeds from
the sandbox and 72 from Fly, because four publishers 403 the sandbox proxy at
IP/ASN level. **Always check whether a 4xx came from the service or from
something in front of it.** A bare `error code: NNNN` text body is Cloudflare;
a JSON envelope is the service.

### What this means for the work in this document

`docs/92` previously said mail delivery was broken and that the donation
receipt would not send. **That was overstated.** Production holds its own
Resend key and `docs/73`'s finding stands; the receipt path is untested only
because no donation had ever existed before this one, and the KES 50
collection was recorded by a script that does not send mail. Whether
production's key still works is **unverified** — confirming it means asking
production to send, which has not been done.

The `docs/66` cron Worker is also confirmed alive with this token:
`lastdonor-cron`, one `*/5 * * * *` trigger, created 2026-10-18T00:41:45Z,
exactly as that doc records. Account-wide there are now **4 Workers and 2 cron
triggers** (`lastdonor-cron`, `pantheons-jobs-staging`), so against the free
cap of 5 per account there is headroom for three more — `docs/66` was written
when the shared account looked tighter than it currently is.

Namecheap's key reached the API and was refused only for an IP allow-list
(expected from a sandbox). The direct `DATABASE_URL` could not be verified
from here at all: raw Postgres cannot traverse this environment's
TLS-inspecting proxy, which establishes a CONNECT tunnel and then waits for a
TLS ClientHello while Postgres sends a plaintext 8-byte SSLRequest first. All
database work in this session went over the Supabase HTTPS SQL endpoint.

---

## A note on method

Four of the behaviours in *What PayHero actually does* are absent from or
contradict the published documentation, and both corrections in this document
came from a single real KES 50 payment rather than from reading. The pattern is
now established across `docs/84` (Africa's Talking answers 201 for a failed
send), `docs/66` (an IP allow-list advised from the wrong egress address),
`docs/90` (a feed list "verified" from a laptop would have deleted nine
working feeds) and this one.

**A provider's documentation describes the API they meant to build.** For
anything that moves money, the only trustworthy source is a request you made
yourself, against the account you will actually use, from the place the calls
will actually come from.
