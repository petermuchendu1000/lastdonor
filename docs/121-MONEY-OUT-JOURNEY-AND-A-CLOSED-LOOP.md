# 121 — The money-out journey, and a loop an organiser could not escape

**Date:** 2026-10-27
**Scope:** the journey from "a donation has settled" to "the money reaches the
family" — verification, release, payout — walked end to end.
**Status:** six findings fixed and tested; eight reported and not changed (§9).

---

## 1. Why this journey, and what production says

`docs/118` covered the donor journey, `docs/119` the organiser's own doors, and
`docs/120` the review that gates them both. This is the other half of the money
path, and it is the one where a real family either does or does not get paid.

Production, read 2026-10-27:

| | |
|---|---|
| campaigns at `identity_verified` or `fully_verified` | **0** |
| verification documents | **0** |
| Didit sessions ever started | **0** |
| Stripe Connect accounts | **0** |
| `campaign_withdrawals` rows | **0** |
| `SUM(campaigns.total_released_amount)` | **0** |
| real money on the platform | **KES 10,000 minor units (KES 100.00)** |

**This journey has never been entered by anybody.** `docs/113` records that
money has never left the platform; this pass is about whether it *could*.

### 1.1 What is genuinely fixed, measured in a browser

Before the findings, the good news, taken from a signed-in production build
rather than from the docs that claim it:

- Every campaign row, the dashboard and the campaign page carry **"Check your
  ID"**, and `/dashboard/campaigns/<id>/verification` renders **"Start Identity
  Verification"**. The `docs/83` unreachable-screen defect and the `docs/110`
  never-arming poll are both genuinely closed at the component level.
- The copy is honest and quantified: *"Until this is done, this campaign can
  raise up to $500.00, and we cannot pay you anything."*
- `/dashboard/campaigns/<id>/payout-destination` says plainly that no checked
  institutional account exists yet — the `docs/113` state, stated rather than
  hidden.
- `FinancesClient` already reports **per currency** and already sizes the
  withdraw field with `majorToMinor` from the campaign's own currency. The
  `docs/114` `Math.round(dollars * 100)` finding is fixed in both handlers. A
  single `$7,800.00` on the Payouts tab looked like a currency-blind sum and is
  not: all five fixture campaigns are USD.

---

## 2. ⛔ The finding: a loop the organiser could not escape

The intended path is:

> pass the ID check → `identity_verified` → upload supporting documents →
> submit them → an admin presses `approve_t2` → `fully_verified` → the
> withdrawal route will finally accept a request.

Three facts, each harmless alone:

1. **`submit/route.ts`** — `submittableStates` was
   `['unverified', 'submitted_for_review', 'info_requested', 'rejected']`.
   **`identity_verified` was not in it**, so the route answered
   `409 Cannot submit verification from status: identity_verified`.
2. **`CampaignVerificationDashboard`** — `canSubmitForReview` excluded
   `identity_verified` too, so no control rendered to produce that 409.
3. **The same component** renders Step 2, the upload form, only once
   `identityVerified || documents.length > 0`.

Compose them: **the only state in which an organiser can attach a first
document is the only state from which they cannot submit it.**

So an organiser passed the ID check, was emailed *"One more step: send us
papers — our team will look at them"*, uploaded a hospital letter, and then
nothing they could do changed anything. No control, no "under review" banner,
and **no admin told** — because `notifyAdminsVerificationSubmitted` lives on the
route they could not reach. Uploading a document writes no audit row and
notifies nobody.

The only escapes were admin-initiated and required an admin to notice the
upload unprompted.

### 2.1 Why nothing caught it

[VERIFIED] no integration or E2E test executes the Didit session route, the
webhook, the document upload or the submit route. `organiser-journey.test.ts`
tests the pure ladder. The dead end was invisible to the whole suite, and
production had never been far enough down the path to meet it.

### 2.2 The fix, and the test shape

`identity_verified` is now submittable, and the component offers the control.

`verification-submittable.test.ts` reads **both ends from source and compares
them to each other** (the `docs/109` shape) rather than pinning today's list: a
status the route accepts but the component hides is a dead end, and one the
component offers but the route refuses is a button that 409s. It also requires
the status `mapDiditStatus` writes on approval to be submittable — so if the
mapping changes, the test follows it.

⚠️ **That test immediately found a second, pre-existing divergence.**
`submitted_for_review` was in `submittableStates` all along while
`canSubmitForReview` excluded it, and the component is the route's only caller
— so nothing could reach it. Re-submitting a campaign that already has a
reviewer would reset its place in the queue, so the component's end was the
correct one and the route's entry was removed.

Proven by injection both ways: removing `identity_verified` from the route
fails the route assertion; hiding it in the component fails the component
assertion *and* the agreement rule.

---

## 3. ⛔ The navbar printed a cross-currency sum with a dollar sign

`GET /api/v1/user/balance` reduced `total_released_amount −
total_withdrawn_amount` across **every** campaign into one bare integer, and
summed `campaign_withdrawals.amount` across every currency beside it. Every
amount column is in the minor units of its own row's currency (`docs/92`), so
that added shillings to dollars.

`UserNav` then rendered the result with

```ts
(cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
```

— the **seventh** hand-rolled currency formatter, after the six `docs/88` F4/F5
and `docs/114` removed. A KES 10,000-minor balance printed as **$100.00** in the
navbar of every signed-in page.

Both halves are fixed: the route groups **in SQL**, so there is no point at
which two currencies share an accumulator, and the navbar renders one `<Money>`
per currency.

### 3.1 ⚠️ The ratchet could not see it, and that is the transferable part

`money-currency.ratchet.test.ts` globbed `src/**/*.tsx` for `<Money …>` JSX. A
hand-rolled `Intl` call has no such tag, so **both** the `docs/114` and
`docs/115` sweeps walked straight past it. The ratchet was checking the
symptom.

It now also checks the property — *is a currency being formatted outside the
one module allowed to* — matching `Intl.NumberFormat(…, {currency})` and
`.toLocaleString(…, {currency})` across `src/**/*.{ts,tsx}`, with the exact
line that got through pinned as a self-test so the pattern cannot quietly stop
matching.

⛔ It has **no allowlist entries for call sites**. The one remaining formatter,
`WhereYourMoneyGoes`, was legitimately USD — a literal `EXAMPLE_CENTS` in an
explainer, never wrong — and was converted to `formatMoney` anyway, because an
exception that has to be maintained is how the seventh formatter came to be
written.

---

## 4. ⛔ The withdraw form offered an action the rail refuses

`withdraw/route.ts` refuses any campaign whose currency is not
`PLATFORM_PAYOUT_CURRENCY` (`'usd'`) with `400 WRONG_PAYMENT_RAIL` — a
deliberate refusal, reasoned out in the route, that converts nothing and is the
single line standing between the KES ledger and `stripe.transfers.create` under
`'usd'`.

But `FinancesClient` rendered the Withdraw form on `isVerified &&
availableBalance > 0` and **nothing else**. A shilling campaign with a released
balance showed a live Withdraw button that the server rejects — `docs/119`'s
rule, that a step may offer an action only if its target will accept it.

Now gated on a predicate derived from the route's own constant, with an
explanation in its place: *"… is held for this campaign. We cannot pay out KES
yet, so there is nothing for you to do here."*

⚠️ A test asserted the old behaviour — that a KES campaign's withdraw field is
labelled "KES" rather than "$". The field was right about the label and wrong
to be there. The assertion was repointed, not deleted: the currency the rail
cannot pay shows no form, a payable one still does (the control), and the label
is still proved to derive from the campaign rather than a literal — which can
now only be checked in the source, because only USD is reachable.

---

## 5. ⛔ A definite withdrawal failure told the organiser nothing

`notifyWithdrawalFailed` and `withdrawalFailedEmail` both existed and had
**zero callers**. A definite transfer failure set the row `failed`, released
the reservation and said nothing: the organiser's money came back and the only
way to learn why was to reload the payouts screen and read a raw gateway
string.

It is now called on the definite-failure branch, with the **laundered**
message the HTTP response has always used rather than the raw provider error —
`safeFailureMessage` was extracted from the catch so the two cannot diverge.

⛔ **Only on that branch.** The other branch is the UNKNOWN outcome, where the
platform does not know whether the transfer went through. Emailing "your
withdrawal failed" there would be a claim it cannot substantiate, and it is the
one case where the money may actually have moved.

---

## 6. ⛔ Two turnaround promises, in a directory the sweep already covered

The verification screen said:

> You will be notified by email once a decision has been made. **This typically
> takes 1 to 2 business days.**

> Once submitted, our team will review your documents **within 1-2 business
> days.**

`organiser-journey.ts` and `docs/78` forbid quoting a turnaround, and
`organiser-promises.test.ts` **already swept this file**. It missed both, for
two different reasons, and neither is a coverage gap:

- the first puts "decision" and the duration on **opposite sides of a full
  stop**, and that rule deliberately requires them in the same sentence;
- `"1-2"` breaks `\d+\s*(?:days)` at the hyphen, and `"takes 1 to 2"` has no
  `within`/`in` at all.

So the hole was the pattern, not the coverage — the `docs/110` §9.2 lesson
again. A second rule now matches a turnaround in **business days** with no
proximity and no lead-in word, which it can afford because "business days" is a
turnaround promise and nothing else: the false positive the first rule was
narrowed for is a refund window stated in **calendar** days, and a test asserts
that sentence still passes.

The email promise stays — it is true, the Didit webhook sends it. Only the
turnaround is gone.

### 6.1 And the screen linked its own campaign to a 404

`CampaignVerificationDashboard` rendered the campaign title as
`` href={`/campaigns/${campaign.slug}`} `` unconditionally. An organiser is
sent to this screen precisely when their campaign is `under_review` — the
status the public page does not serve — so **the campaign's own title was a 404
at the exact moment they were told to come and check their ID.** Now through
`publicCampaignPath` (`docs/118`), rendering plain text when there is no public
page.

That is the third `docs/118` sweep gap in two days: notifications (`docs/118`),
`src/components/admin/` (`docs/120` §11.3), and now
`src/components/verification/`.

---

## 7. Where the money actually stops today

For completeness, traced and verified rather than assumed. The first refusal is
`withdraw/route.ts`:

```ts
if (!user?.stripeConnectAccountId || user.stripeConnectStatus !== 'verified') {
```

→ `400 "Complete Stripe Connect setup before withdrawing"`. With **0 Connect
accounts**, this is unsatisfiable for every organiser in any currency.

⚠️ And it is the wrong message, because setting one up cannot succeed either.
`isConnectAvailable` caches `false` only for three specific "Connect not
enabled" messages and **returns `true` for anything else** — including the
authentication error a placeholder key produces — with the stated intent that
"the real error surfaces when the user attempts the action". So the screen
renders an enabled **Connect with Stripe** button and the POST ends in
`500 "Payment service configuration error. Please contact support."`

**Nothing on this path mis-handles the KES 100 numerically.** It is refused
before arithmetic, three times over.

---

## 8. Checks

- `npm run lint` — clean (one pre-existing unused-arg warning).
- `npm run typecheck` — clean.
- `npm run test:unit` — **7,674 tests: 7,658 passing, 16 skipped, 259 files.**
- `npm run test:integration` — **256 passing, 26 files**, on a throwaway
  Postgres.
- New/changed: `verification-submittable.test.ts` (10, proven by injection both
  ways), `money-currency.ratchet.test.ts` (+3 rules incl. a self-test),
  `organiser-promises.test.ts` (+1 rule, +1 false-positive boundary test),
  `FinancesClient.test.tsx` (repointed, +2).
- The browser walk — §8.1.

### 8.1 The walk

The E2E fixture was put into the exact state the defect lived in — a campaign
at `identity_verified` with a document already uploaded — because that is the
state no test in the repository had ever constructed. Chromium at 1440x1000
against `next start`:

| | |
|---|---|
| the screen says the ID check has passed | ✅ |
| **a submit control exists at `identity_verified`** | ✅ 1 control |
| the uploaded document is listed | ✅ |
| **quotes no turnaround time** | ✅ no "business day" anywhere |
| **pressing it moves the campaign on** | ✅ |
| an `under_review` campaign's title is not a link to its public page | ✅ 0 links |
| nothing on these screens 4xx'd | ✅ |

**7/7, and the database is the part that matters:**

```
campaign:     documents_uploaded
audit:        verification_submitted (identity_verified -> documents_uploaded)
notification: to admin — [Verification] "E2E Fixture: Medical Appeal" ready for review
```

That last line is the whole finding. Before this, an organiser who had passed
the ID check and uploaded their papers could produce **none** of those three
rows, because the only route that writes them was one they could not reach.

---

## 9. Reported, not changed

1. ⛔ **The status poll is a Stripe poll on a column Didit never writes.**
   `verification/identity/status/route.ts` selects `stripeVerificationId` and
   returns `{decided:false}` when it is null; the Didit path never writes that
   column. So if Didit's console webhook is unregistered or a delivery is
   dropped, the organiser sits on "Verification In Progress" **forever**, and
   the screen polls every 5→30s per open tab against a `max: 5` pool. This is
   the `docs/110` defect moved one layer down, from the component into the
   route it calls.
   ⚠️ It is reported rather than fixed because the naive fix — have the poll
   call `getDiditDecision` — turns every open tab into a provider poll. What it
   needs is a **bounded** fallback (poll the provider only after the webhook
   has had its chance), which is design work, not a line change.
2. ⛔ **[UNKNOWN] whether `STRIPE_CONNECT_WEBHOOK_SECRET` is set in
   production.** It is declared in `.env.example`, `SECURITY-AUDIT.md` and
   `docs/35`, but not in `fly.toml` or `validate-secrets.ts`, and there is no
   `flyctl` in this session to check. If it is unset the webhook returns 500
   before parsing, so `transfer.created` is never processed: a **successful**
   transfer would leave the row `processing` and `total_withdrawn_amount`
   unchanged — money gone, ledger saying in-flight, organiser never emailed.
   Owner-checkable in one command.
3. ⛔ **`organiser-journey.ts`'s `payoutAccount` fact is set by nothing**, so
   the payout step is permanently "later" / *"Where we send the money."* and
   never says *"Tell us the account to pay"*.
   ⚠️ **Do not wire it yet.** The target is Stripe Connect onboarding, whose
   button 500s (§7), so setting the fact to `'missing'` would make the journey
   point organisers at a 500 — creating the `docs/119` violation the field
   looks like it would fix. It is accidentally correct until the rail works.
4. **An `UNKNOWN_OUTCOME` withdrawal has no operator surface.** It stays
   `processing` forever holding its reservation: no cron touches
   `campaign_withdrawals`, no admin screen shows `failureReason`, and there is
   no admin route to approve, retry or reject one. The statuses `requested`,
   `approved` and `rejected` exist in the enum and nothing writes them.
5. **`cron/reconcile`'s discrepancy threshold is currency-blind**:
   `discrepancy > 100` with the comment *"More than $1 discrepancy"* — which is
   KES 1.00 on a shilling campaign and 100 whole units on a zero-decimal one.
6. **`payment-service.ts` can leave `total_withdrawn_amount >
   total_released_amount`** after a refund lowers `raised_amount` — a real cash
   shortfall, with the comment *"nothing here can undo a completed transfer."*
   It is written to `audit_logs.details` only; nothing reads it and reconcile
   does not look for it.
7. **A declined ID check shows three contradictory statements at once.** The
   Didit webhook never clears `didit_session_id`, so `identityPending` stays
   true and the screen renders *"Verification In Progress… You will be
   notified by email"* while the status chip reads *"Did not pass"* and the
   ladder says *"The check did not pass. You can try again."* The Stripe poll
   it replaced did clear its session on a decline. Also: `canUploadDocs` omits
   `rejected`, so the rejection email's promise — *"You can send new papers
   now"* — lands on a screen with no upload form, although the API would accept
   one.
8. **A campaign with `creator_id IS NULL` can never be verified by anybody** —
   every route on the path compares `creatorId === session.user.id`. That is
   **13 of 14 live campaigns** (`docs/119`): nobody can lift their raise cap,
   nobody can be reminded, nobody can be paid.
