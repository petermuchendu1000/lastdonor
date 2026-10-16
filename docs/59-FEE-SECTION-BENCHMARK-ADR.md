# 59 — "Where your money goes": the fee band, measured against GoFundMe

**Date:** 2026-10-16
**Status:** Implemented
**Section pass:** homepage, section 5 of the landing-page sweep (after
`48` navbar, `49` hero, `51` cards, `55` listing, `56` steps).

---

## Measurement first

Both homepages captured at 390×844 and 1440×900, live, on 2026-10-16.

| | LastDonor | GoFundMe |
|---|---|---|
| Mobile document height | **10,631px** | 7,745px |
| Desktop document height | 6,946px | 7,774px |
| Approx. words on the page | **~800** | ~318 |

**On mobile we were 37% taller and 2.5× wordier than the competitor.** Desktop
was fine; the phone was not, and the phone is the majority case.

Per-section mobile heights, ours:

| Section | Mobile height | Words |
|---|---|---|
| Campaigns | 1,379px | 136 |
| **WhereYourMoneyGoes** | **1,383px** | **90** |
| CategoryShowcase | **1,944px** | 81 |
| FAQ | 1,598px | 244 |

### A harness bug caught before it misled anything

The first capture reported an **identical** document height for 390px and
1440px. That is impossible, and it was the harness: Playwright's
`newContext()` takes `viewport: {width, height}`, and width/height spread at
the top level are silently ignored, so every shot came back at the 1280×720
default.

This is the third time in this project a comparison harness has silently
measured the wrong thing (see docs/56). The harness now asserts
`window.innerWidth` against the requested width on every run and prints
`<-- HARNESS WRONG` when they disagree. **Measure the measuring tool.**

---

## What was wrong with the section

Four defects, three of them live on the homepage and one a false claim.

1. **A missing space.** The copy rendered as `...fees apply.Operations are
   funded...`. A `<br className="hidden md:block" />` sat between the two
   sentences and supplied the gap on desktop only.

2. **The chart asserted something untrue.** The donut animated
   `strokeDasharray` to a **complete** ring, drawn in the same teal the
   legend used for "Campaign Support", with `0%` in the middle. A full ring
   reads as 100%. So the graphic claimed *"100% goes to the campaign"*
   directly above body text explaining that Stripe takes a cut — two
   different metrics in one picture, one of them false. On a platform that
   handles other people's money that is not a styling problem.

3. **The mobile layout fought the screen.** An 85px right-aligned value
   column forced "Your donation" and "Stripe fee" to wrap, consumed 28% of a
   390px viewport for labels, and the CTA was aligned to it with a hardcoded
   `pl-[109px]`.

4. **The punchline came last.** Order on mobile was heading → paragraph →
   three items → CTA → donut. The only visual sat *below* the call to
   action.

---

## What was decided

### 1. A ledger with real money, not a chart

```
If you give                     $50.00
  Payment processing           − $1.75
  LastDonor platform fee       − $0.00
  ─────────────────────────────────────
  Reaches the campaign          $48.25
```

The donor's question is not "what percentage" but "how much of mine
arrives". The `$0.00` line is the entire competitive claim and needs no
chart to make it.

Figures are **computed** from the rate constants, not typed, so the
arithmetic cannot drift from the rate.

**Rejected: fixing the donut.** A correct donut would show a sliver of Stripe
fee against a near-full campaign arc — visually indistinguishable from the
broken one, 280px tall, and still not answering the question in dollars.

### 2. Verified against GoFundMe's published numbers

From their help centre, article **203604424 "Learn about GoFundMe fees"**,
edited **2026-09-30** (VERIFIED, fetched 2026-10-16):

- transaction fee **2.9% + $0.30**;
- their own worked example: *"If a donor makes a $50 donation to a US
  fundraiser, the individual receiving funds will receive $48.25"*;
- **recurring donations pay 5% per donation**;
- a voluntary tip, defaulted on, adjustable to 0, invisible to the organizer.

So on a **one-time** gift our maths is identical to theirs, because the fee
is Stripe's and not ours. The real differences are the **5% recurring
charge** and the **tip prompt**. The footnote therefore says "Recurring gifts
carry no extra platform charge" — the sharpest true thing available.

`2.9% + $0.30` is Stripe's published US rate and is **already claimed** by
this product in `ShareYourStoryForm`. This reuses an existing claim rather
than introducing a new one.

**Rejected: naming GoFundMe on the homepage** with a side-by-side fee
comparison. The numbers are sourced and dated, so it would be substantiable,
but comparative advertising naming a competitor is an owner's decision and a
legal one, not a UI change. The contrast is left to speak for itself. If the
owner wants it, the sourcing is in this doc.

### 3. The band inverts — the only one on the page that does

`--surface-ink` (`#0B2B28` light, `#10302C` dark), a new token. Fixed rather
than derived from `--primary`, because `--primary` is a **bright** teal in
dark mode and would be unreadable as a background.

GoFundMe reserves exactly this device for their trust block ("GoFundMe is a
trusted leader in online fundraising", a dark green full-bleed band) and it
is the most memorable thing on their page. Ours previously used
`bg-surface-amber` — the same cream as its neighbours — which left the
product's single strongest differentiator visually indistinguishable from
the FAQ.

### 4. One DOM order, two layouts

Three grid children placed explicitly: copy at (1,1), ledger spanning
column 2, link at (1,2). A phone gets a plain flex column reading
**heading → ledger → link**; desktop puts the ledger beside the copy.

The link must follow the ledger on mobile. The first rewrite reproduced the
original defect in mirror image — link *above* the ledger — inviting the
reader away before the proof. Caught in the screenshot, not in review.

### 5. Server component

The old one was `'use client'` and pulled framer-motion in to fade three list
items. See docs/49 for what motion wrappers have already cost this page.

---

## Result

| | before | after |
|---|---|---|
| Mobile height | 1,383px | **769px** (−44%) |
| Desktop height | 731px | **585px** (−20%) |
| Client JS | framer-motion | **none** |
| False claims | 1 (the full ring) | 0 |

Removing 614px of mobile scroll from this section alone takes the page from
10,631px to roughly 10,017px. **The page is still far too long on mobile:
CategoryShowcase at 1,944px for 81 words is now the worst offender and is
next.**

---

## An accessibility failure found by measuring the right backdrop

The ledger footnote was `text-white/50` at 12px. Checked against the **band**
it passes at 4.84:1. But it does not sit on the band — it sits on the card,
which is `bg-white/[0.07]` over the band and therefore lighter:

| | light | dark |
|---|---|---|
| white/50 on the card | **4.36:1** ❌ | **4.20:1** ❌ |
| white/65 on the card | 6.18:1 ✅ | 5.88:1 ✅ |

WCAG AA needs 4.5:1 for 12px text. Now `text-white/65`, with the measurement
recorded inline so it is not "tidied" back down. Every other text colour in
the band was checked the same way and passes in both themes.

---

## Honest note on verification

`npm run test:unit` passes (5,284). `npm run lint`, `npm run typecheck` and
`npm run build` pass.

**`npm run test:e2e` cannot run in this sandbox**: 209 failed / 44 passed /
23 skipped, with **176 `CONNECT_TIMEOUT ...pooler.supabase.com:5432`** errors
in the dev-server log. The Postgres wire protocol is blocked here (only the
Supabase Management API HTTP endpoint is reachable), so every DB-backed page
renders an error and the suite cannot pass regardless of the change under
test. This is an environment limit, not a regression — and it is a standing
argument for getting GitHub Actions enabled, which docs/50 records has still
never run.

The section itself was verified visually at 390px and 1440px against a dev
server confirmed to have compiled the new token (`surface-ink` present in the
served CSS — the first attempt was checked and found **absent**, a stale
Turbopack build serving white text on a white background).
