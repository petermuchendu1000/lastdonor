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

**The messages.** Six reachable messages contain *"nothing has been
charged"* — four in `donations/payhero/initiate/route.ts` (`:103`, `:422`,
`:435`, `:472`) and two in the component itself (`:364`, `:379`).

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

## 6. UNCHECKED

- **Not deployed.** Production is v177; this is committed only.
- **The card form's 95px was not re-measured.** `docs/161` measured it; I
  measured only the M-Pesa form's 36px.
- **Only one of the six refusal paths was driven.** The client `catch` at
  `:379` was exercised; the four route messages and the
  `PAYMENT_OUTCOME_UNKNOWN` latch were read, not run. Driving those needs
  either a real collection or a fault injected server-side.
- **The `docs/158` latch is untouched** and still correct: it gates the pay
  button on the UNKNOWN outcome only, where the reassurance is the one thing
  we cannot give.
- No screen reader; the label change is announced as ordinary text and that
  was not verified with one.
