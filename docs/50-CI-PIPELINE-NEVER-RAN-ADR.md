# 50 — The CI pipeline has never run, and what was wrong with it

Decided 2026-10-16.

**`CLAUDE.md` states: "CI runs lint → typecheck → unit → security audit →
integration → build → E2E". That pipeline has never executed, not once.**

---

## 1. Evidence

Queried 2026-10-16 against the GitHub REST API:

| Check | Result |
|---|---|
| `GET /actions/workflows` | 1 workflow, `CI`, `state: active`, created 2026-07-01 |
| `GET /actions/runs?per_page=5` | **`total_count: 0`** — all workflows, all branches, all history |
| `GET /commits/main` | `e6db638`, the commit pushed during this session |
| `GET /commits/main/check-suites` | **1 suite, `app: claude`** — and no GitHub Actions suite |
| `GET /repos/...` | `private:false fork:false archived:false disabled:false`, admin permission held |

A workflow that fails still *runs* and still records a run. Zero runs across
the repository's whole history, with a check suite present from a different
app for the same commit, means **GitHub Actions never triggered at all**:
Actions is disabled at the repository level.

**This cannot be fixed from a Claude Code session.** Both
`GET` and `PUT /repos/petermuchendu1000/lastdonor/actions/permissions` return
`403 Access to this GitHub Actions path is not permitted through this proxy`.
The owner must enable it at
`https://github.com/petermuchendu1000/lastdonor/settings/actions`.

---

## 2. The pipeline would still not have worked

Enabling Actions alone would not have produced a green build. Four defects,
each verified locally.

### 2.1 A Jest flag in a Vitest command — fatal to five of seven jobs

```yaml
run: npx vitest run --testPathPattern=test/security
```

`--testPathPattern` is **Jest**. Vitest exits immediately:

```
CACError: Unknown option `--testPathPattern`
```

`security-audit` therefore failed on every run, and `integration-tests`,
`build` and `e2e-tests` each depended on it transitively, so **the pipeline
could never reach any of them**. The positional form is correct and passes
**2800 tests in 12s**.

### 2.2 `drizzle-kit push` contradicts docs/34

`integration-tests` ran `npx drizzle-kit push`, which diffs the live schema
and applies whatever it infers. `docs/34` settled that this project applies
**one validated baseline** from `migrations-v2` through the migrator. Changed
to `npm run db:migrate` so CI and production use the same mechanism.

### 2.3 Every DB-backed job fails red when secrets are absent

`integration-tests`, `build` and `e2e-tests` read `TEST_DATABASE_URL` and the
Stripe test keys. On a repository where those have never been set, the jobs
fail rather than skip, so enabling Actions would have produced a permanently
red pipeline and trained everyone to ignore it.

Added a `config` job that reports secret availability as an output, because
the `secrets` context cannot be read from a job-level `if`. Without a test
database the DB-backed jobs now **skip with a warning annotation** and the
rest of the pipeline is green and useful immediately.

### 2.4 E2E never ran a mobile project

`playwright.config.ts` defines four projects, two of them mobile
(`Mobile Safari` / iPhone 14, `Mobile Chrome` / Pixel 7). CI ran
`--project="Desktop Chrome"` only. Most of this product's traffic is phones
and the recent layout work is mobile-specific (docs/48, docs/49), so E2E is
now a `fail-fast: false` matrix over Desktop Chrome **and** Mobile Chrome.

---

## 3. Also changed

- **`workflow_dispatch`** added, so the pipeline can be triggered by hand or
  by automation. It previously could not be.
- **`lint-and-typecheck`, `unit-tests` and `security-audit` now run in
  parallel.** They were a serial chain despite being independent, so a lint
  error delayed the unit result by a whole job.
- **A `ci-complete` gate job** that treats `success` and `skipped` as passing
  and anything else as failing. This gives `main` one required status to
  protect with, instead of a branch rule that must name every job and that
  would go green if a job were skipped.

---

## 4. Not verified

**None of this has been observed running.** Actions is disabled, so the
workflow could not be executed even once from here. What was verified is
local and specific:

- `npx vitest run test/security` → 2800 passed.
- `node scripts/audit-middleware-coverage.mjs` → exit 0.
- `node scripts/security-audit-p9-12.mjs` → exit 0.
- `npm run lint`, `npx tsc --noEmit`, `npm run test:unit` (5181) → pass.
- `npm run build` → succeeds, 118 static pages.
- The workflow YAML parses, and its job graph is as intended.

**Unverified:** the `config` job's output gating, the `ci-complete` result
aggregation, the matrix E2E, and `npm run db:migrate` against a real test
database. These are ordinary Actions patterns, but they are written, not
observed. **The first real run should be watched, not trusted.**

---

## 5. Correction to `CLAUDE.md`

Its Commands section says `npm run test:unit` runs **3977** tests. The real
count is **5181** (2800 of which are the security canaries). Also corrected
in `docs/47`.

---

## Amendment, 2026-10-21 — still zero runs, five days and two pushes later

This doc fixed four defects that "would have kept it red" but never verified
that a run actually happened. **It still has not.** Re-queried immediately
after pushing `4e4a21a` to `main` (a 62-file, 9-commit merge — exactly the
kind of change CI exists for):

| Check | Result |
|---|---|
| `GET /actions/workflows` | 1 workflow, `CI`, **`state: active`** |
| `GET /actions/runs?per_page=10` | **`total_count: 0`** — still all workflows, all branches, all history |
| `GET /commits/main` | `4e4a21a`, pushed 2026-10-21, confirmed by `638105e..4e4a21a main -> main` |
| `GET /commits/4e4a21a/check-runs` | **`total_count: 0`** |

So the workflow is registered and active, the push reached GitHub, and nothing
ran. Fixing the YAML was necessary and insufficient: whatever stops Actions
firing is **not in the repository**, which is why five days of commits did not
surface it.

**What could not be checked from here.** `GET /repos/.../actions/permissions`
is blocked by this session's proxy
(`"Access to this GitHub Actions path is not permitted through this proxy"`),
so the one setting that would explain it is unreadable. The remaining
candidates are all account- or repo-level and all owner-only: Actions disabled
for the repository (Settings → Actions → General → "Allow all actions"), or
disabled/limited at the account level, or a spending/billing limit with no
minutes available.

### Why this matters more than it did on 2026-10-16

`CLAUDE.md` still tells every contributor that "CI runs lint → typecheck →
unit → security audit → integration → build → E2E", and that claim is false.
Two consequences, both live:

1. **The only gate that ran on the `docs/92` payment work was local** — lint,
   typecheck, 6,236 unit tests and a production build, all run by hand in the
   session. The integration suite and the E2E suite **did not run at all**,
   because both need a database over raw TCP and this sandbox's
   TLS-inspecting proxy cannot carry the Postgres protocol (`docs/92`).
2. So a change to the money path reached production having never been through
   the integration or E2E suites, by anyone or anything. That is not a
   judgement about the change; it is the honest state of the gate.

**This is an owner action and it is the highest-value one outstanding.** A
pipeline that is configured, documented, relied upon in writing, and has never
executed is worse than no pipeline, because people reason as though it ran.

---

## Amendment 2, 2026-10-21 — run 1 exists. There were TWO blockers, and the second is owner-only

CI has now produced **run 1**, the first workflow run in this repository's
history (`run_number: 1`, id `39563731420`, event `workflow_dispatch`, head
`4604cae`). It failed. Both facts are progress, and the reasons are worth
separating carefully, because amendment 1 above drew a conclusion that was
half wrong.

### Blocker 1 (in the repository, fixed): the workflow did not parse

`ci-complete` contained:

```yaml
results='${{ join(needs.*.result, " ") }}'
```

GitHub Actions expressions accept **only single-quoted** string literals.
Dispatching the workflow returned, verbatim:

```
failed to parse workflow: (Line: 181, Col: 14): Unexpected symbol: '"'.
Located at position 22 within expression: join(needs.*.result, " ")
```

**Verified.** A workflow that fails to parse is never queued, so it emits no
run, no check run and no annotation — which is precisely the signature
amendment 1 recorded and could not explain. The failure mode of a fatal error
and the failure mode of nothing happening are indistinguishable from outside.

Why five days of local checks missed it: **the YAML was always valid.** A YAML
parser reads that line as an ordinary string. It is GitHub's *expression*
parser — a second language nested inside the YAML — that rejects it, and that
parser does not run until a dispatch reaches GitHub. Fixed by one character
class; see blocker 1's ratchet below.

### Blocker 2 (NOT in the repository, still open): the account is locked

With the parse fixed, the dispatch answered "Workflow run has been queued" and
run 1 appeared. All four jobs with no `needs` then failed in **three seconds**,
with `runner_id: 0`, `runner_name: ""`, and no step logs at all (the log
download 404s). The dependent jobs skipped.

The reason, quoted verbatim from the check-run annotation:

> `The job was not started because your account is locked due to a billing issue.`

**Verified.** Read from
`GET /repos/petermuchendu1000/lastdonor/check-runs/{id}/annotations` — a
**repository-scoped** path, and therefore one this session *can* reach.

Note what this corrects methodologically. Amendment 1 said the answer was
unreadable because `GET /actions/permissions` and the account billing endpoints
are blocked by the session proxy — still true, both re-confirmed 403 today. But
the answer was never actually behind those endpoints. It was in an annotation
hanging off a run, on a path that was always permitted. It could not be read
only because **no run existed to hang it on**. Fixing blocker 1 is what made
blocker 2 legible.

This is also not a minutes overage: the repository is **public**
(`"visibility": "public"`, verified), where GitHub-hosted Actions minutes are
free and unlimited. A billing lock suspends Actions regardless of repository
visibility.

### Which blocker caused the zero-run history? Unresolved, and both are sufficient

It is tempting to say the parse error caused the four-year silence. The honest
position is that **this cannot be separated from here**, and the doc should not
claim it:

| Claim | Status |
|---|---|
| The pre-fix workflow genuinely did not parse | **Verified** (quoted error, with line and column) |
| The account is locked for billing, and that stopped run 1's jobs | **Verified** (quoted annotation) |
| Pushing a commit whose workflow parses to `main` creates **no run** | **Verified twice** — `4604cae` and later `2455285`. After both pushes the repository still held only manually dispatched runs. |
| The billing lock is what suppresses push-triggered run *creation* | **Assumed**, now on two observations rather than one. It remains the only candidate consistent with the row above, since both pushed commits contain the fix and the repo-level setting is "Allow all actions" (owner screenshot). Still not confirmed from GitHub's side. |
| When the lock began | **Unknown.** No repo-scoped endpoint carries it. |

### Raising the spending budget does not clear it

Tested directly on 2026-10-21: the owner raised the Actions budget to 100 and
run 2 was dispatched immediately after. Its jobs failed in three seconds with
no runner, carrying the **identical** annotation, word for word:

> `The job was not started because your account is locked due to a billing issue.`

**Verified.** That null result is worth more than it looks, because it
separates two states that are easy to conflate. GitHub words a cap problem
differently — *"recent account payments have failed or your spending limit
needs to be increased"*. A **lock** is not a cap, so raising the cap cannot
lift it; what is required is settling the payment. The account billing and
invoice endpoints are blocked by this session's proxy, so which invoice is
outstanding **cannot be read from here**.

### Correction to this amendment's own wording

Above, this doc said the failure is "not a minutes overage". That was too
strong, and the owner's metered-usage page (2026-10-21) shows why: the account
has consumed **2,000 of 2,000 included Actions minutes** and carries **$50.00
billable** ($66.81 consumed less $16.81 discounts), resetting in 11 days.

What survives the correction is the part that governs *this* repository.
`lastdonor` is public; GitHub's own note on that page states discounts cover
Actions usage in public repositories, and `lastdonor` does not appear among the
five repositories carrying the spend (`invest254` $44.15, `CEBUPAY` $12.20,
`elopis` $4.80, `handshakeai_oline` $3.95, `invest254-platform-template`
$1.70 — all private). So the account-level pool is genuinely exhausted, while
CI on this repository should still cost nothing once the lock is lifted.

That distinction matters for the decision this doc exists to support: turning
this pipeline on does not add to that bill.

So both defects were real and each is independently sufficient to produce
"zero runs". Fixing the YAML was necessary; amendment 1's "whatever blocks it
is **not** in the repository" was wrong about blocker 1 and right about
blocker 2.

### The owner action

**Unlock the account's billing.** Nothing in this repository can affect it, and
no further engineering will make CI run until it is done:
GitHub → Settings → **Billing and licensing** → resolve the payment or raise
the spending limit. Then re-run the pipeline (Actions → CI → Run workflow, or
just push) and read run 2.

Until then the whole of §3 above still holds exactly as written: the integration
and E2E suites gate nothing, and `CLAUDE.md`'s pipeline description remains a
statement about configuration, not about anything that has run.

### Two changes made while here

**1. The runner image is pinned.** Run 1's annotations also carried GitHub's own
notice: *"The ubuntu-latest label will migrate to Ubuntu 26 beginning October
19, 2026"* — i.e. it is migrating now. All eight jobs now say `ubuntu-24.04`,
which is what the floating label meant up to this point. A pipeline that has
never been green should not absorb an OS bump on its first run: a failure then
could be the code or the image, with no green baseline to tell them apart. Bump
it deliberately once a run has passed.

The label is written out in each job rather than hoisted into the top-level
`env:` block, because **`runs-on` cannot read the `env` context** (only
`github`, `needs`, `strategy`, `matrix`, `vars`, `inputs`). `${{ env.X }}` there
resolves to empty and invalidates the job — the same class of defect as blocker
1, and equally invisible locally. This was caught while making the change, not
after.

**2. A ratchet for the nested language.** `src/ci-workflows.ratchet.test.ts`
encodes the Actions-expression rules that no YAML parser can see, and runs in
the unit suite — the gate that actually executes. Four rules, each a defect this
project hit or came one edit away from hitting:

| Rule | Why it is fatal |
|---|---|
| No `"` inside `${{ }}` | Blocker 1. Workflow never queues. |
| No `env.` in `runs-on` | Context unavailable; job invalid. |
| No `secrets.` in a job-level `if:` | Evaluates false and skips **silently** — the §2.3 failure mode, and the reason the `config` job exists. |
| No `needs:` on a job that does not exist | Invalidates the whole workflow. |

Each rule was proven by injecting the defect into `ci.yml` and confirming that
rule — and only that rule — fails, then restoring the file byte-identical. A
ratchet that has not been seen to fail is not known to ratchet. It deliberately
is not a general Actions validator; `actionlint` would be, but it is a Go binary
and is not installed in this environment.
