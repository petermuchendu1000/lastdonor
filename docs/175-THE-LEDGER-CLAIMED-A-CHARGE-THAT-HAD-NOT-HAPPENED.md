# 175 — The ledger claimed a charge that had not happened

**2026-11-05.** Found by **looking at a screenshot** of `docs/174`'s round-up
control, which happened to include the ledger. I flagged it as an
observation and explicitly *not* a finding — *"I have not checked whether the
M-Pesa form puts a refusal under its ledger too"* — and the owner said to
check. It does.

⚠️ That observation was made **in conversation only and never written into
`docs/174`**, which is why this doc opens by saying so: a note that exists
only in a transcript is lost, and CLAUDE.md's first section is about exactly
that. `docs/174` §5.5 now carries the pointer.

⚠️ It is also the fifth time in this codebase that a defect was caught by
looking at a rendered screenshot rather than by any assertion (`docs/121`
§10.1, `docs/139` §7, `docs/152` §4b, `docs/160` §3.1).

---

## 1. The finding

`MpesaDonationForm`'s fee ledger stated **"Total charged today — Ksh 650.00"**
and its refusal rendered **36px below it**, saying *"…and nothing has been
charged."*

Two sentences, one screen, contradicting each other — and the one in bold
is the one asserting that a donor's money had moved.

### 1.1 This is `docs/161` §4.1, on the other form

`docs/161` measured exactly this on the **card** form:

> *"Total charged today $25.00" 95px above "nothing has been charged"*

…and fixed it there, changing the label to `Total to pay today` because
**the box is a projection, not a record of an event**. It did not sweep the
sibling. So the fix landed on the rail that **cannot take a payment at all**
(`create-checkout` answers 503 on dead credentials), while the rail that has
actually collected every shilling this platform holds kept the defect.

`docs/109`, `docs/150` and `docs/152` are the same shape: a rule decided on
one surface and never carried to the one next to it.

---

## 2. [VERIFIED] three ways

**Source.** The ledger's `</dl>` closes at `:875`; `error` renders at
`:877-881`; the pay button is at `:901`. The ledger's figures key on
`withinBounds`, **not** on `error`, so they do not blank themselves when a
refusal appears.

**The messages.** ⚠️ **NINE**, not the six an earlier draft of this doc
claimed — **seven** in `donations/payhero/initiate/route.ts` (`:103`, `:149`,
`:242`, `:422`, `:435`, `:463`, `:472`) and two in the component (`:364`,
`:379`).

⚠️ The undercount was my **case-sensitive grep**: `:463` and `:242` open the
sentence with *"Nothing has been charged"*, and `:149` is *"…right now.
Nothing has been charged."* A case-insensitive sweep returns 8 lines in the
route, one of which (`:431`) is a comment, not a message. The three I missed
are the unsupported-currency refusal, the charge-outside-M-Pesa-bounds
refusal, and PayHero rejecting the request — none of them exotic.

**Execution, paired, on live production (v177).**

| | ledger label | figure | refusal | gap |
|---|---|---|---|---|
| CONTROL, no refusal | `Total charged today` | `Ksh 650.00` | **null** | — |
| SUBJECT, refusal shown | `Total charged today` | `Ksh 650.00` | *"We could not reach our payment service and nothing has been charged…"* | **36px** |

Both in the same viewport. The control returning `null` is what makes the
subject's reading evidence rather than a probe that always finds text.

⛔ **No request reached production.** The initiate call was aborted in the
browser, which fires the component's own `catch` at `:379`. A real refusal
state of the real deployed component, at no cost to the money rail — and
`requestsSent: 1, aborted` records that nothing left the machine.

---

## 3. The fix

`Total charged today` → **`Total to pay today`**, matching the card form.

⛔ **The figure is NOT blanked.** `docs/161` settled that: a donor who
retries wants their amount still there. Only the tense was ever wrong.

⚠️ **No monthly variant.** The card form branches on `isRecurring`; an
M-Pesa STK push is a single authorised debit and not a mandate
(`docs/174` §1.1), so this form has nothing to branch on.

---

## 4. The guard is a SWEEP, because a per-file test is what failed here

`DonationForm.ledger.test.tsx` already pinned this property — and could
never have caught it, because it renders **one component**, stubs the Stripe
key for that component, and drives that component's details step. A second
per-file test would have left the next form equally uncovered.

`src/components/campaign/ledger-tense.sweep.test.ts` discovers every
`*DonationForm.tsx` on disk (`docs/110` §9.2: the third instance of a rule is
a sweep; this is the second, and there are exactly two forms, so the sweep is
bounded).

Four rules:

1. **No ledger label asserts a completed charge** (`/\bcharged\b/i`).
2. **ANTI-VACUITY** — both forms found, one `<dl>` each, ≥3 rows each. Rule 1
   is a `not.toMatch` over a list, and an empty list satisfies it completely
   (`docs/163` §5.1).
3. **The TOTAL row still renders money**, so deleting the ledger cannot read
   as a fix.
4. **A refusal renders between the ledger and the pay button** — a premise
   tripwire (`docs/148` §B.4). This rule only matters because of that
   geometry; if it moves, somebody should re-read the reasoning rather than
   inherit a rule whose premise is gone.

⚠️ **Comments are stripped first, and that is load-bearing.** The comment
explaining this fix necessarily quotes `Total charged today`, so a raw-source
sweep reports the fix as the defect — `docs/116` §4 and `docs/167` both
record this trap and both were read before the file was written. Mutation
row 5 makes the stripper identity and the rule fires on my own comment.

### 4.1 ⚠️ Gate 4 found TWO holes in my own rules

Rows 3 and 4 **did not fire** on the first run, and each was a real weakness:

- **Rule 3 asked whether the ledger renders *any* money.** Each ledger holds
  **three** `<Money>` elements, so blanking the one that matters leaves two
  and the rule passes. It now reads the **total row's own `<dd>`**, found
  structurally as the last row. Row 3b is its scope control: blanking a
  *non*-total row must still pass.
- **Rule 4 asked whether the file contains `role="alert"` anywhere.** Both
  forms carry other alert regions on their waiting and failed screens, so
  deleting the one beneath the ledger changed nothing. It now checks the
  **position**: the refusal must sit between `</dl>` and the first button.

**9 mutation rows, all behaving.** Row 1 is the real production state until
this commit; row 2 is `docs/161`'s own regression; rows 7 and 8 MUST PASS —
8 rewords the label to another honest phrase, proving the rule checks the
property and not today's copy (`docs/160` §5.2). sha256-verified clean
restore after every row, and the harness refuses to score a row whose file
sha did not change (`docs/152`, `docs/173`).

---

## 5. ⚠️ Two tests were holding the old copy in place

Neither was a defect; both were pinned to the literal label, and both are
now structural.

- **`MpesaDonationForm.test.tsx:140`** asserted `getByText(/Total charged
  today/i)`. The **fee line** above it is a genuine claim (`docs/59`) and
  keeps its pinned wording; the total row's *label* is not, so it is now
  found as the last `<dt>` and checked for a figure.
- **`money-currency.ratchet.test.ts:272`** sliced from the literal to check
  the total names `billedCurrency`. When the label changed, `indexOf`
  returned **-1**, so `slice(-1)` silently became the single character
  `'\n'`. ⚠️ It failed loudly this time; a different label length could as
  easily have sliced a region that still passed. Both rows are now found as
  the first and last `<dt>` in the ledger.

This is the fourth time a test has held a defect in place here (`docs/109`,
`docs/150`, `docs/170`) — and the second time the cure was the same one
`docs/161` §6.1 had already written down.

---

## 6. ✅ DEPLOYED v178, and ALL TEN refusal states driven

**v178, 2026-11-05.** In-place `Updating machine config` on the baseline
machine id, one `app` machine on v178 read twice, 0 orphans.

⚠️ **The page chunk hash did NOT change, and that is not a failed deploy.**
`MpesaDonationForm` lives in a SHARED chunk, so `/donate`'s page hash is the
wrong probe — `docs/165` §10.1 says exactly this and I reached for it anyway.
The shared chunk did move: `3832-e74ceda7023c6169` →
`3832-156d455ba476b09c`, carrying `Total charged today` **0**,
`Total to pay today` **2** (card + M-Pesa), `Total to pay monthly` **1**.

⚠️ **And my first count of those said 1, not 2.** `grep -oc` lets `-c`
override `-o`, so it counts matching LINES — and minified JS is one line, so
it can only ever return 0 or 1. `docs/169` §8.5 records this trap; this is
the second time. Recounted with `grep -o | wc -l` it is exactly 2, as
predicted. ⚠️ Both of my counting mistakes pointed the same way: they made a
working deploy look like it had not landed. The opposite is equally possible.

### 6.1 Every refusal state, driven against live v178

All ten, in Chromium at 390px:

| state | emitted at | label | asserts a charge | gap | pay latched |
|---|---|---|---|---|---|
| credentials missing | `route:103` | Total to pay today | **false** | 36px | no |
| unsupported currency | `route:149` | Total to pay today | **false** | 36px | no |
| charge out of bounds | `route:242` | Total to pay today | **false** | 36px | no |
| configuration | `route:422` | Total to pay today | **false** | 36px | no |
| transient | `route:435` | Total to pay today | **false** | 36px | no |
| PayHero rejected | `route:463` | Total to pay today | **false** | 36px | no |
| internal error | `route:472` | Total to pay today | **false** | 36px | no |
| **outcome unknown** | `route:459` | Total to pay today | **false** | 36px | **YES** |
| client fallback | `client:364` | Total to pay today | **false** | 36px | no |
| client network | `client:379` | Total to pay today | **false** | 36px | no |

**0 of 10** assert a charge; **0 of 10** render without a message.

⛔ **Nothing reached the money rail.** Each state was produced by
intercepting the initiate call in the browser — `fulfill` with the route's
own verbatim envelope, or `abort` for the thrown-fetch path. No POST left
the machine, no STK push was raised, no float was spent.

⛔ **`outcome-unknown` is the discriminating control.** It is the only state
that renders the named checkbox and disables the pay button (`docs/158` §5),
which is what proves the probe reads ten different states rather than
rendering the same thing ten times — and it is also the one message that
correctly does NOT say nothing was charged.

⚠️ **What this does and does not prove.** It drives the CLIENT: each message
renders beneath the ledger, and the ledger no longer contradicts it. It does
**not** prove the server emits each one on its own branch — those bodies are
copied verbatim from the route, and the branch conditions are covered by
`payment-outcome-claims.test.ts`, which executes the classifier. Two claims;
this run makes the first.

⚠️ One run died on a `page.goto` timeout mid-sweep and was re-run, not
reported (`docs/163` §3). The script now retries navigation three times.

## 7. UNCHECKED

- **The card form's 95px was not re-measured.** `docs/161` measured it; I
  measured only the M-Pesa form's 36px.
- **No refusal was produced by the real server.** Every one was injected at
  the browser boundary, deliberately: forcing the genuine branches means
  either breaking production credentials or calling PayHero for real.
- **The `docs/158` latch is untouched** and still correct: it gates the pay
  button on the UNKNOWN outcome only, where the reassurance is the one thing
  we cannot give.
- No screen reader; the label change is announced as ordinary text and that
  was not verified with one.
