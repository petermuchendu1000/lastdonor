# 71 — `/campaigns` and the campaign detail page, measured against GoFundMe

**Date:** 2026-10-16
**Status:** Implemented
**Amends:** `docs/47` (card zero state), closing the case `docs/62` recorded
but did not take.

---

## Measurement first, and it changed the plan twice

Live, 390×844, 2026-10-16.

### The listing

| | LastDonor `/campaigns` | GoFundMe `/s?q=medical` |
|---|---|---|
| Document height | 4,286px | 5,061px |
| Cards on first load | 12 | 8 |
| **Page height per card** | **357px** | **633px** |
| Words | 483 | 494 |

**Our listing is already nearly twice as dense as theirs per card.** The
docs/55 card work did its job, so density was not the gap and no card
redesign was warranted.

### The detail page

| | LastDonor | GoFundMe |
|---|---|---|
| Document height | **4,245px** | 6,867px |
| Words | 509 | 522 |

**38% shorter for the same word count.** Also not the gap.

### Where the gap actually was

| | LastDonor | GoFundMe |
|---|---|---|
| Chrome before the first card | **486px (58% of the fold)** | **238px (28%)** |

A visitor met 248px more furniture before seeing a single campaign.

### A measurement that corrected me

From the 2× screenshot the `h1` looked enormous and I was about to shrink it
hard. Measured, it is **72px** (two lines at 30px/36px) and the whole header
is 124px. The headline was not the problem. The controls were.

---

## What changed on `/campaigns`

### 1. Three filter pills were the same control twice

The Filters sheet already contains **Category**, **Location** and **Close to
target** as full sections. The pill bar rendered all three again, and the
code comment on the first one already said `(desktop)` — it simply was not
true. Five pills wrapped to two rows on a phone.

Those three are now `hidden` below `sm`, where the Filters button (which
carries the active-filter count) is the single entry point. **Sort stays
visible at every width**: it is a different axis from filtering, and its
label doubles as a statement of the current order.

### 2. A tab strip with nothing to switch to

With no completed campaigns the strip read `Active 12 | Completed 0` — a
second tab linking to an empty page, beside a first tab repeating the count
printed one line above. It now renders only when `completedCount > 0`, so it
appears exactly when it becomes useful.

### 3. A dangling separator

```
12 active campaigns ·
Each one reviewed before going live
```

The paragraph is `flex flex-wrap`. On a phone the second phrase wraps to its
own line and the middot was left stranded at the end of the line above it.
A separator only separates when both sides share a line, so it is now
`hidden sm:inline`.

---

## The card zero state, finally changed

`docs/47` made **"Be the first to donate"** the prominent line and demoted
the goal, evaluating **one card**. `docs/62` recorded that six of them in a
grid read as *"nobody has donated to anything here"* but did not act,
because changing what a donor reads first is an owner's call.

`/campaigns` shows it **twelve times down a single column**. That is no
longer a nuance; at twelve it is the dominant message of the page.

**The goal now leads and the prompt sits one step below it.** A column of
goals reads as twelve campaigns with targets. Nothing is hidden, and the
campaign-page **sidebar keeps docs/47's order** — one instance, high intent,
where the invitation is exactly right.

---

## The detail page: the sticky bar was contradicting its own page

The mobile bar is fixed to the bottom of every phone screen, which makes it
the most-seen element on the page. For an unfunded campaign it said:

> **0% funded · $150,000 to go**

while the sidebar on the same page said *"Be the first to donate"*. "0%
funded" is the exact sentence `docs/47` removed everywhere else, surviving
on the single most prominent surface.

The bar now carries the unfunded state: **"Be the first to donate · $150,000
goal"**, and the empty progress trough is dropped with it. Above zero, the
bar and the percentage return unchanged.

---

## Content: 10 of 12 campaign stories contained em dashes

The house style prohibits em dashes, and `docs/63` added a `JSXText` ESLint
selector after one slipped through. **That rule cannot see database
content**, and a campaign story rendered on the live detail page read:

> "This vision isn't distant**—**it's ready to take shape with your support."

Counted: **10 of 12 campaigns**, 29 occurrences in total.

Safe to fix, and checked before touching anything: every campaign is
`source = 'automated'`, so this is machine-generated seed copy, **not a real
person's words**. Editing someone's own appeal would not have been mine to
do.

Every occurrence was the unspaced `word—word` dramatic pause, so `, ` reads
naturally in all of them — verified by sampling six before writing, not
after. Applied as `regexp_replace('\s*—\s*', ', ')` with two tidy-up passes,
inside a transaction.

**After: 0 em dashes, 0 `" ,"` artefacts, 0 `",,"` artefacts across 12
campaigns.** The sentence above now reads "This vision isn't distant, it's
ready to take shape with your support."

### Worth noting separately

An em dash is a reliable tell for machine-generated prose, and all twelve
campaigns are `source = 'automated'` while being published as appeals from
named people. That is `docs/33`'s territory (the owner's seed-data
disclosure decision) and is **not reopened here**; this change only
normalises punctuation.
