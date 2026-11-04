# 171 — Brand explainers, and an image sitemap

**Date:** 2026-11-04
**Status:** ✅ DEPLOYED as v175, 2026-11-04 — owner overrode the standing
do-not-deploy instruction. Verified live: see §10.
**Owner decision:** approved from a single design, 2026-11-04

---

## 1. What this is

Eight square explainer graphics **about LastDonor** — how giving works, how a
campaign is reviewed, what the fee is — plus the placement and sitemap
plumbing that makes them findable.

This is the sibling of `docs/170`, which replaced the per-campaign imagery.
That one answered *"what picture stands in for this appeal"*; this one answers
*"what does a search for the brand show"*.

| Slug | Page | Layout |
|---|---|---|
| `how-giving-works` | `/how-it-works` | steps |
| `what-the-id-check-covers` | `/how-it-works` | steps |
| `questions-donors-ask` | `/how-it-works` | points |
| `start-a-campaign` | `/share-your-story` | steps |
| `every-campaign-is-reviewed` | `/about` | points |
| `find-a-campaign` | `/about` | points |
| `where-your-money-goes` | `/transparency` | ledger |
| `giving-from-anywhere` | `/donate` | pair |

---

## 2. ⛔ An image on no page is never indexed

This is the constraint everything else follows from, and it is the one
`docs/170` §0 established while correcting a wrong premise: Google Images
indexes images it finds **on pages it has crawled**. A `.webp` sitting in
`public/` reaches nobody, however good it looks.

So the registry's `page` field is not decoration, and three rules enforce it:

- every entry names a route that **exists on disk**,
- that route **actually renders** `<BrandGraphicsFor page="…">` for itself,
- and that route is **in the sitemap**, or Google is never told the images
  belong to it.

⚠️ `<BrandGraphic>` is a **server component**, deliberately. The whole point
is that a crawler reading server-rendered HTML finds the `<img>` and its alt
text — which is exactly the lesson `docs/170` paid for, where a decision made
in a browser-only `onError` path was invisible to Google while looking correct
on screen.

---

## 3. Why a registry rather than eight `<Image>` tags

Three surfaces need the same answer: the component renders it, `sitemap.ts`
advertises it, and the tests check it. Had the alt text lived in JSX while the
sitemap built its own list, the two would disagree the first time either was
edited — the shape `docs/138`, `docs/146` and `docs/165` all record.

`src/lib/brand-graphics.ts` owns slug, alt, caption and page.
`scripts/generate-brand-graphics.ts` owns only what each one **looks like**,
and asserts at run time that its design set matches the published set, because
drift either way is a defect: a design with no entry is on no page, and an
entry with no design renders an empty box.

---

## 4. Why square

1200×1200, where the OG card is 1200×630.

A share card is rendered in a **fixed-ratio slot** by whichever platform shows
it. A Google Images result is a **tile in a grid**, where a square carries
noticeably more pixels at the same width — and unlike an OG card, these are
opened and read. Verified legible at 180/240/320px, the real grid sizes.

---

## 5. Every line is a published claim

CLAUDE.md: *never add a claim the platform cannot substantiate*. These assert
things about a platform holding other people's money, and **an image is harder
to audit than a sentence** — nothing greps a `.webp`. So each graphic carries
a `facts` list recording what makes its copy true, and
`brand-graphics.test.ts` holds the dangerous ones to the code.

### 5.1 Four claims deliberately absent

- **Payment by card.** `create-checkout` answers 503 for every campaign on
  dead Stripe credentials (`docs/161`), so it is false today.
- **Any completed payout** — *"we send the money"*, *"reaches the family"*.
  [VERIFIED `docs/113`, `docs/121`] money has never left this platform: 0
  withdrawals, 0 Connect accounts, and the payout rail is that same dead
  Stripe. The release **gate** is real and is what the graphics state; the
  completed payout is not, so it is never drawn.
- **A percent-plus-fixed rate**, ours or a competitor's. `docs/116` §5 banned
  those and `fee-claims.test.ts` enforces it over `src/` — an image lives
  outside that glob, so the rule is **restated** here rather than left to the
  gap. A comparison graphic was planned and dropped for this reason.
- **Donors receiving impact updates.** `impact_updates` holds 0 rows;
  `docs/142` already had to delete that from `llms.txt`.

### 5.2 ⚠️ Two accuracy errors I wrote and caught by re-reading the code

Both were in the first full render, both read perfectly well, and neither
would have been caught by any rule:

- *"You can give with your phone number alone"* — **false**. `canSubmit`
  demands an email too (`docs/151`), so it is now *"Your phone number and an
  email for the receipt."*
- *"Both ways a campaign can be created go to the same queue"* — **false** and
  stale: `docs/116` §4 found a **third** path. Rephrased to *"However a
  campaign is created…"*, which cannot go stale when a fourth appears.

The transferable point: a claim can be wrong without being dramatic, and the
check is reading the code again, not reading the sentence again.

---

## 6. The image sitemap

`sitemap.ts` now emits `images` on two kinds of entry:

- **Pages with brand graphics**, paired by matching the entry's path against
  the registry — derived, so moving a graphic between pages moves its sitemap
  entry and cannot strand a stale one.
- **Every campaign URL**, which closes the owner's second request.

⛔ A campaign's image is resolved through **`resolveCampaignHero`**, not read
from `hero_image_url`. For most campaigns that column still holds the
third-party photograph the page no longer shows (`docs/170`), so advertising
it would point Google at somebody else's domain for an image our page does not
render. ⚠️ And it costs **no extra query** — `heroImageUrl` was added to the
`select` that already runs, which keeps `docs/87`'s cap of three.

---

## 7. Verification

Six injections, each with a sha256-verified restore (`docs/120` §11.1):

| # | Injection | Result |
|---|---|---|
| 1 | A page stops rendering its graphics | 1 failed ✅ |
| 2 | The copy starts offering card payment | 1 failed ✅ |
| 3 | The sitemap stops advertising them | 1 failed ✅ |
| 4 | A graphic points at a page that does not exist | 4 failed ✅ |
| 5 | A registry entry with no drawn design | 2 failed ✅ |
| 6 | **MUST PASS** — comment-only edit | 16 passed ✅ |

⚠️ **Every forbidden-claim rule is a `not.toMatch`, so an empty haystack
satisfies all of them.** That is how a stripped-comment sweep passes silently
(`docs/163` §5.1), so there is an explicit anti-vacuity control asserting the
drawn copy is visible to the rules at all, and that the comment stripper is
still removing something.

---

## 8. ⚠️ Three self-inflicted defects, recorded because they will recur

1. **A backtick inside a comment inside a template literal** ended the string,
   and the build failed with `Expected ";" but found "max"`. `docs/138`'s
   `*/`-in-a-comment trap, one layer over. The CSS block now carries a warning
   against its own repeat.
2. **The headline orphaned a word.** *"What happens when you give"* broke
   after *"you"*. Fixed by constraining the measure — `max-width` doing
   typography, not layout.
3. **An import landed inside a multi-line import.** My insertion rule took the
   last line starting with `import `, which was a bare `import {`. The rule
   now requires a **complete** single-line statement. Typecheck caught it; a
   looser script would have committed it.

---

## 9. Not done, and not claimed

- ⛔ **This does not get anything indexed.** Zero pages are indexed
  (`docs/169`), and that remains the blocker. These change what Google finds
  *when* it indexes; they do not make it index.
- The graphics were verified as **files** and at tile sizes, and the pages
  typecheck and lint. ✅ **Both gaps closed by §10**: they have now been seen
  rendered in the running app, and the 390px heights are measured.
- No screen reader was run against the alt text.
- Whether Google honours the image sitemap for this domain is **[UNKNOWN]**;
  a sitemap is a hint, not an instruction.

---

## 10. Verified in production (v175, 2026-11-04)

Deployed with `--prerender`; the discriminator is `deploy.sh` closing with
`sitemap: 10 campaign URL(s)`, which is what proves the BUILDER reached the
database (`docs/119`). One `app` machine updated **in place**
(`Updating machine config for 080776daee2d48`, the same id as the pre-deploy
baseline) — not the `No machines in group app, launching a new machine` line
that produces the `docs/163` §9 partial rollout. Machine table read twice
after: 1 machine, v175, 1/1 passing, 0 orphaned release machines, and **one
distinct `page-<hash>.js` over 20 loads**.

### 10.1 The three rules hold on the live site

| Rule | Measured |
|---|---|
| The file exists | 8/8 **200 `image/webp`** (fabricated slug 404 — the control) |
| The page renders it | 3 / 1 / 2 / 1 / 1 figures on the five routes, 0 broken |
| The sitemap advertises it | 8 explainer `<image:loc>`, inside 18 total |

`/privacy` carries 0, which is the control making the five counts evidence.

### 10.2 The 390px measurement `docs/60`/`docs/61` wanted

Measured with `isMobile: false`, because with it true Chromium widens the
layout viewport and **hides** horizontal overflow (`docs/128` §5).

| Route | height @390 | overflow | img width |
|---|---|---|---|
| `/how-it-works` | 6,165px | **0px** | 356 ×3 |
| `/about` | 5,695px | **0px** | 356 ×2 |
| `/transparency` | 4,645px | **0px** | 356 |
| `/donate` | 4,097px | **0px** | 356 |
| `/share-your-story` | 1,854px | **0px** | 340 |

0px on all five, and `<figcaption>` renders as real text beneath each. None of
these is the homepage, so the `docs/60`/`docs/61` budget does not bind; the
figures are recorded so a later change has a baseline to move from.

### 10.3 The sitemap is well-formed, and that was checked rather than assumed

⚠️ Next emits `<image:loc>` **raw, with no XML escaping**
(`resolve-route-data.js:111`), so a single `&` in any image URL invalidates
the whole document and Google rejects every URL in it — a worse outcome than
having no image sitemap. The live XML parses, carries 18 `<image:loc>` with
**0** containing a bare `&`, and the check includes a control proving the
parser rejects a deliberately malformed copy of the same bytes.

⛔ This still does **not** get anything indexed. Zero pages are indexed
(`docs/169`) and that remains the blocker.
