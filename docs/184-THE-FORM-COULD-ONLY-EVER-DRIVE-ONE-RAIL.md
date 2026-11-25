# 184 — The form could only ever drive one rail

**Date:** 2026-11-25
**Status:** BUILT. Not deployed (standing owner instruction, CLAUDE.md).
**Supersedes:** `docs/183` §10's first open item. **Resolves** `docs/182` §6.
**Read with:** `docs/168` (charge vs credit), `docs/180`–`183` (the Palpluss
rail), `docs/146` (one predicate), `docs/160`/`docs/162` (what a screen may
claim).

---

## 1. What was asked, and what the shape of the answer had to be

"Wire the form to the right rail."

`MpesaDonationForm` fetched two string literals:

```ts
`/api/v1/donations/payhero/status?reference=${encodeURIComponent(reference)}`
fetch('/api/v1/donations/payhero/initiate', { … })
```

So it could only ever drive PayHero, whatever the currency table said. The
Palpluss rail built over `docs/180`–`183` — client, callback, settlement,
initiate, poll, 100-odd tests — had **no donor-facing door at all**, which is
the `docs/83` shape ("the Didit flow worked and nobody could reach it") and the
`docs/88` F1 shape ("the API was always correct, only the door was missing").

But the literal paths were only the visible quarter of it. Taking the
inventory found **four** surfaces that each decided between rails by hand:

| Surface | What it said |
|---|---|
| `MpesaDonationForm` | two hardcoded `payhero` paths |
| `campaigns/[slug]/donate/client.tsx:289` | `getCurrency(currency).gateway === 'payhero'` |
| `donate/page.tsx` (general fund) | the same literal comparison |
| `campaigns/[slug]/donate/page.tsx:208` | `payHeroChargeCurrency()`, which **throws** |

Four sites, four chances to forget, against an owner action that is **one line
in the currency table**. `docs/146` is the rule this breaks: the predicate that
decides a thing must be the predicate every surface asks. `docs/147` applied it
to a listing; `docs/165` recorded what happens when a sweep guards the question
it was written for and not its sibling.

So the deliverable is `src/lib/mpesa-rail.ts` — one decider — plus the
`reversed` branch `docs/183` §5 made a precondition, plus the resolution of
`docs/182` §6, which could not be fixed without the decider.

---

## 2. The invariant

> **The rail that charges is the rail whose currency is on the pay button.**

That is why the rail is **derived inside the form** rather than passed in as a
prop. The form already computes the currency the donor is billed in, because it
has to print that figure — `docs/168`'s whole subject is that the button must
not read `$5.00` while `Ksh 650.00` leaves somebody's phone. Taking the rail
from the **same value** makes it structurally impossible for the charge shown
and the API that performs it to disagree:

```ts
const billedCurrency = charge?.chargeCurrency ?? currency;
const rail = mpesaRailFor(billedCurrency);
const paths = rail ? RAIL_PATHS[rail] : null;
```

A `rail` prop would be a second answer to a question already answered here,
settable wrongly at either of two render sites — `docs/119`'s `_hasCampaigns`
(computed, passed, destructured as `_hasCampaigns` and thrown away) and
`docs/125`'s defaulted parameter (invisible at the call site, taken by twelve
of them) are both that shape.

### 2.1 `mpesaRailFor` derives by exclusion, and two things hold that premise

```ts
export type MpesaRail = Exclude<CurrencyDefinition['gateway'], 'stripe'>;
```

No list to drift. Stripe is the card rail with an entirely different client
flow; everything else in the union is a push rail serving
`…/<rail>/initiate` and `…/<rail>/status`.

That derivation is only safe because something **fails the build** when it
stops being true, and two things do:

1. `Record<MpesaRail, …>` — the form's path table — so a fourth gateway cannot
   compile until somebody declares its routes. `docs/144`: a `Record`
   enumerates; an array with a lookup compiles with a hole, which is how a
   whole category went missing from the homepage grid.
2. `mpesa-rail.test.ts` reads the **route tree from disk** and asserts every
   non-Stripe gateway really does serve both routes. A *card* gateway added to
   that union would be claimed as M-Pesa by the function, and this is what
   refuses it rather than hoping nobody does.

### 2.2 `mpesaChargeCurrency()` returns null where the old call threw

`null` for **none** and for **ambiguous**, deliberately the same answer: a
caller cannot act on "there are two" any more than on "there are none", and
picking one of two silently is how a donor is charged in the wrong money.
`palplussChargeCurrency()` had already made exactly that argument for a single
rail (`docs/182` §4).

The per-rail throwing helpers are **kept**, and still used by each initiate
route, where they mean something different and correct: *this rail must charge
in exactly one currency before it collects anything* — not *which rail*.

---

## 3. Why the path table is a `Record` of literals and not a template

`` `/api/v1/donations/${rail}/status` `` is shorter, and it would have been a
silent, invisible regression.

Three guards under `src/app/api/v1/donations/` find the **clients** of a route
by asking which source files name its path. `settled-collection-claims.test.ts`'s
contract rule is written to arm itself *"the moment the form is pointed at
one"*, and it decides that with:

```ts
if (!CLIENT_CODE.includes(routePath)) return; // nothing polls it yet
```

A template literal contains neither `/api/v1/donations/payhero/status` nor
`/api/v1/donations/palpluss/status`, so it would have **disarmed that rule for
both rails** while looking like an improvement — and the rule it disarmed is
the one whose whole purpose was to arm on this change.

⚠️ I know that rather than assume it because the rule carries an anti-vacuity
control (`CONTROL: that contract rule is live for the rail the client does
poll`, asserting at least one route is actually polled). A `Record` of literals
keeps the paths greppable, keeps all three guards live, and enumerates. One
builder, in one place, is `docs/118`'s rule anyway.

---

## 4. `reversed`: the branch `docs/183` §5 required

`docs/183` left a rule that is **vacuous while nothing polls the Palpluss
route and arms the moment something does**: every non-`pending` state a status
route answers must be explicitly tested by any client that fetches it. Pointing
the form at that path armed it, and it demanded `reversed`.

The branch and its screen are not a formality. Routing `reversed` through
either neighbour produces a specific false statement:

| Routed through | What the donor reads |
|---|---|
| `failed` | *"Your donation was not completed… nothing has been charged"*, then three causes — a cancelled prompt, a timeout, too little balance — **none of which is a reversal**. `docs/160`'s defect handed a new input. |
| `collected_unrecorded` | *"Your payment went through"* — half of what happened. |
| nothing (the fall-through) | the `unresolved` screen: *"We could not confirm this payment"* — about an outcome the server just confirmed precisely. |

**That third one is measured, not argued.** With the branch removed, the
control test reports the unresolved screen rendering for a `reversed` response,
and the contract rule reports:

```
src/components/campaign/MpesaDonationForm.tsx polls /api/v1/donations/palpluss/status
but does not test for reversed. An unhandled terminal state falls through to the
unresolved screen, which says "We could not confirm this payment" about an outcome
the server just confirmed. docs/183 §4.
```

### 4.1 What the screen may and may not say

- **NOT** "nothing has been charged" — something was. `docs/158` inverted, the
  same way `collected_unrecorded` inverts it.
- **NOT** a thank-you, and no receipt line — no donation exists.
- **NOT** the failed screen's three causes.
- **NO** turnaround and **no** date (`docs/78`, `docs/140`): the reversal is the
  rail's, we did not initiate it, and we do not know when it lands.
- It says the money "was sent back", **not** "is back in your account" — what
  we hold is the gateway's report, not the donor's balance. So it points at the
  one record that can settle that: their own M-Pesa messages.
- It **does** offer "Try again", unlike the unrecorded screen. There the money
  is gone and a retry pays twice; here the net position is nothing taken.

⚠️ Reachable only on the Palpluss rail, which is the only one with a REVERSED
status, and [UNVERIFIED by execution] no REVERSED has been observed on this
tenant. That is configuration, not dead code (`docs/81`'s bar): the server
answers it today, and the screen is driven by tests.

### 4.2 Placement is load-bearing

The branch sits **after** the `failed` branch. `unverifiable-claims.test.ts`
derives which states the failed screen claims with by reading the condition
nearest `setPhase('failed')`, and a new state inserted above it would be read
as one of them. (That derivation is also tightened — see §6.)

---

## 5. The fail-closed screen, and `docs/182` §6

When no M-Pesa rail collects the billed currency, the form renders an
announced refusal **instead of the form** — not a disabled button beneath it.
A control that can only be refused is `docs/119`'s defect inverted ("a door
always shown onto a room that refuses to open") and `docs/158` §5's.

It should be unreachable: both render sites gate on the same derivation. A
guard is allowed to be unreachable as long as its direction is the safe one —
`docs/42` hides the donate form when the general fund row is missing, and
`docs/172` resolves an unrecognised image to a panel rather than passing it
through.

**And `docs/182` §6 is resolved.** `campaigns/[slug]/donate/page.tsx` ran
`payHeroChargeCurrency()` **for every campaign on every load**, not inside a
branch keyed on the campaign's own rail. The moment KES names
`gateway: 'palpluss'` that finds zero currencies and throws during render — and
a throw in a server component is not a 500, it is the error boundary **inside a
200** (`docs/88` F9), on the public donate page of every live campaign at once,
invisible to a status-code sweep.

It now reads `mpesaChargeCurrency()` and handles null.

### 5.1 Deleting a guard, and what replaced it

`charge-currency-premise.test.ts` (`docs/182` §6) turned that throw into a
build failure. It relaxed exactly as written —

```
the donate page no longer calls payHeroChargeCurrency(). If it now tolerates a
missing M-Pesa charge currency, this whole file is obsolete - see docs/182 §6.
```

— and its header says to **delete it rather than satisfy it**. Deleting a guard
is a serious act, so `src/lib/mpesa-rail.test.ts` covers more than it did:

1. the throw is gone **and** the null branch is EXECUTED, on configurations
   that do not exist yet (§5.2);
2. the rail is derived everywhere rather than named — the defect the premise
   test could not see, because it guarded one call and there were four sites;
3. the declared paths are checked **against the route tree**, so a typo in the
   table is a build failure and not a dead pay button.

### 5.2 The branch that matters is unreachable, so it is simulated

Today exactly one currency routes to M-Pesa, so a test driven only by the real
table exercises the one-answer arm and **would pass with the zero case removed
entirely**. `docs/157` §4.1 is the same problem and the same cure: `vi.doMock`
the currency module and load `mpesa-rail` against a fabricated table.

Three simulated configurations, all executed: none (null, no throw), two (null,
not a pick), and **KES on Palpluss** — the owner's actual next step, asserted to
move every derivation with no code change.

---

## 6. A rule that named one file, for the fourth time in three days

`unverifiable-claims.test.ts` lived in `payhero/status/` and read that **one**
route. `settlePalplussRequest` answers `unverifiable` too, and its route is
correct — but only by its author's care, because nothing checked it. That
mattered the instant the form stopped hardcoding the PayHero paths: the
Palpluss branch became donor-reachable with no guard over it.

That is the fourth instance of one shape in three days — `docs/116` §4 (a
review gate named two files while a third insert published unreviewed campaigns
in production), `docs/182` §8 and `docs/183` §6 (both sibling rules in this
same directory, generalised for exactly this reason). It now discovers status
routes from disk and sits beside the routes rather than inside one.

### 6.1 And it fired on correct code

The Palpluss route lifts its failure sentence into
`const FAILED_MESSAGE = '…'` and uses it three times — which is **right**,
since `docs/152` is about four drifting promises about one thing — and the
sweep's anti-vacuity rule ("the genuine failure branch still says so") reported
the route as having dropped the reassurance.

`docs/182` §8 hit precisely this and its sibling carries the same cure, so this
one does too: expand single-quoted `const` declarations before matching, with
an anti-vacuity control proving the expansion works. It also expands the
**shared copy module** both rails import from, because a message behind an
imported identifier is otherwise invisible to a `not.toMatch` rule — which
passes while saying nothing.

### 6.2 Its derivation was imprecise, and that was latent

`claimingStates()` took every `state === '<x>'` in the **400 characters before**
`setPhase('failed')`, so it swept in whichever neighbouring branches happened to
fit. A fixed window is the `docs/153` §5 trap, and here it made the derivation
depend on the order the branches are written in — adding `reversed` above
`failed` would have changed what the rule believed the failed screen claims
with.

It now reads the condition of the branch that **actually assigns** that phase,
by paren matching, with a control asserting `reversed`,
`collected_unrecorded` and `pending` are **not** among the claiming states.

---

## 7. Verification

### 7.1 Mutation table

15 rows, all behaving: 12 fire, 3 must-pass hold. sha256-verified restore after
every row, and the harness **refuses to score a row whose file sha did not
change** (`docs/152` §5.2: an anchor that did not match reads exactly like a
rule with a hole) and detects a COLLECT failure, which prints `no tests` with no
`×` line (`docs/124` §5.1, `docs/138` §6.1).

| # | Mutation | Want | Result |
|---|---|---|---|
| 1 | **the real production state**: status poll hardcodes the PayHero path | fire | FIRED (1) |
| 2 | **the real production state**: initiate hardcodes the PayHero path | fire | FIRED (1) |
| 3 | rail from the CAMPAIGN currency, not the billed one | fire | **FIRED (6)** |
| 4 | the `reversed` branch deleted | fire | FIRED (3) |
| 5 | **production**: general fund gates on `gateway === 'payhero'` | fire | FIRED (1) |
| 6 | **production**: donate client gates on `gateway === 'payhero'` | fire | FIRED (1) |
| 7 | **production**: donate page calls `payHeroChargeCurrency()` | fire | FIRED (1) |
| 8 | a null charge currency forced through with `!` | fire | FIRED (1) |
| 9 | two M-Pesa currencies: picks one instead of refusing | fire | FIRED (1) |
| 10 | `mpesaRailFor` stops guarding an unknown code | fire | FIRED (1) |
| 11 | the card rail reported as an M-Pesa rail | fire | FIRED (4) |
| 12 | a declared path points at a route that is not there | fire | FIRED (1) |
| 13 | MUST PASS: comment-only edit | pass | GREEN |
| 14 | MUST PASS: the refusal copy reworded | pass | GREEN |
| 15 | MUST PASS: `FAILED_MESSAGE` renamed in the Palpluss route | pass | GREEN |

**Row 3 is the one that justifies the behavioural tests.** `mpesaRailFor(currency)`
and `mpesaRailFor(billedCurrency)` both compile, both read sensibly, and differ
only in that the first sends every cross-currency donor to a refusal screen. No
text rule can see that; driving the component can, and does — six failures,
including *"a USD campaign charged in shillings posts to the SHILLING rail"*.

Rows 14 and 15 exist because a rule must check the property, not today's
wording (`docs/160` §5.2). Row 14 forced a real change: my first refusal test
matched the copy, so it would have failed on a rewording of correct code.

### 7.2 Suites

- lint clean (one pre-existing warning in `review-gate.test.ts`)
- typecheck clean
- unit **8813 passed / 16 skipped, 318 files passed + 3 skipped = 321**
- integration **392 passed / 38 files** against a throwaway Postgres —
  identical to baseline, as expected: no integration test was added

The unit delta is **+34**, reconciled per file rather than waved through
(`docs/89`):

| Δ | File |
|---|---|
| +23 | `src/lib/mpesa-rail.test.ts` (new) |
| +7 | `MpesaDonationForm.test.tsx` (35 → 42) |
| +8 | `unverifiable-claims.test.ts` (6 → 14, generalised and moved) |
| −4 | `charge-currency-premise.test.ts` (deleted) |

Measured both ways: those four files total **45 at baseline and 79 now**, which
is the whole suite delta exactly — nothing was silently added or dropped. File
count is unchanged at 318, which is the two new files against the two deleted.

---

## 8. Four of my own mistakes, each caught by something

Worth recording because three of the four were a *test* being wrong about
correct code, which is the failure mode that wastes the most time.

1. **`'kes'` is not an unknown currency.** My unsupported-code rule listed it
   and failed. `isSupportedCurrency` runs `normaliseCurrencyCode`, which trims
   and upper-cases — deliberately, because codes arrive from gateways and query
   strings. "Unknown" means *not a currency*, never *not upper-case*. There is
   now a control pinning that distinction rather than leaving the rule to imply
   the stronger claim.
2. **I brace-matched from the type annotation.** `declaredPaths()` took the
   first `{` after `const RAIL_PATHS`, which is the one inside
   `Record<MpesaRail, { initiate: string; status: string }>` — so the table
   parsed as **zero entries**, two rules passed over an empty list, and only
   the anti-vacuity row said so.
3. **`code()` blanks in place, so the file does not shrink.** My anti-vacuity
   check asserted `FORM_SRC.length < raw.length - 200` and failed: comments are
   replaced character-for-character with spaces, which is what keeps offsets
   usable. The property is that the comment *text* is gone, so the check now
   names a phrase the prose contains and the code does not.
4. **Three DOM tests were wrong, not the component.** `/sent back/i` matched the
   heading *and* the message ("Found multiple elements" — the screen reading
   correctly); a resolved `initiateOk()` let the first poll fire so
   `toHaveBeenCalledTimes(1)` saw two; and a control looked for the pay button
   on a freshly rendered form, where it is labelled "Enter an amount to
   continue" — an assertion that **could not have passed on a working form
   either**.

---

## 9. Reported, not fixed

- ⛔ **Nothing routes to Palpluss yet.** No currency names
  `gateway: 'palpluss'`, so the Palpluss paths are still reachable only by the
  tests. The flip is one line in `src/lib/money/currencies.ts`, it is the
  owner's call, and §5.2 proves by execution that every surface follows it.
- ⛔ **The Palpluss tenant is shared** with another product (`docs/180` §2) and
  its callbacks are **unsigned** until `lastdonor.org` is registered as a
  webhook domain. Both are owner actions and both predate this change.
- ⛔ **No float monitor for the Palpluss rail** (`docs/150` is the shape one
  would take).
- ⛔ **Nothing sweeps `palpluss_payment_requests`** — nor
  `payhero_payment_requests`, since `docs/159` — so the donor's own poll
  remains the only path by which a late settlement is discovered.
- ⛔ **A re-poll of a reversed row reads as `failed`** (`docs/183` §4,
  unchanged). The discriminator lives only in the operator text the poll
  refuses to read.
- ⚠️ `src/lib/mpesa-rail.test.ts` carries its own copy of
  `expandStringConsts`, as does `payment-outcome-claims.test.ts`. Each has an
  anti-vacuity control over its own copy, so a divergence is self-reported —
  but it is duplication, and a shared test helper under this directory would be
  the better end state.

## 10. Not checked

- **No browser.** Everything here is jsdom plus static rules; the donate pages
  were not rendered in Chromium, and no screenshot was taken. Four separate
  defects in this project's history were found only by **looking** at a render
  (`docs/121` §10.1, `docs/139` §7, `docs/152` §4b, `docs/160` §3.1).
- **No money moved.** The Palpluss initiate and poll routes have still never
  been called by a donor, and the `reversed` screen has never been seen by one.
- The general-fund page (`/donate`) was not exercised end to end — its gate
  changed, and its `RAIL_WORDS` table already carried a `palpluss` entry.
