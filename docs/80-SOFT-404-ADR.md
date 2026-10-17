# 80 — The soft 404: a cached "not found" served as 200

**Date:** 2026-10-17
**Status:** Implemented
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

## The fix

`noStore()` before `notFound()` — **the device this very file already uses**
one branch above, for the `unavailable` case. Marking the render dynamic
keeps it out of the ISR entry, so the 404 reaches the client.

The symmetry is the point: a response about whether an appeal exists must
not be served from a cache that cannot carry the answer. `docs/43`
established that for the "database did not answer" case; this extends it to
"the database answered: no".

## It was not one route

Grepping for the combination rather than fixing the reported symptom found
**three** routes with `revalidate` + `notFound()`:

| Route | Backed by |
|---|---|
| `campaigns/[slug]` | database |
| `blog/[slug]` | database |
| `campaigns/category/[category]` | a static content map |

All three had the same defect and all three are fixed. The category one is
worth noting: its miss is a pure static lookup with no database involved,
which shows the bug belongs to the caching combination and not to anything
about queries.

## Keeping it fixed

`src/app/soft-404.test.ts` finds every `page.tsx` that exports `revalidate`
**and** calls `notFound()`, and asserts each one calls `noStore()` first. It
is structural because the invariant is structural — it is a property of how
routes are configured, not a behaviour of any one of them, and the next
route to acquire both will be caught the day it is written.

The test strips comments before matching, after an earlier test in this
session reported a fix as a defect because the comment explaining it
contained the string being searched for.

A guard on the count is included too: if the at-risk set ever drops to
zero, the filter has broken rather than the codebase having improved.

## Not changed

The 404-vs-5xx decision itself. `docs/43` is explicit that an unresolved
lookup must be a 5xx and never a 404, because a 404 tells donors and
crawlers that a live appeal is gone — turning a pool wedge (`docs/37`) into
de-indexed campaigns. Nothing here touches that: only the status code of
the branch that already had the right answer.
