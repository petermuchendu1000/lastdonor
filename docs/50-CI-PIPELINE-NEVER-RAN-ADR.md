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
