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

---

## 10. Owner decision, 2026-10-25

> platform willing to be a payment intermediary
> card+payhero (we'll add as many gateways to cover global presence)

Both questions in §8 are answered. **§5 is settled as a business posture**
and the feature is approved in principle.

⚠️ **Willingness is not a licence.** §5 said the question is legal, and the
answer above is the owner's appetite, not a regulator's permission. It is
recorded as the former. Nothing in §5 is withdrawn: before money is routed
to a third-party institution, somebody still has to establish under what
authority this platform may do it. That is not an engineering gate and no
amount of careful code substitutes for it.

### 10.1 What did NOT change

§2 still stands and is still the binding constraint: **money has never left
this platform.** Approving a destination does not create a rail. The order in
§7.3 is unchanged, and the next engineering step is still a working payout to
the organiser, not a second kind of payout.

§3 is unchanged too: whether PayHero can disburse is still [UNKNOWN], and
settling it needs the owner to ask PayHero. "Card" means Stripe, which on
this platform answers `status: error` (`docs/72`) and has **0** Connect
accounts.

### 10.2 What was built instead, and why it is the right first thing

Nothing that moves money. What the decision *did* make necessary immediately
is the record a payment intermediary is asked for - and it was missing.

**[VERIFIED 2026-10-25] The platform recorded no consent of any kind at
campaign creation.** The wizard shows a real clickwrap notice:

> By submitting this campaign you agree to LastDonor's Terms of Service and
> Privacy Policy, and confirm that the information you've provided is
> accurate.

and, when the campaign is for somebody else, a second line confirming that
person knows about it. The agreement was genuinely given. **The record was
not kept.** The client posted `agreedToTerms: true`, `confirmedTruthful: true`
and `beneficiaryConsent: true` as hard-coded literals (`ShareYourStoryForm`
`:607`, `:615`, `:616`), the validator demanded `z.literal(true)` - a gate
that can never fail, because the client is what sets it - and
`POST /api/v1/user-campaigns` persisted **none of them**. No column existed.

⚠️ Note the correction to my own first reading: this is *not* "consent was
never collected". It was collected, by a notice on screen. It was never
**recorded**, which is a narrower and still serious thing - the platform
cannot show, for any campaign, that its organiser accepted the terms, when,
or which terms.

Now recorded, as **timestamps** rather than booleans, following `docs/41`
(mail consent) and `docs/82` (SMS): a boolean cannot answer *"before or after
we changed the terms"*, and that is the only question ever asked afterwards.
`migrations-v2/0011` adds `terms_accepted_at`, `terms_version` and
`beneficiary_consent_at` to `campaigns`, all nullable - every campaign
created before this has no record, and inventing one would be worse than
admitting the gap.

⛔ **The server stamps its own clock.** A consent built from a client-set
field is a claim the submitter made about themselves. A test asserts the
route never reads `data.agreedToTerms` into a column.

⛔ **`beneficiary_consent_at` is NULL for a `self` campaign**, because the
wizard shows no second notice then. Recording it unconditionally would
fabricate a consent nobody was asked for - worse than no record. The
condition lives once, in `requiresBeneficiaryConsent`, read by **both** the
screen that shows the notice and the route that records it, so the two cannot
drift (`docs/109`).

⚠️ `TERMS_VERSION` is a human step: nothing enforces bumping it when `/terms`
changes, and a stale value attests to the wrong document. Whoever edits the
terms bumps it in the same commit.

**Verified:** 11 tests; **7 mutants injected, 7 killed**, including stamping
consent for `self`, inverting the predicate, blanking the version, and the
route trusting the client's field instead of its clock. Gate: lint 0 errors,
typecheck clean, unit **7259 passed / 16 skipped, 237 files**.

### 10.3 Also found, not fixed

The same legal notice quotes **"2.9% + $0.30"** - Stripe's published card fee,
on a platform whose card rail answers `status: error` and whose live rail is
PayHero. That is `docs/110` §10's open item (ten files), and this submit
screen is an eleventh site. Still blocked on the same owner decision: the
replacement number, since PayHero's own published table is wrong too
(`docs/92`).

### 10.4 Next, in order

1. **Ask PayHero whether they disburse**, and on what endpoint (§3). One
   email; it decides the whole KES architecture.
2. **A working payout to the organiser** on whichever rail answers first,
   exercised with real money the way `docs/92` exercised collections.
3. Only then: the payee record, the designation, and the donor-facing claim
   (§6, §7.3).

### 10.5 Owner decision, 2026-10-25 (second): B2C deferred until the gateways exist

> for now, let's skip the b2c until all gateways are configured (Stripe and
> the rest)

**No disbursement work is to be built yet** — neither the organiser payout of
§7.2 nor the institutional payee of §7.3. §10.4's step 1 (ask PayHero whether
they disburse) stays a useful question to settle, but it no longer gates
anything, because nothing downstream of it is being built.

⚠️ **What this does NOT change.** The platform's inability to pay anybody is
not a deferred feature; it is the current state of production, and it is
worth saying plainly rather than filing: **14 live campaigns can collect
money and none of them can receive it.** Deferring the work is the owner's
call and is recorded as such. The constraint is unchanged and will still be
there when the gateways land.

⛔ **Nothing in §5 is withdrawn by the deferral either.** The licensing
question survives the pause. When the gateways arrive, routing money to a
third-party institution still needs an answer to *under what authority*, and
the deferral has not made that question smaller.

The work actually landed in this pass is the consent record of §10.2, which
is upstream of every rail and needed regardless of which gateway arrives
first.

---

## 11. The journey, designed — 2026-10-25

⛔ **These are DESIGNS. None of it is built.** Every frame carries a
`DESIGN · NOT BUILT` watermark and a diagonal hatch, so a cropped screenshot
cannot pass as the product. Source and screens:
`docs/design-113-institutional-payouts/` (`journey.html` is the source;
`shoot.js` regenerates every image — do not hand-edit a `.jpg`).

| Screen | Actor | What it settles |
|---|---|---|
| `A1` | Admin | Recording an institution's payment details — separate from vouching |
| `B1` | Organiser | Being offered the choice, and what it costs them |
| `B2` | Organiser | Picking from admin-checked institutions only |
| `B3` | Organiser | The account number at that institution |
| `B4` | Organiser | What they give up, before they agree |
| `C1` | Donor | The destination on the campaign page |
| `C2` | Donor | The destination above the pay button |
| `C3` | Donor | The receipt, and the promise of the institution's own receipt |
| `D1` | Admin | The release queue |

### 11.1 Six decisions the design takes

Recorded so they are argued with rather than inherited. Each is reversible
**now** and expensive later.

1. **The ORGANISER designates, not the donor.** A donor choosing per donation
   splits one campaign's money across destinations, which the composite FK on
   `(campaign_id, currency)` makes unrepresentable (`docs/92`) and which no
   single `raised_amount` can describe.
2. **All-or-nothing per campaign.** No partial split in v1. A split needs a
   second ledger dimension; see decision 1.
3. **The account number is typed twice, and that is not politeness.** The
   paybill is admin-checked; the account field is organiser-typed and
   **nothing can check it**. A right paybill with a wrong account pays a
   stranger's bill at the right hospital, and M-Pesa reversals are manual,
   slow and not guaranteed.
4. **The ID check is NOT replaced by the destination** (`B4`). Otherwise
   anyone raises money against a real hospital and a bill that is not theirs
   and settles a stranger's debt with other people's donations. Verification
   gates money OUT; a destination is not a substitute for knowing who raised
   it.
5. **No self-serve institution** (`B2`), extending `docs/108`. Anyone who can
   add a payee can aim a family's money at an account they control.
6. **Mutable until the first payment leaves, fixed after.** Before any money
   moves, a wrong choice is an edit; after, it is a reversal we cannot
   perform.

### 11.2 The two screens that deliberately show a dead button

`A1`'s **Save payee details** is disabled, and `D1`'s tiles all read **0**.
Neither is placeholder art.

- `A1` is blocked on §5, which is a licensing question and not an engineering
  gate. A mockup that shows it saving would assert the question away.
- `D1`'s zeros are the measured state of production (§2): `campaign_withdrawals`
  0 rows, 0 Connect accounts, 0 campaigns verified enough to withdraw.
  **14 live campaigns can take money and none can receive it.**

### 11.3 The sentence the feature rests on

On `C1`: *"We send what you give to Kenyatta National Hospital, to Amani's
bill. It does not pass through the family's own account."* followed by
**what was checked and what was not** — the `docs/108` `VouchedByBadge`
shape, for the same reason: the value is the donor believing it, so it may
only say what an admin actually confirmed. ⛔ If the rail cannot guarantee
the claim, **the words change, not the rail**.

### 11.4 What the design does NOT answer

- The licence (§5). Unchanged, and still blocking a real `A1`.
- Whether PayHero can disburse (§3). Still [UNKNOWN].
- `C2` prints a KES 8.90 charge from the `docs/92` live test. PayHero's own
  published table contradicts it, and ten other screens still quote Stripe's
  dead "2.9% + $0.30" (`docs/110` §10). **A fee shown to a donor must be the
  fee charged** — still an owner decision.

---

## 12. The UI, built — 2026-10-26

All nine screens of §11 exist as real pages. ⛔ **Still nothing sends money**:
`resolvePayoutRail()` returns null and `payout-boundary.test.ts` fails the
build if that changes.

| Screen | Route |
|---|---|
| A1 | `/admin/institutions/[institutionId]/payout-accounts` |
| B1-B4 | `/dashboard/campaigns/[id]/payout-destination` |
| C1-C2 | `PaidToInstitution` on `/campaigns/[slug]` |
| D1 | `/admin/payout-queue` |

Verified by a production build: all six new routes present, `BUILD_EXIT=0`,
ISR count unchanged at 3.

### 12.1 The destination rides on the EXISTING campaign query

`/campaigns/[slug]` is the hottest public page and its query budget is spent
(`docs/87`: pool `max: 5`, three concurrent per entry point), which is why the
vouch read beside it is guarded on a column already in hand.

There is no such column for a destination, and **adding one would be the
`docs/89` echo-counter mistake** - a denormalised copy of the truth that
nothing keeps in step. Instead the lookup gained two `LEFT JOIN`s: no extra
round trip, nothing to drift, and a campaign with no destination (every
campaign today) comes back unchanged with nulls. The fan-out ratchet is green
because the query count did not move.

⚠️ This broke `page.lookup.test.tsx`, and the way it broke is the point: the
test's fluent `db` mock had `from/where/orderBy/offset/limit` and no
`leftJoin`, so the chain threw `TypeError` and **four tests failed on
assertions about `notFound()` and metadata** - nowhere near the real cause. A
hand-rolled chain mock has to carry every method the chain calls.

### 12.2 Native radios, not a hand-rolled radiogroup

`docs/100` found seven `role="radiogroup"`s claiming behaviour none of them
implemented, and landed on: when the options are a list of labels, use a
native `<input type="radio">`. The institution picker is such a list, so it
does. Arrow keys, one tab stop and screen-reader announcement come free and
cannot rot.

### 12.3 The organiser's door is on EVERY row

`docs/83` is the doc about a working flow nobody could reach: verification's
only link was gated on `status === 'active' && donorCount > 0`, which two
later decisions made unsatisfiable. So "Where the money goes" renders on every
campaign row in every state, and the screen itself decides what to show.

### 12.4 ⛔ The call site may not write its own sentence

`public.test.ts` pins the donor-facing wording, but a rule on a module is
worthless if a page writes its own copy next door - `docs/110` §9.2 exactly,
where a promise was asserted on two surfaces and a third said it anyway.

So `PaidToInstitution.test.tsx` also reads `/campaigns/[slug]/page.tsx` **as
source** and fails if it contains "does not pass through", "goes straight to"
or "What we checked". Proven by injection: writing that sentence into the
page fails the suite, and so does removing the component.

### 12.5 What D1 deliberately does NOT show

No Send button, not even a disabled one - the page states why nothing can be
sent (`docs/88` F9 is the admin screen that was inert and did not say so).

And **no payable amount**. The column shown is labelled "headline raised" and
is `raised_amount`, which is blended with fabricated seed money (`docs/101`).
A real payable figure is absent until a rail exists to pay it; inventing one
would be the first lie on a money screen.

### 12.6 Mutation results

11 injected across the UI work, **11 killed**: the page writing its own
sentence, the component removed from the page, both halves of the
checked/not-checked pair blanked, the institution-kind list drifting from the
enum in both directions, and the rate-date assertion.

⚠️ One mutant was **malformed and reported as such** rather than counted as a
survivor: blanking `notChecked` via its ternary condition only selected the
other branch, so nothing was blanked. Re-injected correctly, it died.

---

## 13. Three defects the screenshots found — 2026-10-26

The nine screens of §12 were driven in Chromium against a production build and
a seeded Postgres: a real organiser logged in, walked the wizard, and the
designation was written. Three defects surfaced that **every test missed**,
and all three are the `docs/107` §8 shape - invisible until somebody looks.

`scripts/seed-payout-journey.ts` reproduces the fixture. ⛔ It refuses any
non-local database.

### 13.1 ⛔ Designating did not revalidate the public page

`POST .../payout-designation` wrote the row, returned 201, and the donor page
showed **nothing**. `/campaigns/[slug]` is ISR (`revalidate = 60`), so the
cached HTML kept serving with no disclosure - and that disclosure is the
entire point of the feature.

The sibling campaign-edit route calls `revalidatePath` at `:201` for exactly
this reason. The designation route did not. Both POST and DELETE now do.

⚠️ Nothing could have caught this but a browser: the API returned 201, the row
was correct, and the component was correct.

### 13.2 ⛔ A KES campaign showed DOLLARS, on the only rail that takes money

The sticky bar printed **"$31,600 to go"** directly beneath a badge correctly
reading "Ksh 50,000.00". The cause was `centsToDollarsWhole`, which hardcodes
USD - and, worse, `<Money minor={...} />` **without a currency prop**, because
`Money` itself defaults to USD. A call site that looks right renders the wrong
symbol.

`docs/112` recorded this as LATENT, reasoning that the only non-USD campaign
was archived and unservable. That was true and was never going to stay true:
KES over M-Pesa is the only rail that has ever collected money (`docs/92`).

Fixed across `StickyMobileDonateBar`, `SidebarDonationSummary`, `CampaignCard`
and `CampaignGrid`; `currency` is now **required, never defaulted**, which is
what made the compiler enumerate all eight call sites and the five queries
that had to start selecting it. Verified in the rendered DOM: **zero dollar
signs, four correct shilling figures.**

⚠️ The preset donation ladder is NOT fixed and is not a display bug: those
are USD-denominated amounts (500 = $5.00), and rendering them as "Ksh 5" would
be wrong differently - about four US cents, below the KES 50 floor. A
per-currency ladder is an owner decision (`docs/72`).

### 13.3 The primary button clipped its own label at phone width

"I understand - send it to Kenyatta National Hospital" rendered as
"…understand - send it to Kenyatta National Hospita…". `buttonVariants` sets
`whitespace-nowrap` and the label carries an institution name of unbounded
length. Now wraps.

### 13.4 Two false alarms, recorded because the method matters

- **A grep of the page HTML "found" `$1`, `$2`, `$22`, `$26` remaining.**
  Those are RSC flight-payload markers in `self.__next_f.push`, not money.
  `docs/106` says exactly this: verifying needs the rendered DOM, not
  `page.content()`. Re-checked against `document.body.innerText`: clean.
- **"The donor badge did not render."** The screenshot script had picked the
  campaign with `.first()` on a newest-first list and walked the OTHER
  campaign - which is `under_review` and so has no public page at all. The
  feature was correct; the harness was aimed at the wrong row.

⚠️ And a third, in a test of mine: a rule forbidding `centsToDollars` in a
file matched **its own doc comment** explaining the defect - the `docs/112`
icon-ratchet trap. Comments are stripped before matching now.
