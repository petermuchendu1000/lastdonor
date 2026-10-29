# 144 — The category grid promotes categories that have campaigns

**Date:** 2026-10-29 · **Closes:** `docs/143` §4 (A-024's remaining 15 orphans)
**Owner instruction:** *"make the grid data-driven and keep the 23 in the sitemap."*

---

## 1. What was wrong

`CategoryShowcase.tsx:21-30` held `TOP_CATEGORIES`, a hand-curated array of
eight, and `:77` is the **only** site in the repo that links
`/campaigns/category/*`. So that array was the entire crawler-visible internal
link graph for **23** URLs.

[VERIFIED from production, two independent queries, 2026-10-29] the live
distribution against that curation:

| | Categories |
|---|---|
| Has campaigns **and** linked | medical (3), emergency (2), memorial (1), disaster (1), veterans (2), community (1) |
| **Has campaigns, NOT linked** | **`military` (3)**, **`essential-needs` (1)** |
| **Linked but EMPTY** | **`family` (0)**, **`education` (0)** |

So `military` — tied with `medical` for the most campaigns on the platform —
was reachable from no link on any page, while two categories with nothing in
them occupied grid slots and sent every visitor who pressed them to a page
reading *"No active campaigns right now."*

[VERIFIED in a browser against production, before any change] the grid
rendered 8 cards — `medical, emergency, memorial, disaster, family, veterans,
education, community` — at **640px desktop / 790px mobile**.

⚠️ This is the shape `docs/119` (sealed-region list), `docs/124` (PII scrub
list) and `docs/116` §4 (two-file gate) each record: **a hand-written list is
only as good as whoever remembered to extend it.** Nothing failed here
either. The curation was correct when it was written and the campaigns moved.

---

## 2. The change

`src/lib/homepage-categories.ts` — pure, no database, no clock:

- `CATEGORY_CARDS: Record<CampaignCategory, {gloss, Icon}>`. ⛔ A `Record`
  over the union, not an array with a lookup, so **`tsc` enumerates all 23**
  and a 24th category fails the build until somebody decides what its card
  looks like. An array would have compiled with a hole in it, which is how
  the curated list came to be missing `military`.
- `selectShowcaseCategories(counts)` — drops zero/negative/unknown rows,
  sorts by live-campaign count descending, ties by label, caps at 8.
- Labels come from `getCategoryContent(slug).label`, never re-typed, so the
  grid and the page it links cannot disagree about a category's name.

`(home)/page.tsx` — one `GROUP BY category` count added to the **second**
batch (2 → 3 queries, still inside `docs/87`'s cap of three; the ratchet was
run and passes).

`CategoryShowcase.tsx` — takes a **required** `categories` prop and renders
`null` when it is empty.

### 2.1 Two things the implementation gets right that are easy to get wrong

⛔ **The homepage caches the TALLY, not the cards.** `getHomepageData` is
wrapped in `unstable_cache`, which **serializes what it returns**, and a
`ShowcaseCategory` carries an icon **component**. Selecting inside the cached
function would put a function through a cache that cannot hold one.
`selectShowcaseCategories` is pure and runs per render instead, which costs
nothing. Caught before it shipped, by reading the call site rather than the
function.

⚠️ **The count requires `published_at IS NOT NULL`; the category page filters
on status alone.** That asymmetry is deliberate and is the safe direction:
this count is a **subset** of what that page would list, so the grid can
under-promote a category but can never put a card in front of a visitor whose
page is then empty. It is also `docs/131`'s predicate — `published_at` is the
record that a person approved publication, and a status allowlist cannot
answer that question.

### 2.2 The height budget is untouched

`MAX_SHOWCASE_CARDS = 8`, and a test pins the number to 8 with `docs/60`'s
reason: that grid was measured at eight cards (**1,944px for 81 words** on a
390px phone at one column, which is why it is two columns from the smallest
screen). [VERIFIED in a browser] the rebuilt grid against production's exact
distribution is **640px desktop / 790px mobile — identical to the live page.**
Only the contents moved.

### 2.3 Icons

23 categories need 23 icons. 19 wraps were added to
`src/components/ui/icon/index.tsx` and `CategoryShowcase` now imports from
the icon layer instead of `@heroicons` directly, so the migration ratchet's
baseline comes **down 80 → 79** in this commit, per its own protocol.

⚠️ **Three marks are approximations and are labelled as such in the source.**
The icon set is stroke-only heroicons (`docs/70`) and contains **no paw, no
ball and no place of worship** — verified by searching all 324 exported
names. The alternative was drawing them, and `docs/70` draws a mark only when
*"the concept is ours"*. The icon is `aria-hidden` and the **label** carries
the meaning, so an approximate mark costs a screen-reader user nothing; a
wrong one would still be wrong. None of the three has a campaign today.

---

## 3. ⛔ What did NOT change: the sitemap still advertises all 23

`sitemap.ts:156` maps `ALL_CATEGORY_SLUGS`, and it is untouched. [VERIFIED by
fetching `/sitemap.xml` from the rebuilt server] **23 category URLs, 56 URLs
total** — including in the fixture where the grid renders nothing at all.

**Promotion and advertisement are separate decisions.** A category page with
no campaigns today is a real page that fills later, `generateStaticParams`
builds all 23, and dropping them would be a different call than the one the
owner made. Rule 7 of the test pins it, because deleting them is the obvious
tidy-up after this change.

---

## 4. ⛔ An empty list renders nothing, deliberately

With no live campaigns the section does not render. This is a real state, not
a hypothetical: `docs/79` moved every automated campaign into the review queue
and `/campaigns` was empty for a day. A heading reading *"Find a Cause You
Care About"* above eight doors onto empty rooms is worse than no section.
[VERIFIED in a browser] with nothing live the section is absent and the
homepage still answers **200**.

---

## 5. Verification

### 5.1 Three browser measurements, each able to give a different answer

Production build (`next build && next start`) against a throwaway Postgres,
re-seeded between runs:

| Fixture | Live campaigns | Cards rendered | Section height (desktop/mobile) |
|---|---|---|---|
| **A** — production's exact distribution | 14 across 8 categories | **8**: medical, military, emergency, veterans, community, disaster, essential-needs, memorial | **640px / 790px** (= production) |
| **B** — the falsifier | travel 2, animal 1, wishes 1 | **3**: travel, animal, wishes | 487px / 586px |
| **C** — nothing live | 0 | **section absent**, page 200 | — |

B is the falsifier that matters: three categories **no curated list would ever
have picked**, and the grid shows exactly those three in the predicted order.
A and C are each other's controls — "always 8" and "always nothing" are both
refuted.

### 5.2 ⚠️ My first attempt at B was VOID, and the reason generalises

The first B run reported the **identical** output to A. Per Gate 5 an
anomalous sample voids the measurement, so it was diagnosed before being
interpreted: `ss -lptn 'sport = :3111'` returned **no pid**, the second
`npm run start` therefore hit **`EADDRINUSE`** (confirmed in its log), and the
request was answered by the **original process still holding fixture A's
`unstable_cache` entry**. Redone with `fuser` to find the pid, a confirmed
kill, `rm -rf .next/cache`, and a verified new pid — and only then did the
numbers move.

**A server you did not actually stop answers exactly like a change that did
nothing.** Confirm the new process is the one answering.

### 5.3 Injections

`inject.py` — 11 mutations, each restored and the restore verified by
**sha256** after every one (`docs/120` §11.1), with a baseline and final clean
run of 18/18.

All 11 fire, including:

1. **the real production defect** (return the hand-curated eight) — fails 9
2. anti-vacuity control (`return []`) — fails 9, so rules 2/4/5 cannot be
   satisfied by returning nothing
3. drop the zero filter · 4. drop the cap · 5. raise the cap past 8
6. drop the tie-break · 7. compare the bigint as a string
8. blank a gloss · 9. hardcode a category href · 10. drop the 23 from the
   sitemap · 11. a bare slug array back inside the component

⚠️ **Injection 3 exposed a hole in my own test and the fix is recorded in
it.** Dropping the zero filter did **not** fail the headline "drops the two
the curated list promoted while empty" row, because that test passed the full
production set of eight plus two zeros — ten rows, and `.slice(0, 8)` cut the
two zeros off, since they sort last. **The cap was silently standing in for
the filter.** The test now uses three live categories so the cap has no part
to play, and the injection fails 2 rows.

⚠️ Injection 9 (a path literal) trips the href rule only; the bare-slug-array
rule is a different **shape** and is proven by injection 11. Two rules, two
shapes — not one rule with a weak injection.

### 5.4 Gate

`lint` 1 pre-existing warning · `typecheck` clean · **`test:unit` 7927 passed
| 16 skipped (7943) across 276 files** · `pool-fanout.ratchet` and
`icon.test` both green.

---

## 5.5 ✅ DEPLOYED (v128, 2026-10-29) and verified live

Every figure below has a **pre-deploy baseline** taken against v127, per
`docs/119`'s lesson that an assertion with no baseline is not a measurement.

| | v127 (before) | v128 (after) |
|---|---|---|
| Grid slugs | community, disaster, **education**, emergency, **family**, medical, memorial, veterans | medical, **military**, emergency, veterans, community, disaster, **essential-needs**, memorial |
| Cards · height | 8 · 640px / 790px | 8 · **640px / 790px** |
| Sitemap | 56 URLs · **23** category · 14 campaign | 56 URLs · **23** category · 14 campaign |

Measured on the live site: `href="/campaigns/category/military"` and
`…/essential-needs` are now present in the **server-rendered homepage HTML**
(the point of the change — a crawler sees them without JavaScript), while
`family` and `education` are at **0 occurrences**. The sitemap was read
**twice** (stale-while-revalidate, `docs/119`).

✅ And the link now leads somewhere: `/campaigns/category/military` serves
**3 campaign links and no empty state**, where the two categories it replaced
rendered *"No active campaigns right now."* `/campaigns/category/family` still
answers **200** — unpromoted is not unserved — with `/campaigns/category`
still **404** as the control.

Release: v128, machine started, 1/1 checks passing, 355s. Health reads
`degraded` on **Stripe alone** (`database`, `payhero`, `redis` all ok), which
is the pre-existing `docs/72`/`docs/125` blocker and not this change.

⚠️ **The deploy surfaced a failure mode `docs/119` did not cover** and that
doc is amended at §2a: `--prerender` was passed with a real `DATABASE_URL` and
**2 of 8 build reads still failed**, with `(EMAXCONNSESSION) … pool_size: 15`
rather than a timeout. Neither sitemap was among them (the end-of-deploy report
read 14), and all four 5-minute routes render live figures on two consecutive
requests — but **which two routes failed is [UNKNOWN]**, because the fail-soft
does not name its caller.

---

## 6. ⛔ Still open

- **A-026 (`docs/143` §5): the listing has no crawlable pagination.**
  `/campaigns` server-renders 12 of 14 live campaigns, `?page=2` returns the
  same 12, and "Load more" is a `<button>`. Unchanged by this work, and still
  a design decision about that page.
- **15 category pages now have 0 inbound links instead of 15.** That is the
  same number as before for the empty ones and is *correct* — but it means
  `family` and `education` moved from "linked and empty" to "unlinked and
  empty". They are still in the sitemap and still build. Whether an empty
  category page should exist at all is the thin-content question `docs/143`
  §4 raised and the owner has not been asked.
- The three approximate icons (§2.3).

## 7. Not checked

- Whether the live grid changes on the next deploy in the way measured here.
  The fixture reproduced production's distribution exactly, but the real page
  is `force-dynamic` behind a 300s `unstable_cache`, so the first load after
  a deploy may serve a pre-change render for up to five minutes.
- Any search-engine consequence. This adds two internal links and removes
  two; `docs/142`'s finding was that indexing is blocked by **age and
  discovery**, not by a technical barrier, and nothing here changes that.
