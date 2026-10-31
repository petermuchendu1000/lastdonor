# 166 — An empty page that asked to be indexed

Closes `docs/146` §9.2, which reported this against its own work and recorded
the fix as blocked:

> ⛔ **A finding against my own `docs/145` work, reported not fixed:**
> `/campaigns?page=99` is served **`index, follow`** with a self-referencing
> canonical of `?page=99`, so an out-of-range page is an indexable empty page.
> The right answer is `noindex, follow` when the requested page is beyond the
> end — but `generateMetadata` runs no query and cannot know the total without
> adding one, which is the **fourth concurrent query** `docs/145` §3 declined
> on `docs/87` grounds.

The blocker turned out to be answerable, and the design I reached for first
was wrong in a way only a query log could show.

---

## 1. The defect is real, and WIDER than it was reported

[VERIFIED live on production v171, with `/settings` reading
`noindex, nofollow` as the control that proves the extractor can see a
noindex:]

| URL | status | robots | canonical | cards |
|---|---|---|---|---|
| `/campaigns` | 200 | `index, follow` | `/campaigns` | 8 |
| `/campaigns?page=2` | 200 | **`index, follow`** | **self** | **0** |
| `/campaigns?page=99` | 200 | **`index, follow`** | **self** | **0** |

⚠️ `docs/146` framed this as a crawler probing parameters. Production has
**8** live campaigns against `PAGE_SIZE = 12`, so there is **one** page — and
therefore **every page above 1** was an indexable, self-canonicalising empty
URL, not just an exotic one. A stale link or a single mistyped parameter
reaches it.

## 2. The stated blocker, and why it was answerable

`generateMetadata:43-55` ran no query, and the page's `Promise.all` at `:236`
held exactly **three** — `docs/87`'s cap. A total for the metadata therefore
looked like a fourth.

⚠️ **My first design was to share one `cache()`d count between
`generateMetadata` and the page**, which is the pattern this codebase already
uses: `campaigns/[slug]/page.tsx:152-153` wraps its lookup with a comment
saying *"the lookup is run by both generateMetadata and the page component
during each ISR render. cache() deduplicates to one DB call."*

**The query log refuted it.** With `log_statement = 'all'`, ONE unfiltered
request to `/campaigns`:

```
3 × select count(*) FILTER (WHERE ("campaigns"."status" = …   <- the cached fn
1 × select "id","slug","title",…                              <- rows
   four backends, all within 2 ms
```

A **zero-argument** `cache()`d function executed **three times** — once from
`generateMetadata` and once from each of the page's two call sites, two of
which sit in the *same* `Promise.all` in the *same* render. On the filtered
path it was **4 queries**, over the cap. The design was wrong, and the
falsifier caught it before it shipped.

⚠️ ✅ And `cache()` **does** work on the other page: one request to
`/campaigns/[slug]` shows its campaign lookup **exactly once**. The
discriminator is **[INFERRED]** — that route is ISR and this one is dynamic
(it reads `searchParams`) — and is **[UNKNOWN]** as a mechanism. What is
[VERIFIED] is that it cannot be relied on here, so nothing in the fix depends
on it, and no comment claims it does.

## 3. The fix: one query with three aggregates

`matched` became a **third `count(*) FILTER` over the same scan** as the two
tab counts, and `generateMetadata` reads it through `browseCounts`.

```
             before   after
page body      3        2     (rows + one count query)
generateMetadata 0      1     (its own execution of that count)
TOTAL          3        3
```

⛔ So the fix adds **nothing**: it removes the standalone filtered-count query
and spends the slot on the metadata. [VERIFIED by query log, after:] **3**
campaigns-table queries per request on every path — unfiltered, filtered and
beyond-the-end alike — down from **4** on the filtered path under the cache
design.

⚠️ `count(*) FILTER (WHERE …)` accepts any boolean expression, so a predicate
built from the request is as valid there as a constant one. The old comment
said the filtered count *"keeps its own query because its predicate is built
from the request"* — that was a choice, not a constraint, and this doc
records the correction.

⛔ **The predicate moved rather than being duplicated.**
`src/db/browse-conditions.ts` holds `browseConditions()`, read by the rows
query and the `matched` aggregate. A second filter-building block inside
`generateMetadata` would be two ideas of *"what matches"* — the defect class
`docs/146`, `docs/147`, `docs/164` and `docs/165` are all instances of. It is
in `src/db/` so the integration suite can **execute** it: the same move and
the same reason as `docs/107` (`report-periods.ts`), `docs/126`
(`auth-lockout.ts`) and `docs/130` (`release-amount.ts`).

### 3.1 The judgement is a pure function

`paginationRobots({ total, pageSize, requestedPage })` in
`src/lib/pagination.ts`. ⛔ Not a ternary in `generateMetadata`: that file
imports the database, the FX store and the whole page, so nothing can execute
a condition inside it — and **text cannot see which way a branch points**
(`docs/162` §5.1; `docs/157` §4.1's cure). Injection row 3 inverts it and
fires; against a text rule it would not have.

⚠️ **`follow` is never withdrawn.** Only indexing. The page still carries the
site navigation and, on a real page, `rel="prev"`, and `docs/145` built
crawlable pagination so a crawler could **walk** it. Row 4 injects
`follow: !beyondEnd` and fires.

⛔ **And a REAL page keeps `index`.** The blanket shortcut — *noindex anything
above page 1* — needs no query at all and is what makes this look easy. It
also de-indexes exactly the pages `docs/145` exists to expose. Row 2 injects
it and fires.

## 4. Verified by execution

| URL | robots | cards | |
|---|---|---|---|
| `/campaigns` | `index, follow` | 12 | |
| `?page=1` | `index, follow` | 12 | canonical correctly drops the param |
| **`?page=2`** | **`index, follow`** | **5** | **THE CONTROL — a real page stays indexable** |
| `?page=3` | **`noindex, follow`** | 0 | past the end |
| `?page=99` | **`noindex, follow`** | 0 | |
| `?category=medical` | `index, follow` | 12 | filtered page 1 |
| **`?category=medical&page=9`** | **`noindex, follow`** | 0 | **the total is FILTER-AWARE, not the unfiltered count** |

Against 17 listed campaigns at 12 per page — two real pages. The `?page=2`
row is what a blanket rule would fail, and the filtered row is what a
total taken from the unfiltered count would fail.

## 5. Gate 4 — 11 injections, and two rules of my own were wrong first

| row | injection | expect | result |
|---|---|---|---|
| 0 | baseline | pass | 42 passed |
| 1 | **the real production state** — robots never withdrawn | fire | FIRED |
| 2 | the blanket shortcut — noindex every page above 1 | fire | FIRED |
| 3 | **INVERTED** — real page noindexed, empty one indexed | fire | FIRED |
| 4 | `follow` withdrawn as well as `index` | fire | FIRED |
| 5 | an empty listing de-indexes its own page 1 | fire | FIRED |
| 6 | `generateMetadata` stops asking (`docs/83`'s shape) | fire | FIRED |
| 7 | `generateMetadata` stops reading the total | fire | FIRED |
| 8 | the `matched` aggregate is removed | fire | FIRED |
| 9 | the page body builds a second count (back to 4 queries) | fire | FIRED |
| 10 | **reword a comment** | **pass** | PASSED |
| 11 | **rename a local, keep the behaviour** | **pass** | PASSED |

⚠️ **My caller-count rule was wrong**: it matched `/browseCounts\s*\(/g` and
found **three**, because `async function browseCounts(` matches the same
pattern — the rule was counting the definition as a caller. It counts calls
now (`(?<!function\s)`).

⚠️ **And the first query-count probe reported 0 for everything**, which I
nearly read as "no queries at all". postgres-js uses the **extended
protocol**, so the log line is `execute <unnamed>: select …`, not
`statement: select …`; my pattern matched 5 lines in the whole file. Gate 5
says an anomalous sample voids the measurement — the zero was the probe, and
the raw log is what showed it.

## 6. ⚠️ Six tests failed, and the fixture had drifted, not the assertions

`src/app/campaigns/page.test.tsx` went red on 6 of 22: the header read
`0 of 12 … match these filters` where it asserts `1 of 12`, and the pagination
strip vanished. Cause: that file **mocks drizzle** as a FIFO queue of result
sets, so it encodes the query SHAPE — and the shape changed from
`[rows, tabCounts, count]` to `[rows, counts]`.

The assertions were right about the behaviour; only the fixture was stale, so
`mockDb` was updated and **not one assertion changed**. ⚠️ This is
`docs/124` §5.1's warning in person: a mocked query proves the component
reads what you handed it, nothing about what the database would hand it.

⛔ And `matched` now **defaults to `active`** in that mock, which is fidelity
rather than convenience: with no filter applied the real aggregate reduces to
the listed count, so leaving it 0 would be a result Postgres could never
produce — and a test passing against an impossible fixture proves nothing
(`docs/128` §6).

## 7. Gate

lint 1 pre-existing warning, typecheck clean, unit **8270 passed / 0 failed /
16 skipped** (298 files, +9 tests and +1 file), integration **329 passed / 0
failed** (35 files, unchanged). The fan-out ratchet passes — ⚠️ though it is
an AST check and says nothing about runtime, which is why the query log was
the falsifier and not that test.

## 8. What was NOT checked

- **Not deployed.** Every figure in §4 and §3 is a local production build on a
  seeded lab fixture. Production has 8 campaigns, so `?page=2` there is
  *already* beyond the end — meaning the live effect of this change is that
  `?page=2` and above become `noindex`, which cannot be observed as a
  behaviour difference on a real page until there are more than 12 live
  campaigns.
- **[UNKNOWN] why `cache()` does not dedupe on a dynamic route** while it does
  on an ISR one. The ISR-vs-dynamic difference is [INFERRED] from two
  measurements, not established. What this doc relies on is only that it does
  not work here.
- ⚠️ **`campaigns/[slug]/page.tsx:152`'s comment is NOT re-verified for every
  path.** Its lookup really does run once per request [VERIFIED], but that
  page is ISR; if it ever becomes dynamic, that comment inherits this doc's
  finding.
- **No crawler behaviour is claimed.** The verified statement is mechanical:
  the tag now says `noindex, follow` past the end and `index, follow` on a
  real page. What Google does with either is outside this measurement, and
  `docs/146` §9.2's own guess that it *"would most likely classify it a soft
  404 itself"* is neither confirmed nor needed.
- **`/completed-campaigns` and the category page have no `page` param at all**
  (`docs/165` §1), so they cannot have this defect and were not changed.
