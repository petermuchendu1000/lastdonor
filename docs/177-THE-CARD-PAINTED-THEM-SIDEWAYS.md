# 177 — The share card painted them sideways, and shouted the weakest fact

**Status:** BUILT, committed on `claude/adoring-bell-7aka3l`. ⛔ NOT DEPLOYED
(standing owner instruction, 2026-10-22).
**Date:** 2026-11-06
**Supersedes nothing. Amends `docs/112` §7 and §8.**

---

## 1. What was reported

The owner opened the share card for
`help-maksym-a-ukrainian-war-veteran-and-widowed-father-overcome-a-financial-crisis`
and the photograph of a father and his son was **lying on its side**. In the
same look: `$5 raised` was the largest line of text on the card — larger than
the appeal it belonged to.

Two unrelated defects in one image. Both are fixed here. Owner's instruction,
verbatim: *"fix the EXIF rotation, keep the amount but shrink it."*

---

## 2. Defect A — the renderer read no EXIF, and the page did

### 2.1 The mechanism

A phone photographs in one orientation and stores the pixels in another,
recording the difference as an EXIF `Orientation` tag. **Honouring that tag is
the VIEWER's job**, and this product has two viewers that disagreed.

[VERIFIED 2026-11-06 by fetching the live object and reading its metadata with
sharp 0.34.5]

| | pixels | EXIF orientation |
|---|---|---|
| the stored object (`campaign-photos/223c59ad-…jpg`) | **3264x2448** (landscape) | **8** |
| what `/_next/image` serves the campaign page | 2448x3264 (portrait) | **absent** |
| what the share card drew | the stored object, as it lies | — |

So `/_next/image` **bakes the rotation in and strips the tag**, and Satori —
which `@vercel/og` renders with — fetches whatever URL is in `<img src>` and
paints the bytes. It reads no EXIF at all. The campaign page was never wrong.
Only the card.

### 2.2 Three independent verifications

1. **Metadata.** The table above: stored orientation 8, optimiser output
   portrait with no tag. Two different readings of one object.
2. **The live artefact.** `GET /api/v1/og/campaign/<slug>?v=2` from production
   answered `200 image/jpeg 83,142 bytes`, and the left panel of that JPEG is
   the two faces rotated a quarter turn. Saved as the "before".
3. **Execution of the fix against the real photograph.** `heroPixels` run on
   the live object returns 456x630 with the father and son **upright**, and
   the control — the same bytes cropped to the same box with no `.rotate()` —
   returns the sideways crop. Two pictures from one input.

### 2.3 The falsifier, which failed to falsify

*"Maybe the page is sideways too, and the photograph is simply stored wrong."*
Refuted by the second row of the table: the optimiser's output is portrait
with the tag already applied, and the live campaign page shows them upright.
The asymmetry between the two surfaces **is** the defect.

### 2.4 The fix

`src/lib/og-hero-image.ts`. The route no longer hands the renderer a URL; it
hands it **pixels**:

```ts
const jpeg = await sharp(bytes)
  .rotate()                                       // apply EXIF, strip the tag
  .resize(HERO_WIDTH, CARD_HEIGHT, { fit: 'cover' })
  .jpeg({ quality: HERO_JPEG_QUALITY })
  .toBuffer();
return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
```

⚠️ **`.rotate()` with NO ARGUMENT is the whole mechanism.** It applies the
EXIF orientation and strips the tag. ⛔ `.rotate(90)` is a different function:
it turns *every* image a quarter turn whether or not it needs it. Most
photographs carry no tag, so that mistake would break the common case to fix
the rare one. There is a test whose only job is to tell those two apart.

### 2.5 ⛔ Why the fix is here and not at the upload

Normalising on upload is the deeper fix and it does **not** close this:

- it cannot reach the photographs already stored, and this defect is about one
  of them;
- re-encoding somebody's original on the way in is a **write-path change on a
  live system for a rendering bug**.

Handing the renderer pixels that need no EXIF fixes every photograph, old and
new, and touches nothing anyone has stored.

**The upload question is recorded here as an open decision, not silently
made.** If it is ever taken: `/api/v1/upload` would gain a `.rotate()` on the
way into Supabase, which makes the stored object agree with both viewers and
lets this module become a pure resize. It is an owner call because it rewrites
files people uploaded, and because `docs/172` has just made the same objects
first-party at `/media/<key>` — two changes to the same path in one week is
one too many.

### 2.6 A second thing it buys, measured

Satori used to fetch the **full-resolution original** and decode all of it to
fill a 456x630 box. [MEASURED on this photograph] **1,685KB in, 44KB out** —
a 38x reduction in what the renderer has to pull and decode, on a route that
runs on every scrape of every campaign.

### 2.7 ⚠️ Every failure still answers `null`

Which renders the designed fallback panel. That is the direction
`resolveHeroSrc`, `probeHeroSrc` and `resolveCampaignHero` (`docs/170`) all
already fail in, and it is the whole point of `docs/112` §7: a campaign losing
its photograph is a small loss; a card that throws mid-stream is an HTTP 502
and means **no card at all**. sharp throws on anything it cannot decode, so
this is also a second, independent refusal of the webp and svg that
`probeHeroSrc` already rejects by content type.

---

## 3. Defect B — the money out-sized the title

### 3.1 The mechanism

`fitTitle` steps the **title** down through `TITLE_SIZES` =
`[60, 54, 48, 42, 36, 32, 28, 26, 24]` until it fits its box. The money line
was the fixed constant `OG_TYPE.headline = 52`. Nothing compared them. So the
longer the appeal, the more the amount raised out-shouted it.

### 3.2 Three verifications

1. **Computed against the real fit.** Running `fitTitle` with the real font
   over the **ten live campaign titles, fetched from production**:

   | campaign | title fits at | money was | inverted |
   |---|---|---|---|
   | `david-nwosu` | 48px | 52px | ⛔ |
   | `marcus-delgado` | 48px | 52px | ⛔ |
   | `help-maksym-…` | **42px** | 52px | ⛔ worst |
   | the other seven | 54–60px | 52px | ok |

   **3 of 10.**

2. **Measured in the production JPEG.** Ink-band heights down the right panel
   of the live card: the money band is **45px** tall against **39 / 31 / 30**
   for the three title lines. The same card rendered through this change
   measures **36px** against the same 39/31/30.

3. **Looked at.** The before and after renders are unambiguous: `$5 raised`
   dominates the first and recedes in the second.

### 3.3 ⚠️ A CORRECTION TO MY OWN WORKING, and it is the lesson of §3

An intermediate run of that table reported **1 of 10**, and I nearly wrote
that number down as a correction to the figure above.

It was wrong because **I had typed the ten titles out of the ten slugs**
rather than reading them. The slugs are short (`david-nwosu`,
`marcus-delgado`), so my invented titles were short too, so they all fitted at
60px, so only Maksym — whose slug happens to carry its whole title — inverted.

A fabricated input produces a confident, precise, wrong number, and it is
indistinguishable from a real one in the output. The real titles came from each
campaign's own `og:title`, and the original figure stood. **This is Gate 1's
two-call rule: fetching a fact and using it may not happen in one step, and
"I can reconstruct it from the slug" is not fetching it.**

### 3.4 The fix, and why a constant cannot be it

```ts
export function moneyLineSize(renderedTitlePx: number): number {
  return Math.min(OG_TYPE.headline, renderedTitlePx);
}
```

⛔ **THE INVARIANT: the money is never larger than the title beside it.**

A constant alone cannot hold that, and this is not a style preference.
`TITLE_SIZES` floors at **24**, so for *any* fixed money size there is a title
long enough to be drawn smaller than it — which is this exact defect, just
further down the ladder. Lowering 52 to 42 fixes today's ten campaigns and
rearms itself on the eleventh. The only way to guarantee it is to derive the
money size **from the title as rendered**.

### 3.5 Two decisions inside that one line

**The ceiling moved from 52 to 42, and 42 is DERIVED.** It is
`cardPx(MIN_EFFECTIVE_PX, WORST_DOWNSCALE)` = `ceil(10 × 4.138)` — the
smallest size that still reads in the narrowest rendering this product has
measured (iMessage, 290px of a 1200px card). The owner's instruction *"keep
the amount, shrink it"* is encoded as that derivation, not as the number, so
changing a downscale or the legibility floor moves it.

**`headline` left `PRIMARY_KEYS`.** It was one of the two things held to
`PRIMARY_EFFECTIVE_PX` (12) at the worst downscale, which is a floor of 50 —
so leaving it listed would have made the owner's decision fail this file's own
rule. ⚠️ That is the rule **working**, not an obstacle: demoting the money line
from "a stranger must be able to read this in a message bubble" to "this must
remain legible, and must not compete" is the decision, and it is now written
down where the next person will read it. `og-card-metrics.test.ts`'s
anti-vacuity control requires every key of `OG_TYPE` to fall under exactly one
tier, so a key cannot be moved between them without somebody stating which
budget it is held to.

### 3.6 ⚠️ An accepted consequence, stated rather than hidden

A title at the very bottom of the ladder drags the money line below the
feed-legibility floor with it. That is the right trade: `TITLE_SIZES` already
records that a title which reaches the floor is unreadable on every platform
anyway, and a money figure out-shouting an unreadable title would be worse,
not better.

---

## 4. Blast radius

- **One route**, `/api/v1/og/campaign/[slug]`. Nothing else renders this card.
- **`CARD_VERSION` 2 → 3**, which changes the `og:image` URL so platforms
  fetch fresh bytes on their next scrape. ⚠️ It does **not** force that scrape
  (`docs/112` §9.2): Facebook and WhatsApp keep serving their cached card
  until they re-scrape the page. So the backlog of already-cached sideways
  cards is **not** healed by this change, and nothing here claims it is.
- **`HERO_WIDTH` is now shared** between the route (which draws the box) and
  `og-hero-image.ts` (which fills it). If they disagreed the photograph would
  be scaled twice.
- **No database, no money, no schema, no public copy.** Gate 8 does not apply.
- **Rollback** is the commit.

---

## 5. ⚠️ Four things the tests could not do, and what replaced them

This section is the reusable part.

1. **Dimensions cannot see the rotation.** `heroPixels` resizes to a fixed
   456x630 box, so the output is 456x630 whether or not `.rotate()` ran. A
   test on width and height passes with the fix deleted.
2. **Nor can the EXIF tag.** [MEASURED] re-encoding through `.jpeg()` drops
   all metadata by default, so the orientation tag is absent either way. Its
   absence is a real property worth pinning — a second renderer must not
   rotate again — but it is **not** evidence the first rotation happened.
3. So the fixture is a landscape image split **left red / right blue** with
   EXIF orientation 8. [MEASURED] orientation 8 sends the left edge to the
   **bottom**, so rotation applied gives a *horizontal* split (blue top, red
   bottom) and rotation skipped gives a *vertical* one (red left, blue right).
   Two different pictures from one input — which is what the defect was.
4. **A text rule cannot see which way a branch points.** The invariant in §3
   is therefore executed across the whole `TITLE_SIZES` ladder, not asserted
   about the source.

### 5.1 ⛔ A HOLE IN MY OWN TEST, found by mutation row R9

`heroPixels` refuses a non-200 response. My first test for it served an
**empty body** with `ok: false` — and deleting `if (!res.ok) return null;`
left that test **GREEN**, because sharp cannot decode an empty buffer either,
so the catch answered `null` and the test passed for the wrong reason.

The test now serves a **valid JPEG with a non-200 status** — a CDN handing
back a placeholder image with its 403, which is the realistic case and the
only one where `res.ok` is the thing doing the work. It then fires.

*A refusal test whose fixture would be refused anyway tests nothing.*

### 5.2 ⚠️ And one mutation row was VOID, not a hole

R7 (`.rotate()` → `.rotate(90)`) first reported `ANCHOR_COUNT=2`: the module's
own header comment explains the difference between those two calls, so it
quotes both. The harness refuses to score a row whose file sha did not change
(`docs/152` §6, `docs/173`), so it read as VOID rather than as a rule with a
hole. Re-anchored on the indented code line, it fires.

### 5.3 Mutation results — **13 of 13 rows behaved**

| # | mutation | expected | result |
|---|---|---|---|
| R1 | route reads `OG_TYPE.headline` again (**production state**) | FIRE | 1 failed |
| R2 | the `Math.min` clamp removed | FIRE | 6 failed |
| R3 | the 52 ceiling restored (**production state**) | FIRE | 1 failed |
| R4 | `headline` is primary again (**production state**) | FIRE | 2 failed |
| R5 | `src={heroSrc}` restored (**production state**) | FIRE | 1 failed |
| R6 | `.rotate()` deleted (**production state**) | FIRE | 2 failed |
| R7 | `.rotate()` → `.rotate(90)` | FIRE | 2 failed |
| R8 | panel no longer filled exactly | FIRE | 1 failed |
| R9 | non-200 treated as a photograph | FIRE | 1 failed *(after §5.1)* |
| R10 | a decode failure answers the URL instead of `null` | FIRE | 3 failed |
| R11 | comment-only edit | **PASS** | green |
| R12 | JPEG quality retuned 92 → 84 | **PASS** | green |
| R13 | fetch deadline shortened 4s → 3s | **PASS** | green |

Rows R1 and R3–R6 are the real production state, layer by layer: every one of
them fires. R11–R13 are the control that the rules check the *property* and do
not pin an implementation detail.

A clean restore was verified by sha256 after every row.

---

## 6. Results

- `npm run lint` — clean (one pre-existing warning in
  `review-gate.test.ts`, untouched here).
- `npm run typecheck` — clean.
- `npm run test:unit` — **8517 passed, 16 skipped; 310 files passed, 3
  skipped**. Up 27 tests and one file from the 8490/309 before this change.
- The card rendered through the **real route** against the **real
  photograph**: upright, `$5 raised` at 36px under a 39px title line.

---

## 7. ⛔ What was NOT checked

- **No deployment.** The standing instruction is not to deploy. Everything in
  §2 and §3 was executed locally against production *data*; the deployed card
  still carries both defects, and `?v=2` is still what production serves.
- **The other nine campaigns' photographs were not re-rendered.** Only
  `help-maksym-…` was put through the route end to end. The fit table covers
  all ten for the type sizes; the EXIF path was exercised on one real object
  and on synthetic fixtures.
- **No platform was asked to re-scrape.** How WhatsApp, Facebook, X, Slack,
  Signal, Telegram, LinkedIn and iMessage each behave on the new URL is
  unmeasured, and `docs/112` §9.2 says a version bump does not force a
  re-scrape.
- **The fallback panel path was not re-rendered.** It is unchanged apart from
  reading `HERO_WIDTH`/`CARD_HEIGHT` instead of two literals of the same
  value, and a test pins that no `'456px'` literal remains.
- **How many stored photographs carry an orientation tag is unknown.** One was
  measured. Whether this fix changes anything for the other nine is
  [UNKNOWN] — it is a no-op for an image with no tag, which is the common
  case, and that no-op is itself tested.
- **The share-card design discussion the owner opened is NOT answered here.**
  Whether to design one card that survives every platform's crop, or
  per-platform variants, and whether 9:16 story images are in scope, remain
  open questions from that conversation.
