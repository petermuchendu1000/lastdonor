# 107 — `/admin/reports` answered 500 on every load, and the drizzle trap behind it

**Date:** 2026-10-25
**Status:** FIXED. Not yet deployed (the owner deploys — `docs/96`).
**Read before:** writing any `sql` template that compares a timestamp column
against a value, or extending `src/lib/public-chrome.ts`.

---

## 1. What was wrong

`/admin/reports` — "Financial Reports", linked from the admin sidebar — threw
on every request. Not slowly, not for some data, not for some admins: every
load, deterministically, with an empty table or a full one.

**[VERIFIED 2026-10-25]** Reproduced against a freshly migrated Postgres 16 by
running the page's three batched queries in isolation. Two succeeded; the
third threw before Postgres was ever asked anything:

```
[OK]   monthlyRevenue: []
[FAIL] periods: ERR_INVALID_ARG_TYPE
       The "string" argument must be of type string or an instance of
       Buffer or ArrayBuffer. Received an instance of Date
[OK]   topCampaigns: []
[OK]   categoryRevenue: []
```

**[UNKNOWN] how long it had been broken.** The defect is present in the oldest
commit this working clone contains (`38cacbd`, 2026-10-18) and in every commit
since, but the clone is **shallow** (65 commits, `clone_depth` 50), so
`git log --diff-filter=A` naming that commit as the file's creation is an
artifact of the boundary, not a fact. It is at least seven days; it may be
much longer. Do not quote a figure from this clone.

---

## 2. The cause, and why it is worth a numbered doc

The page built its period aggregates as an inline `sql` template:

```ts
ytdTotal: sql<number>`coalesce(sum(${donations.amount}) FILTER (
  WHERE ${donations.createdAt} >= ${startOfYear} AND ... ), 0)::int`
```

`startOfYear` is a JS `Date`.

A typed builder — `gte(donations.createdAt, startOfYear)` — knows **which
column** the value is compared against, so it encodes the `Date` with that
column's own `mapToDriverValue`. A `sql` template has no such information:
drizzle wraps the value as a parameter with **no encoder**, and it reaches
postgres-js as a live `Date` object, which the driver cannot serialise. The
`TypeError` comes from Node's string machinery inside the driver, which is why
it does not read like a SQL error at all.

This is the second member of a family (`docs/101` is the first): **a `sql`
template silently discards information the typed builders carry, and the loss
is invisible until the statement actually runs.**

| | `docs/101` | here |
|---|---|---|
| What is lost | the table qualifier on a Column | the column's value encoder |
| Symptom | `WHERE "campaign_id" = "id"` — valid SQL, always false | `TypeError` inside the driver |
| Visible to typecheck | no | no |
| Visible to a unit test | no | no |
| Visible to a text/grep ratchet | no | no |
| Caught by | running it against real Postgres | running it against real Postgres |

The transferable rule, and it is now mechanically enforced:

> ⛔ A value interpolated into a `sql` template must be a Column, another `SQL`
> fragment, or wrapped in **`sql.param(value, column)`** so the column's
> encoder is used. Or step out of the template and use `gte` / `lte` /
> `between`, which carry it for you.

---

## 3. Both candidate fixes were tested, on data, against a reference

Two fixes are available. Both were run against a real Postgres seeded with
rows on **both sides** of the month boundary and the year boundary, plus a
seed donation and a refunded donation, and compared against *two* independent
expectations: the typed-builder queries the consolidation had replaced, and a
figure computed by hand.

```
[REPRODUCED] current query throws: ... Received an instance of Date
[A sql.param]   ok: {"ytdTotal":5200,"mtdTotal":4000}
[B toISOString] ok: {"ytdTotal":5200,"mtdTotal":4000}
[REFERENCE gte()]   ytd=5200 mtd=4000
[EXPECTED by hand]  ytd=5200 mtd=4000
[COMPARE A] MATCHES reference
[COMPARE B] MATCHES reference
```

**`sql.param(value, column)` was taken** over `.toISOString()`. Both work
today; only one keeps the column as the source of truth about its own
encoding. `.toISOString()` hard-codes an assumption about what a `timestamptz`
parameter will accept, which is the kind of assumption that is correct until
the column type changes underneath it.

### Rejected: leave the five queries unconsolidated

Reverting to five separate `gte()` queries would also have fixed it, and would
have reintroduced the `docs/87` fan-out the consolidation existed to remove —
five concurrent queries from one entry point against a `max: 5` pool. The
consolidation was right; only the parameter binding was wrong.

---

## 4. Two checks, both proven by injection

A fix with no check is a fix that comes back. Neither of these existed, which
is the whole reason a page could 500 for a week in a repository with 6,855
unit tests, a CI pipeline and nine ratchets.

### 4.1 `src/lib/report-periods.integration.test.ts` — runs the real query

The query is now a module (`src/lib/report-periods.ts`) rather than inline
page code, for one reason: **so a test can execute it**. Six tests against a
real Postgres cover the boundaries with rows on both sides, seed exclusion,
refund routing, and the zero state.

Injection: putting the bare `Date` back fails **all six**.

```
× executes against Postgres and returns zeros on an empty table
× puts each donation in the periods its date belongs to
× includes a donation exactly on the boundary and excludes the one before it
× never reports seed money as revenue
× moves a refunded donation out of revenue and into the refund figure
× reads the boundary from the instant it is given, not from the clock
```

The first of those is the cheapest assertion in the file and the one that
would have caught this: *the query executes.* The other five exist because a
query that runs and silently reports zero is the `docs/101` defect, and these
figures are quoted to people as revenue.

### 4.2 `src/db/sql-template-dates.ratchet.test.ts` — catches the next one

A grep cannot do this job. `${since}` is fine when `since` is a string and
fatal when it is a `Date`, and the two read identically — so the ratchet
builds a real TypeScript program and asks the **checker** for the type of
every interpolated expression in every `sql` template in `src/`.

That costs about 8 seconds (measured: 7.6s to build the program over 1,084
root files, 116ms to walk 657,924 nodes). That is the price of a check that
can actually fail.

It carries a vacuity guard — `templatesScanned > 250` — because a type-driven
check that quietly stopped finding the templates would pass for the worst
possible reason. There were **282 interpolating `sql` templates** in `src/`
when this was written (403 counting those with no `${}` at all, which cannot
carry a `Date`).

Injection, with the real defect restored in the real file:

```
× finds no Date-typed interpolation anywhere in src/
  src/lib/report-periods.ts:92  ${startOfYear}  is Date
  src/lib/report-periods.ts:93  ${startOfYear}  is Date
  src/lib/report-periods.ts:94  ${startOfYear}  is Date
```

It reports file, line, the expression and the type, and names the fix.

---

## 5. A falsification pass: is this defect anywhere else?

Asked properly, because "I fixed the one I was shown" is not an answer.

The same type-driven sweep over **all 282** interpolating `sql` templates in
`src/` found exactly **six** `Date`-typed interpolations, all six in
`/admin/reports/page.tsx`. A name-based grep additionally surfaced
`src/lib/blog/analytics-tracker.ts:102,113`, which looked like the same
pattern and **is not**: it calls `.toISOString()` first. (It also has no
callers at all, which is a separate matter and not touched here.)

So the defect was confined to one page — and is now impossible to reintroduce
anywhere without failing the build.

---

## 6. While in there: the organiser dashboard had the marketing footer too

`docs/106` §10a took the public footer off `/admin` with
`src/lib/public-chrome.ts`. `/dashboard` has exactly the same problem and was
missed: it is signed-in, it has its own navigation shell (`DashboardShell`),
and it was carrying the newsletter signup and the four-column marketing footer
below it.

`PRIVATE_PREFIXES` is now `['/admin', '/dashboard']`. Everything else about
the mechanism is unchanged, and the reasons it is built this way still hold:

- ⛔ **Do not branch on `headers()` in the root layout** to do this. A dynamic
  API there opts every route out of static rendering — measured in `docs/106`,
  the build is 181 dynamic / 32 static / 3 ISR, and all 35 would have gone
  dynamic to hide a footer.
- ⛔ **The navbar stays ungated.** Neither sidebar has a sign-out, so the
  navbar is the only way out of either tool.
- The predicate is **anchored**. `startsWith('/dashboard')` would also match a
  future `/dashboards` marketing page, exactly as `startsWith('/admin')`
  matches `/administrator`. Both cases are tested.
- It **fails toward showing**: an unreadable pathname keeps the footer, because
  showing one where it is not wanted is cosmetic and hiding it everywhere
  strips the site's navigation, legal links and unsubscribe route.

---

## 7. What this changes about trusting a green pipeline

Nothing about CI was broken. Lint passed, typecheck passed, 6,855 unit tests
passed, the fan-out ratchet passed. The page still 500'd on every load, and it
is reached from the admin sidebar, so it was not an obscure corner.

The gap is specific and worth naming: **no admin page's data query is executed
by any test.** The integration suite covers API routes (`docs/98`), the E2E
suite covers public pages and has no signed-in admin fixture (`docs/99` — ten
tests skipped for exactly that reason), and the unit suite cannot reach a
server component's database call at all. An admin screen's query is checked by
reading it.

That is the hole this doc leaves open, deliberately and visibly. The two
checks added here close it for `/admin/reports` only. The cheap general fix is
an admin sign-in fixture for the E2E suite, which would also un-skip the ten
tests `docs/99` lists.
