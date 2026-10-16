# 55 — The campaign listing: compact cards on phones

Decided 2026-10-16. Section 4 of the landing-page pass, after `docs/48`
(navbar), `docs/49` and `docs/53` (hero). Covers the campaign grid on the
homepage and, because it is the same component, `/campaigns`.

**Method.** GoFundMe's homepage "Discover fundraisers inspired by what you
care about" row and our "Browse Reviewed Campaigns" section measured at
390×844 and 1440×900, cards enumerated with geometry. GoFundMe figures
**VERIFIED, retrieved 2026-10-16**.

---

## 1. The measurement that decided it

| | GoFundMe mobile | LastDonor mobile (before) |
|---|---|---|
| Card dimensions | **358 × 128** | 358 × ~400 |
| Card orientation | **horizontal** | vertical |
| Campaigns surfaced | **10** | 6 |
| Section height | **869px** | ~2,400px |
| **Vertical px per campaign** | **87** | **~400** |
| Section heading | 24px | 30px |

They surface **ten** campaigns in a third of the height we spent on **six**.
On the device most of this product's traffic uses, that is the difference
between a browsable list and a scroll.

Their desktop card goes the other way — **552 × 578**, two per row, larger
than our 349 × 401 three-up. So the strategy is explicitly responsive:
immersive on desktop, scannable on mobile. We had one card doing both jobs,
tuned for desktop.

### Their compact card, element by element

Square thumbnail left; text right carrying proximity ("27 miles away"),
title at two lines, a progress bar, and **one** number (`$3,485 raised`) —
no goal, consistent with the card philosophy recorded in `docs/51` §1.1.

---

## 2. What was changed

`CampaignCard` is now **horizontal below `sm` and vertical from `sm` up**:
`flex-row sm:flex-col`, with the image `aspect-square w-28` on mobile and
`aspect-[16/10] w-full` above it.

Measured after: mobile card **149–161px** against ~400px before; desktop
**419px**, unchanged.

### Done as one element, not two cards

The obvious implementation is a compact card and a full card toggled with
`hidden`/`sm:block`. That was rejected: **a hidden card is still in the DOM
and its image is still fetched.** That exact mistake cost 18KB per phone
load in the hero (`docs/53` §2) and across a twelve-card grid it would cost
far more. One element changing direction fetches one image.

`sizes` was corrected with it: `(max-width: 639px) 112px, …`. The thumbnail
is 112px wide, so the previous `100vw` was downloading several times the
pixels it could display.

### Supporting changes

- **Category chip hidden on the compact card.** In ~218px of text column it
  pushed the location onto its own line. GoFundMe's compact card shows
  proximity only, no category. It returns at `sm`.
- **The unfunded line stacks on mobile.** "Be the first to donate" plus
  "$47,000 goal" need ~235px side by side and the column is ~218px, so they
  wrapped raggedly. Side by side again from `sm`.
- **Section heading 30px → 24px on mobile**, matching theirs. At 30px it ran
  to three lines above a list of compact cards. Its sub-paragraph lost its
  second sentence, which repeated the review claim yet again (`docs/51`
  counted four, `docs/53` a fifth).
- **Grid gap 24px → 12px on mobile**, since the cards are now a list.

---

## 3. A bug this surfaced

`docs/51` hid "for \<name\>" when the title already names the subject,
matching on the **full** name. That missed
*"Sgt. Vega Comes Home to Find His Killeen House Destroyed by Mold"* for a
subject recorded as `Sgt. Ramon Vega` — the card still said "for Sgt. Ramon
Vega" directly under a title containing "Sgt. Vega".

Now the **surname** is checked too, which is the token a reader recognises
as the same person. Verified against the three-card preview: only the card
whose title genuinely omits the name still carries the line.

---

## 4. Checked and found not to be a problem

A card on the live mobile homepage rendered as a flat purple-blue block,
which looked like a broken image falling back to a placeholder. It is not:
all 12 campaigns have a `hero_image_url`, and both suspect URLs return
**HTTP 200**. The block is the photograph itself. **An art-direction
question, not a bug** — but worth noting that at 112px square, an abstract
or low-contrast photo reads as a loading state. Campaign imagery should be
legible as a thumbnail, not only at full width.

---

## 5. Not done

- **Proximity ("27 miles away").** Their strongest relevance signal on this
  card, and we show city/state instead. Real proximity needs geolocation or
  IP inference, which is a privacy decision and a separate piece of work.
- **A progress bar on unfunded cards** stays suppressed, per `docs/51` §1.1.
  Their compact cards show one because their campaigns have money; ours
  would show twelve empty tracks.
- **Desktop card size.** Theirs is 552×578 two-up against our 349×401
  three-up. Whether fewer, larger cards converts better is a real question
  and an A/B test, not something to change on one competitor observation.
