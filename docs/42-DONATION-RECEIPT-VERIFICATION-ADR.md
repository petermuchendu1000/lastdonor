# 42 - Donation receipts come from Stripe, not from the URL

**Date:** 2026-10-15
**Status:** Accepted, implemented in this change
**Supersedes:** nothing. **Amends:** nothing. **Related:** docs/29 (audit),
docs/31 (remediation plan), docs/41 (journey remediation)

Three defects were found on the donation path by a live browser audit of
production on 2026-10-15. All three are **verified**, by the auditing agent in
the browser and re-read in the code here. Each is recorded below with what was
decided, what was rejected, and what the fix costs.

---

## D1. The "Thank you" receipt was produced from the query string

### What was there (verified)

`src/app/campaigns/[slug]/donate/page.tsx` decided a donation had succeeded
from the URL and nothing else:

```ts
const isDonationSuccess = resolvedParams.donation === 'success';
const confirmedAmountFromUrl = isDonationSuccess && rawAmount >= 500 && rawAmount <= 10_000_000
  ? rawAmount : undefined;
```

No PaymentIntent lookup, no Checkout Session lookup, no database read. Loading

```
/campaigns/<real-campaign>/donate?donation=success&amount=10000000
```

rendered "Thank you. Your **$100,000.00** donation to \<campaign\> is on its
way. A donation confirmation is being emailed to you now.", with
WhatsApp / Facebook / X / email share buttons, on the real domain, naming a
real beneficiary, on a page that simultaneously said "$0 raised - 0 people have
donated". The range check in that expression is why `10000000` worked and
`abc` or `-500` fell back to the form.

Two more sources of the displayed amount were equally unverified: a
`sessionStorage` key (`lastdonor_donation_amount`) the browser wrote before
paying, and `setConfirmedAmount(data.amount)` from the submitted form values.

The mirror defect: `?donation=cancel`, `failed` or anything else dropped the
donor back on an empty form with no acknowledgement that their payment had been
declined or abandoned.

### Decision

**A receipt is rendered only from a state Stripe reported, and the amount shown
is the amount Stripe reported.** One function owns that judgement:
`src/lib/donations/verify-return.ts` → `verifyDonationReturn()`, which returns
one of four states:

| State | Means | Rendered as |
|---|---|---|
| `succeeded` | Stripe says the money moved | the receipt, with Stripe's amount |
| `processing` | Stripe has it, not settled | "We are confirming your payment" |
| `failed` | declined, cancelled, abandoned, expired | "Your donation was not completed" + recovery |
| `unverified` | no id, unknown id, wrong campaign, Stripe unreachable | the same confirming screen. Never a receipt |

Two checks, both required:

1. **Status**, from the PaymentIntent (`succeeded` / `processing` /
   `requires_payment_method` / `canceled` / …), falling back to the Checkout
   Session's `payment_status` when no PaymentIntent exists yet.
2. **Ownership**: the Stripe metadata must name *this* campaign. A genuine
   succeeded payment for campaign A renders no receipt on campaign B's page.
   This works because `create-checkout` writes `campaignId` into the Checkout
   Session metadata and onto the PaymentIntent (**verified** in
   `src/app/api/v1/donations/create-checkout/route.ts`); recurring donations
   carry it on the session and subscription only, because Stripe rejects
   `payment_intent_data` in subscription mode (**verified**: existing comment
   plus `resolveSubscriptionMetadata` in `payment-service.ts`, from docs/29
   P1-2).

Where each surface now gets its answer:

- **Redirect return** (`?donation=…&session_id=…`): the server component awaits
  `verifyDonationReturn()` before rendering. Zero-flash, and no client code is
  trusted.
- **In-page embedded completion** (`onComplete`): the form moves to the pending
  screen and asks `POST /api/v1/donations/confirm`, which performs the same
  verification server-side. `create-checkout` now returns `session.id`
  alongside the client secret so the client has an id to ask about. (It was
  already inside the client secret; returning it explicitly avoids parsing it.)
- **Still settling**: the donate page re-asks the confirm route up to 3 times,
  2.5s apart, then leaves the pending copy in place.

`create-checkout`'s `return_url` no longer carries `&amount=`: the page would
have to ignore it anyway, and a plausible-looking amount in a shareable URL is
exactly the artefact that made the forged receipt convincing.

The confirm route still records the donation (`processPaymentSuccess`) so a
donor is not waiting on the webhook, and it still requires nothing but ids plus
the campaign. It now **refuses to confirm a payment whose metadata names a
different campaign**, and it no longer returns an amount for a payment it did
not verify as succeeded.

### Rejected

- **Read `donations` by `stripe_payment_id` instead of calling Stripe.** It is
  one query and no vendor dependency, but it answers "has our webhook landed
  yet" rather than "did the money move", and the webhook is asynchronous. On
  the happy path it would show "we cannot confirm this" to donors whose payment
  had plainly succeeded. Stripe is the authority on Stripe's state; the DB is a
  projection of it.
- **Keep the URL amount as a "zero-flash" optimistic render and correct it
  afterwards.** This is what the old comment claimed to be doing ("primary
  source; sessionStorage and confirm API are fallbacks"). An optimistic receipt
  is a receipt: it is screenshot-able, shareable, and in the `?amount=` case it
  is never corrected because there is nothing to correct it against.
- **Sign the return URL (HMAC over campaign + amount).** It would stop a
  hand-typed URL, and it needs no Stripe call. Rejected because it proves only
  that *we minted the link*, not that the payment succeeded: a donor who
  abandons checkout still holds a validly signed success URL. It also adds a
  key to rotate for a weaker guarantee.
- **Render nothing at all on the return leg and send donors to the campaign
  page.** Honest, and the cheapest possible fix, but it throws away the receipt
  the donor is owed at the one moment they are looking for reassurance.
- **Hide the share buttons but keep the text.** The fabricated claim is the
  text; the share buttons only distribute it.

### Trade-off accepted

Two Stripe API calls (session + intent) on the donation return leg, on a page
that is already dynamic and already behind a payment. A Stripe outage now
degrades the return leg to "we are confirming your payment" instead of
(falsely) succeeding - deliberate, and the direction we want to fail in. The
donor can be shown a pending screen for a payment that in fact succeeded
seconds later; the receipt email and the campaign page both still arrive.

### Copy claim: the receipt email

"A donation confirmation is being emailed to you now" was reworded to "A
receipt is on its way to the email address you gave us", and it is now only
reachable from a Stripe-verified success. The underlying claim is
**substantiated**: `processPaymentSuccess` fires `sendDonationReceipt` for every
donation row it inserts (`src/lib/services/payment-service.ts`), from
`receipts@lastdonor.org`, subject `Donation Receipt - <campaign title>`, with
two retries. Two caveats, which is why the copy promises a send and not an
arrival: the send is fire-and-forget through `safeAsync`, and a signed-in donor
with `preferences.emailDonationReceipts === false` gets none.

---

## D2. `/donate` (the navbar CTA on every page) was a dead end

### What was there (verified)

`GENERAL_FUND_CAMPAIGN_ID` in `src/lib/constants.ts` is the hardcoded uuid
`d7fcb01f-468a-49e1-848f-bee7377a35ea`. **Verified against the production
database on 2026-10-15 by the auditing agent: no `campaigns` row carries that
id.** So `POST /api/v1/donations/create-checkout` answered every submit from
`/donate` with `404 NOT_FOUND` "Campaign not found or not accepting donations",
while the page rendered a complete, inviting donation form in front of it. The
constant's own comment says the id "must match the actual row in the campaigns
table". It does not. This is not a Stripe-key problem and will 404 on launch
day too.

### Decision

`/donate` checks server-side whether the general fund exists **and is
donatable**, using a predicate deliberately identical to the one
`create-checkout` enforces (`id` + status in `active` / `last_donor_zone`). If
it is not, the page renders no donation form. In its place: a plain statement
that the general fund is not accepting donations right now, that nothing is
wrong with the donor's card or account, that individual fundraisers are
unaffected, and two links out - "Browse active fundraisers" (`/campaigns`) and
the Donor FAQ.

The lookup fails closed: a database fault renders the explanatory state rather
than a form, because an error is not evidence that a donation would work.

No production data was created and the constant was not repointed at some other
campaign's id.

### Rejected

- **`redirect('/campaigns')`.** Considered seriously, and it is one line. It
  was rejected because `/donate` is a canonical, indexed URL with its own
  metadata, its own FAQ schema and real copy about what the general fund pays
  for. It is listed in `src/app/sitemap.ts` at priority 0.7, has its own
  section in docs/12 (3.10 "General Fund Donation (`/donate`)"), and is the
  target of the navbar CTA in two places (`Navbar.tsx`). A silent
  redirect erases the explanation, makes the navbar CTA behave differently from
  its label, and gives the donor no idea what happened. Rendering the page with
  one honest panel keeps the content and still lands the donor one click from
  giving. If the fund is retired permanently rather than missing, a 308 to
  `/campaigns` becomes the right answer - revisit here.
- **Hardcoding a different campaign id.** Explicitly out of bounds, and it
  would silently route general-fund money to one named beneficiary.
- **Seeding the row from the app (create the campaign on first visit).** A page
  render that writes a campaigns row is a far worse invariant than a missing
  one, and docs/36 is about what happens when seeding scripts invent things.
- **Leaving the form and improving the 404 message.** Cheap, but it still
  takes the donor through amount, email and a submit before telling them it was
  never going to work.

### Trade-off accepted

One indexed query per 5 minutes: `/donate` gains `export const revalidate = 300`
(same cadence as `/campaigns`). That is one more page on the ISR tally CLAUDE.md
tracks (26 as of 2026-10-14; other work in flight is also adding to it, so take
the number as approximate), which matters for the shared-cache-handler caveat in
docs/26 §5 and nowhere else. When the fund row is created, the page can take up
to 5 minutes to start offering the form.

---

## D3. A failed submit showed the donor nothing

### What was there (verified)

In both donation flows, after clicking Donate: the DOM was byte-identical
before and after, `document.querySelectorAll('[role=alert],[aria-live],[class*=error]')`
was empty, and the submit button - polled every 250ms - never disabled, never
showed a pending state, never spun. Meanwhile the API returns specific,
field-tagged messages ("Minimum donation is $5.00", "Enter a valid email
address", "Amount must be a whole number (cents)").

The code did have `isSubmitting` and a spinner, and `src/app/layout.tsx` does
mount sonner's `<Toaster />`. The error path's only output was
`const { toast } = await import('sonner')` - a **dynamic chunk fetch inside the
failure handler**. If that import does not resolve, the donor's only signal is
gone, and the `catch` around it tries the same import again. Why the pending
state was also invisible in production is **not established**; a hydration
failure on that page would explain all of it, and one candidate is **verified**
in the build: `Dockerfile:95` defaults `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to
`""`, and module-scope `loadStripe('')` rejects inside Stripe.js ("Please call
Stripe() with your publishable key"). That is an assumption about the
production symptom, not a diagnosis.

### Decision

- **Inline error first, toast second.** `showSubmitError()` sets React state
  rendered as a `role="alert"` `aria-live="assertive"` panel above the CTA, and
  then attempts the toast with `.catch(() => {})`. The donor-visible signal is
  synchronous and needs no network. The CTA carries `aria-busy` and
  `aria-describedby` pointing at the error.
- **The API's message is shown verbatim.** These strings are written for
  donors; paraphrasing them loses the field.
- **A `useRef` latch, not state, guards submit.** Three clicks dispatched
  synchronously in one task produced **3** `create-checkout` POSTs, because
  React had not re-rendered and every handler read the stale `isSubmitting`.
  `submitInFlight` is written synchronously, so the second click sees the first
  one's latch regardless of batching. (**Verified by test**: removing the ref
  and guarding on `isSubmitting` instead makes
  `DonationForm.submit.test.tsx` fail with 3 recorded requests.)
- **The CTA never quotes an amount the form will not submit.** At 999999999
  cents the button read "Donate $999,999,999.00" directly above "Maximum
  donation is $100,000". It now reads "Enter an amount up to $100,000.00" and is
  disabled; the amount is quoted only inside
  [`MIN_DONATION_CENTS`, `MAX_DONATION_CENTS`], which mirror the server schema.
- **A missing publishable key is stated, not blank.** `stripePromise` is null
  rather than a rejected promise, and the payment step says card payments are
  unavailable, that it is our fault, that nothing was charged, and how to reach
  support.

### Rejected

- **Toast only, with a non-dynamic `sonner` import.** Better than today, but a
  toast auto-dismisses, is not in the form's accessibility tree where the donor
  is looking, and is one failed chunk away from nothing at all.
- **Keeping `isSubmitting` as the single-flight guard** (just reading it at the
  top of the handler). Measured insufficient - see above.
- **Disabling the button for a fixed cooldown after a click.** Hides the
  symptom and punishes a donor retrying a genuine failure.
- **Rendering field-level errors next to each input from the API's `field`
  tag.** Worth doing later; it needs a mapping from server field names to the
  form's registered names and was out of scope for a fix whose point is that
  *something* must be shown.

### Trade-off accepted

One more rendered element and one more piece of state in the hottest
conversion component. The latch means a genuinely slow network cannot be
retried until the first request settles - correct for a payment, and the
pending state now says so.

---

## What this change does not do

- **No real payment was tested.** It cannot be from here: the deployed
  publishable key is empty, so Stripe.js throws on page load. Every claim above
  about Stripe behaviour is from the code path plus mocked-SDK tests
  (`page.receipt.test.tsx`, `confirm/route.test.ts`), not from an end-to-end
  charge. **The redirect return leg must be exercised once against a real
  Stripe test-mode payment before launch**, because the shape of
  `session.payment_intent` and the metadata copy on recurring charges are the
  two places a mock can lie.
- **The general fund row still does not exist.** D2 makes the failure honest;
  it does not make `/donate` work. Creating that campaign (and deciding whether
  the id should be a constant at all, rather than a lookup by slug or a
  settings row) is still open.
- **No schema change, no migration, no change to the donation idempotency
  index, and the Stripe-metadata disaster-recovery substrate is untouched** -
  `create-checkout` still writes full donor context onto the PaymentIntent, the
  session and the subscription.
