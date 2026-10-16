# 70 — The icon system

**Date:** 2026-10-16
**Status:** Implemented (layer and brand set), migration staged behind a ratchet

---

## What was actually wrong

Measured across `src/**` before this layer existed:

| Inconsistency | Count |
|---|---|
| Distinct `strokeWidth` values | **5** (1.5, 1.6, 1.8, 2, 2.5) |
| Icon sets in use | **3** (24/outline, 24/solid, 20/solid) |
| Distinct size classes | **10+** (`h-3` … `h-16`), no scale |
| Files with hand-rolled inline SVG | **17** |
| Local redefinitions of one `SortIcon` | **3** (three admin files) |
| Distinct icons / importing files | 105 / 80 |

Every one of those is a decision taken at a call site that should never have
been a decision. An icon's stroke weight is a property of the brand, not of
the button it happens to sit in.

---

## The contract

`src/components/ui/icon/`

- **One grid.** Every icon declares `viewBox="0 0 24 24"`, so swapping
  artwork never shifts alignment.
- **One stroke.** `STROKE_WIDTH = 1.75`, round caps and joins, plus
  `vectorEffect="non-scaling-stroke"` so a 14px and a 32px icon have the
  same *visual* weight rather than the same scaled weight.
- **A size scale, not pixels.** `xs 14 / sm 16 / md 20 / lg 24 / xl 32`,
  derived from where usage actually clustered (`h-4` 206 uses → `sm`, `h-5`
  88 → `md`, `h-6` 15 → `lg`), not invented.
- **Accessible by default.** `aria-hidden` unless `label` is passed, because
  almost every icon here sits beside its own text and announcing it twice is
  worse than not at all. `label` promotes it to `role="img"` with a
  `<title>`. Never focusable.
- **`currentColor` only.** No icon carries its own colour.

---

## What was NOT done, and why

**105 icons were not redrawn by hand.** Heroicons are drawn by designers on
a 24px grid with consistent optical correction. Hand-writing 105 replacement
paths in one session would produce worse artwork while calling itself a
brand asset, which is exactly the result this work exists to avoid.

What ships instead is the part that is genuinely ours and genuinely missing:
**the facade and the brand icons**. Call sites import from one module and
never choose a stroke, a size or a variant again. Artwork behind a given
name can then be redrawn one icon at a time **without touching a single call
site** — that seam is what makes this a library rather than a folder of
SVGs.

---

## The brand icons

Seven, drawn here because the concept is ours and a generic set has no mark
for it:

| Icon | Why it exists |
|---|---|
| `ReviewedIcon` | A document with a tick, not a shield. A shield claims "protected"; what happens is that a person reads the campaign before it goes live. |
| `ImpactUpdateIcon` | A camera. The promise is a photo *and* the receipt; an eye says "visible" and stops. |
| `ZeroFeeIcon` | A banknote struck through. |
| `ReceiptIcon` | The torn-edge receipt a donor is promised. |
| `PayoutIcon` | Money leaving for a verified account; direction is the point. |
| `LastDonorIcon` | A heart completed by a final mark. The product's own idea, previously unrepresented. |
| `FirstDonationIcon` | The zero state, where a progress bar renders as an empty trough. |

### `ZeroFeeIcon` took three attempts, and the first two shipped nothing

1. **A percent glyph** (two circles and a rising diagonal). Rendered at 32px
   it read as a plain `%` — which says "fee", the **opposite** of the claim.
2. **A percent with a perpendicular negating bar.** Two crossing diagonals
   over two small circles read as a scribble at 32px and would be mud at 16.
3. **A banknote with one slash.** Three large shapes, each legible on its
   own at `sm`, which is the size the trust bar actually renders.

Recorded because the failure mode is specific and repeatable: **an icon that
is correct as a drawing can still be wrong as a sign**, and the only way to
find out is to render it at the size it ships at and look.

---

## Tests: 191

`icon.test.tsx` turns each former inconsistency into a failing test:

- every icon is on the 24 grid and carries the brand stroke;
- the whole system resolves to **exactly one** stroke width (asserted as a
  set, so adding a second fails);
- each scale step renders at its exact pixel size, and brand and wrapped
  icons agree at the same step;
- every icon is `aria-hidden` by default, becomes `role="img"` with a title
  when labelled, and is never a tab stop;
- brand artwork contains no hardcoded hex and no `fill`;
- `SortIcon` distinguishes asc/desc and dims the unsorted state so the
  header does not reflow.

### A type collision the compiler caught

`SortIcon` first took `IconProps & { direction?: 'asc' | 'desc' | null }`.
`SVGProps` already declares `direction` (the SVG text attribute,
`string | undefined`), so the intersection silently narrowed the union and
**dropped `null`** — the unsorted state would not have type-checked at any
call site. Fixed with `Omit<IconProps, 'direction'>`.

---

## Migration ratchet

80 files still import heroicons directly and 16 contain hand-rolled SVG.
Failing on any occurrence would mean rewriting all of them in one commit,
which is how migrations get abandoned. Two tests assert the counts **do not
grow**, so the number can only come down. When it drops, lower the baseline
in the same commit.

The footer's hand-rolled card SVG was migrated as the first step and the
baseline lowered 17 → 16, which also proves the seam works end to end.
