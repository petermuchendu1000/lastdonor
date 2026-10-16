# 51 — Card anatomy and homepage consolidation

Decided 2026-10-16. Sections 3+ of the landing-page pass begun in `docs/48`
(navbar) and `docs/49` (hero), plus the campaign card, which appears on both
the homepage and `/campaigns`.

**Method.** Card DOM and computed styles extracted at 390×844 and 1440×900
from `gofundme.com/discover` and `lastdonor.org/campaigns`. Section heights
from the homepage of each. Redundancy counts taken from the component
sources. Campaign data read from production via the Supabase SQL API.
GoFundMe figures **VERIFIED, retrieved 2026-10-16**.

---

## 1. The card: they show less, and that is the point

| | GoFundMe | LastDonor (before) |
|---|---|---|
| Card size (desktop) | 355×340 | 349×**401** |
| Corner radius | **0px** | 18px |
| Border / shadow | **none / none** | 1px / none |
| Image ratio | 3:2 (1.50) | 16:10 (1.60) |
| Image share of card | **66%** | 54% |
| Elements in card | **4** | **7** |
| Progress bar | **none** | yes |
| Goal shown | **no** | yes |
| Donor count | no | if > 0 |
| Title size | 16px, clamp 2 | 15px, clamp 2 |
| Image loading | `auto`, no `srcset` | **`lazy` + `srcset`** |

Their entire card is: image, location, title, **and one number — "$38,515
raised"**. No goal, no percentage, no bar.

### 1.1 Why omitting the goal is a deliberate move, not an omission

"$38,515 raised" is unambiguously positive. "$38,515 of $500,000" silently
reports 7.7%, and a progress bar renders that failure as a picture. By
showing only the amount raised, **every campaign in their grid looks
successful regardless of how it is actually doing.**

Our grid did the opposite. Every live campaign is at `raised_amount = 0`
(verified in production; correct, because seeded donations are gated off per
docs/33 and docs/41), so the browse page rendered **twelve empty progress
bars under twelve "$0 raised"**.

**Decided:** keep the bar where it carries good news, drop it where it does
not. `raisedAmount > 0` now gates the bar. The goal line stays, so nothing is
concealed — a donor can still see what the campaign is asking for. This is a
weaker version of their move: they hide the denominator permanently, we hide
only an empty bar.

**Rejected:** copying them exactly and removing the goal from the card
outright. The goal is the single most useful number for deciding whether a
campaign is plausible, and hiding it permanently to flatter the grid is the
kind of thing this project's own `CLAUDE.md` warns against.

### 1.2 "for \<name\>" was duplicated text on 11 of 12 cards

Queried against production:

- subject's **full** name already in the title: **11 / 12**
- subject's **first** name already in the title: **12 / 12**

So `for Keisha Wallace` sat directly under
*"Keisha Wallace Fights to Keep Her Four Kids Off Atlanta Streets"*.

**Decided:** render the line only when the title does not already contain the
subject's name. The beneficiary signal matters — organizer-versus-beneficiary
is a real differentiator (docs/30 §1.4) — so it is kept where it adds
something and dropped where it repeats.

### 1.3 Title to 16px

15px → 16px, matching theirs. Ours was the smaller title on the taller card.

### 1.4 Kept, against their example

Their images are `loading="auto"` with **no `srcset`**. Ours are `lazy` with
`srcset`. Ours is better and is part of why our CLS and LCP beat theirs
(docs/47 §0). **Not changed.**

Corner radius, border, 16:10 ratio: theirs is a flat square-cornered tile,
ours is a rounded bordered card. A style difference, not a defect. Left alone.

---

## 2. The homepage said the same three things eleven times

Counted across the five trust sections' sources:

| Claim | Times asserted |
|---|---|
| "0% platform fees / no platform cut" | **4** |
| "reviewed before publication" | **3** |
| "visible impact tracking" | **3** |

Those five sections occupied **4,036px of a 15,756px mobile page — 48%.**
GoFundMe makes its trust argument in **one** section, 942px of 7,801px — **9%**.

### 2.1 The worst of them advertised the thing it was meant to dispel

`ImpactCounter` is served in production as, verbatim:

> **Real Numbers. Real People Helped.** These are totals from real donors
> giving to reviewed campaigns. **Not projections. Not estimates.** — **$0**

664px of confident framing wrapped around a zero, on a page whose entire
proposition is trustworthiness. This is not a redundancy problem; it is a
section that works against the site.

### 2.2 What was removed, and where each claim survives

| Removed from homepage | Every claim it made now lives in |
|---|---|
| `ImpactCounter` | nothing to preserve — it rendered `$0` / 0 donors / 0 funded |
| `Testimonials` ("What Donors Can Verify Before Giving") | HowItWorks steps 01, 02, 03 |
| `TrustBanner` ("Built on Proof, Not Promises") | `HomepageFAQ`, which already asks all three of its questions |

`TrustBanner`'s three questions against the existing FAQ:

| TrustBanner | HomepageFAQ |
|---|---|
| "How do I know campaigns are reviewed?" | "How does LastDonor review campaigns before publication?" |
| "Will they charge a platform fee?" | "Does LastDonor charge platform fees?" |
| "What happens to my money?" | "Where does my donation money go?" |

**The two that remain:** `HowItWorks` (process and verification, stating all
three claims once, in order) and `WhereYourMoneyGoes` (the fee breakdown).

**None of the three components is deleted.** They remain in the repo and on
`/how-it-works` and `/transparency`.

### 2.3 Kept despite fitting the pattern

The `What LastDonor Does` block is **not** redundant trust copy — it is the
`data-speakable` AI/SEO answer block, built for snippet extraction per
docs/12 and docs/20. Removing it would cost search surface for no layout
gain. Kept.

---

## 3. Effect — measured in production

The prediction was ~2,965px off the mobile page (664 + 1,184 + 1,117),
landing near 12,800px. Measured on production after deploy:

| | Before | After | GoFundMe |
|---|---|---|---|
| Mobile homepage height | 15,756px | **12,504px** | 7,745px |
| Desktop homepage height | 8,996px | **7,163px** | 7,774px |
| Mobile LCP | 1,036ms | **712ms** | 884ms |
| Mobile CLS | 0 | **0** | 0 |

**−3,252px on mobile**, slightly more than predicted because the hero changes
in docs/49 landed in the same release. Desktop is now **shorter than theirs**;
mobile is still 1.6× theirs, so there is more to do below the fold.

LCP figures are from a clean run with **no programmatic scrolling**. An
earlier pass reported 18,040ms for the mobile homepage; that was an artifact
of the probe scrolling the full page, not a real regression. Scrolling a page
during measurement invalidates LCP — do not trust a number collected that way.

---

## 4. Follow-up, deliberately not done here

`getHomepageData` still computes `totalRaised`, `totalDonors`,
`campaignsCompleted` and `peopleSupported`, including a
`COUNT(DISTINCT donor_email)`, and **nothing consumes them** now that
`ImpactCounter` is gone. It sits inside `unstable_cache`, so the cost is once
per revalidate rather than per request, which is why it was left alone rather
than changed late in a session that cannot run the integration suite. It
should be removed.

Also still open from docs/49 §3.1: the hero photograph.
