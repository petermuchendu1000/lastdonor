# 176 — A hash cannot promise three different pictures

**✅ DEPLOYED v179 2026-11-06 — see §11 for the verification record, including
the 3→2 collision now OBSERVED on the live grid rather than computed.**

**2026-11-06.** Owner: *"what we currently have makes the site look
newbie-like … can we use stock images? Can we edit the stock images?"*

Yes to both, and the answer has a line through it that `docs/170` drew and
this change does not cross: **a stock photograph may be the TEXTURE on a
brand plate; it may never be the PICTURE OF A NAMED PERSON.**

---

## 1. What was actually on the page

[VERIFIED 2026-11-06 by classifying every rendered `<img>` on the live
`/campaigns`, unwrapping each `/_next/image?url=` target]

| | cards |
|---|---|
| organiser's own photograph | 2 |
| designed brand panel | 8 |
| third-party photograph | **0** |

So `docs/170` held: nobody's face stands under another person's name. What
replaced it was **eight near-identical teal rectangles, three of them
byte-identical** — `medical-panel.webp` three times, because three live
campaigns are `medical`.

⚠️ **The owner's complaint was about the FIX, not the original defect.** A
flat rectangle at the 112px phone thumbnail reads as a failed image load,
because nothing in it is an image.

---

## 2. What the licences actually permit

Read 2026-11-06, quoted rather than summarised, because the earlier
removal of stock photography was partly a licence question and partly a
trust question and the two were not separated.

- **Unsplash**: grants *"download, copy, modify, distribute, perform, and
  use"*. Attribution appreciated, **not required**.
- **Pexels**: *"Be creative and edit them as you like"*. Attribution not
  required. And then the two lines that matter more than permission:
  *"Identifiable people may not appear in a bad light or in a way that is
  offensive"*, and *"Don't imply endorsement of your product by people or
  brands on the imagery."*

⛔ **So the portraits `docs/170` removed were never licensed for that use
either.** A stranger's face captioned with a real named person's medical
crisis is both the trust defect `docs/170` found and a licence breach. The
two reasons agree, which is why the line below is absolute rather than a
preference.

---

## 3. The decision

A campaign with no photograph from its own organiser gets a **treated
plate**: a people-free landscape photograph, printed in one of four brand
duotones, with the category word centred over it and
`lastdonor.org · illustrative photo` at the foot.

### 3.1 ⛔ The one line these may not cross

**No identifiable person.** Every image in `MOOD_POOL` was inspected at
420px and again zoomed. Three candidates were REJECTED for exactly this —
two had people in boats and on a rock that the contact sheet was too small
to show. ⚠️ **The contact sheet is not the check**; the zoom is.

### 3.2 ⚠️ And no signage

A hospital reception shot was rejected because its Spanish wayfinding
(*"PISO 1"*, *"BANCO DE SANGRE"*) stayed legible through the duotone. A
literal photograph carries specifics that can contradict the appeal sitting
above it.

### 3.3 ⚠️ The pool is SHARED, not per-category

A field at dawn is honest under Medical, Memorial or Education alike. A
picture that tries to *depict* the category is what drags in the signage
and the specifics — an operating theatre under Medical is a claim about a
campaign nobody has read. **The category is carried by the WORD, not the
photograph.**

---

## 4. ⛔ THE FINDING: the fix is partial, and measurably so

Variants are picked by `plateVariant` — FNV-1a over the campaign TITLE,
mod `PLATE_VARIANTS` (3). The title is the key at every call site, so one
campaign keeps one plate across its card, its detail page, two dashboard
lists and the sitemap.

**Computed against the eight real live panel cards:**

| category | cards | distinct plates |
|---|---|---|
| medical | **3** | **2** |
| every other | 1 | 1 |

*Help Danielle Sutton…* and *Help Marcus Delgado…* both hash to variant 1.

⚠️ **This is not a bug and it cannot be fixed by a better hash.** Three
items into three buckets collide with probability **78%**; the hash quality
is irrelevant. Raising `PLATE_VARIANTS` lowers the odds and never reaches
zero (5 variants → 52%, 13 → 22%).

⛔ **The only way to GUARANTEE distinctness is to stop choosing per
campaign** — either de-duplicating per page, which breaks the stability
that keeps one campaign's picture the same on every surface, or storing a
chosen variant on the row, which is a migration on a live money database
for a cosmetic property (Gate 8, and out of proportion).

So the honest statement is: **variants reduce repetition; they do not
eliminate it.** Three identical rectangles became two photographs and one
repeat among ten cards, which is what a normal site looks like.

### 4.1 Why `PLATE_VARIANTS` stays at 3

23 categories × 3 = 69 files, 2.1MB (the flat panels were 288KB). Five
would be 3.6MB to move the collision odds from 78% to 52% — not a number
worth defending.

⛔ **The trigger for raising it is a different case entirely**: the category
page serves 12 cards, so 12 medical campaigns would show at most 3 distinct
pictures. That state does not exist today (3 do). Raising it then is one
constant and a regenerate, *because the count lives in app code and the
generator imports it* — which is the whole reason for §6.

---

## 5. ⚠️ Three things measured that changed the design

### 5.1 `object-cover` CROPS — testing by resizing is the wrong test

`CampaignCard.tsx:91` is `aspect-square w-28 … sm:aspect-[16/10] sm:w-full`.
From a 1200×675 source that keeps **56% of the width** on a phone and **90%**
on desktop. The first generation of these panels was left-aligned like the
OG card, and at 112px the words read *"dical"*, *"erans"*, *"ntial Needs"*.

So everything that must survive lives inside `SAFE_WIDTH = 620` (51.7%), the
label is **measured against the real font** and the run **throws** if it
would not fit. The footer is measured too — a disclosure whose ends are
cropped off is a disclosure that no longer says what it meant.

### 5.2 ⚠️ `.normalise()` is the obvious fix and is a NO-OP here

Two plates look flat. Stretching each photograph's histogram is the
textbook answer, and it does nothing: [MEASURED on four sources] all
already span grey 0..255, normalising leaves the standard deviation
unchanged to one decimal and moves the mean pixel by **1.6/255**.

⚠️ I wrote a comment claiming it rescued a near-invisible backdrop and the
measurement refuted it. The flatness is **the scrim**, which is the
legibility guarantee, not the photograph. The line is deliberately absent
with that reasoning recorded next to it, so the next person does not spend
the same hour.

### 5.3 The two tools split on what each is the only option for

`sharp` applies the duotone; Chromium sets the type. A CSS
`mix-blend-mode` duotone depends on headless Chromium reproducing a blend
mode exactly, whereas `out = dark + (light − dark) × grey/255` is
arithmetic that can be read and checked. Chromium is there for the one
thing nothing else does — laying out real DM Serif Display outlines
(`docs/95`).

⚠️ `toColourspace('b-w')` is load-bearing: `greyscale()` alone leaves THREE
equal channels, so a one-byte-per-pixel read walks three times as fast as
the image and produces stripes. The channel count is asserted, not assumed.

---

## 6. The drift hazard, closed in the direction that fails loudly

If the generator wrote N plates and the resolver picked from a different N,
the resolver would name a file that was never written — a broken image on
the busiest public surface.

`PLATE_VARIANTS` is exported from `src/lib/campaign-hero.ts` and
**imported by the generator**. The category list is already derived from
`CATEGORY_CONTENT`. So neither a 24th category nor a 4th variant can be
half-introduced: whichever is added first fails the on-disk test.

---

## 7. ⚠️ Gate 4 found my own guard asserting the wrong property

The generator refuses a pool that would repeat a photograph within one
category. I wrote the error as *"widen MOOD_POOL so it is coprime with
PLATE_VARIANTS"* and ran the injection — **and nothing fired**.

Because the message named the wrong mechanism. With a pool of 3 and 3
variants, consecutive indices mod 3 are `0,1,2` for **every** category:
three distinct photographs each, and the **same three site-wide**. Those
are two different failures, at two different pool sizes:

| property | fails when | fix |
|---|---|---|
| distinct WITHIN a category | pool < variants | a bigger pool |
| not the same set ACROSS categories | stride divides pool | a **coprime** pool |

Both are now asserted separately, and each was proven by shrinking the pool
to the size that breaks it:

```
pool=3  Error: every category draws the same 3 photographs - MOOD_POOL (3)
        shares a factor with PLATE_VARIANTS (3); pick a pool size coprime
pool=2  Error: medical: 2 distinct photo(s) across 3 variants - MOOD_POOL
        has 2, which must be at least PLATE_VARIANTS (3)
```

⚠️ **An assertion that happens to hold can still state a false reason**, and
a reader will act on the reason. The arithmetic was right and the sentence
beside it was wrong.

---

## 8. Mutations

8 rows against `campaign-hero.test.ts`, all behaving, sha256-verified clean
restore after each, and the harness refuses to score a row whose file sha
did not change (`docs/152` §5.2, `docs/173`).

| # | mutation | expect | result |
|---|---|---|---|
| 1 | **the real production state** — one flat panel per category | FAIL | 4 failed |
| 2 | `plateVariant` always returns 1 (the vacuity attack) | FAIL | 3 failed |
| 3 | `plateVariant` is random | FAIL | 5 failed |
| 4 | FNV prime changed | FAIL | 1 failed |
| 5 | variant is 0-based → names `-panel-0.webp` | FAIL | 4 failed |
| 6 | variant is 1..N+1 → names `-panel-4.webp` | FAIL | 5 failed |
| 7 | one plate file deleted, code untouched | FAIL | 2 failed |
| 8 | **comment-only edit** | PASS | 21 passed |

⛔ **Row 2 is the one that justifies the anti-vacuity test.** Without it, a
constant variant satisfies stability, the on-disk sweep and the shape
regex — every other assertion in the file.

⚠️ **The anti-vacuity row uses the REAL live titles**, not strings chosen
to spread across the buckets. A fixture picked to make it pass would be the
row testing itself.

⚠️ **The hash is PINNED by hand-recorded outputs.** Changing it is not a
refactor: every campaign's picture moves at once, so somebody has to decide
that the reshuffle is intended.

---

## 9. ⚠️ A dependent I failed to enumerate

`CampaignHeroImage.test.tsx` pins the panel path per category — **27 tests**
went red on the full run after the targeted ones passed. The property it
guards (each category renders its OWN panel) is unchanged; only the
filename shape moved, so it is REPOINTED, not deleted (`docs/109`,
`docs/172`).

Repointing it exposed a gap it had: every row used one title, so a
component that dropped the variant key — or passed a constant — would have
passed all 27. A new row drives four real titles through `medical` and
requires more than one distinct plate.

---

## 10. What was NOT checked

- **No browser.** Postgres is not running in this sandbox and the
  production host does not resolve from it (`docs/116` §8), so there is no
  way to render the real listing. What was done instead: the plates were
  composited at the **exact crops read from `CampaignCard.tsx:91`**, and the
  live grid was reproduced from the real `/campaigns` HTML with each card's
  computed plate. That answers the layout question; it does not exercise
  `next/image`, whose handling of these files is unchanged from the panels
  they replace.
- ~~**Not deployed.** Standing owner instruction (2026-10-22).~~ **Deployed as
  v179 on the owner's instruction — see §11.**
- **The detail-page hero and the dashboard thumbnails** were not inspected
  at their own sizes; only the two card crops were.
- **No screen reader.** The alt text is unchanged
  (`LastDonor <Category> campaign`) and deliberately does not repeat the
  footer disclosure — it would describe the file rather than the thing in
  it.
- **Whether a reader notices the disclosure.** It is 4px at the 112px
  thumbnail, legible on the detail page, and unmeasured for contrast
  against the brightest possible highlight; the scrim was sized against
  that worst case by calculation, not by sampling a rendered plate.

---

## 11. ✅ Deployed v179, 2026-11-06

Gate run first (`scripts/deploy.sh` runs none — CLAUDE.md): lint clean,
typecheck clean, **8,490 unit tests passing**.

**Rollout is clean, not merely "complete".** The deploy log reads
`Updating machine config for 080776daee2d48` — the **same machine id as the
pre-deploy baseline**, so it was updated in place rather than replaced
(`docs/161` §7.2, `docs/163` §9). Machine table read twice: **one** `app`
machine, version **179**, 1/1 passing, **0** orphaned
`fly_app_release_command` machines. ⚠️ Deployed with `--prerender`, and the
discriminator that proves the builder reached the database is the script's
closing line: `sitemap: 10 campaign URL(s)` (`docs/119`).

### 11.1 The change is live, and the control is a DELETION

| | result |
|---|---|
| rendered `<img>` on `/campaigns` | **10** |
| treated plates | **8** |
| old flat panels | **0** |
| organiser photos (untouched) | **2** |
| third-party photographs | **0** |

All **69** plate files answer **200**. Two controls both **404**:
`fabricated-panel-9.webp`, which never existed, and —
⛔ **the stronger one** — `medical-panel.webp`, the old flat panel. A
deploy that had added the new files without carrying the **removals** would
serve that one 200, so its 404 is what proves the image set was *replaced*
rather than added to.

Three detail pages (`keisha-wallace`, `danielle-sutton`, `marcus-delgado`):
200, treated plate, **0** third-party, `alt` naming the panel and not the
person, and the share card **200 `image/jpeg`** — no `docs/112` §7 502 from
`ImageResponse` meeting a `.webp`.

### 11.2 ⛔ The §4 collision, now OBSERVED

The three `medical` cards on the live grid render **`medical-panel-1`,
`medical-panel-1`, `medical-panel-3`** — two distinct plates across three
cards, exactly as §4 computed before the deploy. This is recorded as a
measurement rather than left as a prediction: the limitation is real on the
running site, and it is the expected behaviour of three items in three
buckets, not a regression to chase.

✅ **And the cross-surface stability held on live data**, which §4 asserts
and only production could show: `danielle-sutton` renders
`medical-panel-1` on its card **and** `medical-panel-1` on its detail page.

⚠️ One self-inflicted probe failure: I **guessed** the detail-page slug from
the campaign title and got a 404 on the page and on its share card — which
reads exactly like the deploy having broken both. The slugs are short
(`keisha-wallace`), and reading them out of the listing HTML rather than
inventing them gave 200 on every one. A fabricated URL and a broken feature
return the same status code.
