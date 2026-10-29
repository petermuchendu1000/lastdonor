# 143 — `/about` was linked only from a closed dropdown

**Date:** 2026-10-29 · **Closes:** docs/142 §7's A-025 in full, A-024 **in part**
**Owner instruction:** add the About link to the footer.

---

## 1. The finding, and the correction to how I first reported it

`docs/142` recorded two findings from the Phase 4 link graph:

- **A-024** — 16 of 56 sitemap URLs have **0 inbound internal links**.
- **A-025** — the Organization `@graph` declares a `SiteNavigationElement`
  for `/about` while no page links to it.

⚠️ **My wording for A-025 was imprecise and is corrected here.** I wrote *"no
page links to it"*. In fact `src/components/layout/Navbar.tsx:37-45` **does**
list it:

```ts
const ABOUT_ITEMS = [
  { label: 'How It Works', href: '/how-it-works' },
  { label: 'About LastDonor', href: '/about' },
  …
] as const;
```

The link exists in code and **never reaches server-rendered HTML**, which is a
sharper defect than an omission.

⚠️ **And a number was wrong.** I reported *"15 category pages, 3 of which hold
live campaigns"*. [VERIFIED from production] it is **2**: `military` (3
campaigns — tied for the most of any category) and `essential-needs` (1).
`first-responders` holds **0**, despite `docs/90` naming it a core category. I
should have cross-checked the unlinked set against the per-category counts
before stating a count.

---

## 2. Root cause [VERIFIED]

`ABOUT_ITEMS` is rendered inside a Radix **`DropdownMenuContent`**
(`Navbar.tsx:172-201` / `215-235`) and a `Sheet`-based mobile menu behind
`useState` (`:110`, `mobileView === 'root' | 'campaigns' | 'about'` at
`:320/416/488`). Both mount **only when opened**, so neither is in the first
server response.

This is `docs/130`'s recorded trap on a public page — *"they are
`DropdownMenuItem`s, absent from the DOM until the row menu opens"* — and it
is why `docs/104` could match *"the hidden mobile 'About' nav link"* in a
Playwright DOM assertion while a crawler saw nothing.

**Verified three independent ways:**

1. **Link graph over all 56 sitemap URLs** (server HTML, `<script>` blocks
   stripped): `/about` → **0 inbound**. The control is in the same data — 7
   URLs show **52-56 inbound** (the sitewide nav and footer), so the extractor
   finds nav links correctly.
2. **Homepage raw HTML**: `href="/about"` occurs **0 times**, including inside
   the RSC flight payload (so it is not merely a `<script>`-stripping
   artifact).
3. **An independent page**: `/privacy` → `href="/about"` **0**, with
   `href="/compare"` → **1** as the positive control.

### 2.1 The falsifier, run

*"What would most likely falsify this?"* — that some page outside my 56-page
crawl links it. A repo-wide sweep for `/about` returns exactly one UI site:
`Navbar.tsx:40`, the dropdown array. Every other hit is `robots.ts`,
`sitemap.ts`, `layout.tsx`'s JSON-LD, the page's own canonical,
`navigable-routes.ts`, or AI-prompt text. **Not falsified.**

---

## 3. The fix

One line in `src/components/layout/Footer.tsx`, in the `Platform` group:

```ts
{ label: 'About LastDonor', href: '/about' },
```

The footer is the only **unconditionally server-rendered** navigation on this
site (`PublicFooterGate`, `docs/106` §10a), so this is what makes the
`SiteNavigationElement` claim true. **A-025 is closed by it.**

### 3.1 The guardrail, and why it reads the two surfaces differently

`src/app/site-navigation-is-crawlable.test.ts` (11 tests) derives the claimed
paths from the JSON-LD source and requires each to appear in crawler-visible
chrome. The subtlety is the whole point:

- **`Footer.tsx`** maps over `LINK_GROUPS` unconditionally, so its **object
  form** (`href: '/x'`) *is* the rendering.
- **`Navbar.tsx`**'s object arrays are rendered **only** inside a dropdown or
  the mobile sheet, so there only a **JSX attribute** (`href="/x"`), outside
  those surfaces, proves a crawler can see it. The navbar source is sliced at
  the first `md:hidden` container and its `DropdownMenuContent` blocks are
  tag-matched out.

⛔ Reading the navbar's object arrays as evidence is exactly the mistake that
would have let this defect pass — the rule would have found `href: '/about'`
in `ABOUT_ITEMS` and gone green against the broken site.

**Controls that make it non-vacuous:** the claim set must be non-empty and
contain `/about`; the dropdown strip must remove >200 characters (a no-op
strip would re-admit dropdown links); `NAV.paths` must **not** contain
`/about` (so only the footer can satisfy it); and `/donate` must be satisfied
by the navbar main bar and **not** be in the footer — proving the union works
in both directions rather than collapsing to *"everything must be in the
footer"*.

**All three injections fire, each on exactly one row:** removing the About
footer link (the real production state) fails the `/about` row; a no-op
dropdown strip fails the strip control; deleting the `/about` JSON-LD node
fails the anti-vacuity row and drops the count 11 → 10. Clean restore
verified after each.

---

## 4. ⛔ A-024 is only PARTLY closed, and the rest is an owner decision

This fixes **1 of the 16** orphans. The other **15 are category pages**, and
they have a different root cause: `CategoryShowcase.tsx:21-30`'s
`TOP_CATEGORIES` is a hand-curated list of **8**, and
`CategoryShowcase.tsx:77` is the **only** UI site in the repo that links
`/campaigns/category/*` (the one other hit, `link-graph.ts:95`, is blog-only
and there are 0 blog posts). The sitemap advertises **23**
(`sitemap.ts:157`).

Two cross-checks agree the measurement is sound: `TOP_CATEGORIES` holds 8
entries, and the link graph found exactly those 8 categories with 1 inbound
each.

[VERIFIED from production] set against that curation:

| | Categories |
|---|---|
| Has campaigns **and** linked | medical, emergency, memorial, disaster, veterans, community (6) |
| **Has campaigns, NOT linked** | **`military` (3), `essential-needs` (1)** |
| Linked but **empty** | family, education |
| Neither | the remaining 15 |

So `military` — tied for the most campaigns on the platform — is reachable
from no crawler-visible link, while two empty categories occupy grid slots.

⚠️ **Not fixed, deliberately.** Every available fix is a product decision with
no single right answer, and `docs/60` tuned that grid's mobile height budget
for exactly 8 cards:

1. Make the grid data-driven (show categories that have campaigns) — changes
   what the homepage promotes, and the set would shift as campaigns come and
   go.
2. Add `military` + `essential-needs` → 10 cards, which reopens `docs/60`.
3. Drop the 15 empty categories from the sitemap — but they will fill later.
4. Add a category index page linking all 23 — a new surface.

**My recommendation is (1) plus keeping the 23 in the sitemap**, because the
grid's job is to route people to campaigns that exist, and an empty category
page is the thin-content half of this same finding. That is the owner's call,
not an audit's side effect.

---

## 5. ⛔ A-026, found while VERIFYING this fix: the listing has no crawlable pagination

The post-deploy link graph confirmed `/about` had left the orphan set — and the
count stayed at **16**, because **`/campaigns/tuan-nguyen` joined it with 0
inbound** where it had 2 before. Per Gate 5 an anomalous sample voids the
measurement, so I diagnosed it before interpreting anything.

[VERIFIED] `tuan-nguyen` is `active` with `published_at` set, and it appears in
**neither** `/` nor `/campaigns` server HTML. The cause:

- `/campaigns` server-renders **12** distinct campaign links; **14** are live
  and published.
- `/` renders **6**, stable across two consecutive fetches — including
  `harold-jennings`, which `/campaigns` omits.
- So the first page is a moving window: my earlier "2 inbound" and today's "0"
  are both valid samples of a set that shifts as campaigns are published.
  **Campaign-page inbound counts are not a stable measurement**, and the
  `docs/142` figures for individual campaign slugs should be read that way.

**Verified three independent ways that there is no crawler path to the rest:**

1. No `rel="next"` or `rel="prev"` link tag anywhere in the document.
2. No `href` containing `page=` in the body; "Load more" is enclosed by a
   **`<button>`**, not an `<a>`.
3. **`?page=2` returns the same 12 campaigns as `?page=1`** — the parameter is
   not honoured server-side at all.

⚠️ **Precisely what this does and does not mean.** Those campaigns are **not
undiscoverable**: all 14 are in the sitemap, which is how a search engine finds
them. What they have is **no crawler-visible internal link**, so they receive
no internal link signal, and a link-following AI fetcher never reaches them.
Today that is 2 of 14; the unlinked fraction grows with every campaign
published.

**Not fixed** — the remedies (server-rendering the full set, real paginated
`?page=` URLs with `rel=next`, or a crawlable archive) are design decisions
about the listing, and `docs/71` already tuned that page's chrome budget. It
belongs with §4's category decision.

---

## 6. Not checked

- Whether the footer link renders in a **browser** at mobile width — the
  `columns-2` layout (`docs/69`) now balances 7 Platform links instead of 6,
  and I verified the served HTML and the test, not the rendered column break.
- Whether Googlebot's renderer would have found the dropdown link anyway. It
  executes JavaScript, so it **might**; the claim here is only that the link
  is absent from the first response, which is what non-rendering AI fetchers
  and the no-JS pipeline see (`docs/142` §8.2). Marked **[UNKNOWN]**, and it
  is not the basis for the fix — the `SiteNavigationElement` claim being
  unbacked in HTML is.
- `/blog` has **1** inbound and is the other `ABOUT_ITEMS` entry with no
  footer link. Left alone: 1 is not an orphan, and the owner named only
  About.
