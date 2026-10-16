# 69 — The footer on a phone, and a duplicate signup

**Date:** 2026-10-16
**Status:** Implemented

---

## Measurement

Live, 2026-10-16:

| | Height | Words | Links |
|---|---|---|---|
| Mobile (390px) | **1,408px** | 91 | 18 |
| Desktop (1440px) | 589px | 91 | 18 |

**2.4× taller on a phone, and roughly a fifth of the entire homepage**
(6,865px at the time). The cause was the same one `docs/60` found in the
category grid: three link groups stacking one per row below `sm`.

---

## What changed

### 1. The homepage asked for an email address twice

`<Newsletter />` rendered a "Stay in the Loop" card, and the footer's own
"Stay in the loop" strip sat roughly 300px below it. The same heading, the
same field, the same button, inside one scroll.

**The footer's version was kept and the homepage section removed.** The
footer appears on every page; the homepage section appeared on one. Removing
the section also takes 336px off the homepage.

### 2. Link groups flow in columns on a phone

This took three attempts, and the simplest won:

1. **A two-column grid** of the three groups put Platform (6 links) and
   Trust (7) in row one and pushed Legal (4) to row two. Row one took its
   height from Trust, leaving a block of dead space under Platform.
2. **Pairing Platform and Legal into one cell** balanced it and saved a
   further 30px, but a paired cell is adjacent in the DOM while being
   visually split by Trust, so the focus order stopped matching the reading
   order (WCAG 2.4.3). Adding `sm:order-*` to restore the desktop sequence
   only moved the mismatch from desktop to mobile.
3. **`columns-2`** flows the groups down the first column and on to the
   second, which is exactly DOM order, so reading order and focus order
   agree at every width.

Option 3 ships. It leaves some space under the shorter column; that is a
cosmetic cost and it is the right one to pay. **Verified** by comparing DOM
order against column-flow order at 390px and 1440px: `MATCH` at both.

### 3. Two claims removed from the brand block

- **"Reviewed Fundraising Platform"** pill. The tagline directly above it
  opens with "Reviewed fundraising" and the trust bar at the top of the page
  says "Human reviewed". Three statements of one claim in a single viewport.
- **"SSL Protected"**. Every site has been HTTPS for years, so it signals
  nothing and spends a line saying so. **"Secured by Stripe" stays** —
  who holds the card details is a real question a donor has.

---

## A test was retargeted, not deleted

`Footer.test.tsx` asserted the pill text. Rather than drop the test, it now
asserts the *claim* via the tagline:

```
it('states that fundraising is reviewed', ...)
  expect(screen.getByText(/Reviewed fundraising/i))
```

The guarantee the test exists for is unchanged; only its coupling to one
piece of markup is gone. Per `CLAUDE.md`, a test and the code disagreeing
means working out which drifted: here the code changed deliberately and the
assertion was following the element instead of the promise.

---

## Result

| | before | after |
|---|---|---|
| Footer, mobile | 1,408px | **1,002px** (−29%) |
| Footer, desktop | 589px | **560px** |
| Homepage newsletter signups | 2 | **1** |
| Focus order matches visual order | n/a | **verified at 390 and 1440** |

The remaining mobile height is roughly: newsletter strip 203px, link columns
406px for 17 links, brand block and bottom bar ~390px. Measured, not
estimated.
