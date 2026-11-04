# 170 — A stranger's face under a real name

**Date:** 2026-11-04
**Status:** ✅ DEPLOYED as v175, 2026-11-04 — owner overrode the standing
do-not-deploy instruction. Verified live: see §10.
**Owner decision:** designed brand panels, taken 2026-11-04

---

## 0. How this started, and the premise that was wrong

The owner reported that ten brand illustrations generated the day before
were *"not professional at all"*, and added the goal they were for: **they
should appear when somebody searches `lastdonor` and clicks the Images tab.**

The illustrations were indeed clipart and are scrapped. But the stated goal
could not have been served by them, for three reasons that have nothing to
do with their quality:

1. **Nothing is indexed.** [VERIFIED from Search Console, `docs/169` §2.3]
   Google knows **60 URLs** and has indexed **zero**. Google Images only
   indexes images on pages it has already indexed.
2. **They were on no page.** They existed in a scratchpad directory. An
   image no page renders is never indexed.
3. **A brand-name image search returns images whose PAGE is about the
   brand.** An abstract icon illustrating "reviewed by a person" on
   `/how-it-works` is not a `lastdonor` image to Google.

⚠️ So the image work worth doing was never illustration. Asking *"what will
Google actually show for this brand"* is what found the real defect, and it
was already live.

---

## 1. The finding

[VERIFIED 2026-11-04 by classifying every `<img>` on the live `/campaigns`
page] of the 10 published campaigns:

| Source | Count |
|---|---|
| Unsplash stock photograph | **7** |
| Generic category SVG | 1 |
| Photograph the organiser supplied | 2 |

**8 of 10 campaign images were a picture of somebody who is not the person
named beside them**, and the alt text carried that person's name. Two opened
at full size:

- `alt="Keisha Wallace Fights to Keep Her Four Kids Off Atlanta Streets"`
  → a **toddler holding a toy camera** in a bright nursery.
- `alt="Help Danielle Sutton Care for Her Twins While Battling Aggressive MS"`
  → a **male doctor, arms folded**, studio portrait.

`docs/151` had already noticed the second one in passing (*"the 'Danielle
Sutton' card shows a male doctor with a stethoscope"*) and `docs/141` §5
raised the general question, recommended nothing, and left it open because
*"the alternative is a trust call with no right answer"*. It stayed open.

⛔ This is not an accident to be tidied away. `CampaignHeroImage` carried a
**curated stock pool as a deliberate Tier 1**, 115 images across 23
categories, documented as *"deterministic per campaign title, emotionally
matched to category"*. The platform chose this.

⚠️ `docs/36` is this project's recorded history of forged attribution about
real named people, and the campaigns involved here are largely
machine-written appeals about real named people (`docs/116` §8,
`docs/148`). A photograph of a stranger presented as a person in crisis is
the same family of claim.

---

## 2. The thing that made the fix non-obvious

⛔ **The stock fallback ran in `onError`, which only ever executes in a
browser.** A crawler reads the server-rendered HTML. So:

- the Tier-1 pool was **invisible to Google entirely**, and
- every stock URL Google would index came **straight out of
  `campaigns.hero_image_url`**, placed there by the news pipeline.

This matters because the obvious fix — change what the error handler falls
back to — would have changed **nothing** about what is indexed, while
looking correct in a browser. The decision had to move into the render path.

That is why `resolveCampaignHero` is a pure function called during render,
and why `CampaignHeroImage.test.tsx` now asserts the **first** render rather
than the error path.

⚠️ **A test was holding the defect in place**, for the third recorded time
in this codebase (`docs/109`, `docs/150`). `CampaignHeroImage.test.tsx`'s
first assertion was *"renders the original image source on initial load"* —
the defect written down as desired behaviour — while the rest of the file
exercised a fallback chain no crawler could see.

---

## 3. The decision

**A campaign with no photograph from its own organiser shows a designed
brand panel, which depicts nobody.**

`src/lib/campaign-hero.ts` is the one decider:

- `isOrganiserPhoto(url)` — true only for an **https** URL on our Supabase
  host whose path is the public `media` bucket.
- `resolveCampaignHero({ heroImageUrl, category, title })` → `{ src, isPanel, alt }`.

### 3.1 The predicate can only fail one way

It asks *"did we receive this file from the organiser"*, answered by where
it is hosted. Anything unrecognised — a new CDN, a malformed URL, an
unresolvable host — reads as **not theirs** and renders the panel.

So the worst case is a real photograph replaced by a panel, never a
stranger's face under a real person's name.

⛔ **Do not invert this into a denylist of stock-photo hosts.** A denylist
fails the other way the moment somebody adds a source nobody listed, which
is precisely how the curated pool grew.

### 3.2 The alt text moves with the image

⚠️ A panel captioned *"Keisha Wallace Fights to Keep Her Four Kids Off
Atlanta Streets"* describes a teal graphic as a photograph of a named person
in crisis — the same inaccuracy one layer down. So a panel is named for what
it is: `LastDonor Medical campaign`. The campaign title remains the adjacent
heading on every surface, so neither a reader nor a crawler loses context.

That is why `resolveCampaignHero` returns the alt alongside the src: they
cannot be decided in two places without drifting.

---

## 4. Why a raster file, and not an SVG or a component

Three constraints, each ruling something out:

1. **It must be an indexable image.** The goal is Google Images, and Google
   indexes images, not DOM. A CSS-drawn panel would look identical on the
   page and be invisible there.
2. **The text must not depend on an installed font.** The panels these
   replace used `font-family="system-ui"` plus an emoji glyph (`⭐`), so they
   rendered in an arbitrary face. `docs/95` had to convert the BIMI wordmark
   to outlines for exactly this reason. Rasterising bakes in the real DM
   Serif Display outlines.
3. **It must not be rendered per request.** `docs/112` §7 recorded
   `ImageResponse` throwing mid-stream and answering **HTTP 502**; a listing
   page draws twelve of these at once, so a route per card is a twelve-fold
   chance of that on the busiest public surface.

`scripts/generate-category-panels.ts` renders each panel in Chromium at
`deviceScaleFactor: 2` and downsamples through `sharp` — supersampling, so
the serif edges stay clean at the 112px thumbnail the dashboard list uses.

The design matches the existing OG card (`api/v1/og/page/route.tsx`) so the
brand reads as one system: `#0F766E` ground, an 8px `#D97706` stripe, the
category in DM Serif Display, a short amber rule, `lastdonor.org`.

⚠️ **The four background tones encode nothing.** A reader cannot decode
"teal-800 means memorial", and no copy claims they can. They exist because a
search-results grid of identical rectangles reads as one repeated image
rather than a set.

### 4.1 ⛔ The composition is CENTRED, and that was found by looking

The first version was left-aligned, matching the OG card, and looked right
at 360px. Rendering it at the sizes it is actually used at showed the
defect: **`CampaignsListClient` draws a 112px SQUARE thumbnail with
`object-cover`**, which keeps the middle and throws the sides away. Every
label lost its start —

> **dical** · **erans** · **Responders** · **ntial Needs** · **mily** · **morial**

The OG card can be left-aligned because it is a fixed 1200×630 that nothing
ever crops; these are cropped, so everything that must survive lives inside
the central square (675px, less a margin → `SAFE_WIDTH = 620`).

⚠️ **The label is sized to fit by MEASUREMENT, not by counting characters** —
`docs/112` §9's rule, because `M` advances 2.8× `i` in DM Serif Display. The
generator measures the rendered width and steps the size down; it **throws**
rather than emitting a panel that would be cropped. Fitted sizes range from
128px down to 85px (`First Responders`), all within 620px.

⚠️ No assertion caught this and none could have: it is a visual property of
a crop, and both the files and the 16:9 rendering were correct. It is the
fourth time in this codebase that looking at the render found what the tests
could not (`docs/139` §7, `docs/160` §3.1, `docs/121` §10.1).

Output: 23 files, **8–12KB each**, against 40–53KB for the stock heroes they
replace.

⛔ The category list is **derived** from `CATEGORY_CONTENT`, so a 24th
category generates a panel without the generator being edited — and
`campaign-hero.test.ts` fails the build if any known category has no panel
**file on disk**, because a path that 404s renders an empty box, which is
worse than the stock photo it replaced.

---

## 5. The share card had the same defect

`og-card-model.ts`'s `resolveHeroSrc` answers a **format** question — can
Satori decode these bytes — and an Unsplash URL passes it happily. So every
shared link showed the same stranger the listing did.

The provenance decision is made in `ogCardModel`, before the format one:

```ts
const ownHero = isOrganiserPhoto(input.heroImageUrl) ? input.heroImageUrl : null;
const heroSrc = resolveHeroSrc(ownHero, input.baseUrl);
```

⛔ **`null`, not the category panel.** A panel is `.webp`, which that
renderer cannot decode, and the OG route already has a designed fallback
built for 1200×630. Handing it the panel would reintroduce the `docs/112` §7
502.

⚠️ **Nothing asserted `heroSrc` at all.** The change passed the existing 19
tests because none of them looked at it — Gate 4 in person. Three tests were
added, and deliberately drive **both** of `ogCardModel`'s return sites (the
raised-nothing card and the funded one), since a test exercising one would
pass against a miss in the other.

---

## 6. Verification

Four injections, each with a sha256-verified restore (`docs/120` §11.1):

| # | Injection | Result |
|---|---|---|
| 1 | `ogCardModel` provenance gate removed (**the live production state**) | 2 failed ✅ |
| 2 | `isOrganiserPhoto` always true (stock passes through everywhere) | 35 failed ✅ |
| 3 | Resolution moved back into `onError` (**invisible to a crawler**) | 28 failed ✅ |
| 4 | **MUST PASS** — comment-only edit | 63 passed ✅ |

Row 3 is the one that matters: it is the shape of a fix that looks right in
a browser and changes nothing about what Google indexes.

Fixtures are **real production values** — the Unsplash URLs read off the
live listing and the real Supabase upload — so the rule is checked against
the rows that were actually wrong.

---

## 7. Deleted

`src/lib/campaign-fallback-pool.ts` (555 lines, 115 stock images) and
`scripts/generate-fallback-pool.ts` (264 lines) are **deleted**, not left
orphaned. Keeping a curated pool of stock photographs of strangers, indexed
by the emotional register of somebody's crisis, is how this comes back.

---

## 8. What this does NOT do

- ⛔ **It does not get anything indexed.** Zero pages are indexed today, and
  that is the actual blocker for the Images tab. `docs/169` established the
  cause: Google crawled four real pages and declined, which is the profile
  of a new domain with no inbound links and thin inventory — not a defect in
  code. These panels change what Google finds *when* it indexes; they do not
  make it index.
- It does not touch the **homepage hero** (`hero-hope.webp`, a stock
  photograph of a father and daughter). That is brand/marketing imagery, not
  a picture captioned with a real person's name, and it is a different
  question.
- It does not alter `campaigns.hero_image_url` for any row. The decision is
  made while rendering, so it covers the 13 queued campaigns and every
  future one without a production write.
- The two organiser-supplied photographs are **untouched**, and a control
  test exists for exactly that: without it, "always show a panel" would
  satisfy every other assertion and delete the only real photographs the
  platform has.

## 9. Not checked

- No screen reader was run against the new alt text.
- The panels were rendered **in a harness** reproducing the two geometries
  they are used at — a 360px 16:9 card and a 112px square `object-cover`
  thumbnail — which is what caught §4.1. ✅ **Resolved by §10**: they have now
  been seen in the running app.
- ✅ The `/campaigns` detail page's `MediaGallery` renders through the same
  component. Not reproduced in the harness; **now verified live in §10.**
- Whether Bing or Google eventually index any of this is **[UNKNOWN]**.

---

## 10. Verified in production (v175, 2026-11-04)

Every `<img>` on four live pages was classified by unwrapping
`/_next/image?url=` and reading the real target.

| Page | `<img>` | organiser | panel | **third-party** |
|---|---|---|---|---|
| `/campaigns` | 10 | 2 | 8 | **0** |
| `/` | 7 | 1 | 5 | **0** |
| `/campaigns/keisha-wallace` | 1 | 0 | 1 | **0** |
| `/campaigns/danielle-sutton` | 3 | 0 | 3 | **0** |

The last two are the reported cases: the toddler with a toy camera and the
male doctor are gone, replaced by *Essential Needs* and *Medical* panels. The
detail page's `MediaGallery` is the 3 on `danielle-sutton`, which closes §9.
Panel alt text reads `LastDonor <Category> campaign` — no named person.

⚠️ **A crude `grep -c unsplash` over the same page reports 7, and that is not
a defect.** `CampaignHeroImage` is a client component taking the raw column
value as `src` and resolving it while rendering, so the third-party URL is
still serialized into the RSC flight payload as a hydration input. It is never
a rendered `src`, never in the sitemap (§10.1) and never in the share card.
**Count the `<img>` elements; a string search over the document cannot tell an
input from an output.**

⚠️ **The two `organiser` photos were suspected and cleared.** One is a
photograph of a car crash, which looked like a news image laundered into our
bucket — which would defeat the predicate, since it infers provenance from
hosting. Refuted two ways: there is **no upload path anywhere in
`src/lib/news/` or the crons**, and both URLs are
`campaign-photos/<uuid>.jpg`, the shape our own uploader produces, on exactly
the two slugs `docs/169` §8.4/§8.6 recorded as the only campaigns with a real
organiser. They are genuine uploads. Whether an organiser's chosen photo
depicts their own event is not something the platform can verify, and is not
what this change is about — the defect was the *platform* substituting a
stranger.

### 10.1 The sitemap advertises no third-party image

[VERIFIED by parsing the live XML] 18 `<image:loc>`, of which **0** point
outside `lastdonor.org` or our Supabase host. 8 panels + 2 organiser photos
across the 10 campaign URLs, plus the 8 explainers of `docs/171`.

⚠️ **Next emits `<image:loc>` RAW, with no XML escaping**
(`resolve-route-data.js:111`), so one `&` in a hero URL would invalidate the
whole document and Google would reject every URL in it. Checked, not assumed:
the live XML parses, 0 locs contain a bare `&`, and the check carries a
control proving the parser rejects a deliberately malformed copy. It is not
reachable from our uploader either — `getPublicUrl(path)` with no options
builds no query string, and a transform would use a `render/image` path that
fails `PUBLIC_MEDIA_PREFIX` and resolve to a panel.

### 10.2 Share cards did not regress

`ogCardModel` returns `null` rather than the panel for a third-party hero, so
Satori renders its designed fallback instead of being handed a `.webp` it
cannot decode (`docs/112` §7's 502). Four live cards: **200 `image/jpeg`**,
46–59KB.
