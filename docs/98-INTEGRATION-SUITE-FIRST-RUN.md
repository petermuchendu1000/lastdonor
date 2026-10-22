# 98 — The integration suite ran for the first time, and raced itself

**Date:** 2026-10-22
**Trigger:** owner asked for the `TEST_DATABASE_URL` secret to be set, so that
integration and E2E would stop skipping (`docs/97` §4).
**Status:** integration is **green and wired into CI with no secret at all**.
Resolves `docs/97` §4 for integration.

---

## 1. The request could not be done as asked, and should not have been

Two blockers, both checked rather than assumed:

| Blocker | Evidence |
|---|---|
| No database credential exists in this sandbox | nothing matching `DATABASE\|POSTGRES\|SUPABASE\|PG*` is set in the environment |
| The secrets API is unreachable from here | `GET /repos/.../actions/secrets` → **403**, `"Access to this GitHub Actions path is not permitted through this proxy."` |

So there was no value to set and no way to set it. But the more important
point is the third one: **the only connection string this project has is
production**, and `TEST_DATABASE_URL` is consumed by a job that runs
`npm run db:migrate` and then an integration suite whose every file calls
`clearDatabase()` in `beforeEach`.

Pointing that secret at production would have truncated the live database —
on a platform that has taken real money (`docs/92`). That is not a risk to be
careful about; it is a thing that must be impossible.

---

## 2. What was done instead: the job brings its own Postgres

`integration-tests` now runs a `postgres:16` **service container** and
addresses it with a literal URL. `TEST_DATABASE_URL` is no longer referenced
by that job at all.

```yaml
services:
  postgres:
    image: postgres:16
    env: { POSTGRES_USER: postgres, POSTGRES_PASSWORD: postgres, POSTGRES_DB: lastdonor_test }
    ports: ['5432:5432']
    options: >-
      --health-cmd pg_isready --health-interval 10s
      --health-timeout 5s --health-retries 10
env:
  DATABASE_URL: postgresql://postgres:postgres@localhost:5432/lastdonor_test
```

Better than supplying the secret on every axis that matters:

- **Nothing to leak or rotate.** The credential is `postgres:postgres` against
  a database that lives for about two minutes inside the job's own network
  namespace and holds nothing.
- **A clean database per run.** A shared test database accumulates state, and
  §3 shows what this suite does when state is shared.
- **It cannot point at production.** There is no connection string to get
  wrong.
- **No owner action.** The thing being waited on stops existing.

The health check is not decoration: without it the job races the container and
`db:migrate` fails with `ECONNREFUSED` on a cold runner.

`-U postgres -d lastdonor_test` on that check is also deliberate. A bare
`pg_isready` connects as the container's OS user — `root` — for which no
Postgres role exists, so run 6's service-container log carried
`FATAL: role "root" does not exist` once every ten seconds for the life of the
job. The check still *passed*, because a FATAL reply proves the server is up
and that is all `pg_isready` asks, so this was purely cosmetic. It is fixed
anyway: a FATAL in the logs of a healthy run is the first thing someone
debugging a genuine failure would chase.

### Verified on a real runner, not only locally

Run 6 (`39762742194`, dispatched on `main` 2026-10-22). `integration-tests`
**ran** — it did not skip — and passed:

```
Test Files  11 passed (11)
Tests       83 passed (83)
Duration    15.90s
```

Job wall clock 80s, of which the suite is 16s and the rest is `npm ci` plus
container start. The whole run was green: `config`, `lint-and-typecheck`,
`unit-tests`, `security-audit`, `build`, `integration-tests`, `ci-complete`,
with `e2e-tests` skipped per §5.

The service container's own log is the better proof that the new assertions in
§4 are not vacuous — Postgres is visibly doing the rejecting:

```
ERROR:  new row for relation "donations" violates check constraint "donations_amount_check"
DETAIL:  Failing row contains (…, pi_nonpositive_0, 0, Zero, zero@test.com, …)
DETAIL:  Failing row contains (…, pi_nonpositive_-1, -1, …)
```

alongside the expected `users_email_unique`, `campaigns_slug_unique` and
`newsletter_subscribers_email_unique` violations from the tests that assert
uniqueness. Those lines are the suite working, not failing.

### Verified before wiring it up

Against a real Postgres 16.15 started locally, not reasoned about:

| Check | Result |
|---|---|
| `gen_random_uuid()` with no extension installed | **works** — it is in core from Postgres 13, and the probe DB had only `plpgsql` |
| `npm run db:migrate` against plain Postgres | **exit 0**, baseline applied |
| Suite on three consecutive freshly-migrated databases | **83/83, 83/83, 83/83** |
| Variables the suite actually needs | **`DATABASE_URL` only** — run with `NEXTAUTH_SECRET`, both Supabase variables and both Stripe keys unset: 83/83 |

That first row was the one real risk in using plain Postgres instead of
Supabase: the baseline uses `gen_random_uuid()` in 20+ places and issues no
`CREATE EXTENSION` anywhere. Had it needed `pgcrypto`, the service container
would have failed on every run. It does not.

One harmless `NOTICE` during migration, recorded so nobody mistakes it for a
problem later:

```
identifier "payhero_payment_requests_share_link_id_campaign_share_links_id_fk"
will be truncated to "payhero_payment_requests_share_link_id_campaign_share_links_id_"
```

Postgres truncates identifiers at 63 bytes. The constraint is created; only
its name is shortened.

---

## 3. The finding: the suite raced itself, so no result it gave meant anything

This is the part worth keeping. The suite had **never been executed** —
anywhere, by anyone (`docs/50`). On first run it did not merely fail; it
failed *differently every time*.

Measured locally, same code, same machine:

| Run | Database | Result |
|---|---|---|
| A | fresh, migrated | **50 failed** / 32 passed |
| B | A's database, not reset | **18 failed** / 64 passed |
| C | fresh, migrated | **23 failed** / 59 passed |
| D | fresh, migrated, **serial** | **1 failed** / 81 passed |
| E | fresh, migrated, **serial** | **1 failed** / 81 passed |

**A and C start from identical conditions and differ by 27 tests.** That is
the whole argument. The suite was not order-dependent on leftover rows — it
raced itself *within* a run, so a red result carried no information and a
green one would have carried none either.

### Cause

Vitest parallelises test *files* by default. There is one database. And every
integration file opens with:

```ts
beforeEach(async () => { await clearDatabase(); });
```

So file 2 truncates the tables while file 1 is mid-test. The symptom is not a
clean assertion failure, which is why it reads as chaos:

```
PostgresError: insert or update on table "campaigns" violates foreign key
constraint "campaigns_creator_id_users_id_fk"
```

— a test inserting a campaign whose fixture user a sibling file had just
deleted underneath it.

### Fix

`fileParallelism: false` and `sequence: { concurrent: false }` in
`vitest.config.integration.ts`. That turned **49 of the 50 failures into
passes** and left exactly one real finding (§4).

The suite was *written* for serial execution — `clearDatabase()` in
`beforeEach` only makes sense that way — and was never run, so nobody
discovered that the config did not actually serialise it. The intent was
there; the configuration never matched it.

**Do not remove those two lines to speed the suite up.** The whole run takes
about 20 seconds. If parallelism is ever genuinely wanted, the prerequisite
is a database per worker (Vitest exposes `VITEST_POOL_ID`), not a shared one.

---

## 4. The one real failure was a stale test, about money

After serialising, exactly one test failed, reproducibly:

```
FAIL  donations.integration.test.ts > enforces minimum donation amount of
      500 cents via DB check
AssertionError: promise resolved "[]" instead of rejecting
```

It inserted a 499-minor-unit donation and expected the **database** to refuse
it. Which one drifted, the test or the code? The code is right, and the chain
is explicit:

1. `migrations-v2/0000` did create `CHECK ("donations"."amount" >= 500)`.
2. `migrations-v2/0005_low_maddog.sql` **drops it** and replaces it with
   `CHECK ("donations"."amount" > 0)`.
3. The probe database confirms what exists today:
   `donations_amount_check CHECK ((amount > 0))`.
4. `schema.ts` records the reason in a comment above the constraint: *"Was
   `amount >= 500`, a USD-cents literal meaning '$5 minimum'… 500 KES minor
   units is about US$0.04 — so the old constraint imposed a real floor on one
   currency and a meaningless one on the other. The per-currency floor moved
   to `CURRENCIES[code].minDonationMinor`."*

So the floor was deliberately converted from a database guarantee into an
application rule when multi-currency landed (`docs/92`). The test asserted the
old world. It is the project's most common failure mode, again: in the last
audit 7 of 8 failures were stale tests.

**Both halves are now asserted**, because half an assertion is how this came
back:

- `rejects a non-positive donation amount in the DATABASE` — 0 and -1 must
  still be refused. A zero or negative donation would corrupt `raised_amount`
  and no code path is trusted with it.
- `does NOT impose a 500-minor-unit floor in the database` — 499 must be
  *accepted* by the schema. Re-adding the old constraint now fails here
  rather than silently breaking every zero-decimal and low-value currency.

Final state: **83/83 on three consecutive fresh databases** (83 rather than
82 because the one test became two).

---

## 5. ⛔ E2E stays skipped, and a database is NOT what it is missing

The obvious next move after §2 is to give `e2e-tests` the same service
container. **That would turn the job permanently red**, which is worse than
skipped, so it was not done.

The suite was run locally against the same real Postgres with a freshly
migrated schema. Facts:

| Check | Result |
|---|---|
| The harness itself works | `e2e-11-og-meta.spec.ts` → **3 passed (46.9s)**, dev server and Chromium both fine |
| Full `Desktop Chrome` run | **29 failed** before it was stopped early, the cause being unambiguous by then |
| Do the specs seed data? | **No.** Only `donate-button-e2e.spec.ts` touches an API or fixture at all |

The failures cluster in the accessibility and donate-button specs, and
`e2e-02-guest-donate.spec.ts` shows why:

```ts
await page.goto('/campaigns');
const firstCampaign = page.getByRole('link', { name: /donate|view|learn more/i }).first();
await firstCampaign.click();
```

Against an empty database that locator matches nothing and the test times
out. The suite assumes the database **already contains published campaigns**.

And this is not merely an empty-CI-database problem, which is the part worth
keeping: **`docs/79` moved every campaign to `under_review`, so `/campaigns`
is empty in production too.** These specs assert a state the product no
longer has by default. They would fail against production as surely as
against a fresh container — they have simply never been run anywhere to find
out (`docs/50`).

So the blocker is **fixtures, not credentials**. Enabling E2E needs a seed
that publishes a known campaign and tears it down afterwards: a scoped piece
of work, not a config change. Until it exists the job stays gated on the
absent secret — which is also why the `config` job is still there — and the
workflow carries a comment saying so, because the natural "fix" of adding the
secret would produce 29 red tests.

## 5a. Also still not covered

- **The `push` trigger still produces no run** (`docs/97` §1a). Integration
  being green in CI means green *when dispatched*. It is a real gate only
  once a push creates a run.
- **`TEST_DATABASE_URL` is still referenced by `build` and `e2e-tests`.** In
  `build` it is empty and harmless — the build was proven to succeed with
  nothing set (`docs/97` §5.4).

---

## 6. Rejected

**Setting `TEST_DATABASE_URL` to the production connection string.** Refused
outright, and recorded here so it is never proposed as a shortcut: the job
that consumes it runs `db:migrate` and then a suite that truncates every table
before each test. It would destroy the production database of a platform
holding real donations.

**Asking the owner for a throwaway Supabase project.** It would have worked,
and it was the obvious reading of the request. Rejected because it leaves a
long-lived credential in repository secrets, shares state between runs, and
keeps a human in the loop for something a container does better — and because
"the owner must do a thing first" is what had kept this suite dark since the
project began.

**Making the suite parallel-safe with a database per worker.** The correct
long-term answer and genuinely better: `VITEST_POOL_ID` could key a schema per
worker. Rejected for now because the suite takes 20 seconds serially, so the
work buys nothing today, and because the first thing this suite needed was to
be *trustworthy*, not fast. Serialising is the smaller change and it made the
result deterministic, which is the property that was missing.

**Leaving the `config` job's `has-db` probe in place for integration.** It now
gates nothing for that job, since the database always exists. The job itself
stays for `e2e-tests` and because it still documents a real Actions
constraint — `secrets` is unreadable from a job-level `if:` — which
`src/ci-workflows.ratchet.test.ts` enforces.
