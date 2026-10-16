# 64 — The dev CSP hole, and the trust bar my own merge made redundant

**Date:** 2026-10-16
**Status:** Implemented
**Amends:** `docs/32` and `docs/46` (security headers) — development only.
**Follows:** `docs/63`, which created the duplication fixed here.

---

## Part 1 — CSP: every client component was inert in `next dev`

### The symptom

The `docs/63` stepper appeared completely dead locally. `aria-selected`
never changed, the panel never switched, clicks did nothing. The component
looked wrong. It was not.

```
Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an
allowed source of script in the following Content Security Policy directive:
"script-src 'self' 'unsafe-inline' js.stripe.com plausible.io embed.tawk.to"
```

Next's **development** runtime (React Refresh / HMR) compiles modules with
`eval`. Without `'unsafe-eval'` React never hydrates, so **every** client
component on **every** page is inert in local dev. Pages render — server
HTML is fine — which is exactly what makes it so misleading: the failure is
silent, total, and looks like a bug in whatever you just wrote.

The production bundle does not use `eval`, so production was never affected.

### The fix

`IS_DEV` in `next.config.ts`, gated on `process.env.NODE_ENV === 'development'`:

- `script-src` gains `'unsafe-eval'`;
- `connect-src` gains `ws://localhost:* http://localhost:*`, because the HMR
  socket is same-origin but `'self'` does not cover the `ws:` scheme in every
  browser.

Gated on `NODE_ENV`, **not** on a custom flag, so it cannot be switched on in
production by setting an environment variable. `next build` and `next start`
both run with `NODE_ENV=production`.

### Verified, not assumed

| check | result |
|---|---|
| Production CSP header, byte-diff before vs after | **IDENTICAL**, 682 bytes both |
| `unsafe-eval` in production header | **0 occurrences** |
| `ws://localhost` in production header | **0 occurrences** |
| `unsafe-eval` in dev header | present |
| CSP console errors in dev | **none** (was 1) |
| React hydrated in dev (DOM responds to a click) | **yes** (was no) |

The production baseline was captured from a running `next start` built
*before* the change, and compared against a `next start` built *after* it.

### Why this is safe

`'unsafe-eval'` is the directive that lets `eval`/`new Function` run. Allowing
it in development weakens a control that only ever protected a developer's
own localhost, against content that developer is already executing. It does
not touch the deployed header, which is what protects users.

---

## Part 2 — The trust bar, and duplication I introduced

### What the owner saw

Flagged alongside the two sections merged in `docs/63`. Left untouched in
that change, and it should not have been: the merge is precisely what made
it redundant.

### The duplication, stated plainly

After `docs/63`, every line of the trust bar was restated almost verbatim
within the next two sections:

| Trust bar | Restated by |
|---|---|
| "Human Reviewed. Reviewed before going live." | How it works, step 01: "A real person reviews every campaign before it goes live" |
| "Impact Updates. Photos, receipts, transparency." | How it works, step 03 + its "Receipt attached" panel |
| "0% Platform Fees. Standard Stripe payment processing fees apply." | The fee band's ledger: `$0.00` and "Stripe's standard rate (2.9% + $0.30)" |

**This was self-inflicted.** The merge pulled those explanations up the page
to within ~900px of a strip that already said them.

### The arithmetic it was costing

At 390px:

```
3 icon wells x 44px (h-11)   = 132px
2 gaps       x 32px (gap-8)  =  64px
vertical padding   py-6      =  48px
                               -----
                               244px   (measured: 245px)
```

Twenty words at **12.3px of scroll per word**. The fee band, which carries a
full ledger, manages 8.8px/word. The gaps and the oversized icon wells were
the entire bill, so both are gone: three columns in one row at every width.

### What changed

- **Sublabels removed.** A trust strip is a set of flags; the explanation is
  what the rest of the page is for, and it now sits immediately below.
- **No trailing periods.** "0% Platform Fees." is a label, not a sentence.
- **`outline` icons**, matching every other section; it was `solid`.
- **Server component.** It was `'use client'` with framer-motion to fade in
  three list items.
- **"Impact updates"**, not "Photos and receipts": at 390px the latter is
  ~118px against a ~122px column and wrapped to two lines, so the third
  column drove the row height while the other two sat on one. It is also the
  name the product uses for the feature everywhere else.

### On keeping "0% platform fee" without its qualifier

The old sublabel ("Standard Stripe payment processing fees apply") qualified
the claim. Dropping a qualifier from trust copy deserves an explicit
argument, so: the word **platform** is the qualifier. "0% platform fee"
states exactly what is zero and implies nothing about processing. The old
label — "0% Platform Fees." with a full stop — read closer to "no fees",
which is what made a qualifier necessary in the first place.

The full breakdown, with the 2.9% + $0.30 and the `$0.00` row, is in the fee
band on the same page (docs/59), and the hero has carried "0% platform fees"
unqualified since long before this change.

### Result

| | before | after |
|---|---|---|
| Mobile | 245px | **75px** (−69%) |
| Desktop | 109px | **61px** (−44%) |
| Words | 20 | **6** |
| Client JS | framer-motion | none |
| Lines duplicated by the next section | 3 of 3 | 0 |

---

## Homepage, whole-page position after docs/59–64

| | start of pass | now | GoFundMe |
|---|---|---|---|
| Mobile | 10,631px | **~6,960px** | 7,745px |
| Desktop | 6,946px | **~5,800px** | 7,774px |

Mobile is now **~10% shorter** than the competitor and desktop **~25%
shorter**, while carrying a fee ledger, an interactive product walkthrough, a
category grid and a seven-item FAQ that their homepage does not have.

(Mobile figure is the 7,132px measured live after docs/63 minus the 170px
saved here; to be confirmed live after deploy.)
