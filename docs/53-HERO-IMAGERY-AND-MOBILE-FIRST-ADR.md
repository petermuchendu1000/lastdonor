# 53 — Hero imagery, the mobile image, and the H1 brand question

Decided 2026-10-16. Follows `docs/49` (hero geometry) and `docs/51`
(consolidation). Answers three owner questions and records one generated
asset.

---

## 1. Does dropping "LastDonor" from the H1 cost SEO? No.

Measured on the served homepage, 2026-10-16:

| Signal | Value |
|---|---|
| `<title>` | `LastDonor - Reviewed Crowdfunding with 0% Platform Fees` — brand is the **first word** |
| Occurrences of "LastDonor" in served HTML | **91** |
| `meta description` | contains "LastDonor" |
| JSON-LD | `Organization`, `WebSite`, `FAQPage`, `BreadcrumbList` all name it |
| Domain | `lastdonor.org` |

Removing it from the H1 took the page from 92 mentions to 91. The brand is
carried by the title tag, the domain and structured data — not by the H1.

**The H1's job is query intent, not brand repetition.** A navigational search
for "LastDonor" is already won by the exact-match domain plus a title tag
that opens with the word. The H1 is the page's one chance to match
*non-brand* intent: "reviewed crowdfunding", "0% platform fee fundraising".
Spending its first line on a word the logo says 8px above it won nothing.

### Rejected: dropping "Reviewed" instead

This was the owner's suggested alternative, and it is the **worst** word to
remove. "Reviewed" is:

- the **first word of the title tag**, so H1 and title would disagree;
- the platform's stated differentiator — verify-before-publish is the wedge
  identified in `docs/21` and confirmed unoccupied in `docs/30` §2.1;
- the one word that distinguishes us from every other crowdfunding site in
  a SERP listing.

"0% platform fees" is a price claim competitors can match tomorrow.
"Reviewed" is the moat. It stays.

---

## 2. No hero image on phones

**Removed entirely.** Reasons, in order of weight:

1. **It cost a download for nothing.** Measured 2026-10-16: a 390px viewport
   fetched **two** hero variants (`w=384`, 6KB and `w=640`, 12KB). The
   desktop image was `hidden lg:block` — CSS-hidden, still in the DOM, still
   fetched. A hidden `<img>` is not a free `<img>`.
2. **It cost 215px of an 844px viewport** and carried nothing the headline
   did not already say.
3. GoFundMe's own mobile hero is **text-first**: badge, headline, subhead,
   one CTA, and imagery only after. We now match the pattern they have
   presumably tested far more than we can.

### How the remaining desktop image avoids the mobile cost

`sizes="(max-width: 1023px) 16px, 55vw"`. Declaring 16px below `lg` makes the
browser resolve the `srcset` to Next's smallest candidate on a phone rather
than a full-width one.

**Rejected: a JS `useIsDesktop` hook.** It would keep the image out of the
mobile tree entirely, but at the cost of delaying the desktop LCP element
until after hydration — and the desktop hero image *is* the LCP element. A
hydration-gated LCP would spend the 712ms/CLS 0 lead measured in `docs/51`
to save 1KB. The `sizes` route is server-rendered and keeps `priority`
preloading.

### Replacing it with an ambient CSS wash

With no image, the mobile hero was a flat grey slab. Two CSS radial
gradients in the brand amber and teal now sit behind the headline. No image
request, no JavaScript, no layout box, so it cannot move LCP or CLS. It does
not animate, so there is nothing for `prefers-reduced-motion` to suppress.

---

## 3. The desktop hero image is AI-generated, and that needs saying

`public/images/hero-hope.webp` was generated on **Cloudflare Workers AI**,
model `@cf/black-forest-labs/flux-1-schnell`, 2026-10-16, then resized to
1600×1600 and encoded to WebP at q78 (108KB source; Next serves smaller
per-breakpoint variants).

It replaces a close crop of a visibly distressed woman with her hand over her
mouth — the problem raised in `docs/49` §3.1. The two images make opposite
appeals: the old one said *someone here is suffering*, the new one says
*this works*.

### The risk, stated plainly

**This platform's entire positioning is that it does not fabricate.** `docs/33`
gates seeded donations fail-closed; `docs/36` records a sanitization incident
over forged press attribution and invented quotes. Putting synthetic humans
in the hero of that platform is a tension worth naming even though the image
is decorative and depicts no real campaign or beneficiary.

Mitigations applied:

- The `alt` text describes the scene plainly and claims nothing about it
  being a real LastDonor campaign or donor.
- It is brand imagery in the hero only. It is **not** used on any campaign
  page, in any campaign card, or anywhere a reader could take it for
  documentary evidence of a beneficiary.

**Four candidates were generated.** `d-father-child` was discarded outright —
the model rendered the father with two heads. A faceless alternative
(`b-hands`, two pairs of hands clasped across a table) was generated and
kept in the session scratchpad: **if the synthetic-people question is ever
decided against, that is the zero-risk swap**, since an image with no faces
cannot be mistaken for a person.

**Recommended follow-up:** replace with a licensed photograph of real people,
with a release, when budget allows. AI imagery is the right call for today,
not the right call forever, on this particular platform.

---

## 4. Other mobile-first changes

- **Trust strip → chips.** Was a 12px grey run-on separated by middots that
  wrapped into two ragged lines at 390px and read as fine print. Now three
  bordered chips at 13px, settling into two tidy lines. "Every campaign
  human-reviewed" shortened to "Human-reviewed campaigns" purely so the wrap
  is deliberate rather than accidental.
- **Full-width CTAs below `sm`.** A 260px pill floating in a 390px column
  reads as tentative; full-width is the standard mobile affordance and the
  largest available tap target. Inline from `sm` up, unchanged on desktop.
- **The AI/SEO answer block lost three of five definition pairs.** "0%
  platform fee", "Reviewed campaigns" and "Donation tracking and impact"
  restated claims already made by `HowItWorks` and `HomepageFAQ` — the
  *fifth* consecutive statement of the same argument, after the four counted
  in `docs/51`. The two kept say something found nowhere else. **The SEO
  payload is untouched:** every target term lives in the lead paragraph,
  which is what the `data-speakable` block exists to serve.

### Measured after

| | Before this change | After |
|---|---|---|
| Mobile hero height | 927px (with image) | **657px** |
| Mobile hero image requests | 2 (18KB) | **0 full-size** |
| Hero fully above the fold (844px) | no | **yes** |
| Trust strip lines at 390px | 2, ragged | 2, aligned chips |

---

## 5. On "3D, alive, interactive" — what was deliberately not done

The request was for a more exciting page, with 3D as an example. **No 3D
engine was added, and that is a recommendation, not an oversight.**

Three.js or Spline costs roughly 500KB–1MB of JavaScript, runs the GPU on
devices that are mostly mid-range phones, and would put a large animated
canvas in the critical path. Our measured advantage over GoFundMe is
**CLS 0 vs 0.75** and **LCP 712ms vs 884ms** on mobile (`docs/47` §0,
`docs/51` §3). A 3D hero would hand that back and then some.

What was used instead, at effectively zero byte cost: layered CSS gradients
for depth, chips with real borders and elevation rather than flat text,
full-bleed primary actions, and the stagger/reveal motion already in
`AnimateOnScroll`.

**If genuine interactivity is wanted next, the highest-value candidates are
all content, not chrome:** a live donation activity feed (currently
impossible — every campaign is at zero), an impact calculator on the donate
form, and a share-preview the organizer can see before posting. Those make
the page feel alive because something is actually happening, rather than
because something is spinning.

---

## 6. A regression this change caused, and the fix

**Removing the mobile hero image made mobile LCP worse before it made it
better, and the first version of this change shipped that.**

Measured on production, three consecutive runs: **LCP 1,656ms / 1,936ms /
1,732ms**, against 712ms before. Not a cold start. The LCP element had
become `p.hero-summary`.

### Cause

The hero's paragraph, CTA row and trust chips were `motion.*` elements using
the `fadeInUp` variant, whose `hidden` state is `{ opacity: 0, y: 24 }`.
They were invisible until React hydrated and framer-motion ran.

That was survivable while the preloaded hero image was the LCP element — the
image painted at 712ms and the hydration-gated text never mattered. Removing
the image from phones promoted that text to LCP, and with it the hydration
dependency that had been hiding behind the image all along.

The H1 was already exempt: `globals.css` carried a `.hero-h1` CSS animation
with a comment explaining that JS-gated opacity keeps text out of the DOM
for crawlers. **The codebase had already diagnosed this problem for one
element and not generalised it.**

### Fix

`.hero-reveal` plus three stagger delays, replacing the motion wrappers.
A CSS animation runs at parse time, so the text paints immediately and
animates afterwards — visually identical, no JavaScript in the critical
path. The new rule also honours `prefers-reduced-motion`, which the existing
`.hero-h1` animation did not.

With no motion left, `HeroSection` uses no hook and no handler, so it drops
`'use client'` and renders on the server.

### Verified

| | Before image removal | Regression | After fix | GoFundMe |
|---|---|---|---|---|
| Mobile LCP | 712ms | 1,656–1,936ms | **728ms** | 884ms |
| Mobile CLS | 0 | 0 | **0** | 0 |
| LCP element | hero image | `p.hero-summary` | `span.text-primary` (H1) | hero image |
| Mobile hero image bytes | 18KB (2 requests) | 0 | **0** | — |

### The generalisable lesson

An LCP that depends on hydration is invisible for as long as something
faster happens to be the largest element. Removing an image is enough to
expose it. **Before changing what the largest element on a page is, check
whether the next candidate is gated on JavaScript.**
