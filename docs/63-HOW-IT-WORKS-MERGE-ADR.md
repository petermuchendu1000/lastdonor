# 63 — Two explainer sections merged into one interactive one

**Date:** 2026-10-16
**Status:** Implemented
**Amends:** `docs/51` (homepage consolidation) and `docs/53`, which created
and then trimmed the answer block this removes.

---

## The complaint

Owner review of the live desktop homepage: two sections "look vibe-coded",
are "too wordy" and are "not interactive".

They were right, and the measurement backs it:

| Section | Desktop | Mobile | Words |
|---|---|---|---|
| "What LastDonor Does" | 353px | 575px | 86 |
| "3 Steps to Give with Confidence" | 496px | 871px | 76 |
| **Together** | **849px** | **1,446px** | **162** |

---

## What was actually wrong

### 1. They were the same section twice

Both exist to explain the product. Between them, and with the trust bar and
the fee band, **"0% platform fees" appeared four times on one page**:

- the trust bar ("0% Platform Fees. Standard Stripe payment processing fees apply.")
- the answer block ("We charge 0% platform fees on fundraisers")
- step 02 ("LastDonor charges 0% platform fees on fundraisers; standard Stripe processing fees apply")
- the fee band, whose entire job that is

Repetition at that density does not reinforce a claim. It reads as a site
with nothing else to say.

### 2. The prose was written for a crawler, not a reader

> "LastDonor helps people support **medical fundraising**, **emergency
> fundraising**, and **disaster relief fundraising** campaigns…"

"Fundraising" three times in one sentence. That is the specific texture the
owner called vibe-coded, and it is what keyword-stuffing reads like to a
person.

### 3. Nothing to look at and nothing to do

Three 20px grey outline icons (shield, padlock, bar chart) straight from the
default set, a number, and two lines of prose per column. No product, no
imagery, no state.

---

## What replaced them

One section, **How it works**, with a stepper that drives a preview panel.
Each step shows the actual product:

| Step | Panel |
|---|---|
| 01 Find a campaign you trust | A reviewed campaign card with its verification checklist |
| 02 Give in seconds | Amount chips, the donate control, platform fee `$0.00` |
| 03 See what it paid for | An impact update with photo, quote and receipt total |

**The panels are markup, not screenshots.** A screenshot of a product goes
stale the first time the product changes and nobody notices until a visitor
does.

GoFundMe's equivalent section pairs numbered steps with a video and a
progress ring that advances with it. The device worth taking is that the
steps *drive* something. The video is not worth taking: a heavy autoplaying
asset is exactly what let us beat them on LCP (docs/49), so the countdown is
a 2px CSS bar instead.

### Copy

162 words to 94, and the fee claim now appears **once** outside the fee band
(as `$0.00` in a panel, where it is demonstrated rather than asserted).

### The SEO payload is intact

`#ai-answer` is named in this page's JSON-LD `speakable.cssSelector`, so the
element had to survive. The paragraph moved into the new section keeping
every target term — "medical", "emergency", "disaster relief fundraising",
"0% platform fees on fundraisers", "visible donation tracking" — in **25
words instead of 43**, and without saying "fundraising" three times.

### Accessibility

A real tabs pattern: `tablist`/`tab`/`tabpanel`, roving `tabindex`, arrow
keys plus Home/End. Auto-advance **stops permanently** the moment anyone
selects a step, and never starts under `prefers-reduced-motion`.

---

## Two defects found by testing rather than looking

### The panel jumped 52px on every tab change

Measured per step: **238px, 267px, 290px**. Switching tabs moved everything
below it.

Fixed by stacking all three panels in **one grid cell** so the container is
always as tall as the tallest. Inactive panels use `invisible`, not the
`hidden` attribute — `hidden` removes them from layout and the container
collapses back to the active one, while `visibility: hidden` reserves the
space and still correctly removes the content from the accessibility tree
and tab order. No magic min-height, and it stays correct at every
breakpoint. Verified: **0px jump** at 390px and 1440px.

### The em-dash rule had a hole, and I fell in it

`.eslintrc.json` prohibits em dashes, but its selectors only matched
`Literal` and `TemplateElement`. **JSX text is `JSXText`**, so an em dash
written directly in markup passed lint cleanly. Mine did.

Added `JSXText[value=/—/]` and mutation-tested it: reintroducing the dash
fails lint with the right message. A sweep found the only other occurrences
in `src/**/*.tsx` are inside code comments, which the selector does not
match, so the codebase is clean.

---

## Finding: our CSP breaks interactive components in local dev

While testing, the stepper appeared completely dead in `next dev` —
`aria-selected` never changed, the panel never switched. It was not the
component. The console showed:

```
Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an
allowed source of script … "script-src 'self' 'unsafe-inline' js.stripe.com
plausible.io embed.tawk.to"
```

Next's **development** runtime needs `unsafe-eval`; the production bundle
does not. So React never hydrates in dev, and **every** client component is
inert locally. Rebuilt and served with `next start`, the same code works and
throws no errors.

This is a developer-experience defect worth fixing separately — anyone
building an interactive component here will conclude their code is broken.
The fix is to allow `unsafe-eval` in the CSP **for development only**, never
in production. **Not done in this change**, because the CSP is a security
control (docs/32, docs/46) and widening it deserves its own review rather
than being slipped into a homepage edit.

Until then: **verify interactive components against `next build && next
start`, not `next dev`.**

---

## Result

| | before (2 sections) | after (1 section) |
|---|---|---|
| Desktop | 849px | **666px** (−22%) |
| Mobile | 1,446px | **956px** (−34%) |
| Words | 162 | **94** (−42%) |
| "0% platform fees" on the page | 4× | 3× |
| Interactive | no | yes |
| Layout shift on interaction | n/a | **0px** |
