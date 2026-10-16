# 56 — The steps section, and an off-brand font on the homepage

Decided 2026-10-16. Section 5 of the landing-page pass, after `docs/55`
(campaign listing). Covers `HowItWorks` ("3 Steps to Give with Confidence")
and a font bug it exposed in `CategoryShowcase`.

---

## 1. The bug: homepage body copy was rendering in the OS serif

Read off the live page, 2026-10-16:

```
step body -> fontFamily: "ui-serif"   14px   weight 300
```

`ui-serif` is the **generic system serif** — Times New Roman on most
machines. Not DM Sans, not DM Serif Display. Two homepage sections were
rendering body copy in whatever serif the visitor's OS happened to ship.

### Why

`globals.css` defines `--font-display`, `--font-sans` and `--font-heading`.
**There is no `--font-serif`.** So `className="font-serif"` was not a brand
token at all — it was Tailwind's stock serif utility falling straight
through to the system stack.

Four usages, two files:

| File | Usages |
|---|---|
| `HowItWorks.tsx` | 2 |
| `CategoryShowcase.tsx` | 2 |

### Fix

Removed, so the text inherits `font-sans` (DM Sans) from `<body>`.

**Rejected: adding a `--font-serif` token pointing at DM Serif Display.**
That is a *display* face. Setting 14px body copy in it would be worse
typography than the bug, not better. The brand's text face is DM Sans; this
copy should always have been using it.

Weight also went `300` → normal. A 300-weight serif at 14px is thin on a
phone regardless of which serif it is.

### What this was NOT

I expected a contrast failure and checked before asserting one. There is
none — `--muted-foreground` measures **5.05:1** on white and **6.93:1** in
dark mode, both clearing WCAG AA's 4.5:1 for body text. The problem was
typeface, size and weight, not colour, and the colour is unchanged.

---

## 2. The step numbers were the faintest thing in a numbered process

| | GoFundMe | LastDonor (before) | After |
|---|---|---|---|
| Numeral | ~24px in a 56px circle | **12px** | **22px / 24px** |
| Colour | full contrast | `muted-foreground` | `foreground` |
| Face | sans | DM Serif Display | DM Serif Display |

A numbered process whose numbers are 12px and muted is not communicating
its own structure. GoFundMe anchors each step with a large circled numeral
and separates steps with rules; we had the rules but not the anchors.

The numeral keeps the display face — at 22px that is the right tool, where
at 12px it was not — and gains full-contrast ink and `tabular-nums`.

**Not copied:** their circled-numeral treatment. Ours is a flatter editorial
layout and a filled circle would not sit in it. The problem was legibility,
not the absence of a circle.

---

## 3. Measured

| | Before | After |
|---|---|---|
| Step body face | `ui-serif` (system) | DM Sans |
| Step body size / weight | 14px / 300 | 15px / 400 |
| Step numeral | 12px, muted | 22–24px, foreground |
| Section height, mobile | ~730px | ~820px |

The section got **taller**, deliberately. Everything here was small and faint
and the compactness was a symptom, not a virtue — unlike the campaign
listing in `docs/55`, where the height was genuine waste.

---

## 4. Not verified here

The preview harness could not confirm the typeface: its injected font
variables did not resolve, so it rendered the whole page in Times and was
useless for exactly the question being asked. This is the **second** time
that harness has produced a misleading result (see `docs/53` §3 on arbitrary
Tailwind classes). **Font and token questions must be checked against the
deployed page, not the harness.** Confirmed live after deploy.
