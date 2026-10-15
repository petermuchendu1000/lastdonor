# 43 - Campaign detail page: stale message wall, and unknown slugs returning a 15s bare 500

**Date:** 2026-10-15
**Status:** Accepted, implemented in the same change
**Scope:** `src/app/campaigns/[slug]/page.tsx`, `src/lib/campaign-lookup.ts`,
`src/hooks/usePollingList.ts`, `src/components/campaign/MessageWall.tsx`,
`src/app/api/v1/campaigns/[slug]/messages/route.ts`
**Related:** docs/26 §5 (ISR cache handler), docs/37 (DB pool wedge incident),
docs/29 (system audit)

Two defects found by a live browser audit of production on 2026-10-15. Both sit
on the campaign detail page and both come from the same root cause class: an
ISR-cached server render treated as the source of truth.

---

## D1 - a message of support posts, then vanishes on reload

### What was observed (verified, production, 2026-10-15)

1. Signed in, opened `/campaigns/marcus-delgado`, posted a message.
2. `POST /api/v1/campaigns/marcus-delgado/messages` returned **201** and the
   message appeared immediately (an optimistic insert through
   `MessageWallContext`).
3. A reload rendered "Messages of Support - No messages yet. Be the first to
   leave a message of support!"
4. The row was genuinely stored: `GET .../messages?limit=20` returned it.
   `curl /campaigns/marcus-delgado | grep -c "<message text>"` returned `0`.

### Diagnosis (verified by code reading)

Two independent facts combine:

- The page sets `export const revalidate = 60`, so the HTML - including
  `initialMessages`, read server-side by `getMessages()` - comes from a cached
  render. **No write path invalidated it.** Before this change
  `src/app/api/v1/campaigns/[slug]/messages/route.ts` called neither
  `revalidatePath` nor `revalidateTag`; compare
  `src/app/api/v1/campaigns/[slug]/route.ts:158`, which does.
- `src/hooks/usePollingList.ts` armed `setInterval(poll, pollIntervalMs)` **with
  no leading call**. `MessageWall`'s interval is 30s. So for the first 30s after
  any mount the component renders `initialItems` verbatim, and if that cached
  render predates the message, the reader is shown the empty state.

The human cost is the reason this is a defect and not a latency nit: a donor
writes encouragement to someone with a serious illness, reloads, and is told
nothing was saved. They post again, or give up. The beneficiary never sees it.

### Decided

**The message wall is client-authoritative after mount.** `usePollingList` gains
a `syncOnMount` option; `MessageWall` sets it. On mount the component re-reads
page 1 of `/api/v1/campaigns/<slug>/messages` with `cache: 'no-store'` and
**replaces** the list with what comes back.

It replaces rather than merges on purpose. The existing `mergeNew` can only add
items, which is right for a live feed but cannot repair a stale render: it would
keep a message that has since been hidden by moderation, and it cannot help at
all when staleness is the reason the list looks empty.

The list is still server-rendered. First paint and crawlers get
`initialMessages`; the refresh only corrects it. A failed or aborted refresh
keeps the server-rendered list, so a network hiccup can never blank a list that
did render.

`revalidatePath(\`/campaigns/${slug}\`)` was **also** added to the message POST,
but only as a best-effort improvement to the crawler-visible HTML. See
"What is only true until a shared ISR cache handler lands" below.

### Rejected

- **`revalidatePath` alone.** This is the obvious fix and it is not sufficient.
  No shared cache handler is deployed (docs/26 §5, and CLAUDE.md records 26
  pages using `revalidate` with 36 files calling `revalidatePath`/
  `revalidateTag`), so an in-process revalidation invalidates only the instance
  that served the POST. On a multi-instance deploy the next GET can be answered
  by any other instance, still from its own stale entry. Relying on it would
  have made the bug intermittent instead of fixed, which is worse.
- **Dropping ISR on the campaign page (`force-dynamic` or `revalidate = 0`).**
  Correct, and far too expensive: the page issues 6 queries per render against a
  5-connection pool (`src/db/index.ts`), and this is the most-trafficked page on
  the site. ISR is what keeps it cheap.
- **A shorter poll interval.** Does not fix a reload, which is the reported
  symptom; it only shortens the window. It also multiplies read traffic on every
  open tab.
- **Removing the server-rendered list and fetching everything client-side.**
  Fixes staleness, loses the crawler-visible message wall and adds a visible
  empty flash on first paint.
- **Fixing it in `DonorFeed` too, in this change.** `DonorFeed` has the same
  defect shape (15s interval, no leading fetch) and the same fix is one option
  away, but its `initialDonors` feeds visible social proof and the audit did not
  cover it. Left for a deliberate follow-up; `syncOnMount` therefore defaults to
  `false` so nothing else changed behaviour.

---

## D2 - an unknown campaign slug hung 15s and returned a bare, unstyled 500

### What was observed (verified, production, 2026-10-15)

```
200  0.5s  /campaigns/alicia-reeves
500 15.2s  /campaigns/nope-1
500 15.2s  /campaigns/nope-2
200  0.2s  /campaigns/alicia-reeves
```

In the browser: ~18s blank, then a bare `500: Internal Server Error` with no
header, footer or navigation. `/campaigns/ALICIA-REEVES` (wrong case only) did
the same. `/this-page-does-not-exist` returned the branded 404 in 2s, so the 404
page itself works - the campaign route never reached it.

### Diagnosis

Taken in the order it was established.

**1. 15.2s is the client-side query bound, not a database plan.**
`DB_QUERY_TIMEOUT_MS` defaults to 15,000ms (`src/db/query-timeout.ts`), and
nothing else in `src/` has a 15s budget (grep for `15_000`/`15000` finds only
`DonorFeed`'s poll interval and unrelated outbound HTTP timeouts). So the lookup
was reaching that ceiling and rejecting with `QueryTimeoutError`
(`code = 'DB_QUERY_TIMEOUT'`).

**2. "No such slug" cannot be inherently slow.** `campaigns.slug` is UNIQUE in
both migration lineages - `src/db/migrations/0000_square_chronomancer.sql:93`
and `src/db/migrations-v2/0000_cheerful_robbie_robertson.sql:254`, both
`CONSTRAINT "campaigns_slug_unique" UNIQUE("slug")` - so a miss is an index
probe, not a scan. **Verified** from the SQL. A nonexistent slug is therefore
not the discriminator between the fast and slow rows of that table.

**3. What actually distinguished those requests is that the misses were the only
ones that touched Postgres at all.** `/campaigns/alicia-reeves` is an ISR entry
(`revalidate = 60`, plus `generateStaticParams`), so its 0.2-0.5s says nothing
about database health; `/this-page-does-not-exist` renders the static
`src/app/not-found.tsx` with no query. The two 500s were the only uncached
renders in the sample. **Assumed, not verified:** that the underlying stall was
pool-level (a cold or wedged pool of the kind docs/37 documents) rather than
query-level. Confirming that needs production access this change did not have.
It does not alter the fix, because the fix must be correct for *any* lookup that
does not answer.

**4. Why the throw produced a chrome-less page rather than `app/error.tsx`.**
`getCampaignCached` was awaited by **`generateMetadata`** as well as the page
body. `generateMetadata` resolves before the HTML shell is flushed, so a
rejection there aborts the document before `app/error.tsx` or
`app/global-error.tsx` exists in the tree, and Next answers with its own
plain-text 500. This also *proves* the throw came from metadata: a throw in the
page body alone would have rendered the styled boundary, with header, footer and
navigation intact, which is what the audit did not see.

**5. Why `notFound()` was never reached.** `page.tsx` called it on `!campaign`,
but the lookup rejected instead of resolving to `undefined`, and nothing in
`src/` handled `QueryTimeoutError` (grep: the only references were its own
test). `notFound()` is on the resolved path only.

Also ruled out while diagnosing, so nobody re-treads it: `src/middleware.ts`'s
matcher does not include `/campaigns/:path*`, so neither auth nor the rate
limiter is in this path; `src/app/layout.tsx` is synchronous and issues no query;
`generateStaticParams` is build-time only in next@15.5.14 (the only runtime
references in `node_modules/next/dist/server/` are `output: export` errors in the
dev server).

### Decided

A new module, `src/lib/campaign-lookup.ts`, classifies the lookup into three
outcomes instead of returning a nullable row:

| Outcome | Meaning | Response |
|---|---|---|
| `found` | row returned | the page |
| `missing` | the query **answered** and matched nothing | `notFound()` - branded 404, no timeout waited on |
| `unavailable` | the query did not answer (anything thrown) | `CampaignUnavailableError` thrown from the page body, so `app/error.tsx` renders a styled 500 with header, footer, navigation and "Try Again" |

Three properties make this safe:

- **A thrown lookup is never a 404.** Only a resolved empty result is evidence
  that a slug does not exist. "This campaign does not exist" is a factual claim
  published to donors and to crawlers; emitting it during a pool wedge would
  de-index live appeals and tell donors someone's fundraiser is gone. That is
  the trade accepted here: a database outage now shows a 5xx on *valid* campaign
  URLs rather than silently 404ing them, which is the louder and more honest
  failure.
- **`generateMetadata` no longer throws.** On `unavailable` it returns
  `{ title: 'Campaign temporarily unavailable ...', robots: { index: false,
  follow: false } }`; on `missing`, `{ title: 'Campaign Not Found', robots:
  { index: false } }`. The shell can always flush, so the error boundary can
  always render.
- **The degraded render is not cached.** The page calls `unstable_noStore()`
  before throwing. **Verified 2026-10-15** against the installed next@15.5.14:
  `revalidate === 0` yields `private, no-cache, no-store, max-age=0,
  must-revalidate` (`node_modules/next/dist/server/lib/cache-control.js:14`),
  and a response generator that throws does not write a new entry -
  `node_modules/next/dist/server/response-cache/index.js:285` only re-sets a
  *previous* entry, with a 3-30s revalidate, and an unknown slug has none.
  `renderErrorImpl` sets the same no-store header
  (`node_modules/next/dist/server/base-server.js:1607`).

A second, tighter deadline was added around this one query:
`CAMPAIGN_LOOKUP_TIMEOUT_MS`, default **4,000ms**, clamped to
`[500, DB_QUERY_TIMEOUT_MS]`. A stalled lookup now fails in ~4s instead of 15s.

- It **does not touch or weaken** the global bound in `src/db/query-timeout.ts`,
  which docs/37 explains and which remains the backstop for every other query.
  It is strictly narrower and cannot be configured wider: a value above the
  global bound is rejected with a logged error and the default is used.
- It is **not applied during `next build`** (`IS_PRODUCTION_BUILD`). A prerender
  drives many pages through a 5-connection pool at once, where a multi-second
  queue wait is normal and is not an outage; tightening it there would convert
  slow builds into failed ones. `withBuildPhaseFailSoft` already turns a
  build-time query failure into zero rows, so `unavailable` cannot arise during
  the build.
- Wrong-case URLs (`/campaigns/ALICIA-REEVES`) now get the fast branded 404.
  Case-insensitive slug matching or a redirect was **not** added; that is a
  separate product decision and `slug` has no case-insensitive index.

### Rejected

- **`try { ... } catch { notFound() }` around the lookup.** The shortest fix and
  the dangerous one: it converts a database outage into a 404 and tells crawlers
  every live campaign is gone. Explicitly ruled out.
- **Letting the error reach `app/error.tsx` without changing
  `generateMetadata`.** Does not work, and is the actual bug: metadata resolves
  before the shell flushes, so the boundary never exists. This is why the fix had
  to be in both functions.
- **Rendering a styled "temporarily unavailable" page with status 200.** Keeps
  the chrome, lies to crawlers about a transient failure, and risks being cached.
- **Dropping the 15s bound so the query can finish.** Reverses docs/37 for a
  cosmetic gain and restores unbounded hangs.
- **Classifying errors by driver code (`ECONNREFUSED`, `57014`, ...) to decide
  404 vs 5xx.** There is no error that means "this slug does not exist"; only a
  resolved empty result does. Enumerating codes adds a list to maintain and a
  way to get the dangerous answer by accident.
- **Adding `not-found.tsx` under `campaigns/[slug]/`.** Would improve the 404
  copy but changes nothing about this defect: the route never reached the 404
  path. Left alone.

---

## What is only true until a shared ISR cache handler lands

docs/26 §5 remains unimplemented: there is **no shared ISR cache handler**, so
each instance holds its own `revalidate = 60` entries.

- `revalidatePath(\`/campaigns/${slug}\`)` in the message POST, and the existing
  calls in `src/app/api/v1/campaigns/[slug]/route.ts`, invalidate **only the
  instance that served the write**. Every other instance keeps serving its own
  copy for up to 60s. Treat these calls as a best-effort improvement to
  crawler-visible HTML, never as a correctness guarantee.
- Consequently, **the server-rendered message list can be up to 60s stale on any
  given instance, and the crawler-visible HTML can miss a just-posted message
  entirely.** What the signed-in reader sees is correct because the client
  re-reads the API on mount; what Googlebot sees is not guaranteed to be.
- Once a shared handler is deployed, the `revalidatePath` call becomes
  authoritative across instances and the crawler gap closes. `syncOnMount` is
  still worth keeping: it is the only thing that makes the list correct within
  the revalidate window itself.
- The same caveat applies to the other 25 `revalidate` pages. Nothing here fixes
  them.

## Unfixed, recorded deliberately

- **`DonorFeed` has D1's defect** (15s interval, no leading fetch): a donation
  made and then reloaded can be absent from the donor feed for up to 15s.
  `syncOnMount: true` is the one-line fix; not applied here because the audit did
  not cover it and the component drives visible social proof.
- **The underlying cause of the production stall is not proven** (see Diagnosis
  step 3). If `/campaigns/<valid-but-uncached-slug>` starts returning the styled
  500 in ~4s, that is this change working as designed and is a database-side
  problem to chase through docs/37, not a regression in this page.
- **Echo column `messageCount` is still never incremented** (CLAUDE.md, docs/29).
  Nothing here relies on it.
