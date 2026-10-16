# 62 — Homepage campaign row: three cards, not six

**Date:** 2026-10-16
**Status:** Implemented
**Section pass:** homepage, section 4 — the last mobile outlier after
`docs/59`, `docs/60` and `docs/61`.

---

## Measurement

Live, 390×844, 2026-10-16, both sites.

| | LastDonor | GoFundMe |
|---|---|---|
| Section height | **1,379px** | 869px |
| Words | 136 | 46 |
| Cards shown | **6** | 3 |
| Then | "Browse reviewed campaigns raising money now" | "Show more" |

The card *anatomy* already matches theirs — square thumbnail left, content
right, title capped at two lines — because `docs/51` and `docs/55` had
already taken that pass. The gap was almost entirely **how many** we show.

---

## What was decided

### 1. Three cards on a phone, six on desktop

GoFundMe shows exactly three and puts the rest behind a button. We showed all
six stacked, which is most of the 510px difference.

Cards 4–6 are now `hidden sm:block`. Desktop keeps the full 2×3 grid, which
costs nothing there because they sit side by side.

**Hidden with CSS, not sliced on the server**, because the server cannot know
the viewport and this section is rendered once and cached. The trade-off
accepted: the markup for three extra cards is sent to phones that will not
show them. That is a few hundred bytes of HTML against 510px of scroll, and
their images are lazy so they are not fetched.

*Rejected: fetching only three and adding a client-side "load more".* It
turns a cached server render into an interactive component with a loading
state, for content that is one tap from `/campaigns` anyway.

### 2. A call to action that fits on one line

"Browse reviewed campaigns raising money now" is seven words, and inside a
`px-8` pill at 390px it wrapped to two lines. Now "Browse all reviewed
campaigns" — four words, one line, and it keeps the "reviewed campaigns"
anchor text that makes the internal link worth something.

---

## Observed and deliberately NOT changed

**Every one of the six cards reads "Be the first to donate", in bold, as the
most prominent line after the title.**

In isolation that is the right zero state and `docs/47` chose it on purpose:
headline "Be the first to donate", goal demoted beneath it, donor count
suppressed. But `docs/47` evaluated **one card**. Six of them in a column
produce a reading the single-card decision could not see — not "be the
first", but *"nobody has donated to anything on this platform."*

I did not flip it, for two reasons:

- `CLAUDE.md` is explicit that trust copy is "a factual assertion, not
  microcopy". Reversing a deliberate, documented decision about what a donor
  sees first is an owner's call, not a layout fix I should make while
  shortening a section.
- Showing three instead of six already halves the repetition, so the measured
  change may be sufficient on its own.

**If the owner wants it changed**, the minimal version is to swap the
hierarchy *on the card only* — goal primary (`$47,000 goal`), prompt
secondary — leaving the campaign-page sidebar, where there is exactly one
instance and intent is high, exactly as `docs/47` specified. A pointer to
this section has been added to `docs/47`.

### Also observed, not actionable from here

Three of the six live cards carry no real photograph: one abstract gradient,
one monochrome pattern, one generated category badge. GoFundMe's three all
show real people. This is the largest remaining *visual* gap in the section
and it is a **content** problem — those campaigns have no usable hero image —
not a code one. The generated category badge is a better fallback than an
unrelated abstract image; worth checking why two campaigns have the latter.

---

## Result

| | before | after |
|---|---|---|
| Mobile height | 1,379px | *(pending live verification)* |
| Desktop height | 1,201px | unchanged (same six cards) |
| CTA lines at 390px | 2 | 1 |

### Homepage across docs/59–62

| | start of pass | after 59–61 (verified live) | GoFundMe |
|---|---|---|---|
| Mobile | 10,631px | **8,135px** | 7,745px |
| Desktop | 6,946px | **6,034px** | 7,774px |

Desktop is already 22% shorter than theirs. This change targets the last
mobile outlier; with it the mobile page should land near or below GoFundMe's
while still carrying a fee ledger, a seven-item FAQ and a category grid that
their homepage does not have.

---

## Harness note

The CSS-applied assertion added in `docs/61` **fired on GoFundMe's homepage**
— a false positive, because `.h-5` is a Tailwind utility and their site does
not use Tailwind. The guard is now scoped to our own origins, and prints the
resolved body font for third-party pages instead. A guard that fires on a
healthy page is as useless as one that misses a broken one.
