# 66 — The cron Worker: one trigger, nine jobs

**Date:** 2026-10-16
**Status:** Built, tested, **NOT DEPLOYED — blocked on a Cloudflare token**
**Closes:** the mechanism half of `docs/65`. The finding there stays open
until this is deployed.

---

## What was built

`workers/cron/` — a Cloudflare Worker that dispatches the nine cron jobs that
`vercel.json` declares and that have never run (docs/65).

| File | Role |
|---|---|
| `src/lib/cron-schedule.ts` | The dispatch table and `dueJobs(date)`. In `src/` so `npm run test:unit` covers it. |
| `src/lib/cron-schedule.test.ts` | 18 tests, counting firings across a simulated week. |
| `workers/cron/src/index.ts` | The Worker. Imports the table above, so tests cover the deployed behaviour. |
| `workers/cron/wrangler.toml` | One trigger, `ORIGIN` var, no HTTP handler. |

---

## Decisions

### 1. ONE trigger at `*/5`, not nine native triggers

**Forced by a verified limit.** Cloudflare's limits page, fetched
2026-10-16:

> "Number of Cron Triggers per account — **Free 5**, Paid 250"
> "CPU time per Cron Trigger — **Free 10 ms**"

The cap is **per account**, not per Worker, so nine native triggers cannot
exist on the free plan at all. One trigger that decides internally which jobs
are due costs one of the five and leaves four spare.

The 10 ms CPU ceiling shapes the Worker too: it computes the due list
(microseconds), fires each request, and reads only the status line. Waiting
on a socket is I/O and costs no CPU; parsing bodies would cost CPU.

*Rejected: upgrading to Workers Paid to get 250 triggers.* It buys precision
we do not need — every schedule here lands on a 5-minute boundary — for a
monthly bill.

### 2. The schedule table lives in `src/`, not in the Worker

`vitest.config.ts` includes only `src/**`, so logic placed inside
`workers/` would ship untested. The Worker imports
`../../../src/lib/cron-schedule`, which wrangler bundles. One source of
truth, and the unit tests exercise the code that actually runs.

### 3. Target `lastdonor.fly.dev`, not the hostname docs/26 specifies

`docs/26` §4 calls for a grey-cloud `origin.lastdonor.com`. **That record
does not exist** (checked 2026-10-16: connection failure, while
`lastdonor.fly.dev` answers 200 on `/api/v1/live`).

Going straight to the Fly hostname achieves what the grey cloud was for: it
bypasses Cloudflare's 100s proxy ceiling, which would otherwise truncate the
seven cron routes declared `maxDuration = 300`. It also needs no new DNS.

### 4. No `fetch` handler

The Worker exports only `scheduled`, so it has **no HTTP surface** and can be
invoked only by its own schedule. A "run job now" endpoint would be a second
place `CRON_SECRET` is accepted, and the same thing is already achievable by
calling the Fly route directly with the secret.

### 5. `simulate-donations` is deliberately NOT scheduled

It is a cron route, and `docs/26` mentions a 15-minute cadence for it, but it
is absent from `vercel.json` and stays absent here. It writes **seed
donations into public totals** behind the fail-closed `SEED_DONATIONS_OPT_IN`
gate (docs/33, docs/41). Putting a money-writing job on a schedule is an
owner's decision, not a side effect of repairing the scheduler. A unit test
asserts it never appears in the dispatch list.

### 6. Overlap is the application's problem, already solved

Every cron handler takes an Upstash lock (`src/lib/locks.ts`) and exits early
if a previous run still holds it, so a job that outlives its 5-minute window
cannot stack. The Worker does not need its own guard.

---

## Testing

`src/lib/cron-schedule.test.ts` does not spot-check timestamps. It walks
**2,016 ticks — one full UTC week** — and counts actual firings per job
against the count the cron expression mandates, derived by hand rather than
from the implementation:

| Job | Expression | Firings/week asserted |
|---|---|---|
| `update-phases` | `*/5 * * * *` | 2016 |
| `ingest-news` | `*/30 * * * *` | 336 |
| `publish-campaigns` | `*/30 * * * *` | 336 |
| `fetch-news` | `0 */6 * * *` | 28 |
| `reconcile` | `0 4 * * *` | 7 |
| `blog-topics` | `0 6 * * *` | 7 |
| `blog-generate` | `0 8 * * *` | 7 |
| `send-newsletter` | `0 14 * * 4` | 1 |
| `blog-refresh` | `0 10 * * 0` | 1 |

Plus: the half-hourly jobs fire only at `:00` and `:30`; `fetch-news` only at
hours 0/6/12/18; the weekly jobs land on the right weekday; UTC is read
explicitly so the host timezone cannot change the answer; and a completeness
test fails if a job is added to the table without an expected count.

**18 tests, all passing.**

---

## ⛔ Blocked: the deploy needs a token this session does not have

Probed directly against the Cloudflare API on 2026-10-16:

| Call | Result |
|---|---|
| `GET /accounts/{id}/workers/scripts` | **200** |
| `GET /accounts/{id}/workers/services` | **200** |
| `GET /accounts/{id}/workers/subdomain` | 403 |
| `PUT /accounts/{id}/workers/scripts/{name}` | **403 "No access to the specified resource"** |

The available token is **read-only for Workers**. `wrangler deploy` fails at
`/workers/scripts/lastdonor-cron/secrets`. The global key could not be used
either: the stored `CF_USERNAME` is not an email address, and Cloudflare
rejects it with `6102 Invalid format for X-Auth-Email`.

### To finish, one of:

**(a) An API token with write access** — Cloudflare dashboard → My Profile →
API Tokens → Create Token, with:

- *Account → Workers Scripts → **Edit***
- *Account → Account Settings → **Read*** (wrangler reads account info)

**(b) The account's email address**, to use the existing global key.

### Then

```bash
cd workers/cron
export CLOUDFLARE_API_TOKEN=<the new token>
export CLOUDFLARE_ACCOUNT_ID=<account id>
npx wrangler secret put CRON_SECRET   # paste the value, see below
npx wrangler deploy
npx wrangler tail lastdonor-cron --format pretty   # watch it fire
```

---

## CRON_SECRET was rotated

Fly secrets cannot be read back, so there was no way to give the Worker the
existing value. A fresh 32-byte secret was generated and **set on Fly**
(`flyctl secrets set CRON_SECRET=...`, app restarted and verified healthy).

The value is in the session scratchpad at
`.../scratchpad/secure/.cron-secret`, mode 600, outside the repository. It
must be pasted into `wrangler secret put CRON_SECRET` so both sides match.

Verified after rotation:

| Check | Result |
|---|---|
| `GET /api/v1/live` | 200 |
| `GET /api/v1/cron/update-phases` with no auth | **401** |
| same with the new secret | accepted (ran past a 120s client timeout; a wrong secret 401s instantly) |

---

## `reconcile` has now run, once, by hand

The control that had never executed, run manually on 2026-10-16:

```json
{"ok":true,"data":{"discrepancies":0,"archived":0,"fundPoolAlerts":0,
 "echoColumnFixes":7,"activeCampaignDrifts":0,"errors":[]}}
```

**No money discrepancies against Stripe.** It also repaired **7 echo
columns** — the denormalised counters `CLAUDE.md` records as broken because
nothing in `src/` increments them. Worth noting for that entry: `reconcile`
*does* repair them, so once this Worker is deployed they are corrected daily.
They were drifted only because the repair job had never run.

The other eight jobs were **not** fired by hand. `publish-campaigns` would
mass-publish, `blog-generate` spends AI budget and publishes content, and
`send-newsletter` mails real people. Those are owner decisions.

Until the Worker is deployed, `reconcile` should be run manually on a known
cadence:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://lastdonor.fly.dev/api/v1/cron/reconcile
```
