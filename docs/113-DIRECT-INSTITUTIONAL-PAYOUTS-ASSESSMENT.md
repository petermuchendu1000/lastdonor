# 113 — Paying the hospital directly: assessment, not a build

**Date:** 2026-10-25
**Status:** ⛔ **NOT BUILT. Owner decision required**, and one part of it is a
licensing question rather than an engineering one.
**Follows:** `docs/72` (Stripe is dead), `docs/92` (PayHero is the live rail),
`docs/101` (raise cap), `docs/108` (trusted institutions), `docs/111`
(`NEVER_DELEGATED`), `docs/81`/`docs/76`/`docs/77` (never ship an
unexercised provider path).

---

## 1. What was asked

> GoFundMe allows funds to be sent directly to a beneficiary rather than the
> organizer. LastDonor can take this a step further by integrating with
> medical billing networks or funeral home registries. Donors could click a
> button knowing their money isn't even touching the family's bank account —
> it is being sent straight to Hospital System X to clear Account Number Y.

The instinct is right and it is the single strongest trust feature on the
table. The reason this is an assessment rather than a branch is that **every
part of it moves money**, and the ground it would be built on does not exist
yet.

---

## 2. The finding that reframes it: money has never left this platform

**[VERIFIED 2026-10-25, against the production database]**

| | |
|---|---|
| rows in `campaign_withdrawals` | **0** |
| users with `stripe_connect_account_id` | **0** |
| campaigns at `identity_verified` or `fully_verified` | **0** |
| donations ever collected | **2** (the KES 50 M-Pesa tests, `docs/92`) |

The payout path this codebase already has — organiser withdraws to *their
own* account — **has never executed once in production**. Three independent
things block it, and all three are upstream of the requested feature:

1. `withdraw/route.ts:145-158` requires `stripeConnectStatus === 'verified'`
   on the caller. Nobody has a Connect account.
2. The route refuses anything but `fully_verified` (`docs/101`). No campaign
   is verified at all.
3. `createTransfer` is **Stripe**, and Stripe on this platform answers
   `status: error` (`docs/72`); `/api/v1/health` still reports it today.

Building a second, harder payout path before the first one has ever run
would ship two unexercised money paths at once. That is precisely what
`docs/76`, `docs/77` and `docs/81` were each written about.

---

## 3. The live rail cannot send money out, and whether it ever could is UNKNOWN

`src/lib/payhero.ts` exports exactly three operations: `initiateStkPush`,
`getTransactionStatus`, `getWalletBalance`. **Collections only.** There is no
disbursement of any kind, to anybody.

⚠️ **Whether PayHero offers payouts at all is [UNKNOWN], and my probe did not
settle it.** Their marketing mentions B2C disbursements; that is not an API
reference, and `docs.payhero.co.ke` renders its content with JavaScript. I
probed `backend.payhero.co.ke` unauthenticated for candidate payout paths and
**the control destroyed the result**: `payments/initiate-stk-push`, which
`docs/92` proved works, returns **404 on GET** exactly like a fabricated
endpoint does. PayHero routes only POST, so a GET probe discriminates
nothing and proves no absence.

⛔ I did **not** POST to guessed payout endpoints with live credentials. That
is a money operation against an account **shared with BETWOIN LTD**
(`docs/92`), and a guessed payout call is the worst possible way to discover
an API. **Settling this needs the owner to ask PayHero directly**, or to read
the authenticated docs.

---

## 4. ⚠️ "Medical billing networks and funeral home registries" are not a thing
## you can integrate — but in Kenya the primitive already exists

There is no universal API that accepts "clear account Y at hospital X". US
healthcare billing is fragmented across clearinghouses, each with
institution-by-institution onboarding; funeral homes have no registry with an
API at all. An integration there is a business-development programme, not a
sprint.

**But the platform's only working rail is M-Pesa in Kenya, and Kenya already
has the exact primitive the request describes**: hospitals publish an M-Pesa
**paybill number with an account-number field**, and "pay Hospital X, account
Y" is literally how Kenyans settle hospital bills today. No integration, no
clearinghouse, no registry — the rail is the registry.

So the feature is **far more tractable on the rail that works than on the one
that doesn't**, which is the opposite of how the request frames it. If this is
built, it should be built KES-first.

---

## 5. ⛔ The part that is not an engineering decision

Paying a third-party institution on a donor's behalf is **categorically
different** from paying the organiser, even though both move the same money
out of the same wallet.

Today the platform collects into its own PayHero wallet and the organiser
withdraws what is theirs. Directing that money to a commercial third party to
settle somebody's debt makes the platform an intermediary in that settlement.
In Kenya that is CBK payment-service-provider territory; in the United States
it is money-transmitter licensing. **Whether this platform may do that, and
under what licence, is a legal question and the owner's to answer.** No amount
of careful code substitutes for the answer.

---

## 6. The trust claim has to be earned, not asserted

The feature's whole value is the donor believing *"this money is not touching
the family's account."* That is a factual assertion about where funds went,
and CLAUDE.md is explicit that this platform does not make claims it cannot
substantiate.

To say it truthfully we must know that paybill 123456 **is** that hospital.
Nothing verifies that today. `trusted_institutions` (`docs/108`) holds
`name`, `kind`, `country`, `registrationId`, `verifiedBy`, `verificationNotes`
— and **not one payment column**. That absence is deliberate: `docs/108`
refused to let a vouch grant `fully_verified` *because that status releases
money in the same transaction*. Adding payee details to that table reopens
exactly the decision it recorded.

⚠️ And the failure mode is unforgiving. A wrong paybill or a wrong account
number sends a grieving family's money to a stranger. M-Pesa reversals are
manual, slow and not guaranteed. The `docs/92` guards exist because a
**~130x wrong payout** was reachable from a units mistake; this feature adds
a *destination* that can be wrong, which no amount of amount-checking
catches.

---

## 7. What I would do instead, and why it delivers most of the value

Recorded as a recommendation, not a decision.

**7.1 — Earn the trust claim without becoming an intermediary.** The donor's
real question is *"did this money reach the hospital?"* — not *"which rail
carried it."* The organiser pays the hospital and uploads the receipt; the
platform verifies and **publishes it on the campaign**. That is proof of use,
visible to every donor, with no licence, no new rail and no destination that
can be wrong. It is a fraction of the work and most of the trust.

**7.2 — Make the FIRST payout work before adding a second kind.** The honest
headline of §2 is that this platform cannot yet pay anybody at all. A
PayHero-based payout to the organiser, exercised end to end with real money
the way `docs/92` exercised collections, is the prerequisite for everything
here — and it is the thing standing between 14 live campaigns and their
first shilling.

**7.3 — If the owner wants the real feature, the order is:** settle the
licence question (§5) → confirm PayHero can disburse (§3) → organiser payouts
working (§7.2) → an admin-verified payee record on `trusted_institutions`
with its own boundary test (§6) → a donor-facing designation, defaulting OFF.

---

## 8. What the owner needs to decide

1. **Is the platform willing to be a payment intermediary** settling third-party
   institutional debts, and under what licence? (§5 — blocking, legal.)
2. **KES-first, or wait for a card rail?** §4 says the feature is reachable on
   M-Pesa and a research programme on Stripe.
3. **Or take §7.1 instead** — verified receipts published on the campaign,
   which buys most of the donor trust with none of the regulatory exposure.

---

## 9. UNCHECKED

- Whether PayHero supports disbursement at all (§3). The one probe I ran was
  non-discriminating and I said so rather than reporting it as absence.
- Kenyan and US licensing requirements. Named as the blocker, not researched —
  it is a question for a lawyer, and a confident answer from me would be worth
  less than no answer.
- Whether any hospital or funeral home would agree to be listed. No
  institution exists in `trusted_institutions` today (`docs/108` shipped the
  tables; nothing populates them).
- Nothing in this document was built. No code changed.
