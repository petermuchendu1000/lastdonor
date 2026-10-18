# 80 — The soft 404: a cached "not found" served as 200

**Date:** 2026-10-17, **rewritten 2026-10-18**
**Status:** ✅ RESOLVED. The cause recorded on 2026-10-17 was wrong; this
document now records the real one and the fix.
**Touches:** `docs/43` (the deliberate 404-vs-5xx logic on the campaign page),
which is unchanged.

---

## What was wrong

Verified against production, 2026-10-17:

```
GET /campaigns/definitely-not-real-xyz123   -> HTTP 200
    x-nextjs-cache: HIT
    x-nextjs-prerender: 1

GET /definitely-not-a-page-xyz123           -> HTTP 404
```

The body said **"Campaign Not Found"**. The response said **"here it is."**
A textbook soft 404: search engines index it as a thin page instead of
dropping the URL.

Still reproducible on 2026-10-18 — `/campaigns/sitemap.xml` answered 200 with
`<title>Campaign Not Found</title>`, because `[slug]` matched the literal
string `sitemap.xml`.

---

## ⛔ The first diagnosis was wrong

The 2026-10-17 version of this document said:

> With `revalidate` set, the not-found render is written into the ISR entry
> for that slug and replayed from cache. **A cached entry is served 200
> regardless of the status the render asked for.**

and predicted the fix would be "removing `revalidate` from the page and moving
caching down to the data layer."

**Both are false.** The prediction is the valuable part to have tested,
because it would have cost a day of refactoring three pages' caching model and
the soft 404 would have survived it.

### How it was settled

Six probe routes, built into real production builds (`next build &&
next start`), each a few lines long:

| probe | shape | known slug | unknown slug |
|---|---|---|---|
| a | `revalidate = 60` + `notFound()` | 200 | **200** |
| b | no `revalidate`, `unstable_cache` + `notFound()` | 200 | **200** |
| c | `dynamic = 'force-dynamic'`, `unstable_cache` | 200 | **200** |
| d | `dynamicParams = false`, unknown param | 200 | **404** |
| e | `force-dynamic`, **synchronous**, `notFound()` as the first statement | — | **200** |
| f | `force-dynamic`, async, awaited params | 200 | **200** |
| — | no route at all | — | **404** |

**Probe e is decisive.** A page with nothing awaited, no params used, no data
access, no caching of any kind, whose literal first statement is `notFound()`,
answered **200**. Caching cannot explain that. Neither can ISR, `revalidate`,
`unstable_cache`, or awaiting `params` — probes b, c and f rule each out
individually.

The framework itself was fine throughout: an unrouted path returned a real
404. So the problem was `notFound()` *called from inside a page render*, and
it was app-wide rather than specific to these three routes.

---

## The real cause: `loading.tsx`

`src/app/loading.tsx` existed, and a `loading.tsx` creates an **implicit
`<Suspense>` boundary around every route beneath its segment**.

React streams the shell as soon as something suspends. The HTTP status line
goes out with that first flush — before the page component has finished
rendering. When `notFound()` throws afterwards, Next can still swap the body,
which is exactly why the body was always correct, but the `200` is already on
the wire and cannot be recalled.

**Proof.** Remove `src/app/loading.tsx`, rebuild, re-run the same probes:

```
probe e  (sync notFound)                 200 -> 404
probe a  (revalidate + notFound)         200 -> 404      <- the shape blamed in 2026-10-17
probe c  (force-dynamic)                 200 -> 404
probe f  (async, awaited params)         200 -> 404
```

`revalidate` was innocent. Probe a keeps `revalidate = 60` and returns a
correct 404 once the Suspense boundary above it is gone.

`/campaigns/category/...` stayed 200 in that run, which confirmed the
mechanism a second time: it has no `loading.tsx` of its own but
`src/app/campaigns/loading.tsx` sits above it.

---

## The fix

`loading.tsx` is not banned — it is **scoped with route groups** so that none
sits above a route calling `notFound()`. Route groups do not appear in the
URL but do scope the boundary:

| was | now | covers |
|---|---|---|
| `src/app/loading.tsx` | `src/app/(home)/loading.tsx` | `/` only |
| `src/app/campaigns/loading.tsx` | `src/app/campaigns/(index)/loading.tsx` | `/campaigns` only |
| `src/app/blog/loading.tsx` | `src/app/blog/(index)/loading.tsx` | `/blog` only |
| `src/app/dashboard/loading.tsx` | `src/app/dashboard/(index)/loading.tsx` | `/dashboard` only |
| `src/app/admin/loading.tsx` | `src/app/admin/(index)/loading.tsx` | `/admin` only |

Two were **deleted outright**: `campaigns/[slug]/loading.tsx` (83 lines) and
`blog/[slug]/loading.tsx` (53 lines). Those sit directly on routes that call
`notFound()`, so there is nowhere to scope them to.

### Verified

Against `next build && next start`, which is the only thing that shows this:

```
/campaigns/category/not-a-real-cat-xyz   404      (was 200)
/campaigns/category/medical              200      unchanged
/campaigns                               200      unchanged
/blog                                    200      unchanged
/                                        200      unchanged
/unrouted-xyz                            404      unchanged
```

`/campaigns/[slug]` and `/blog/[slug]` could not be checked locally — the
sandbox has no Postgres route (TCP to Supabase is blocked), so their lookup
fails and they return the `docs/43` 5xx rather than reaching `notFound()`.
They now carry no Suspense boundary above them, exactly like the category
route that was proven, and they are verified in production after deploy.

---

## It was not three routes

Grepping for `revalidate` + `notFound()` in 2026-10-17 found three. That was
the wrong thing to grep for, so it found the wrong set.

The ratchet written for the real cause — every `page.tsx` calling
`notFound()`, cross-referenced against every `loading.tsx` that could wrap it
— found **twelve**, nine of them behind authentication:

- `dashboard/campaigns/[id]/{,edit,updates,donors}`
- `admin/campaigns/[id]/{,edit,updates/new}`, `admin/blog/[id]/edit`,
  `admin/users/[id]`

Those are `noindex`, so no crawler was affected and the reported symptom never
mentioned them. But a signed-in person opening a campaign id that does not
exist was getting a 200 too. They are fixed in the same pass.

---

## The trade-off accepted

**`/campaigns/[slug]` and `/blog/[slug]` have no loading skeleton any more.**
That is a real perceived-performance cost on the two most important public
pages, and it is not disguised here.

It is worth it: `/campaigns/[slug]` is ISR with `revalidate = 60`, so it is
served from cache for almost every request and the skeleton rarely appeared;
the soft 404, by contrast, was permanent and affected every bad URL anyone
ever linked to.

**The skeleton can come back** without reopening the defect: put an explicit
`<Suspense>` *inside* the page, below the lookup that decides 404. Then the
status is settled before anything streams. That is a deliberate piece of work,
not a one-liner, and it is not done.

---

## What stops it coming back

`src/app/soft-404.ratchet.test.ts` walks `src/app`, finds every `page.tsx`
containing `notFound()`, finds every `loading.tsx`, and fails the build if any
`loading.tsx` segment is an ancestor of any such page — route groups
respected. It also pins that the five scoped skeletons still exist, so a
future change cannot "fix" a failure by deleting loading states wholesale.

It is the test that found the nine authenticated routes.

---

## How the wrong answer got shipped, and then written down

Worth keeping, because it happened twice.

The 2026-10-17 fix (`noStore()` before `notFound()`) passed `npm run lint`,
`npm run typecheck`, **5,679 unit tests** and a local `next dev` check, then
turned all three routes into **HTTP 500** in production and was reverted the
same day. `next dev` does not use ISR, and the unit test drove the page
function directly and never went near Next's cache.

The *explanation* written afterwards was then never tested at all — it was
inferred from `x-nextjs-cache: HIT` appearing on the response, which is true
but incidental. It sat in this file for a day as the reason, and it was wrong.

`noStore()` is still not the fix here, for its own unrelated reason: during
on-demand ISR generation, opting out of the cache is a dynamic-server bail-out
rather than a cache hint, and it surfaces as a 500.

The lesson `docs/63` recorded for hydration and `docs/66` for egress IPs holds
a third time: **reproduce against the thing that actually runs it.** A
mechanism you have not reproduced is a guess, however well it fits the
symptom.

---

## Not changed

The 404-vs-5xx decision itself. `docs/43` is explicit that an unresolved
lookup must be a 5xx and never a 404, because a 404 tells donors and crawlers
that a live appeal is gone — turning a pool wedge (`docs/37`) into de-indexed
campaigns. Nothing here touches that: only the status code of the branch that
already had the right answer.
