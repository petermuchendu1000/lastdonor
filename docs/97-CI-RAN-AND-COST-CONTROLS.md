# 97 — CI ran. What it cost, what it caught, and what now bounds it

**Date:** 2026-10-22
**Trigger:** owner settled the GitHub billing charge and asked to make sure
consumption is never that high again.
**Status:** the lock is lifted and CI is executing. Cost controls landed.
⛔ One owner action remains (§7), and the integration and E2E suites are
**still dark** for a new reason (§4).

Supersedes the open blocker in `docs/50` §3 and the correction in `docs/96`
§3. Both were right that it was a lock and not a quota; §1 records which
part of each was wrong.

---

## 1. The lock is gone, and the pipeline is alive

Run 3 (`39750693419`, dispatched 2026-10-22T08:49:53Z) is the first workflow
run in this repository's history to **reach a runner**. Runs 1 and 2 died in
three seconds with no runner assigned, carrying the annotation:

> "The job was not started because your account is locked due to a billing
> issue."

Run 3 was handed five runners (`ubuntu-24.04`, image `20261018.339.1`, Azure
`centralus`) and the `config` job went green in 3 seconds — **the first CI
job this project has ever passed.**

So the diagnosis in `docs/50` amendment 2 holds: it was a payment lock, not
the included-minutes quota, and **settling the payment is what lifted it**.
`docs/96` §3 left that as "assumed, not verified"; it is now verified. The
one thing both documents got wrong is more interesting, and it is in §2.

| Claim | Then | Now |
|---|---|---|
| A lock is not a cap | asserted | **verified** — paying cleared it; raising the budget had not |
| Settling the payment lifts it | assumed | **verified** |
| Waiting ~10 days for the quota reset would not help | asserted | **verified** — the reset has not happened and CI runs anyway |
| `lastdonor` is public, so its minutes are free | verified | still verified (`visibility: public`) |

---

## 1a. ⛔ CI is proven by DISPATCH only. The push trigger has never fired.

Added after merging to `main`, and it qualifies §1 rather than contradicting
it. **Do not read "CI runs" as "CI gates your pushes" yet.**

`main` was fast-forwarded to `ea3d6e8` and pushed at 09:30:40Z. **No
workflow run was created.** Chasing that produced a flat fact:

| Fact | Evidence |
|---|---|
| Every run in repo history is a manual dispatch | 5 runs total, `by event: {'workflow_dispatch': 5}` |
| A `push` or `pull_request` run has **never** existed | same query, no other event present |
| GitHub *did* receive the push | `/events`: `PushEvent`, `main`, `ea3d6e89`, 09:30:40Z, actor `petermuchendu1000` |

So the push was accepted, attributed to the owner's account, and silently
produced nothing.

### What it is not

Ruled out, each by direct check rather than reasoning:

- **Not `paths-ignore`.** The push range `d8814d8..ea3d6e8` changed 12
  files, and **9 are outside both patterns** — `.github/workflows/ci.yml`,
  `package.json`, `package-lock.json`, `scripts/deploy.ps1` and five
  `src/` files. `paths-ignore` skips only when *all* changed files match,
  so it cannot apply under either the whole-range or the head-commit
  reading of the diff.
- **Not a parse error.** A dispatch of the *same* commit (`ea3d6e8`, run 5)
  went fully green. A workflow that does not parse cannot be dispatched
  either.
- **Not the trigger definition.** `push.branches` is `[main, staging]` and
  `main` is the default branch, confirmed from the API.
- **Not the repository.** `visibility: public`, `fork: false`,
  `archived: false`, `disabled: false`, workflow `state: active`.
- **Not the billing lock.** That is gone; run 5 is green.

### What it probably is — marked as inference, not fact

The pushes in this repository are made from an agent session through a
rewritten remote (`url.https://<token>@github.com`), and that token matches
none of GitHub's documented public prefixes (`ghp_`, `gho_`, `ghs_`,
`ghu_`, `github_pat_`), so it could not be classified. GitHub deliberately
**suppresses workflow runs for pushes authenticated as a bot or app**, to
stop a workflow retriggering itself. That fits every observation here, and
it would mean the push trigger is fine and simply never exercised, because
every push this repository has ever received came from an agent.

**This is inference. It cannot be proven from inside the sandbox**, which
is why it is marked rather than asserted.

### ⛔ Owner action: a one-minute test only you can run

From your own machine, push any trivial **code** change to `main` (not a
`.md` file, or `paths-ignore` will correctly skip it) and look at the
Actions tab.

- **A run appears** → the gate works for human pushes, only agent pushes
  are inert, and nothing needs fixing. Note it here and this section can
  be closed.
- **No run appears** → the `push` trigger is genuinely broken and CI gates
  nothing automatically. Start with repository Settings → Actions →
  General, then the account's Actions entitlement.

Until one of those is observed, treat **manual dispatch as the only
confirmed path**, and keep running the local gate before every commit as
CLAUDE.md requires.

### Correction to `docs/50`

`docs/50` amendment 2 noted that pushing the already-fixed commit to `main`
created no run, and offered — explicitly marked as inference — that the
billing lock was suppressing automatic triggers. **That inference is now
unsupported.** The lock is lifted, dispatches run, and a push to `main`
still produces nothing. Whatever suppresses push-triggered runs is a
second, independent cause that was hidden behind the lock, exactly as the
parse error and the lock were two independent causes hiding behind each
other. This repository has now produced three of those in a row, which is
itself the lesson: **one fixed cause is not evidence that there was only
one.**

---

## 2. This repository was never what cost $50

Worth stating plainly, because the instinct after a bill is to go and
optimise the pipeline you can see.

**`lastdonor` is a public repository.** Quoting GitHub's billing
documentation (docs.github.com, Billing → GitHub Actions, read
2026-10-22):

> "GitHub Actions usage is free for self-hosted runners and for public
> repositories that use standard GitHub-hosted runners."

`ubuntu-24.04` is a standard runner, and run 3 used exactly that label. So
this pipeline has cost **$0** and does not appear in the account's spend.

Two caveats on that sentence, both load-bearing:

- The same page adds: *"Larger runners are always charged for, even when
  used by public repositories."* Free is a property of the **runner
  label**, not of the repository alone. §6.3 now ratchets the label.
- The page never says "unlimited". It says free. Treat a runaway as a
  problem even where it is not a charge.

The $50.00 billable came from **five other private repositories**:

| Repository | Spend |
|---|---|
| `invest254` | $44.15 |
| `CEBUPAY` | $12.20 |
| `elopis` | $4.80 |
| `handshakeai_oline` | $3.95 |
| `invest254-platform-template` | $1.70 |

(Figures as reported in the owner's billing view, 2026-10-21. They sum to
$66.80 against a $50.00 billable total, so at least one line is
pre-discount or partly covered by included minutes — the split is the
owner's to read, not this session's. The ranking is what matters.)

None of those is in this session's repository scope, so **nothing in this
commit can reduce that $50.** The controls below are about a different
thing: making sure this repository cannot become one of those lines, and
bounding the worst case rather than the average.

### So why do the work at all

Three reasons, in order of how much they matter:

1. **"Free" is a property of the repository's visibility, not of the
   workflow.** Flipping `lastdonor` to private is one click in a settings
   page, and the day that happens an unbounded pipeline starts metering.
2. **The 360-minute default is a silent six-hour failure**, billed or not.
   It wastes feedback, not just money, and it holds the concurrency slot.
3. **The same controls apply verbatim to the five private repositories.**
   §7 is written so they can be copied there, which is where the money
   actually is.

---

## 3. What one run actually costs, measured

From run 3, which is the only data that exists. Durations are
runner-assigned to completed:

| Job | Duration | Of which `npm ci` | Real work |
|---|---|---|---|
| `config` | **3s** | — | 0s |
| `security-audit` | **53s** | 34s | 5s |
| `lint-and-typecheck` | **97s** | 43s | 44s (lint 15s, tsc 29s) |
| `unit-tests` | **159s** | 37s | 113s (6,303 tests) |
| `ci-complete` | **3s** | — | 0s |
| `build`, `integration-tests`, `e2e-tests` | skipped | — | — |

Two things fall straight out of that table.

**`npm ci` is the dominant repeated cost.** It runs in five jobs today and
seven on a full run (the E2E matrix has two legs), at 34–43s each with
`cache: 'npm'` already working. On `security-audit`, **49 of 53 seconds are
overhead** — the job does five seconds of auditing.

**Per-job rounding is real.** GitHub bills each job rounded up to the
minute, so those five jobs are 8 billed minutes against 5.25 minutes of
wall clock. Many short jobs cost more than few long ones.

Both of those point at consolidation, and §6 explains why it was still the
wrong change to make today.

---

## 4. ⛔ Integration and E2E are still dark — new reason

`docs/50` has said for days that the integration and E2E suites have never
run on any change. **That is still true, and the billing fix did not change
it.** The reason is now different, and visible in the `config` job's log:

```
env:
  TEST_DATABASE_URL:
##[warning]TEST_DATABASE_URL is not set, so integration and E2E will not run.
```

The repository has no `TEST_DATABASE_URL` secret, so `config` emits
`has-db=false` and `integration-tests` and `e2e-tests` skip. They skip
*cleanly* — that is what the `config` job is for, and it worked — but
skipping and running are not the same thing, and `ci-complete` treats
`skipped` as acceptable by design.

**Owner action:** set `TEST_DATABASE_URL` as a repository secret (a
throwaway Supabase project, not production) to turn both suites on. Until
then, this pipeline gates lint, typecheck, unit tests, the security audit
and the build — which is five of eight jobs and a great deal more than the
zero it gated last week, but it is not the whole pipeline CLAUDE.md
describes.

---

## 5. What the first run caught, immediately

CI earned its keep on the first attempt. `unit-tests` went **red** with
three failures that pass on every developer machine:

```
FAIL src/components/ui/money-currency.ratchet.test.ts
TypeError: globSync is not a function
 ❯ moneyCallSites src/components/ui/money-currency.ratchet.test.ts:37:17
```

`6,294 passed | 3 failed | 6 skipped`. Chasing it turned up three separate
defects, each fixed here.

### 5.1 CI was the only place in the project running Node 20

| Where | Node |
|---|---|
| `.nvmrc` | **22** |
| `Dockerfile` (`ARG NODE_IMAGE`) | **22** (`node:22-bookworm-slim`) — build *and* runtime |
| developer machines | **22** (22.22.0 in this session) |
| `.github/workflows/ci.yml` | **20** ← the odd one out |

`fs.globSync` exists only from Node 22, so the test threw in CI and nowhere
else. That is the mild version of this bug. The serious version is the
other direction: **a CI pinned to a runtime production does not use cannot
catch a defect in the runtime production does use.** Every green run was
evidence about a configuration that existed nowhere.

Node 20 was also **end of life on 2026-04-30** — six months ago.
*Verified* against `nodejs/Release`'s own `schedule.json`, fetched
2026-10-22:

| Major | Maintenance from | End |
|---|---|---|
| 20 | 2024-10-22 | **2026-04-30** (EOL) |
| 22 | 2025-10-21 | 2027-04-30 |
| 24 | 2026-10-20 | 2028-04-30 |

CI now runs **22**, matching `.nvmrc`, the Dockerfile and production. Not
24: production is on 22, and this pipeline has one green-ish run to its
name. The same reasoning that pinned the runner to `ubuntu-24.04` instead
of taking the `ubuntu-latest` bump applies — one variable at a time, or a
failure cannot be attributed.

### 5.2 `glob` was used by four files and declared by none

Three files in `test/security/` and the Money ratchet import `globSync`.
`glob` appeared in neither `dependencies` nor `devDependencies`. It was
reachable only as a transitive dependency, four levels down:

```
lastdonor
└── @sentry/nextjs@9.47.1
    └── @sentry/webpack-plugin@3.6.1
        └── @sentry/bundler-plugin-core@3.6.1
            └── glob@9.3.5
```

It resolved because npm hoists, which is luck, not a contract. A Sentry
upgrade that drops or swaps `glob` would have broken the **security-audit
job** — a CI gate — with an error pointing at our test file and no obvious
connection to the dependency that actually moved.

Now declared as `glob: ^9.3.5` in `devDependencies`. The version is
deliberately the one the suites have been running against all along, so
behaviour is unchanged: the lockfile diff shows **0 version changes and 0
removals**. (It added six entries under
`@tailwindcss/oxide-wasm32-wasi`, all `optional: true, inBundle: true`
beneath a parent gated to `cpu: ['wasm32']` — bundled metadata npm had
elided. Nothing installable moved; they cannot install on a linux-x64
runner or in the Docker build.)

The Money ratchet now imports from `glob` too, so the suite has **one**
glob implementation instead of two, and none of it depends on a Node
built-in that is still marked experimental.

### 5.3 Nothing declared the Node floor

No `engines` field existed, so `.nvmrc`, the Dockerfile and a test using a
Node-22-only API all assumed a floor that nothing stated.
`"engines": { "node": ">=22" }` now states it.

### 5.4 The build required runtime credentials, and a test had hidden it

With §5.1–5.3 fixed, run 4 got lint, typecheck, unit tests and the security
audit to green — and then the **`build`** job failed. It had never executed
in CI before, so this is the first time anything had run `next build`
outside a machine that happened to have credentials:

```
Supabase Storage: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set
Error: supabaseUrl is required.
> Build error occurred
[Error: Failed to collect page data for
 /api/v1/admin/verification-documents/[documentId]]
```

`src/lib/supabase-storage.ts` built its client at **module scope**:

```ts
if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('Supabase Storage: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
}
export const supabase = createClient(supabaseUrl ?? '', supabaseServiceKey ?? '', { … });
```

The `?? ''` reads as tolerance for a missing variable and is the exact
opposite: `createClient('')` throws `supabaseUrl is required` (verified
directly against `@supabase/supabase-js`). So the warning printed "not
set", as though execution would continue, and the next statement threw. It
is a two-line function with a misleading diagnostic in front of it.

`next build` imports every route handler to collect page data, so **any
build without Supabase credentials failed entirely** — not the storage
routes, the whole build. A contributor without Supabase credentials could
not build the app at all, and the only reason production works is that Fly
passes the variables. The build was coupled to runtime secrets to compute
page data that does not need storage.

**The part worth remembering is why nobody knew.** Two independent reasons:

1. The `build` job had never run in CI (`docs/50`).
2. **A test had already hit this wall and worked around it.**
   `test/security/verification-document-privacy.test.ts` carries a
   `vi.hoisted` block stubbing both variables, with the comment:
   *"`@supabase/supabase-js` throws from `createClient('')`, so the storage
   module cannot be imported at all without these."*

That comment is an accurate description of a defect, written down, in the
repository, for as long as the test has existed — recorded as a fact to
work around rather than a thing to fix. A workaround that gets a test
passing can keep a build-breaking defect invisible indefinitely. The
workaround is still there and still correct for that file, which genuinely
needs a usable client; it is simply no longer the only thing between this
module and an import failure.

**Fixed** by building the client on first use, reading `process.env` inside
the accessor so the laziness is real, and raising a named
`StorageNotConfiguredError` when a client is genuinely needed and not
configured. Every call site still writes `supabase.storage.from(…)`.

Ordering was preserved deliberately: `getPublicUrl` refuses a private key
**before** it checks credentials. A private storage key must be refused
whether or not storage is configured, or the acceptance criterion in
`docs/31` §1.2 would start answering a different question.

*Verified:*

| Check | Result |
|---|---|
| `npm run build` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` unset | **exit 0**, "Compiled successfully in 37.7s" |
| Module imports with the environment stripped | OK (previously rejected) |
| `getPublicUrl('verification-documents/a.pdf')` | still `PrivateObjectError` |
| `getPublicUrl('avatars/u/a.png')` without credentials | `StorageNotConfiguredError` |
| Credentials set *after* import | client builds and the URL is correct |

Pinned by `src/lib/supabase-storage.lazy.test.ts`, which is the only test
that deliberately imports the module with the environment stripped. Proven
by injection: restoring the eager `createClient` makes **all five** of its
tests fail with `supabaseUrl is required`, and the file restores
byte-identical.

---

## 6. The controls that landed

### 6.1 `timeout-minutes` on every job — the one that matters

**No job declared a timeout**, so every one inherited GitHub's **360-minute
default**. Nine job instances (the E2E matrix has two legs) at 360 minutes
is **3,240 job-minutes** of exposure from a single wedged step — six hours
of silence, then an invoice. This project has already had a step hang on
`npm ci` with `ECONNRESET` (`docs/96`), so it is not hypothetical.

Sized from §3's measurements, with 8–10x headroom on anything measured and
a deliberate over-estimate on anything that has never run:

| Job | Timeout | Basis |
|---|---|---|
| `config` | 5 | measured 3s |
| `lint-and-typecheck` | 15 | measured 97s |
| `unit-tests` | 20 | measured 159s |
| `security-audit` | 15 | measured 53s |
| `integration-tests` | 25 | **not measured** — never run |
| `build` | 30 | **not measured** — a Fly build is ~6 min |
| `e2e-tests` | 30 | **not measured** — never run; **per leg**, so 60 |
| `ci-complete` | 5 | measured 3s |

**Worst case: 3,240 → 175 job-minutes.** An 18.5x reduction in the
unbounded case, and it costs nothing in the normal case.

The point is not to be tight. It is to be **finite**. Tighten the three
estimates once each has a green baseline.

### 6.2 Docs-only changes no longer run the pipeline

`paths-ignore: ['docs/**', '**/*.md']` on `push` and `pull_request`.

**17 of the last 60 commits on `main` touched only docs or markdown — 28%.**
This is a documentation-heavy project by policy (the CLAUDE.md rule that a
decision ships in the same commit as the change guarantees it), so that
ratio is structural, not a fluke of one week.

*Verified safe:* no test in the repository reads a markdown file or the
`docs/` directory. Checked by grepping every `readFileSync`, `readdirSync`,
`existsSync` and `globSync` call in `src/**/*.test.*` and `test/**` for a
`.md` or `docs/` path — nothing matched. The CI ratchets read
`.github/workflows/`, `.nvmrc`, `Dockerfile` and `package.json`, none of
which is markdown.

**⛔ HAZARD, recorded because GitHub does not warn about it.** `main` is
currently **unprotected** (`protected: false`, 2026-10-22). If branch
protection is ever added with `ci-complete` as a *required* check, a
docs-only pull request will produce **no run**, the required check will
never report, and the PR becomes unmergeable with no way to override short
of editing the rule. If protection is added, either drop these filters or
add a no-op twin workflow declaring the same job name. This is written in
the workflow itself as well as here.

`workflow_dispatch` ignores `paths-ignore`, so a hand-dispatched run always
executes — which is what keeps the filters testable.

### 6.3 Ratchets, so none of this can drift back

Consumption rules added to `src/ci-workflows.ratchet.test.ts`:

- every job declares `timeout-minutes`
- no job exceeds **30** minutes
- the whole pipeline, counting matrix legs, stays under **200** job-minutes

And `src/ci-node-version.ratchet.test.ts` (new) asserts a four-way
agreement — `.nvmrc` = `Dockerfile` `ARG NODE_IMAGE` = `package.json`
`engines.node` = every workflow's `NODE_VERSION`, majors only — plus that
the pinned major has not passed its end-of-life date.

Both are **line-based, with no YAML parser**, for a reason worth recording:
the only YAML library resolvable in this tree is `js-yaml`, reachable
solely as an undeclared transitive dependency. Using it would have
reproduced §5.2 inside the very test meant to stop that class of bug.

**Each rule was proven by injection** — the defect was introduced, the run
confirmed that rule and only that rule failing, and the files restored
byte-identical (`cmp` clean). A ratchet that has not been seen to fail is
not known to ratchet.

| Injection | Failed |
|---|---|
| strip `timeout-minutes` from `unit-tests` | `declares timeout-minutes on every job` |
| raise `build` to 90 minutes | `per-job ceiling` **and** `total budget` (205 > 200) |
| put CI back on Node 20 | `Node version agreement` |
| point `.nvmrc` at Node 20 | `agreement` **and** `still supported` |
| delete `engines` from `package.json` | `Node version agreement` |

The two double-failures are honest couplings, not false positives: 90
minutes genuinely breaks both bounds, and an EOL `.nvmrc` genuinely breaks
both agreement and support.

The EOL table is **pinned in the test, not fetched** — a ratchet that
reaches the internet fails when the internet does — and compared against a
fixed `AS_OF` date rather than `new Date()`, so it cannot start failing on
an unrelated pull request merely because time passed. Update the table when
a line expires.

---

## 7. ⛔ Owner actions

**1. Set an Actions budget with "Stop usage when budget limit is reached"
ticked.** This is the only control that cannot be undone by a workflow
edit, and it is the one that actually answers "never should consumption be
that high".

*Verified against docs.github.com, Billing → "Set up budgets", read
2026-10-22.* The thing to get right is that the stop is a **checkbox, not
a side effect of having a budget**:

- A budget **without** that option only emails you when you exceed it.
  Usage continues and so does the charge.
- A budget **with** it stops further metered usage at the limit. GitHub's
  own worked example is a $50 Actions budget with the option enabled:
  once spent, "Members are now blocked from using all GitHub-hosted
  runners until the next billing cycle" or until the budget is raised.

So a budget of **$0 with stop enabled** is the hard floor. Public
repositories on standard runners are free and therefore unmetered, so
`lastdonor` keeps running either way — the budget bites only on the five
private repositories, which is exactly where it should bite.

**Correction to an earlier draft of this document**, which said a budget
only alerts and that a separate "spending limit" is what stops. That was
wrong on both counts: GitHub's billing platform now expresses this as
budgets, and the stop lives inside the budget. The reason the budget
raised to 100 on 2026-10-21 changed nothing is unrelated and was already
in `docs/50`: the account was **locked for non-payment**, and a lock is
not a cap. Raising a cap cannot clear a lock. That is not evidence about
how budgets behave.

**Also, the loophole worth knowing about**: *"Larger runners are always
charged for, even when used by public repositories"* (same source, same
date). "This repository is public, so CI is free" is true only while every
`runs-on` is a **standard** runner. One label edit starts metering, and it
looks like a performance tweak rather than a billing decision — so
`src/ci-workflows.ratchet.test.ts` now fails the build on any runner label
outside a narrow allow-list.

**2. The $50 is in five other repositories, and the fix is the same.**
`invest254` alone is $44.15 of the $50, so start there. Those repositories
are outside this session's scope and nothing in this commit can touch them.

The port is one line per job. In each `.github/workflows/*.yml`, directly
under every `runs-on:`:

```yaml
jobs:
  whatever-the-job-is:
    runs-on: ubuntu-24.04
    timeout-minutes: 20      # <- this line, on EVERY job
```

Pick the number from a recent successful run's duration, roughly 5–10x it,
and keep it under 30. Guessing high is fine; the default of 360 is what is
being fixed, so anything finite is an improvement.

Two companions worth copying at the same time, because they cut *runs*
rather than minutes:

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true   # a new push kills the superseded run
```

`lastdonor` already had this one. A repository without it pays for every
intermediate push in a rapid series, which on an active branch is most of
the bill.

And, where no test reads prose (check first, as §6.2 did):

```yaml
on:
  push:
    paths-ignore: ['docs/**', '**/*.md']
```

A private repository is where all of this actually earns money. Note the
§6.2 hazard applies there too, and private repositories are more likely to
have branch protection — so check whether a required check exists **before**
adding `paths-ignore`.

**3. Set `TEST_DATABASE_URL`** to turn on integration and E2E (§4).

---

## 8. Rejected, with the measurements

### Caching `node_modules` between jobs

The biggest arithmetic win available: six of seven jobs would skip a 34–43s
`npm ci`, worth roughly 3.3 minutes of runner time per run.

Rejected for now. The minutes are **free** (§2), so it buys nothing
financially; it adds a real failure mode — a stale or partially-restored
cache produces a CI failure that looks like a code failure — and it does it
to a pipeline with **one** run of history. The project has 9 packages with
install scripts and 180 platform-gated packages (`sharp`, `esbuild`,
`unrs-resolver`), which is exactly the shape that makes `node_modules`
caching bite. Revisit if the repository goes private, and then measure the
cache hit rate before trusting it.

### Consolidating `lint-and-typecheck` + `unit-tests` + `security-audit`

Also sound arithmetic: one `npm ci` instead of three, and two fewer
per-job roundings — about 3 minutes per run.

Rejected. The workflow's own comment records that these were *deliberately*
split out of a serial chain because "a lint error delayed the unit result by
the whole lint job". Reversing a deliberate decision to save free minutes,
and paying for it in feedback latency, is the wrong trade. Reconsider only
alongside the private-repo question.

### Removing the `config` job

It burns a whole runner for 3 seconds of work and folding its probe into
`lint-and-typecheck` as a job output would work (`integration-tests`
already needs that job; `e2e-tests` would gain it, which it already
requires transitively).

Rejected. It saves one free minute, and it would delete the clearest
in-repo explanation of why the probe exists at all — the `secrets` context
is unreadable from a job-level `if:`, a rule the ratchet's own failure
message points at this job to explain. Churn for $0.

### Running E2E against `next start` instead of `npm run dev`

`playwright.config.ts` starts the **dev** server, so the `build` job's
output is thrown away and every route is compiled on demand, twice (once
per matrix leg), with `retries: 2` on top.

Rejected *for now*, and this one is a genuine improvement being deferred on
principle: the E2E suite has **never executed in CI** (§4). Changing what
it runs against on the same commit that first makes it runnable means a
failure could be the change or the suite, with no baseline to tell them
apart. Get it green first, then switch.

### Bumping `actions/checkout` and `actions/setup-node` to v5

Run 3 ends with:

> Node.js 20 is deprecated. The following actions target Node.js 20 but are
> being forced to run on Node.js 24: `actions/checkout@v4`,
> `actions/setup-node@v4`.

Harmless today — GitHub already forces them onto Node 24 — and unrelated to
the `NODE_VERSION` fix in §5.1, which is the *job's* runtime, not the
actions'. Deferred to keep this commit's variables separate. Worth doing
before the forcing becomes a removal.

### Waiting for the included minutes to reset

`docs/96` §3 already argued this, and it is now settled by observation: the
reset has not happened, the payment was made, and CI runs. A quota reset is
not a payment.
