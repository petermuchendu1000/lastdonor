# 161 — The probe watched a route the form never calls

The CARD-RAIL donor journey, which `docs/158` §8 named as the next thing to
walk (*"`DonationForm` and `create-checkout` were not walked; that rail answers
503 to everybody, so its refusal copy is the next thing to read"*) and which
`docs/151` §8 left open from the phone walk.

The refusal **copy** turned out to be sound. What was not sound was a belief
about the form, written into the E2E suite as fact, that three skipped tests
rest on.

---

## 1. The finding

`e2e/donate-button-e2e.spec.ts` recorded this as a measured fact:

> Probed 2026-10-22 against a production build: submitting a valid form ($50 +
> a good email) does **NOT** call `create-intent` at all. The request never
> fires — a route interceptor recorded `null` — and the form instead shows
> "Card payments are unavailable right now."
> **That is correct behaviour, not a bug.**

Everything after the first clause is false, and the reason is the probe:
**this form has never called `create-intent`.** It calls `create-checkout`
(`DonationForm.tsx:651`). Both routes exist on disk, so an interceptor watching
`create-intent` records `null` however the form behaves — **it could not have
produced any other answer.** Gate 4's definition of a check that cannot fail,
and `docs/135` §5's rule: *a probe that cannot see its subject reports the same
thing as a subject that is absent.*

Measured properly, counting **both** endpoints in one run:

```
create-intent   calls: 0      <- all the old probe could see
create-checkout calls: 1  ->  503
message shown is the PaymentStep GUARD ("try again later")? false
message shown is the ROUTE's 503 ("so we can help you give")?  true
```

So the form **submits**, and the **server** refuses. The donor picks an amount,
types an email, presses *Donate $25.00*, and only then learns the platform
cannot take it.

⚠️ The two messages are nearly identical, which is what let this sit: the
component's notice and `create-checkout:332` both open *"Card payments are
unavailable right now. This is a problem on our side, not with your card, and
nothing has been charged."* They are told apart only by their tails — *"Please
try again later or email"* versus *"so we can help you give"*.

### 1.1 And the live test passed for the wrong reason

`'the form says so when the card rail is unavailable'` clicked $50, filled an
email, pressed Donate, and asserted that sentence was visible. It passed — on
the **route's** 503 body. Its name claimed it pinned the form's upfront
refusal; it pinned the server's reply (`docs/104`'s class).

## 2. Why the donor never reaches the component's own notice

`DonationForm.tsx:30` is `stripePromise = key ? loadStripe(key) : null`, and
the honest dead end lived inside `CheckoutStep`, which renders at
`step === 'payment'` — reached only **after** `create-checkout` returns a
client secret. Production's `create-checkout` answers 503, so that step is
never reached and the notice was **unreachable**. `docs/83`'s shape: a working
screen with no door.

## 3. Severity, and what it affects

[VERIFIED from production] all **8** publicly reachable campaigns are USD, and
USD routes to Stripe. The only KES campaign with a listed status is the general
fund, whose `published_at` is NULL so it has no public page (`docs/147`). So
**every donor who reaches a campaign page is on the dead card rail.**

[VERIFIED by live probe, with a discriminating control]

| probe | result |
|---|---|
| real live campaign | **503** `PAYMENTS_UNAVAILABLE` |
| fabricated campaign id | **404** `NOT_FOUND` |

[VERIFIED] all 8 report `real_raised = 0`, so the `docs/101` raise cap does not
fire first and the donor really does reach the gateway.

⚠️ **Two independent blockers, either sufficient**: no publishable key in the
build (so embedded checkout cannot mount) **and** a secret key that cannot
authenticate (so the route 503s). Measured in the production bundle: **0**
key-shaped matches across 34 chunks, with controls proving the sweep works —
`donor-email` and the dead-end copy are both present in the same chunks, and
the single `pk_` hit is literally `t[0].match(/^pk_test/)`, Stripe's own SDK
regex.

⛔ The dead credentials themselves remain **OWNER-ONLY** (`docs/125`,
`docs/138`). This doc does not fix them and does not claim to.

## 4. The fix

**Refuse before collecting, using the signal the component already holds.**
The notice moved into `CardRailUnavailable` (one decider, `docs/146`) and is
now rendered at the **details** step when `stripePromise` is null, which is the
last moment at which the donor has spent no effort.

⛔ **The implication runs one way, and that is what makes it safe:**

| condition | proves |
|---|---|
| no publishable key | the rail **cannot** work — refuse, always correct |
| a publishable key | **nothing** — the secret key may still be dead |

So the gate can refuse too rarely; it can never refuse wrongly. The second
blocker stays with the server's 503, which is honest and specific.

### 4.1 The ledger asserted a charge beside "nothing has been charged"

Found by **looking at the screenshot**, not by any assertion. `submitError`
renders directly beneath the ledger (`:1081` closes the `<dl>`, `:1083` opens
the error), so after a refusal the donor read:

> **Total charged today  $25.00**
> …
> *"Card payments are unavailable right now … nothing has been charged."*

[VERIFIED by execution on **two independent refusal paths**] — total at 290px,
error at 405px, 95px apart, both inside the 844px viewport:

| path | error | both visible |
|---|---|---|
| dead key (503) | *"…nothing has been charged"* | **true** |
| raise cap (409, `docs/101`) | *"…Nothing has been charged."* | **true** |

The second path matters: it is reachable **independently of the Stripe
outage**, the moment any campaign passes $500. So this half survives the key
being fixed.

⚠️ **The falsifier changed the fix.** *Should the ledger be blanked on error?*
**No** — a donor who retries wants their amount still there. The figure is
right; only the **tense** was wrong. The box's own comment says *"the figures
are the donor's own arithmetic, **not a claim**"*, and the label contradicted
it. Now `Total to pay today` / `Total to pay monthly`.

## 5. Verified by execution, paired

Same lab, same 390px viewport, before and after, with the KES campaign as a
control so "it refuses" cannot just be the probe failing:

| | before | after |
|---|---|---|
| warned before typing | **no** | **yes** |
| email field | present | **absent** |
| amount field | present | **absent** |
| ledger | present | **absent** |
| "Total charged" on screen | **yes** | **no** |
| donation API calls | `["create-checkout"]` → 503 | **`[]`** |
| **CONTROL** M-Pesa rail | works | **works, untouched** |
| horizontal overflow | 0px | 0px |

The empty call list is the point: the donor's effort is no longer spent.

## 6. The guards

- `DonationForm.rail-availability.test.ts` — 3 tests driving **both**
  directions via `vi.resetModules()` + dynamic import, because the key is read
  at module scope. The anti-vacuity control asserts the form **still renders**
  when a key is present; without it, a component that never renders the form
  would satisfy the rule and block every donor the day the rail works.
- `DonationForm.ledger.test.tsx` — a property test: **no ledger row may use the
  past tense of a charge**, with its own anti-vacuity row proving the matcher
  catches the wording it replaced.

**10 injections, all 10 behaved**, restore sha-verified, every row asserting
its file's sha changed before being scored. Rows 1 and 2 restore the real
production state and both fire. Rows 8, 9 and 10 must **pass** — a reworded but
still-honest label, a comment edit, and reworded notice copy.

### 6.1 ⚠️ Three of my own rows were wrong, and the harness said so

- **Rows 8 and 10 fired when they had to pass.** My ledger tests found the
  total row by its exact label, and the rail test pinned the headline
  sentence — so any reword failed them. That stops the copy being improved and
  proves nothing about the property. `docs/160` §5.2, one day later, in tests I
  wrote after reading it. Both now identify their subject **structurally** (the
  row whose label starts "Total"; the `role="alert"` notice) and assert the
  wording only as a property.
- **Row 9 was VOID, and it was my harness.** The anchor contained backticks
  (`` `docs/161` ``), which the shell executed as command substitution, so the
  anchor never matched and it reported ANCHOR-MISS rather than a result.

### 6.2 ⚠️ The key is stubbed per file, never globally

Five test files now set `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `vi.hoisted`.
⛔ It is deliberately **not** in `test/setup.ts`: a global stub would make every
test in the suite render a form production never shows — which is exactly how
this defect hid.

## 7. Gate

lint 1 pre-existing warning, typecheck clean, unit **8215 passed / 0 failed /
16 skipped** (293 files, +5 tests).

⚠️ Two page-level tests broke on the first full run and were legitimate
dependents I had **not** enumerated at Gate 6 — I listed `<DonationForm` render
sites and missed tests that render the *page*. Both assert the form appears, so
both got the same local stub.

## 8. What was NOT checked

- **The dead Stripe credentials.** Owner-only, unchanged, and the reason the
  rail is dead at all. This fixes what the donor is told, not the outage.
- **Whether the gate is right when a publishable key exists but the secret is
  dead.** By construction the form then renders and the server 503s — the
  pre-existing behaviour — but it was not re-measured in that configuration.
- **The three skipped card tests remain skipped.** They need a real
  `pk_test_…`; their skip reason is now accurate instead of resting on the
  false premise.
- **`create-intent`** itself — it exists, has its own importers (`docs/148`
  §B.3), and was not walked here.
- No screen reader. The notice carries `role="alert"`; its announcement was not
  heard.
