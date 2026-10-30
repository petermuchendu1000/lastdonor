# 151 — The donor on a phone, and a field that demanded without saying so

The donor's own path, walked against production at **390px** in Nairobi's
timezone — which is the donor this platform actually has, since M-Pesa is the
only rail that has ever taken money (`docs/92`, `docs/147`).

Nobody had done this. `docs/141` walked the public surface at desktop, and
`docs/128` §5 had already established that the obvious mobile method lies.

---

## 1. The method, because the obvious one does not work

⚠️ **`isMobile: false` at a 390px viewport, deliberately.** `docs/128` §5:
with `isMobile: true` Chromium widens the LAYOUT viewport to fit the content
rather than scrolling, so a page that slides sideways reads as fine. Overflow
is measured as `documentElement.scrollWidth - clientWidth`, which is true in
both modes.

Every measurement carries a control, because a probe that cannot see its
subject reports the same thing as a subject that is absent (`docs/134`,
`docs/135` §5). Here: the page must have rendered (innerText length, an `h1`),
and every size is paired against the same element at 1280px.

## 2. ✅ What is sound, measured rather than assumed

| route | horizontal overflow | page height | visible targets |
|---|---|---|---|
| `/` | **0px** | 6,086px | 46 |
| `/campaigns` | **0px** | 4,088px | 40 |
| `/donate` | **0px** | 3,647px | 42 |
| `/how-it-works` | **0px** | 4,815px | 31 |
| `/transparency` | **0px** | 4,033px | 35 |

**Zero horizontal overflow on all five**, so `docs/128` §5's admin-table
finding does not extend to the public surface. And the donation form itself
has **no tap target under 24px at all** — its controls are 308x56 (pay),
308x50 (amount, phone).

`docs/149`'s conversion line renders correctly at phone width: *"Goal is about
Ksh 649,450 at the 2026-10-30 rate"* — and the figure moved from the 649,162
of the day before, so the daily FX refresh is working. The per-card provider
credit is gone and appears once per grid, as `docs/150` intended.

## 3. ⛔ THE FINDING: the pay button names your amount, and refuses

Driving the form on a 390x844 viewport, one input at a time:

```
  0. nothing filled   "Enter an amount to continue"            disabled
  1. amount chosen    "Send M-Pesa request for Ksh 100.00"     disabled
  2. + phone number   "Send M-Pesa request for Ksh 100.00"     disabled
  3. + email          "Send M-Pesa request for Ksh 100.00"     ENABLED
```

At step 2 the button **says the donor's amount back to them and does nothing**,
with no message naming what is missing. The email is what unlocks it
(`MpesaDonationForm.tsx:109-110`):

```ts
const canSubmit =
  phase === 'form' && withinBounds && phone.trim().length >= 7 && donorEmail.includes('@');
```

And the markup said the opposite of the design:

| field | label | gated on? | `required` | `aria-required` |
|---|---|---|---|---|
| `#mpesa-phone` | "M-Pesa number" | **yes** | `false` | absent |
| `#mpesa-name` | "Your name (optional)" | no ✓ | `false` | absent |
| `#mpesa-email` | "Email" | **yes** | `false` | absent |

⚠️ The visual contrast carried the information and the accessibility tree
contradicted it: the field directly above the email one says **"(optional)"**,
so a sighted reader infers the others are required — while a screen reader was
told all three were optional. ⛔ And on the same page the **footer newsletter
email is `required=true`**, so the attribute is this codebase's convention; its
absence here is an oversight, not a house style.

### 3.1 Verified three ways, each challenging the last

1. **Source** — the predicate above.
2. **DOM** — all three inputs `required=false`, `aria-required` absent.
3. **Behaviour, and this is the discriminating one** — amount + phone leaves it
   disabled; adding an email enables it. Neither reading alone shows which
   field is responsible; the step sequence does.

### 3.2 ⚠️ My first two readings of this were WRONG, and both are recorded

- I suspected an **unnamed 16x16 input** on the donate page. It is the "Give
  anonymously" checkbox, **wrapped in a `<label>`**, so it has an accessible
  name. The only unnamed input on the page is `type=hidden`, which needs none.
  Refuted.
- I then reported the button as *"still disabled after filling the form"* from
  a probe that had not typed an email. The button was correct; my fill was
  incomplete.
- ⛔ And an earlier version of that probe took **the last wide button on the
  page** and read the **footer newsletter's "Subscribe"**, reporting
  `disabled=false` as though it were the pay button. The replacement pins the
  button by its own two labels, read out of `MpesaDonationForm.tsx:533-538`,
  and asserts the label is not "Subscribe". `docs/135` §5 for the third time.

## 4. The fix, and why it is two attributes

`required` on `#mpesa-phone` and `#mpesa-email`. Nothing else.

⚠️ **It changes no behaviour and no pixel, which is what makes it the whole
fix**: [VERIFIED] the component contains **no `<form>` element** (`grep -c
'<form'` = 0) and the pay button is `type="button"`, so native validation never
runs; and there is **no `:invalid` or `:required` rule** anywhere in the
stylesheets, so nothing turns red before a donor types. It is the accessibility
tree only — which is exactly the thing that was wrong.

⛔ The visible copy is NOT changed. Adding "(required)" to two labels is a copy
decision on a money page, and the markup fix stands on its own.

## 5. The rule DERIVES both ends

`donation-required-fields.test.ts` reads the submit predicate, extracts the
state identifiers it gates on, maps each `<input>` to its `value={…}` binding,
and requires exactly those to be marked. Pinning two ids would pass forever
while saying nothing about whether it is still the right two (`docs/109`).

⛔ **The optional field is the anti-vacuity control.** `donorName` is absent
from `canSubmit`, so it must stay UNMARKED — without that half, marking every
input in the file would satisfy the rule while telling donors their name is
compulsory, three lines under a label reading "(optional)".

A fourth rule is a **tripwire on the premise**: if somebody wraps these fields
in a `<form>`, `required` starts gating a native submit and showing browser
bubbles — a different decision, which should be taken rather than inherited.

**8 of 8 injections behave**, sha256-verified restore after each: row 1 is the
production state, row 3 marks the optional field, row 4 removes the email
clause from the predicate (so the marking becomes over-marking), row 5 adds a
`<form>`, rows 6-7 break the scan, and **row 8 must PASS** — a comment-only
edit, proving the rule is not firing on noise.

## 6. Reported, NOT fixed

- ⛔ **`DonationForm` (Stripe) has the same marking gap**, and its own comment
  at `:940` says *"Donor email - always visible (required)"* while the input
  carries nothing. It is NOT changed here, for a reason: its button gates on
  `isSubmitting || !amountIsPayable` — **amount only** — so the email is
  enforced by the API schema rather than the button, which is a different
  shape needing its own decision. And that rail answers 503 (`docs/125`), so
  no donor can reach it today.
- ⚠️ **`/donate` carries 2,218px of chrome BELOW the pay button** — 2.6 screens
  on a phone. `docs/72` measured 1,095px of this at desktop. Not acted on: the
  footer is `docs/69`'s deliberate design and shortening it is a layout
  decision, not a defect.
- ⚠️ **The stock-photo question is now visible rather than theoretical.** The
  card for *"Help Danielle Sutton Care for Her Twins"* shows a male doctor with
  a stethoscope. That is `docs/141` §5, raised and left as an owner call
  because `docs/36` is this project's recorded history of forged attribution
  about named real people.

## 7. What was NOT checked

- **Only five routes.** `/campaigns/[slug]`, the campaign donate page, `/blog`,
  `/search` and every signed-in screen were not walked at 390px.
- **No real device.** Chromium at 390px is not a phone: no touch heuristics, no
  real keyboard overlay, no slow network.
- **The pay button was never pressed.** Pressing it sends a real STK push to a
  real handset and moves money (`docs/147` §11), so the path beyond "enabled"
  is unexercised here.
- **No screen reader was run.** The claim is that the accessibility tree now
  carries `required`; that it is *announced* usefully by a specific reader is
  [INFERRED] from the attribute, not observed.
- **Tap-target sizes are reported against 24px (WCAG 2.2 AA)**, which is not
  this project's stated 2.1 AA target. The breadcrumb home icon is 16x16 at
  both widths; that is below the 2.2 floor and is not a 2.1 failure, and it is
  left alone.
