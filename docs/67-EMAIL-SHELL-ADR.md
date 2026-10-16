# 67 — One email shell, and five fabricated statistics removed

**Date:** 2026-10-16
**Status:** Implemented

---

## What the mail looked like

Both `email-templates.ts` and `email-adaptive.ts` carried an **identical
copy** of this, wrapping all 44 templates:

```html
<div style="font-family: 'DM Sans', Arial; max-width:600px; padding:24px;">
```

A bare `div`. Specifically:

| Problem | Consequence |
|---|---|
| No doctype, no `<head>` | No charset, no viewport, no dark-mode declaration |
| No tables | **Outlook on Windows renders through Word**, which does not lay out `div` widths reliably |
| CTA was padding on an inline `<a>` | Word ignores both padding and `border-radius` on an anchor, so the primary action rendered as **plain blue text** |
| No preheader | The inbox preview line was whatever text came first, almost always "Hi Ada," |
| No brand header | Nothing identified the sender above the body |
| `'DM Sans'` named with no fallback reasoning | Gmail strips `@font-face`, so it silently fell back to Arial while headings fell to Times |

---

## The shell

`src/lib/email-shell.ts`. Both `wrap()` functions now call it, so all 44
templates were upgraded without being individually rewritten.

- Full XHTML document, charset, viewport, `color-scheme`.
- Table layout throughout, `role="presentation"`.
- **Bulletproof button**: a table with the background on the `td`, wrapped in
  a VML `v:roundrect` that only Word parses, with the HTML version hidden
  from Word so it is not drawn twice.
- **Preheader**, derived automatically (below).
- Brand header: the LastDonor wordmark as *text*, so it survives images being
  off.
- Dark-mode rules, mobile rules, reduced-motion rule.
- Typography set on the content cell so the templates' unstyled `<p>` tags
  inherit it. Without that every template would have rendered in the client
  default serif.

### Fonts: why not DM Serif Display and DM Sans

Gmail drops `@font-face`, so the brand faces cannot load for the largest
share of readers. Naming them anyway produces a silent fallback to Times.
The stacks instead name the closest system faces — Georgia for display,
the system humanist sans for body — and the brand is carried by colour,
spacing and tone, which render everywhere.

All **67** heading declarations across both files were given the serif
stack, so headings now match the wordmark instead of rendering sans.
Semantic colours were left alone: teal for ordinary news, orange for
attention, red for a problem.

### Animation and illustration: the honest ceiling

The brief asked for animation and 3D illustration. What is actually
deliverable:

- **CSS animation is progressive enhancement only.** Apple Mail, iOS Mail
  and Samsung Mail honour keyframes; Gmail and Outlook strip them. The shell
  ships a short rise-in on the card, and every element is fully legible in
  its final state, so a client that ignores it loses nothing.
- **No SVG.** Gmail strips it entirely, so an inline-SVG illustration is
  *nothing at all* for most readers.
- **No hosted 3D renders as load-bearing content.** Images are off by
  default in Outlook and for many Gmail readers. Depth here is built from
  table cells, borders and background colours, which always render.

**Rejected: shipping a hero illustration anyway.** It would look impressive
in a preview tool and blank in the inbox for the plurality of recipients,
while adding weight that hurts deliverability.

### The preheader

`derivePreheader()` builds the inbox preview line from the body, so every
template gained one without being edited. It strips **headings first** (the
headline is already visible beside the subject; repeating it wastes the one
spare line) then a leading greeting (the reader knows their own name), then
truncates on a word boundary.

Before: `"You Just Made a Real Difference Hi Ada, You just did something..."`
After: `"You just did something meaningful. Your donation of $50.00 to After the tornado..."`

---

## Five fabricated statistics, removed

Found while reading the copy. **None had a source anywhere in the
repository**, and all four files shipped them to real donors and organizers:

| Where | Claim |
|---|---|
| `email-adaptive.ts:289` | "One thing you can do right now that **doubles your impact**" |
| `email-adaptive.ts:290` | "Personal shares are **10x more effective** than social media posts" |
| `email-adaptive.ts:548` | "Campaigns that post updates at least once a week raise **2x more**" |
| `email-adaptive.ts:649` | "Personal messages get **10x more donations** than public posts" |
| `email-templates.ts:370` | "Campaigns that receive their first donation within 24 hours raise **3x more on average**" |

This is the same class as the invented "One share brings an average of two
new donors" removed from `DonationForm` earlier in this session, and the
501(c)(3) disclaimer removed in `13a2726`. `CLAUDE.md`: *never add a claim
the platform cannot substantiate.*

**The replacements are more persuasive, not less.** A fabricated multiplier
is a weak persuasive device because it invites arithmetic; a true statement
about *mechanism* does not:

> ~~"Share this campaign with one person. Personal shares are 10x more
> effective than social media posts."~~
>
> "Send this to one person you think would care. A public post reaches
> everyone and asks no one. A message asks someone, by name, and it comes
> from you, who already gave."

That carries reciprocity (you already gave), identity (by name) and a
concrete action, and every clause is true.

> ~~"Quick tip: Campaigns that post updates at least once a week raise 2x
> more than those that don't."~~
>
> "Quick tip: Your donors have no way of knowing what their money did unless
> you tell them. Five minutes and one photo is the difference between a
> receipt and a reason to give again."

---

## Tests

`src/lib/email-shell.test.ts`, 20 tests, covering the two things that break
invisibly:

- **The preheader**, which is hidden in the markup and therefore never
  noticed in development: heading skipped, greeting skipped, word-boundary
  truncation, entity decoding, heading-only body.
- **The Outlook button**, which degrades to plain text the moment the VML is
  lost: asserts `v:roundrect`, the `[if mso]` branch, the `[if !mso]` guard,
  and that the href appears in both branches.
- **Document invariants**: doctype present, no `display:flex`, no
  `display:grid`, no `<svg>`, no `@font-face`, `color-scheme` declared,
  reduced-motion respected.
- **CAN-SPAM**: the postal block appears for commercial mail only when
  `MAILING_POSTAL_ADDRESS` is set, and never otherwise (docs/41 §5.1).

---

## Standing blockers on actually sending

Three, and all three must clear before any of this reaches an inbox:

1. **No scheduler** — docs/65, docs/66. Built, blocked on a Cloudflare token.
2. **`RESEND_API_KEY` returns 401.** The key on Fly is rejected.
3. **`MAILING_POSTAL_ADDRESS` is not set.** Verified against Fly's secret
   list on 2026-10-16: only `RESEND_API_KEY` exists among mail variables. So
   `send-newsletter` would correctly refuse to send even with the other two
   fixed. It needs the operator's **real** physical address; inventing one is
   what docs/41 §5.1 exists to prevent.
