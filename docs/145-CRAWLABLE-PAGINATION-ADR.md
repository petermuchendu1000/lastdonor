# 145 — `/campaigns` could only ever show its first page

**Date:** 2026-10-29 · **Closes:** `docs/143` §5 (A-026) for `/campaigns`
**Owner instruction:** fix A-026, add crawlable pagination to `/campaigns`.

---

## 1. ⛔ The correction first

`docs/143` §5 reported the overflow campaigns as having *"no crawler-visible
internal link … a link-following AI fetcher never reaches them."* **That was
wrong**, and §5 is amended. I should have tested the category path before
stating a consequence.

[VERIFIED by fetching all 23 category pages] every one of the 14 live
campaigns, **including both absent from `/campaigns`** (`harold-jennings`,
`tuan-nguyen`), is linked from its own category page — and since `docs/144`
every category holding a campaign is linked from the homepage. The number of
campaigns reachable by no crawlable internal link today is **0**.

---

## 2. What is actually wrong [VERIFIED]

**There is no crawlable pagination anywhere in the browse surface.**

| | Evidence |
|---|---|
| The page reads no `page` param | `(index)/page.tsx:63-70` declares `category, sort, q, location, close_to_target, status` |
| The query applies no offset | `:192-195` — `.limit(PAGE_SIZE + 1)`, no `.offset()` |
| The only "more" control is a button | `CampaignGrid.tsx:127-129` — `<button type="button">` |
| The cursor was a constant | `:220` — `nextCursor = hasMore ? String(PAGE_SIZE) : null` |
| Every URL claimed to be page 1 | `:21` — a static `alternates.canonical` of `https://lastdonor.org/campaigns` |

**Verified three independent ways, each with a control that can fail:**

1. **Source** — the five rows above, read in this session.
2. **Live HTTP** — `?page=1`, `?page=2` and `?page=99` returned the **identical
   12 slugs** (0 differing). ⚠️ The control is what makes this mean anything:
   `sort=newest` vs `sort=most_funded` differ by **4** slugs through the same
   extractor, so it can see a change when there is one.
3. **The consequence, traced** — 14 listable campaigns against 12 rendered;
   `rel=next`/`rel=prev` absent (0); no `href` containing `page=` (0).

⚠️ **The API underneath was never the problem.** `GET /api/v1/campaigns`
already paginates: `parsePagination` reads `cursor` as an integer offset
(`api-helpers.ts:47-49`) and the route does `.offset(offset).limit(limit+1)`
(`route.ts:109-110`) with the same `asc(campaigns.id)` tiebreaker. Only the
pages ignored it.

### 2.1 The falsifier, run — and it changed the severity

*"What would most likely falsify this?"* — that the overflow campaigns are
reachable another way. **They are** (§1). So this is a **latent** defect, not a
live one, and it bites in three ways:

1. Any single category exceeding **12** campaigns — the category page is also
   `PAGE_SIZE = 12` with no pagination at all, and its "View all" link goes to
   `/campaigns?category=X`, which has the same cap. The escape hatch leads
   back to the same wall.
2. More than **8** categories holding campaigns — `MAX_SHOWCASE_CARDS` is 8
   (`docs/144`), so the 9th category's page is linked from nowhere.
3. `/campaigns` itself is the canonical listing, in the sitemap and the nav,
   and could never concentrate internal links on more than 12 rows.

[VERIFIED] the largest category today holds **3**, so the ceiling is far away.

---

## 3. The fix

- **NEW `src/lib/pagination.ts`** — `parsePageParam` + `paginationModel`, pure.
  The arithmetic lives outside the route *so that a test can execute it*
  (`docs/107`, `docs/126`, `docs/130`).
- **NEW `src/components/campaign/Pagination.tsx`** — a server component of
  plain `<Link>`s with `rel="prev"`/`rel="next"` and `aria-current="page"`.
- **`browse-params.ts`** — `PAGE_PARAM` and `campaignsPageHref`.
- **`(index)/page.tsx`** — reads `page`, applies `.offset()`, fixes the cursor,
  and becomes `generateMetadata` so each page self-canonicalises.

**No new database query.** The total was already computed: `:216` derives
`matchedCount` from the tab-count FILTER aggregate when unfiltered and from the
filtered count when not. The route stays at docs/87's cap of three, and the
ratchet confirms it.

### 3.1 ⛔ Three decisions that are not style

**`page` is NOT in `BROWSE_PARAM_KEYS`.** That list is what `campaignsHref`
builds filter links from and what `/search` forwards. A `page` in it would
carry page 4 across a category change and land the visitor past the end of a
one-page result. Pagination is positional, not a filter.

**Page 1 carries no `page` param**, so `/campaigns` and `/campaigns?page=1` are
never two addresses for one document.

**An out-of-range page is served honestly, never clamped.** Clamping would put
page 2's rows under the URL `?page=99`, and `generateMetadata` cannot detect
that without re-running the count — a **fourth** concurrent query, breaking
`docs/87`. So the offset is honoured literally, the listing comes back empty,
and the page says *"There is no page 99. This listing has 3 pages."* with a
link to page 1.
⚠️ It also had to be this way for a mechanical reason: an unclamped offset
depends only on the requested page, so it is known **before** the queries run,
which is what lets the rows query carry it. A clamp needs the total first.

### 3.2 ⛔ Two traps avoided, both found by reading

**`notFound()` is unsafe on this route.** `campaigns/(index)/loading.tsx`
exists, and `docs/80` proved a `loading.tsx` above a route calling `notFound()`
flushes the 200 status line before the page finishes — the soft 404. That is
why §3.1's out-of-range page renders rather than 404s.

**The cursor would have become a bug I introduced.** `nextCursor` was the
constant `String(PAGE_SIZE)`, correct by coincidence while page 1 was the only
page. On page 2 it asks the API for rows 12-24 — the rows already on screen —
and `CampaignGrid`'s id dedupe (`:78-80`) discards every one, so "Load More"
would spin and append nothing. It is now `offset + PAGE_SIZE`, and
`load-more-cursor.test.tsx` exists **only** because nothing else could see it:
the cursor is not in the DOM, it surfaces only when the button is pressed.

### 3.3 Load More is kept

The instruction was to **add** a crawlable path; removing a working control is
not part of that. The two compose once the cursor is offset-aware — Load More
extends the current page, the links jump between pages. The cost is two "more"
affordances on one screen, recorded as a trade-off rather than hidden.

---

## 4. ⚠️ Two accessibility regressions I introduced, and what caught them

Both were mine, both were caught by the **E2E axe run**, not by any assertion I
wrote, and both are worth recording because the second is worse than the first.

**(a) Contrast, 1.72:1.** The inert Previous/Next placeholders were
`text-muted-foreground/40` — `#c1c6cb` on white against AA's 4.5:1. ⚠️
`aria-hidden="true"` does **not** exempt it: the text is still there for a
sighted reader. This is `docs/91` word for word — *"Dimming below the
legibility floor is not a way to signal state … A placeholder nobody can read
is not a placeholder."* I repeated a mistake this repo had already written
down. The semantic signals (no href, not focusable, `aria-hidden`) carry the
state; the colour does not have to.

**(b) `link-name` on phones only.** "Previous" and "Next" were `hidden
sm:inline`, so below `sm` the link's only child was an `aria-hidden` icon and
the link had **no accessible name at all** — axe `link-name` /
`focusable-no-name`, serious, Mobile Chrome only. Fixed with `sr-only
sm:not-sr-only`, which keeps the real text in the accessibility tree at every
width and keeps the accessible name identical to the visible label (an
`aria-label` would not).

⚠️ **Desktop passed while mobile failed**, which is the generalisable part: a
responsive utility that hides text changes the accessible name, and a
desktop-only a11y check cannot see it.

---

## 5. Verification

### 5.1 Executed against a real Postgres

`pagination.integration.test.ts` (8 tests) seeds **29** rows — deliberately not
a multiple of 12, so a partial last page cannot hide an off-by-one — with
**five rows sharing a sort key** so the tiebreaker matters. It proves the
pages concatenated reproduce the full ordered list **once each**: no gap, no
duplicate. A mock cannot do this; it would happily return page 1's rows for
every page, which is the defect itself.

⚠️ **One of its tests was rewritten because it could not fail.** The first
version asserted "walk the pages twice, get the same answer" as proof the
tiebreaker was needed — but at 29 rows Postgres sorts a seq scan
deterministically, so it would have passed with `asc(campaigns.id)` deleted.
It now pins the *contract* (tied rows emerge in id order) and says plainly
that the tiebreaker's necessity is an argument about what Postgres is
**permitted** to do, not something this fixture demonstrates.

### 5.2 In a browser, against a production build

29-campaign fixture, three pages:

| | Result |
|---|---|
| `href="/campaigns?page=2"` in server HTML | present, with `rel="next"`; page 1 links to pages 2 **and** 3 |
| Pages disjoint | p1∩p2 = 0, p1∩p3 = 0, p2∩p3 = 0 |
| Union | 12 + 12 + 5 = **29 of 29 seeded** |
| Canonicals | `/campaigns` → itself, `?page=2` → itself, `?page=3` → itself |
| Past the end | *"There is no page 99. This listing has 3 pages."*, stock empty state absent |

⚠️ **The first browser run was VOID** and the reason generalises: with
`waitUntil: 'domcontentloaded'` the same URL measured differently between the
desktop and mobile passes (`page 99` reported nav absent on one and present on
the other). Next streams the listing in a later chunk, so the probe was racing
the render. Re-run waiting for `load` plus a settled locator, all six rows
agree. **An inconsistent sample is not a weak result, it is a void one.**

### 5.3 Injections

13 mutations, each restored and the restore verified by **sha256**
(`docs/120` §11.1), baseline and final clean run 90/90. **All 13 fire**,
including the real production defect (drop `.offset()`), restoring the
constant cursor, clamping, emitting `?page=1`, putting `page` into
`BROWSE_PARAM_KEYS`, and making the current page a link to itself.

⚠️ Two first reported WEAK and **both were my harness's expectation strings,
not test gaps** — one named a cursor test whose `hasMore` comes from the row
count and so never consults `nextPage`; the other named the generic `it.each`
titles when the injection only breaks scientific/hex notation. Corrected the
expectations, not the code.

### 5.4 Suites

`lint` 1 pre-existing warning (I introduced one and removed it) · `typecheck`
clean · **unit 7995 passed / 16 skipped (8011) in 278 files** · **integration
309/309 in 32 files** · **E2E 164 passed / 0 failed / 24 skipped**.

---

## 6. ⛔ Not fixed, and not checked

- **The category page has the same ceiling and no pagination** (§2.1). It is
  the other half of A-026 and the instruction named `/campaigns`. Its "View
  all" link points at `/campaigns?category=X`, which now paginates, so the
  overflow is reachable in two hops — but the category page itself still shows
  at most 12 with no control.
- **`/completed-campaigns`** is the other `CampaignGrid` caller and has the
  same shape. Untouched.
- **No `?page=` URL is in the sitemap**, deliberately — the campaigns
  themselves are already listed individually.
- **Filtered URLs still canonicalise to `/campaigns`**, exactly as the static
  object did. Whether a filtered listing deserves its own indexed URL is a
  separate decision I did not take.
- **Not verified against production**, because this is not deployed. Every
  browser figure above is from a local production build on a seeded fixture.
- **[UNKNOWN] what any particular crawler does with this.** The verified claim
  is narrow and mechanical: the links are now in the server HTML, where before
  there were none. No claim is made about ranking, indexing or how Google
  treats `rel=next`.
