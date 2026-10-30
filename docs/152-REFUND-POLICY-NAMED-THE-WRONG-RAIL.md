# 152 — The refund policy named the rail that has never refunded anybody

**Date:** 2026-10-30
**Status:** fixed in code, gated by a new rule; one item reported and not fixed
**Journey:** the donor on a phone (`docs/151`), continued — the donor's *next*
screen after the one `docs/151` measured

---

## 1. How it was found

`docs/151` walked `/donate` at 390px in Nairobi's timezone and stopped at the
pay button. The screenshot taken there carries one more line, below the
button, that nothing in that pass examined:

> Your donation is protected. If a campaign is removed before funds are
> released, or fails verification after you give, you get your money back.

That sentence is a promise about money, made at the moment a donor is deciding
to part with it, and it points at `/refund-policy`. So the walk continued onto
that page.

### 1.1 The first suspicion was WRONG, and the falsifier caught it

I suspected the second half — *"or fails verification after you give"* — was
unsubstantiated, because `docs/140` verified three ways that **no mechanism
returns money on a clock** and every refund call site is an admin route.

⚠️ **Refuted.** `/refund-policy:111` carries, verbatim:

> A campaign fails required verification after donors have contributed.

So **both** halves of the donate-form sentence are backed by published policy.
My first read missed it because the grep that produced it matched on *refund*
and *money back*, and that bullet says neither — it says *"fails required
verification"*. A pattern that cannot match its subject reports the same thing
as a subject that is absent (`docs/135` §5). The form's claim stands.

---

## 2. The defect

Fifty lines below that correct bullet, **"How To Request a Refund"** said:

> We usually review refund requests within 5 business days. If approved, the
> refund **is submitted through Stripe** and may take **5 to 10 business days
> to appear on the original payment method**.

One return path, named for a rail that has never returned a cent here, with a
card-network timetable attached to it.

### 2.1 [VERIFIED] three independent ways, each able to produce the other answer

**Method 1 — the code.** `api/v1/admin/donations/[id]/route.ts` branches on
`provider !== 'stripe'`. On that branch it calls **no gateway at all**, and
answers:

```
manualRefundRequired: true
message: "This donation was collected by payhero, which has no refund API.
          The ledger has been corrected, but the money must be returned to
          the donor manually."
```

The route's own comment, written by `docs/122`, says the Stripe template's
wording *"would be false here"*. The published policy page said precisely
those words, to every donor, before they gave.

**Method 2 — production.** Every donation this platform has ever taken:

```
provider=payhero | currency=KES | n=3 | total_minor=15000
```

Three of three. **Zero Stripe donations, ever** — because Stripe collects from
nobody (`docs/125`: `create-checkout` answers 503 for every USD campaign).
Stripe has refunded nobody because Stripe has charged nobody.

**Method 3 — the live page.** Production served the sentence verbatim,
fetched and stripped of markup:

> `'...We usually review refund requests within 5 business days. If approved,
> the refund is submitted through Stripe and may take 5 to 10 business days to
> appear on the original p'`

### 2.2 ⚠️ And the file contradicted itself

`/refund-policy:91-92`, in the **same file**, fifty lines above:

> Payment details are handled by the payment provider for that currency…
> **Card payments are processed by Stripe, and M-Pesa payments by PayHero.**

That sentence is `docs/148` §B's own correction to this page. The sweep that
fixed it did not reach the refund paragraph. One file, both halves of a
contradiction, green throughout — because **nothing compares two sentences in
one file to each other**. That is `docs/109`'s lesson word for word, and this
is the second time it has produced a live defect.

### 2.3 ⚠️ Why no existing rule caught it

`fee-claims.test.ts` forbids naming a payment processor on a user-facing
surface, and `PROCESSOR_NAME_ALLOWED` exempts `app/refund-policy/page.tsx` —
correctly, because naming a sub-processor on a policy page is a **compliance
disclosure**, not a marketing claim (`docs/116` §5, `docs/148` §B.2).

The exemption says a processor **may** be named. Nothing said the one named
had to be the **right** one. An allowlist entry is a hole in a sweep, and the
thing that falls through it is not always the thing the exemption was for.

---

## 3. The fix

`src/app/refund-policy/page.tsx` only. The return sentence now reads:

> If we approve it, the money goes back the way it came. A card donation is
> refunded through Stripe, and can take 5 to 10 business days to show up on
> the card. An M-Pesa donation is sent back by a person on our team, because
> the mobile money provider gives us no way to do it automatically. We email
> you as soon as we start it. We do not promise a date for it to arrive.

⛔ **No turnaround is quoted for the manual return**, deliberately (`docs/78`).
There is no gateway behind it, so any figure would be invented —
`docs/116` §5's rule applies: *do not substitute another number.*

### 3.1 What was deliberately NOT changed

- **"We usually review refund requests within 5 business days."** A review
  SLA is a policy commitment somebody made on purpose. It is not a factual
  error about a rail, so it is not an audit's to edit.
- **The eligibility and non-eligibility lists.** Both correct (§1.1).
- **`:91-92`.** Already right.
- ⚠️ **`:169`, the Payment Disputes paragraph, which names Stripe alone.**
  A falsifier was run against it and **held**: that paragraph reads *"If a
  dispute is opened through a **bank or card issuer**, Stripe and the payment
  network may request…"*. A chargeback **is** a card-network mechanism and
  M-Pesa has none, so naming one rail there is correct and naming both would
  be a claim the platform cannot substantiate. The new rule is section-scoped
  specifically so it cannot pressure anybody into "fixing" that paragraph.

### 3.2 ⚠️ A second suspicion, also refuted

I suspected the bulk cancel path carried `docs/122` §2's defect — a PayHero
donor refunded in silence. [VERIFIED by reading the transaction] it does not:

```ts
if (donation.provider !== 'stripe') { … status = 'failed'; }
…
for (const result of refundResults) {
  if (result.status !== 'completed') continue;
  await applyRefundInTx(tx, { … });
}
```

The PayHero donation is marked `failed`, **`applyRefundInTx` is skipped
entirely**, the batch reports `partial_failure`, and `notifyBulkRefundCompleted`
hands the admin a non-zero failed count. So the ledger is **not** corrected and
the donor is correctly **not** told their money is on its way. The route's own
comment states the reasoning. Coherent design, not a defect — and it is what
makes the new copy's *"We email you as soon as we start it"* true: for an
M-Pesa donation the start of the return **is** the individual admin action,
which is the path `docs/122` wired to `notifyManualRefundPending`.

---

## 4. The guard

`src/app/refund-policy/refund-rails.test.ts`, 6 rules. Both ends derived:
the gateway set comes from `CURRENCIES` (the one source of what can collect),
the prose comes from the page, sliced per `<section>`.

| # | Rule |
|---|---|
| 1 | **Premise tripwire** — more than one gateway collects. If this platform ever drops to one, rule 3 is vacuously true and somebody must re-read this decision rather than inherit a dead rule. |
| 2 | **Anti-vacuity** — the slicer found all three sections and each carries real prose. |
| 3 | ⛔ The refund section names **all** collectable rails, or none. |
| 4 | ⛔ It **agrees** with the section that already named them (`docs/148` §B.5: two surfaces asserting one fact must agree). |
| 5 | ⚠️ **Control** — the card-only dispute paragraph stays card-only. |
| 6 | ⛔ No arrival date is promised for the rail a person settles by hand; the card timetable survives (so deleting it is not a way to pass). |

⚠️ **Rule 4 is why rule 3 alone is not enough.** Naming *neither* rail in the
refund section is honest in isolation, so rule 3 returns early for it — rule 4
is what catches it, because the page's other section names both.

⚠️ **Whitespace is collapsed in the slicer, and that is not cosmetic.** My
first version of rule 5 matched the literal `bank or card issuer`, which JSX
stores with a newline and ten spaces inside it. It could never fire. Caught on
the first run; same class as `docs/146` §5.2's broken probe.

### 4.1 Injections — 9 rows, all behaving

| Row | Injection | Result |
|---|---|---|
| 1 | **The real production sentence restored** | fired (2) |
| 2 | Drop the M-Pesa rail, keep Stripe | fired (2) |
| 3 | Name neither rail in the refund section | fired (1) |
| 4 | Satisfy rule 3 by naming PayHero in the **card dispute** paragraph | fired (1) |
| 5 | Delete the arrival timetable entirely | fired (1) |
| 6 | Invent an arrival date for the hand-settled rail | fired (1) |
| 7 | Collapse `CURRENCIES` to one gateway | fired (1) |
| 8 | Break the slicer by renaming a heading | fired (4) |
| 9 | **Must PASS** — a comment-only edit naming Stripe, PayHero and "5 to 10 business days" | passed |

sha256-verified clean restore after every row (`docs/120` §11.1), and the
harness confirms `0 failing` at HEAD afterwards.

⚠️ **Row 6 first reported "DID NOT FIRE", and that was MY ANCHOR, not a hole.**
The mutation's search string was `We do not promise a date for it to arrive.`
— flat, while JSX wraps it across a newline between `We` and `do`. `replace`
matched nothing, the file was unchanged, and the run passed. **An injection
that does not apply reports exactly like a rule with a hole in it**
(`docs/134`). Re-run with a whitespace-tolerant regex, `assert n == 1`, and a
before/after sha comparison, it fires on exactly the intended rule. The
harness now refuses to score a row whose file did not change.

---

## 4a. The sweep — §6 was acted on, and it found three more

§6 below originally listed the sibling policy pages as *not swept*. They were
swept immediately afterwards, because they share the same
`PROCESSOR_NAME_ALLOWED` exemption and therefore the same hole. **Four
instances of one rule is a sweep, not a fourth assertion** (`docs/110` §9.2).

### 4a.1 ⛔ Three more surfaces credited Stripe with all collection

| Surface | What it said | Live? |
|---|---|---|
| `/terms` | *"**All** donations are processed by Stripe and are final upon completion."* | yes |
| `/fund-release-policy` | *"Stripe processes donations and handles card, wallet, subscription, and settlement mechanics."* | yes |
| `/privacy` | *"Payment processing is handled **entirely** by Stripe…"* and a sharing list naming Stripe, not PayHero | yes |

All three fetched from production and confirmed served verbatim.

### 4a.2 ⚠️ And several Stripe-only mentions are CORRECT — the rule must not touch them

| Surface | Claim | Verdict |
|---|---|---|
| `/fund-release-policy` | "Stripe Connect onboarding and payout eligibility" | **correct** |
| `/fund-release-policy` | "through Stripe-connected payout rails" | **correct** |
| `/campaign-verification-policy` | "Bank or payout verification through Stripe Connect" | **correct** |
| `/refund-policy` | "If a dispute is opened through a bank or card issuer, Stripe and…" | **correct** |

[VERIFIED] **Stripe really is the only way money LEAVES**: `createTransfer`
has exactly one caller, it lives in `@/lib/stripe-connect`, and
`withdraw/route.ts:223` refuses any currency but `PLATFORM_PAYOUT_CURRENCY`
(`docs/121` §4). **Collection and payout are different questions and only one
of them has two answers.** A rule that fired on these would be satisfied by
naming PayHero beside Stripe in a paragraph about card chargebacks — which
M-Pesa does not have — making the page worse.

### 4a.3 ⛔ `/terms` also carried a fourth single-currency bounds claim

> "The minimum donation amount is **$5.00 USD**. The maximum is **$100,000.00
> USD** per transaction."

`/refund-policy` had already derived the same fact from `CURRENCIES`
(`docs/148` §B fixed three such sites) — so **two policy pages disagreed about
the same number**, one derived and one not. `/terms` now derives it too.

### 4a.4 ⛔ `/privacy` disclosed a company that receives nothing, and omitted two facts

**(a) "Vercel: For application hosting."** [VERIFIED three ways] production
answers `server: Fly/366e4bf88`, `via: 2 fly.io` and a `fly-request-id` with
no Vercel header at all; `fly.toml` is the deploy target while `vercel.json`
is the inert file `docs/65` proved never ran; and this codebase's own comments
say `VERCEL_ENV` is *"UNSET on Fly"*, which is why `/api/v1/health` reports
`commit: 'local'`. **Disclosing a recipient that receives nothing is as wrong
as omitting one that does**, and this policy did both at once — PayHero, which
receives every donor's phone number, was absent from the same list.

**(b) The donor's phone number was not disclosed as collected.** The
"Donation information" bullet listed *"Donor name, email, location, donation
amount, and optional message"*. [VERIFIED from the schema]
`payhero_payment_requests.phone_e164` and `.msisdn_sent` are both
`.notNull()`; [VERIFIED in production] **5 rows, all 5 carrying both, oldest
2026-10-21**. It is the most identifying thing an M-Pesa donor hands over, it
is indexed for the abuse guard (`docs/92`), and the policy did not say it was
kept.

### 4a.5 The sweep's guard

`src/app/collection-rails.test.ts` reads every public page and component
(admin and dashboard excluded — `docs/110` §4's two-vocabularies rule) and
matches a **collection phrase**, never a processor name, so the correct
payout and dispute copy of §4a.2 is invisible to it.

⚠️ **The qualifier must precede the claim, and that is not a detail.** A
sentence may narrow itself to one rail (*"Stripe: For **card** payment
processing"*). But *"Stripe processes donations and handles **card**, wallet,
subscription, and settlement mechanics"* contains the word *card* trailing, in
a list of mechanics — an anywhere-in-the-sentence test passes the live defect.
That was a real hole in the first draft, found by injecting the production
sentence and watching it not fire.

⚠️ **A heading is not a sentence, and an inline tag is not a boundary.** The
first run reported *correct* copy as a defect: `<h2>Payment Processing</h2>`
carries no full stop, so it merged with the bullet beneath it and the match
landed on the heading, with nothing before it to narrow anything. Replacing
*every* tag with a stop is worse — it would split `<strong>Stripe:</strong>
For card payment processing`, leaving a claim that names nobody and is
skipped, which is exactly the line that was wrong. Only block-level closers
terminate a sentence.

⚠️ **Row 5 exposed a hole in my own rule, and the mutation had applied.**
"The privacy policy names every gateway" was tested against the **whole
page**, so deleting the PayHero entry from the sharing list did not fire — the
name survived in the security paragraph. **A page that mentions a processor in
passing has not disclosed it as a recipient**, which is the entire distinction
that section draws. The rule is now scoped to the sharing list itself.

**10 injections, all behaving** — the three live sentences, the Vercel entry,
the dropped PayHero recipient, the dropped phone disclosure, a deleted
qualifier, a single-gateway `CURRENCIES`, a broken corpus glob, and a
must-PASS comment quoting every bad sentence. sha256-verified restore after
every row, and each row asserts its own anchor matched exactly once before
it is scored.

---

## 5. Reported, NOT fixed

- ⛔ **An admin can cancel a campaign and leave M-Pesa donors untold
  indefinitely.** §3.2's design is correct as far as it goes: the batch marks
  those refunds `failed` and flags the count. But nothing *obliges* the admin
  to then process each one individually, and until they do, the donor has been
  told nothing. This is an operational gap, not a code defect — the system
  surfaces it to the one person who can act — and closing it means either
  auto-emailing on a refund that has not happened (false) or building a queue
  that chases the admin. Latent today: **0 campaigns have been cancelled and
  0 refunds have ever been issued.**
- ⚠️ **`:91-92` says "Card payments are processed by Stripe"** while Stripe
  processes nothing (`docs/125`, owner-only blocker). That sentence describes
  the design rather than present availability, and `docs/148` had just
  corrected it; rewriting it again on this pass would reopen an owner call.

## 6. What was NOT checked

- ~~Whether the sibling policy pages carry the same assumption.~~ ✅ **Done —
  see §4a.** Three more instances found and fixed, and the rule became a sweep.
- ⛔ **The rest of the `/privacy` sharing list was NOT audited.** Fixing Vercel
  and PayHero corrected two demonstrable errors; it did not verify the list is
  now complete. Integrated third parties absent from it include **Cloudflare**
  (proxies traffic — `docs/105`), **Sentry** (`docs/38`), **Didit** (receives
  government identity documents — `docs/81`), **Africa's Talking** (receives
  phone numbers — `docs/84`) and **OpenRouter** (`docs/106`). Whether each
  receives personal data, and how a legal disclosure list should read, is an
  **owner decision** — not an audit's to rewrite wholesale. Recorded here
  rather than half-fixed.
- ⛔ **No retention period is stated for the stored donor phone number.** The
  collection is now disclosed; how long it is kept is not, and nothing purges
  it. Same shape as `docs/140` PART B's finding about `actor_ip`.
- The page was not re-read in a browser at 390px after the change; the copy is
  longer by one sentence, which costs vertical height on a phone.
- No screen reader was run on it.
