# 60 — Category grid: the tallest section on the homepage

**Date:** 2026-10-16
**Status:** Implemented
**Section pass:** homepage, section 6. Follows `docs/59`, which measured the
page and identified this section as the next target.

---

## The measurement

From the sweep in `docs/59` (live, 390×844, 2026-10-16):

| Section | Mobile height | Words |
|---|---|---|
| **CategoryShowcase** | **1,944px** | **81** |
| FAQ | 1,598px | 244 |
| Campaigns | 1,379px | 136 |
| GoFundMe's "Featured topics" | 628px | 34 |

The tallest section on the page carried the least content on it. Eight
category names — one word each, with a four-word gloss — occupied **a quarter
of a 10,631px page**. On desktop the same section is 731px, so this was
almost entirely a mobile-layout failure.

---

## Cause

Three compounding faults, all visible once the section was cropped and
looked at rather than read in source.

### 1. The grid never had a mobile column count

```
className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
```

`grid` with no `grid-cols-*` is **one column**. The first explicit count was
`sm:` (640px), so every phone got eight full-width cards stacked. A category
name is a short label; two fit side by side at 390px with room to spare.

This is the kind of fault that is invisible in code review — the class list
looks responsive, and `sm:grid-cols-2` reads like it covers small screens
when `sm:` actually means "640px and up".

### 2. `min-h-[168px]` on every card

Eight cards × 168px floor = 1,344px before gaps, for content that measures
about 60px. Removed; the cards now size to their content and land at ~90px
on a phone.

### 3. A "Browse →" line inside a card that was already a link

```jsx
<Link href={...} aria-label={`Browse ${label} campaigns`}>
  ...
  <span>Browse -&gt;</span>   {/* decorative duplicate of its own parent */}
</Link>
```

Eight of these. Each added a text row plus `pt-5`. It was not a second link
— it was a span *inside* the link, so it could not even be tabbed to — but
it looked like an affordance, and it cost about 40px per card.

Removed. The card is the link; the label is its accessible name. The
`aria-label` went too: it was overriding the visible text with "Browse
Medical campaigns", which is worse for a screen reader than the label itself
and breaks voice control ("click Medical").

---

## What was decided

- **`grid-cols-2` from the smallest screen**, `lg:grid-cols-4` unchanged.
- **Descriptions `hidden sm:block`.** The gloss earns its space only where
  the space is free. On a phone "Medical" is the whole message; the
  description was a third line on each of eight cards. Desktop keeps them.
  *Rejected: deleting them entirely* — at 4 columns on desktop there is room,
  and "Disaster Relief" vs "Emergency" is a distinction worth one line.
- **Server component.** Dropped `'use client'` and framer-motion, which were
  there to stagger-fade eight tiles. Consistent with docs/49 and docs/59.
- **Distinct icon for Disaster Relief.** It shared `ShieldCheckIcon` with
  Veterans — two different categories rendering the identical glyph, four
  tiles apart. Now `ExclamationTriangleIcon`, which also disambiguates
  Memorial's flame from "Fires, floods, storms".

### Left alone deliberately

The section header carries **two** buttons, "Browse all" and "Start a
fundraiser", and the latter already appears in the navbar and the hero.
Removing a primary conversion CTA is a product decision, not a layout fix,
so it is flagged here rather than taken. It costs roughly 100px on mobile.

---

## Result

| | before | after |
|---|---|---|
| Mobile height | 1,944px | **790px** (−59%) |
| Desktop height | 731px | **640px** (−12%) |
| Client JS | framer-motion | **none** |
| Duplicate icons | 2 categories shared one | 0 |

Combined with docs/59 (−614px), the homepage drops from **10,631px to
roughly 9,400px on mobile**. GoFundMe is 7,745px. The gap is now mostly the
FAQ (1,598px / 244 words) and the campaigns grid, which are next.

Verified by screenshot at 390px and 1440px against a dev server confirmed to
be serving freshly compiled CSS.
