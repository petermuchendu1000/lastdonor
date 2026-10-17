# 80 — The soft 404: a cached "not found" served as 200

**Date:** 2026-10-17
**Status:** ⛔ OPEN. The fix was implemented, broke production, and is reverted.
**Touches:** `docs/43` (the deliberate 404-vs-5xx logic on the campaign page),
which is unchanged.

---

## What was wrong

Verified against production, 2026-10-17:

```
GET /campaigns/definitely-not-real-xyz123   -> HTTP 200
    x-nextjs-cache: HIT
    x-nextjs-prerender: 1
    cache-control: s-maxage=60, stale-while-revalidate=31535940

GET /definitely-not-a-page-xyz123           -> HTTP 404
```

The body said **"Campaign Not Found"**. The response said **"here it is."**

Checked at both the edge and the origin (`lastdonor.fly.dev`) to rule out
Cloudflare: identical, so this was Next.js, not the CDN.

## Why

`src/app/campaigns/[slug]/page.tsx` does call `notFound()` for a genuine
miss — that part was correct and is `docs/43`'s doing. The defect is the
**combination**:

```
export const revalidate = 60   +   notFound()
```

With `revalidate` set, the not-found render is written into the ISR entry
for that slug and replayed from cache. **A cached entry is served 200
regardless of the status the render asked for**, which is what
`x-nextjs-cache: HIT` and `x-nextjs-prerender: 1` on a "not found" body are
telling us.

That is a textbook soft 404. Search engines treat it as a thin page to
index rather than a URL to drop, so every mistyped or retired campaign slug
anyone ever linked to becomes an indexable empty page.

## ⛔ The fix that was tried, and why it is reverted

`noStore()` before `notFound()` — the device this very file already uses
one branch above, for the `unavailable` case. Applied to all three routes,
it **turned every one of them into an HTTP 500** in production.

```
GET /campaigns/definitely-not-real-xyz123      -> HTTP 500
GET /blog/definitely-not-real-xyz123           -> HTTP 500
GET /campaigns/category/not-a-category-xyz     -> HTTP 500
```

Reverted the same day. A 500 is worse than the soft 404 it replaced: it
breaks the page for a person and tells a crawler the server is broken
rather than that the page is thin.

### Why it fails

On an unknown slug, Next renders the page **through on-demand ISR
generation** — it is producing a cache entry, not serving a dynamic
response. Opting out of the cache from inside that render is a
dynamic-server bail-out, not a cache hint, and the bail-out surfaces as a
server error instead of a 404.

That it works in the `unavailable` branch is a coincidence of outcome, not
evidence that it is safe here: that branch throws
`CampaignUnavailableError` and is *meant* to produce a 5xx, so the
bail-out is invisible.

### How it got to production

This is the part worth keeping.

- `npm run lint`, `npm run typecheck` and **5,679 unit tests** all passed.
- A local check on `next dev` returned **200**, not 500 — because dev does
  not use ISR at all, so the failing path never executed.
- The unit test asserting the new behaviour passed, because it drives the
  page function directly and never goes near Next's cache.

Nothing short of a production build exercises on-demand ISR generation.
`docs/63` recorded the same lesson for hydration — `next dev` is not a
model of production — and this is the second time in one session it has
been the thing that mattered.

**Before retrying: reproduce against `next build && next start`.** All
three call sites carry a comment saying so.

### What the real fix probably costs

The not-found render has to not be cached, and `revalidate` on the segment
is what caches it. Removing `revalidate` from the page and moving caching
down to the data layer (`unstable_cache` around the queries, or `fetch`
level) would give a dynamic page with cached data and a real 404 — at the
cost of re-working the caching model of three pages, and a line in the ISR
tally `docs/26` §5 keeps. That is a deliberate piece of work, not a
one-line fix, which is precisely what the one-line fix pretended to be.

## It was not one route

Grepping for the combination rather than fixing the reported symptom found
**three** routes with `revalidate` + `notFound()`:

| Route | Backed by |
|---|---|
| `campaigns/[slug]` | database |
| `blog/[slug]` | database |
| `campaigns/category/[category]` | a static content map |

All three have the same defect and all three are **still soft 404s**. The
category one is worth noting: its miss is a pure static lookup with no
database involved, which shows the bug belongs to the caching combination
and not to anything about queries — and that the eventual fix has to work
for a route that never touches Postgres.

## Keeping the knowledge

The structural ratchet written for the reverted fix
(`src/app/soft-404.test.ts`, asserting every `revalidate` + `notFound()`
route calls `noStore()`) was **deleted with the fix**. A test that asserts
a behaviour we have proven wrong is worse than no test.

What remains instead:

- the existing assertion in `page.lookup.test.tsx` that the 404 render
  does **not** call `noStore()` — which was there before today with no
  reason recorded, was reversed, and is now restored **with** the reason,
  so the next person to try this finds the evidence instead of the bare
  assertion that invited the attempt;
- a comment at all three call sites naming what was tried, what it did,
  and what to reproduce against before retrying.

## Not changed

The 404-vs-5xx decision itself. `docs/43` is explicit that an unresolved
lookup must be a 5xx and never a 404, because a 404 tells donors and
crawlers that a live appeal is gone — turning a pool wedge (`docs/37`) into
de-indexed campaigns. Nothing here touches that: only the status code of
the branch that already had the right answer.
