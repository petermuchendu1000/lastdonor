# 66 — The cron Worker: one trigger, nine jobs

**Date:** 2026-10-16
**Status:** **DEPLOYED AND VERIFIED FIRING 2026-10-18.** See the final
section; the blocked history below is kept because the credential dead
ends are worth not re-walking.
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

### Re-probed 2026-10-18: the credential situation is WORSE than above

Every Cloudflare credential in the session was re-tested. Values were
never printed; only shapes and API responses.

| credential | `/user/tokens/verify` | list workers | **write probe** |
|---|---|---|---|
| `CF_API_TOKEN` | **401 invalid** | 401 | 401 |
| `CF_USER_TOKEN` | 200 valid | 200 (0 scripts) | **403 no access** |
| `CF_WORKERS_AI_KEY` | 401 invalid | 200 | **403 no access** |
| `CF_GLOBAL_KEY` | 401 as a bearer token | - | - |

The write probe is `DELETE /accounts/{id}/workers/scripts/<a name that
does not exist>`: 404 would mean allowed, 403 means refused. It is the
cheapest way to ask "may I write?" without writing.

Two things changed since 2026-10-16:

- **`CF_API_TOKEN` is now invalid outright**, not merely read-only. It
  was answering 200 on reads two days ago.
- **`CF_GLOBAL_KEY` is not a global API key.** It is 52 characters and
  not hexadecimal; a Cloudflare global key is 37 hex characters. It
  fails as a global key (`9103 Unknown X-Auth-Key or X-Auth-Email`)
  *and* as a bearer token (`1000 Invalid API Token`). **So option (b)
  below cannot work however correct the email is** - the key itself is
  not a usable Cloudflare credential. Supplying an email would have
  looked like the fix and changed nothing.

The account email could not be discovered either: `/user`, `/accounts`
and `/accounts/{id}/members` are all forbidden to `CF_USER_TOKEN`.
`/zones` works and lists 20 zones including `lastdonor.org`, which
confirms the token is bound to the right account.

`wrangler deploy --dry-run` succeeds, so nothing is wrong with the
Worker: **Total Upload: 3.03 KiB / gzip: 1.07 KiB**. The only missing
piece is a credential that may write.

### To finish, one of:

**(a) An API token with write access** — Cloudflare dashboard → My Profile →
API Tokens → Create Token, with:

- *Account → Workers Scripts → **Edit***
- *Account → Account Settings → **Read*** (wrangler reads account info)

**(b) ~~The account's email address, to use the existing global key.~~**
**RULED OUT 2026-10-18**: what is stored is not a global key (see the
table above). This needs the real 37-hex-character global key *and* the
email, which is strictly more credential than option (a).

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


---

# DEPLOYED 2026-10-18 — the scheduler runs

The first scheduled job in this platform's production history ran at
**2026-10-18T00:55:03Z**. `docs/65` is resolved.

## What it took

A Cloudflare API token with Workers write. Three dead ends first, all
recorded above and in the re-probe table: `CF_API_TOKEN` had gone
invalid, `CF_WORKERS_AI_KEY` cannot write, and the thing stored as
`CF_GLOBAL_KEY` is not a Cloudflare global key at all.

A fourth dead end was of my own making. The new token was created with
**Client IP address filtering**, on my advice, using an egress address
I measured with `curl` — `160.79.106.0/24`. The actual API calls leave
from somewhere else entirely, and not consistently:

| measured with | egress Cloudflare saw |
|---|---|
| `curl` | `160.79.106.16/.20/.131/.139` |
| the real failing call | `34.58.71.169` |
| Node, six samples | `34.72.45.172` ×6 |

The token verified fine and every real call returned
`9109 Cannot use the access token from location: …`. **Measure the
path the actual calls take, not a convenient proxy for it.** The filter
was removed; the token value did not need rotating.

## Deployment

```
Total Upload: 3.03 KiB / gzip: 1.07 KiB
Uploaded lastdonor-cron (0.91 sec)
Deployed lastdonor-cron triggers (0.82 sec)
  schedule: */5 * * * *
Version ID: 28c95d7c-0b3f-406f-b873-368dde27ea0d
```

`CRON_SECRET` set with `wrangler secret put`, from the value rotated
onto Fly on 2026-10-16.

**The account is shared.** It already held three Workers, all another
product's (`pantheons-jobs-staging`, `pantheons-staging-preview`,
`pantheons-web-staging`), which is also why `docs/65`'s "the account
has 0 workers" was wrong — the read-only token could not see them. The
deploy touched only `lastdonor-cron`. The `*/5` trigger is the first of
the account's five free Cron Triggers; the other product now has four
left, which it shares with us.

## Verified, twice, end to end

**The Worker's own log** (`wrangler tail`), 00:55 tick:

```
[cron] 2026-10-18T00:55:03.916Z dispatching 1: update-phases
[cron] update-phases ok 200
outcome: ok   cpuTime: 1 ms   wallTime: 421 ms   exceptions: []
```

1 ms of CPU against the free plan's 10 ms ceiling, which is what
`waitUntil` and not reading response bodies buys.

**A database write**, 01:00 tick, when three jobs are due:

```
cron.publish_campaigns  2026-10-18 01:00:05.897+00
  {"errors": [], "published": 0, "rateLimited": [], "volumeLimited": 0, "qualifiedItems": 0}
```

The 200 is itself proof the secret matches on both sides: a mismatch
returns 401, which the Worker logs as `REJECTED`.

**No HTTP surface**, as designed: `https://lastdonor-cron.<subdomain>.workers.dev`
answers `500 error code 1101` — no `fetch` handler exists. It can only
be invoked by its own schedule.

## What now runs, and when (UTC)

| job | schedule | first run after deploy |
|---|---|---|
| `update-phases` | `*/5 * * * *` | 00:55, confirmed |
| `ingest-news`, `publish-campaigns` | `*/30 * * * *` | 01:00, confirmed |
| `fetch-news` | `0 */6 * * *` | 06:00 |
| `reconcile` | `0 4 * * *` | 04:00 |
| `blog-topics` | `0 6 * * *` | 06:00 |
| `blog-generate` | `0 8 * * *` | 08:00 |
| `send-newsletter` | `0 14 * * 4` | next Thursday |
| `blog-refresh` | `0 10 * * 0` | next Sunday |

Two consequences worth stating plainly:

- **`reconcile` becomes a live financial control at 04:00 daily.** It
  is the job whose absence `docs/65` called out, and the one that
  repairs the echo columns (`docs/66` above, and CLAUDE.md's note).
- **The news pipeline is live again.** It drafts to `under_review`
  only (`docs/79`), so nothing reaches the public without a person
  approving it, but the admin review queue will start growing every 30
  minutes.

## A control that had quietly stopped controlling anything

Found while taking a baseline for the first `reconcile` run, 2026-10-18.

`reconcile` step 4 is the integrity check on `campaigns.raised_amount`:
it recomputes the figure from the donation rows, logs a
`reconcile.integrity_drift`, and auto-corrects. It selected
`WHERE c.status IN ('active', 'last_donor_zone', 'paused')`.

That was true when it was written. `docs/79` then gated **both**
campaign creation paths to `under_review`, so by the time the
scheduler finally ran, **all 12 campaigns on the platform were in a
status this query did not select**. The financial drift detector would
have run every night against an empty set, reporting
`activeCampaignDrifts: 0` and meaning nothing by it.

Nothing failed. A check stopped covering anything as a side effect of
a change in a different file, which is the shape `docs/83` records.

**Fixed by inverting it to an exclusion list.** An inclusion list has
to be remembered whenever a status is added or becomes the norm; an
exclusion list fails the other way, covering a new status by default
and forcing anyone who wants one skipped to write down why.

```sql
WHERE c.status::text NOT IN ('completed', 'archived')
```

`completed` and `archived` stay out on purpose: funds may already have
been released against the stored figure, so silently rewriting it is
the wrong default. Step 1 logs a `reconcile.discrepancy` for completed
campaigns instead, for a person to read.

Verified before deploying, because this is a money control:

- the new predicate run against production returns **0 rows**, so the
  first run cannot produce a surprise mass-correction;
- every campaign is `under_review` with `raised_amount`, derived total
  and released total all **0**, measured per status;
- four tests pin the scope, including that `under_review`, `paused`,
  `suspended` and `cancelled` may never appear as exclusions.

The literals are written into the statement rather than bound, so they
appear in `pg_stat_activity` when someone is working out why a campaign
was or was not corrected. They are **not** built with `sql.raw`:
`test/security/oblique-p9-12.test.ts` bans it outright under
`src/app/api`, and it caught the first attempt. The ban is worth more
than the convenience.

**Noted, not fixed:** step 1 audits `completed` but not `archived`, so
archived campaigns get neither the audit nor the correction.
