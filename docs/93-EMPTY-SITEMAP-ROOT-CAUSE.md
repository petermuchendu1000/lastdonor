# 93 — The sitemap shipped empty, and docs/46 blamed the wrong thing

**Date:** 2026-10-19
**Status:** Fixed, deployed, verified from the build log
**Amends:** `docs/46` (its diagnosis of the empty sitemap was incomplete; its
fix bounded the damage without removing the cause)

---

## Symptom

**Verified** 2026-10-19, against the deployed site:

```
$ curl -s https://lastdonor.org/sitemap.xml | grep -c '<url>'
42
$ curl -s https://lastdonor.org/sitemap.xml | grep -o '<loc>[^<]*</loc>' \
    | grep '/campaigns/' | grep -vc '/category/'
0
```

42 URLs: 19 static pages and 23 category pages. **Not one individual campaign
page.**

At the same moment, **verified** against the production database:

```sql
SELECT status, COUNT(*) FROM campaigns GROUP BY status;
-- active         13
-- under_review    4
```

Thirteen live campaigns, none of them in the sitemap. The only pages on the
platform that can accept money were absent from the file Google fetches to
discover them.

This is a direct answer to "why is none of the pages ranked by Google?" — for
the pages that matter, Google was never told they exist.

## Why this was not visible

Three things hid it, and each is individually reasonable:

1. **The build succeeds.** Nothing fails, nothing is red.
2. **`/sitemap.xml` returns 200** with a well-formed, plausible-looking file.
3. **Search Console is verified and reports no error** — the TXT record
   `google-site-verification=vzfr9OWQ5wqrXCbfL1HA1lU5Da2Dc5S_hwXtdRDzcb0`
   resolves (**verified** by DNS query, 2026-10-19). A sitemap that omits URLs
   is not an error; it is a smaller sitemap.

## Root cause

A four-step chain, each step working as designed:

1. **`scripts/deploy.sh --prerender` passes a SESSION-mode `DATABASE_URL`**
   (port 5432). **Verified**: Supabase caps session mode at `pool_size: 15`
   for the whole project.
2. **`next build` pre-renders 24+ database-backed routes across several worker
   processes.** Each worker imports `src/db/index.ts` and opens its own pool at
   `max: 5`. Workers × 5 exceeds 15.
3. **The pool is exhausted.** **Verified** — the build log says so verbatim:

   ```
   [build] database read failed, pre-rendering as empty; the route will render
   on demand once the schema exists: (EMAXCONNSESSION) max clients reached in
   session mode - max clients are limited to pool_size: 15
   ```

4. **`withBuildPhaseFailSoft` swallows it by design** (`src/db/build-phase.ts`),
   so the affected routes pre-render **empty** and the build still passes.

`/sitemap.xml` is one of the casualties. With `export const revalidate = 3600`
the empty render is then served **for up to an hour after every deploy** — and
during a day of frequent deploys, effectively always.

### What docs/46 got right, and what it got wrong

docs/46 found the same symptom on 2026-10-15 and diagnosed it as the sitemap
being a *fully static* route — rendered once at build and frozen forever. It
added `revalidate = 3600`.

That was a real defect and a real fix. But the reason the build-time render was
empty was never established, and the doc attributes it to the first-deploy case
build-phase was written for ("a database read that fails during the build").
The read does not fail because the schema is missing. **It fails because the
build exhausts the session-mode pool**, every time, on a database that is
present and healthy.

So `revalidate` changed "empty forever" into "empty for an hour after each
deploy". The cause survived, and the symptom was still live four days later.

**The lesson:** a fail-soft is a place where defects go to be silent.
`build-phase.ts` is correct and should stay, but anything it swallows needs to
be read, not assumed to be the case it was written for. The warning was in
every build log the whole time.

## The fix

One connection per worker during the build only, in `src/db/index.ts`:

```ts
  max: 5,
  max_lifetime: 60 * 30,
  ...(IS_PRODUCTION_BUILD ? { max: 1 } : {}),
```

A pre-render reads a handful of rows once; it does not need five connections.
Total build connections become one per worker instead of five.

The runtime value is deliberately untouched and still written as the literal
`max: 5`, because `pool-fanout.ratchet.test.ts` asserts that exact text and the
three-concurrent-query budget in docs/87 is derived from it. The spread
override is placed after it so the literal survives for the ratchet and the
build value still wins.

A new assertion in that ratchet pins the override:

```ts
expect(dbIndex).toMatch(/IS_PRODUCTION_BUILD\s*\?\s*\{\s*max:\s*1\s*\}/);
```

This is a line a later cleanup would delete as redundant, and **nothing else
would fail** — the build would still succeed, because failing soft is exactly
what it is designed to do. That is precisely why it needs a test.

## Rejected alternatives

**Point the build at the transaction-mode pooler (port 6543).** Architecturally
the best answer: Supavisor transaction mode handles far more clients, the
driver already sets `prepare: false` for it, and it is what runtime uses. It
was rejected *for now* because **Postgres TCP is not reachable from this
sandbox** (the Supabase Management API is the only database path available
here), so the 6543 URL could not be exercised before shipping. docs/81
establishes that an unexercised provider path is not shipped. Recorded as the
preferred follow-up once it can be probed from the Fly machine itself.

**Remove the build-phase fail-soft so the build fails loudly.** Rejected: it
exists for the genuine first-deploy case where Fly's `release_command` has not
yet created the schema, which is verified in docs/35 §3a / `build-phase.ts`.
Removing it trades a silent defect for an unbootstrappable first deploy.

**Drop `--prerender` and let every route render on demand.** Rejected: it
would make the first request to each of 24 routes pay a cold database read, and
it does not fix the sitemap — it just moves when the emptiness is observed.

**Cap Next's build worker count (`experimental.cpus`).** Rejected as the
primary fix: it slows every build to address a symptom, and the right ceiling
depends on the builder's CPU count, which varies. Kept in reserve if one
connection per worker still exceeds 15 on a larger builder — which the next
build log will show.

**Raise the runtime pool above 5.** Never. docs/87 ties seven production pool
wedges to wide fan-out on this pool, and the three-query cap exists because of
it.

## Verified result

**Measured** on the deploy that carried the fix, 2026-10-19:

| | Before | After |
|---|---|---|
| `database read failed` lines in the build log | 3 | **0** |
| URLs in `/sitemap.xml` | 42 | **55** |
| Individual `/campaigns/<slug>` URLs | **0** | **13** |

Thirteen matches the `active` count in the database exactly. All thirteen were
then fetched individually and **all returned HTTP 200** — submitting URLs that
404 would have been worse than omitting them.

Blog URLs remain 0, and that is **correct, not a second casualty**: `blog_posts`
holds zero rows (**verified** by query, 2026-10-19).

## Trade-off accepted

The build now opens fewer connections and so pre-renders slightly less in
parallel per worker. No measurable build-time cost was observed (the deploy
that verified this is in the same range as the four before it, ~350s). If a
larger builder ever pushes worker count above 15, the same `EMAXCONNSESSION`
line will appear in the log again — which is why the fix is verified by reading
that log rather than by the build's exit code.

## How to check this is still true

Not from the exit code, and not from `/sitemap.xml` returning 200. Both were
green throughout the bug.

```bash
# 1. The build log must contain no fail-soft warnings.
grep -c "database read failed" <deploy log>     # expect 0

# 2. The served sitemap must contain campaign pages.
curl -s https://lastdonor.org/sitemap.xml \
  | grep -o '<loc>[^<]*</loc>' | grep '/campaigns/' | grep -vc '/category/'
# expect this to match the count of active + last_donor_zone + completed
```

Allow for `revalidate = 3600`: immediately after a deploy the previous render
may still be served (`x-nextjs-cache: HIT`).

## Read this before

- Touching `src/db/index.ts` (with docs/37, docs/52, docs/87)
- Touching `src/db/build-phase.ts`, or adding anything that fails soft
- Debugging why a page is missing from search results
- Changing `scripts/deploy.sh --prerender`
