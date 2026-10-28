# 138 — The settings screen claimed more than the system did

**Date:** 2026-10-28
**Status:** fixed, not deployed at time of writing (owner deploys — `docs/96`)
**Sub-journey:** admin journey, part 10 of 10 (SETTINGS / OPERATIONS)

---

## 1. The surface

`/admin/settings` is the operator's control panel: platform settings, API
credentials, and a read-only view of the cron schedule. Four API routes sit
behind it — `settings`, `settings/environment`, `settings/security-question`,
`settings/verify-security`.

**What was sound, verified rather than assumed:**

- All four routes gate on `requireRole(['admin'])`, and the page itself
  redirects on `session.user.role !== 'admin'` (`page.tsx:26-29`) — so
  `docs/132`'s rule holds here, and the group is correctly `adminOnly`.
- `crypto.server.ts` encrypts with AES-256-GCM, mints an HMAC step-up token
  with a 5-minute TTL, compares with `timingSafeEqual`, and **refuses to reuse
  `NEXTAUTH_SECRET`** as the encryption key (`:72`).
- `verify-security` throttles the step-up answer at 5 attempts per 15 minutes.
  ⚠️ It is the in-memory `recordFailedAttempt` CLAUDE.md already distinguishes
  from `docs/126`'s — and unlike that one it is **not** a lost-update: there is
  no `await` between its read and its write, so the `docs/126` class does not
  apply. It is per process, which is per platform while Fly runs one machine
  [VERIFIED: v122, 1 machine, region `arn`]; it weakens if that is scaled.
- The page issues 3 queries, inside the `docs/87` cap of three.

Four findings below. **All are latent, not live** — [VERIFIED in production]
`site_settings` holds **0** `env.%` rows, and `audit_logs` holds **0**
`env_key.updated` and **0** `settings.updated` rows. Nobody has ever saved an
env key or a platform setting through this screen.

---

## 2. S-001 — the credential screen stored secrets that nothing read

"Environment Configuration" lets an admin paste a new API credential behind a
security-question step-up. It encrypts the value into `site_settings` as
`env.<KEY>` — and **nothing reads it**.

[VERIFIED three ways]

1. `resolveEnvVar` (`settings.server.ts:25-41`) is the only reader of an
   `env.*` row, and it has exactly **two** references in `src/`: the import at
   `environment/route.ts:7` and the call at `:75` — inside the **GET that
   draws this very screen**. The value's only consumer is the badge about
   itself.
2. The actual consumers take the process environment directly:
   `stripe.ts:7` is `new Stripe(process.env.STRIPE_SECRET_KEY!)`,
   `resend.ts:7` is `new Resend(process.env.RESEND_API_KEY)`.
3. Nothing copies a database value into the process environment at boot —
   there is no `process.env[...] =` assignment anywhere in `src/`.

The badge nevertheless rendered **"Custom"** in a `default` (primary) variant,
which reads as *this is the value the platform is using*, and the PATCH
answered `"Updated N environment key(s)"`.

⛔ **The consequence that sets the severity.** `docs/72` is an open blocker:
`STRIPE_SECRET_KEY` on Fly is a `sk_test_…0000` placeholder, so the platform
cannot take a card payment. An owner going to fix exactly that through this
screen would have pasted the live key, watched the badge go green, read
"Updated", and believed it fixed — while `create-checkout` kept 503ing.

### 2.1 Why the fix is the label, not the wiring

The obvious fix is to make the consumers read `resolveEnvVar`. ⛔ **Not taken,
deliberately.** That changes where a payment gateway and a mail provider get
their credentials, turns a process-environment read into a database read on a
money path, and introduces a decryption failure mode into client construction.
That is a Gate-8 decision for the owner, not a side effect of an audit.

So the screen now says what is true:

- badge: `Saved · not in use`, in a `secondary` variant;
- an amber notice above the grid: *"A key saved here is stored encrypted, but
  the running app does not read it yet: services still take their credentials
  from the environment they were deployed with. To change what the platform
  actually uses, set the value on the host and redeploy."*;
- the PATCH response says `Saved`, and that the running app still uses the
  values it was deployed with.

⚠️ **Rule 1 of the test is written to AUTO-RELAX**: it demands the honest label
only while `realConsumersOfStoredEnv()` — a glob of `src/` for a
`resolveEnvVar(` call outside the settings routes — comes back empty. Wire a
consumer and the rule steps aside and instead flags the now-stale "not in use"
copy. A check must never stand between somebody and the real fix.

---

## 3. S-002 — the most sensitive write in the product recorded an actor IP the
actor chose

Both settings routes wrote `audit_logs.actor_ip` from the raw header:

```ts
actorIp: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null
```

The **left-most** `x-forwarded-for` entry is whatever the caller typed.
`docs/105` is entirely about this: `lastdonor.fly.dev` and
`origin.lastdonor.org` reach the origin directly and will forever, so that
prefix is attacker-chosen, and `getClientIp` exists to take the hop our own
infrastructure appended instead.

[VERIFIED] 8 route call sites in `src/` already used `getClientIp(request.headers)`;
these two were the only ones that set `actorIp` and did not. Both now use it.

⚠️ Latent: 0 `settings.updated` rows exist, so no recorded actor IP is wrong
today. It is the audit trail on credential changes and platform settings, which
is the row somebody reads when something has gone wrong.

---

## 4. S-003 — no test under the settings routes

`src/app/api/v1/admin/settings/` had **zero** test files. `settings-claims.test.ts`
is the first, and it is a claims ratchet rather than a route test: it reads the
panel and the routes and fails the build when the screen overstates what the
system does.

---

## 5. S-004 — the operations screen showed a schedule that does not run

Found while reading `page.tsx` for the gate. `src/app/admin/settings/page.tsx:15-23`
hardcoded **a third cron list**, matching neither the real one nor the file its
own caption named.

| | jobs | source |
|---|---|---|
| real — bundled into the Worker at `wrangler deploy` time | **12** | `src/lib/cron-schedule.ts` `CRON_JOBS` |
| `vercel.json` — inert on Fly, `docs/65` | 9 | the file the caption named |
| **the settings page** | **7** | hand-written, matched neither |

[VERIFIED three ways: the real table printed from `CRON_JOBS`; the route
directories on disk; a row-by-row diff.]

- 6 rows correct.
- **6 real jobs omitted**: `refresh-fx-rates`, `screen-documents`,
  `verification-reminders`, `blog-topics`, `blog-generate`, `blog-refresh`.
- 1 row, **`Process Donations`** on a fifteen-minute cadence, was in **neither**
  other list. No such route exists among the 14 on disk, and that cadence
  appears nowhere else in the repository.

⛔ **And it is worse than a stale label.** `PipelineMonitor.tsx:605` maps
`cron.simulate_donations` → the label `'Process Donations'`. So that row is the
**seed-donation job this project deliberately does not schedule** — excluded
from `CRON_JOBS` with a written reason (`docs/33`, `docs/41`, `docs/66`), and
verified inert four ways only yesterday (`docs/136`) — presented to the
operator with a hardcoded, unconditional **`<Badge>Active</Badge>`**.

Meanwhile the caption read *"Cron schedules are defined in vercel.json and
managed via deployment configuration."* `vercel.json` has never scheduled
anything in this platform's life; that is the whole of `docs/65`.

### 5.1 The falsifiers both held, and sharpened it

- *"The page just mirrors `vercel.json`."* **Refuted.** `vercel.json` lists 9
  jobs, and not the same 9 — it has the three blog jobs the page omits and does
  not have `Process Donations`. The overlap of the two lists is 6. The page's
  list is independent of both.
- *"`process-donations` is a real route under another name."* **Refuted** — 14
  cron route directories on disk, none of them that.
- *"Admin-only, read-only, cosmetic."* **Refuted by precedent and by use.**
  `docs/136` §7 is the same class: one prose string on `/admin/simulation`
  telling the operator the Worker had never been deployed, in a module whose
  own header says *"a hardcoded 'this does not work yet' banner becomes a lie
  the day it starts working"* — and it misdirected at the worst possible
  moment. This is the sibling screen, telling the operator the schedule is
  something else entirely.

### 5.2 The fix

`src/lib/cron-schedule-display.ts` derives the rows from `CRON_JOBS`,
title-casing the slug for a label. A new job appears with nothing to remember,
and `simulate-donations` is absent for free — which is the point of deriving.
The caption names the Worker and `src/lib/cron-schedule.ts`, and the two-deploy
ordering. The badge says **`Scheduled`**.

⚠️ **It lives in its own module, not in `cron-schedule.ts`**, because that file
is bundled into the Cloudflare Worker and runs under a 10 ms CPU ceiling
(`docs/66`). Display code does not belong in that bundle. The Worker is not
touched by this change, so CLAUDE.md's app-then-Worker ordering does not apply.

⛔ **Do NOT turn `Scheduled` into a liveness badge sourced from `audit_logs`.**
That is the signal `docs/136` §10 measured and found unreliable *per job*:
`update-phases` wrote 22 rows against 288 dispatches because it audits only
when it changed something, and `screen-documents` writes nothing when its queue
is empty. A per-row liveness badge on it would print "never ran" against the two
jobs that run most often — recreating §10's open false alarm one row at a time.
`Scheduled` is true by construction: it states what the list *is*. Liveness is
readable from the Worker's own observability log (`docs/136` §4.1).

---

## 6. Checks — 9 rules, every injection fires

`src/app/api/v1/admin/settings/settings-claims.test.ts`.

| Injection | Fires |
|---|---|
| the badge reads `'Custom'` again | rule 1 |
| the consequence notice deleted | rule 2 |
| raw `x-forwarded-for` back in `settings/route.ts` | rules 3 + 4 |
| raw `x-forwarded-for` back in `environment/route.ts` | rules 3 + 4 |
| **CONTROL** `actorIp` removed from the audit row entirely | rule 4 |
| **AUTO-RELAX** a module outside the settings routes calls `resolveEnvVar` | rule 1, inverted |
| **ANTI-VACUITY** a settings route file removed | rules 0 + 4 |
| a hardcoded schedule literal back in `page.tsx` | rules 5 + 8 |
| the derivation truncated to seven | rule 6 |
| `'Process Donations'` re-added to the rows | rule 6 |
| the caption names `vercel.json` again | rule 7 |
| the unconditional `'Active'` badge restored | rule 7 |
| **CONTROL** the rows no longer come from `stats.cronJobs` | rule 8 |

The controls are what make the rest non-vacuous: without rule 4, deleting the
audit row satisfies rule 3; without rule 8, deleting the whole cron section
satisfies rules 5 and 7. Rule 6 derives **both ends** (`cronScheduleRows()`
against `CRON_JOBS`) rather than pinning today's count of twelve, so adding a
job needs no edit here.

⚠️ `git status` was checked after every injection, and the suite re-run, so no
injection measured a polluted tree — `docs/120` §11.1.

### 6.1 ⚠️ The comment trap `cron-schedule.ts` warns about, met in person

Writing these comments broke the build twice: a `/* */` comment **cannot
contain a cron cadence with a slash-star** — the `*/` in `*/15 * * * *` ends
the comment early. `cron-schedule.ts` records this about itself (*"the obvious
spelling of this cadence ends the comment three lines early"*) and I walked
into it anyway, in two files.

⚠️ And it failed in the shape `docs/124` §5.1 names: an esbuild transform error
means vitest **collects nothing**, so the run printed `Tests  no tests` and
**no `×` line at all**. An injection harness that counts `×` lines reads that
as zero failures. The harness greps for `no tests` as well, for that reason.

---

## 7. Reported, NOT fixed — 27 admin routes audit with no actor IP

Found taking the inventory for §3. Of the **35** routes under
`src/app/api/v1/admin/` that insert an `auditLogs` row, **27 have a
`NextRequest` in scope and set no `actorIp` at all** — among them
`fund-pool/allocate`, `fund-pool/disburse`, `refund-batches/[id]`,
`campaigns/[campaignId]/verification` (which writes `total_released_amount` —
`docs/130`), and every campaign status transition.

[VERIFIED in production] the five `simulation.settings_changed` rows all carry
`actor_ip = NULL`. Those are the rows recording the change to
`simulation.max_concurrent` that `docs/116` §8 identified as the accidental
guard holding the unreviewed-publication path shut — so the one audit trail
that mattered most in this codebase's history records no origin.

⛔ **Not fixed here, on proportion and on principle.** It is 27 files across
money, verification and publication routes — a sweep in its own right, not a
fix in passing — and fixing only the one I happened to be reading would leave
26 while creating the appearance of coverage, which is the half-fix
`docs/127` §6 declined for the same reason. A missing IP is also weaker than a
forged one: `NULL` says *unknown*, which is honest.

The fix is one line per route (`actorIp: getClientIp(request.headers)`) plus a
derived rule over the same 35-route discovery used to find them. Recommended as
its own change.

The full list is in the body of this section's measurement and reproducible
with: discover `src/app/api/v1/admin/**/route.ts`, strip comments, keep those
containing `insert(auditLogs)` and `NextRequest`, and report those without
`actorIp`.

---

## 8. Suites

| Suite | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | 1 warning, pre-existing, in `review-gate.test.ts` (untouched) |
| `npm run test:unit` at HEAD | **7751 passed / 16 skipped**, 266 files |
| `npm run test:unit` with this change | **7760 passed / 16 skipped**, 267 files (+9, one new file) |
| `npm run test:integration` | **301 passed**, 31 files |

⚠️ CLAUDE.md recorded `7739 pass … 267 files`; measuring HEAD with the new file
excluded gives **7751 / 266**, so that line was stale in both numbers. Updated.

---

## 9. What was NOT checked

- **The screen in a browser.** The rules read source and execute
  `cronScheduleRows()` for real, but nothing mounted `SystemSettings`, pressed
  **Update** on a key, or completed the security-question step-up against a
  running server. The amber notice, the `Saved · not in use` badge and the
  `Scheduled` badge are verified as source, not as pixels. `docs/121` and
  `docs/119` §9.1 are both cases where looking at a screenshot found what no
  assertion did — this journey did not get that.
- **The settings PATCH round-trip.** No test executes
  `PATCH /api/v1/admin/settings`. Its validation branches (invalid JSON,
  unknown key, wrong type, empty body) are read and look correct, and
  `updateSettings` is covered by `settings.removed-money-keys.integration.test.ts`,
  but the handler itself is not run — `docs/107` §7's standing gap.
- **`security-question` POST and the step-up token end to end.** The crypto is
  read, not exercised; no test mints a token and spends it.
- **Whether the 5 `simulation.settings_changed` rows were the owner's own
  change or an agent session's.** `actor_id` is set; who that is was not
  resolved.
- **The adversarial node graph the prompt defines.** Nodes for page load,
  re-render after save, and the non-admin branches of each of the four routes
  were read rather than executed, and dimensions were not applied node by node.
  This is an audit of four established findings, not a complete traversal.
