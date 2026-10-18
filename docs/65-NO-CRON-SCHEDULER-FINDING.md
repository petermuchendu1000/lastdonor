# 65 — FINDING: no cron scheduler exists in production

> **RESOLVED 2026-10-18.** The Cloudflare Worker is deployed and the
> first scheduled job in production history ran at 00:55:03Z. See
> `docs/66`. One correction to this document: it states the account
> has 0 Workers. It had three, all another product's - the read-only
> token used here could not see them.

**Date:** 2026-10-16
**Status:** ⛔ **OPEN — not fixed in this change.** Copy corrected; the
infrastructure gap remains.
**Severity:** High. Nine scheduled jobs, including Stripe reconciliation, do
not run at all.

---

## Summary

**Nothing on the cron list has ever run on a schedule in production.** Found
while checking whether the homepage's "Weekly." newsletter promise was
substantiated. It was not, and the reason turned out to be much larger than
the newsletter.

---

## Evidence

Four independent lines, all gathered 2026-10-16.

### 1. The only schedule declaration is inert on our platform

`vercel.json` declares all nine jobs:

```json
{ "path": "/api/v1/cron/send-newsletter", "schedule": "0 14 * * 4" }
```

We deploy to **Fly.io**, not Vercel. `docs/26` line 119 already states this
in as many words:

> "`vercel.json`'s `crons` array is Vercel-only and does nothing on Fly.
> Replace it [with the Cloudflare Worker in §4]."

### 2. The replacement Worker does not exist

`docs/26` §4 specifies a Cloudflare Worker to dispatch the jobs. Queried
against the account with a verified-active token:

```
GET /client/v4/accounts/<id>/workers/scripts  ->  200, count = 0
```

**Zero Workers on the account.** There is also no `wrangler.toml` anywhere in
the repository.

### 3. No other scheduler

- `fly.toml`: no scheduled process, no machine cron. Only the `app` process.
- `.github/workflows/`: no `schedule:` trigger anywhere — and per `docs/50`
  GitHub Actions has never run at all.

### 4. The database agrees

`audit_logs` holds **16 rows in total**, all inside a **four-minute window**
on 2026-10-15:

```
01:12:54  cron.publish_campaigns
01:12:07  cron.publish_campaigns
01:11:26  cron.publish_campaigns
01:10:00  cron.publish_campaigns
   (+ 12 campaign.auto_published rows interleaved)
```

Four `publish_campaigns` invocations one to two minutes apart is a person
hitting the endpoint by hand during the docs/41 remediation. A `*/30 * * * *`
schedule produces evenly spaced entries every thirty minutes, indefinitely.

**The newest audit row is 2026-10-15 01:12.** Expected activity in the ~27
hours since, against observed:

| Job | Schedule | Expected runs | Observed |
|---|---|---|---|
| `update-phases` | `*/5 * * * *` | ~324 | **0** |
| `publish-campaigns` | `*/30 * * * *` | ~54 | **0** |
| `ingest-news` | `*/30 * * * *` | ~54 | **0** |
| `fetch-news` | `0 */6 * * *` | ~4 | **0** |
| `blog-topics` | `0 6 * * *` | 1 | **0** |
| `blog-generate` | `0 8 * * *` | 1 | **0** |
| `reconcile` | `0 4 * * *` | 1 | **0** |
| `blog-refresh` | `0 10 * * 0` | 0–1 | **0** |
| `send-newsletter` | `0 14 * * 4` | — | **0 ever** |

Corroborating state: **0 rows in `blog_posts`**, against two daily blog crons.
**3 rows in `newsletter_subscribers`**, with **0 newsletter audit rows**.

---

## What this breaks

| Job | Consequence of never running |
|---|---|
| `reconcile` | **Stripe reconciliation never happens.** The money-path integrity check docs/41 relies on is dead. |
| `publish-campaigns` | Scheduled campaigns never go live by themselves. |
| `update-phases` | Campaign phases never advance. |
| `send-newsletter` | 3 people subscribed; none has ever received anything. |
| `ingest-news` / `fetch-news` | The news pipeline is inert. |
| `blog-topics` / `blog-generate` / `blog-refresh` | Zero blog posts exist. |

`reconcile` is the one that matters most: it is a financial control.

---

## What was fixed here, and what was not

**Fixed: the false claim.** The homepage newsletter said *"Campaign updates,
impact stories, and ways to help. **Weekly.** No spam."* A weekly cadence
promised to three people who have never received a single send is exactly the
unsubstantiated claim `CLAUDE.md` prohibits. It now reads "New reviewed
campaigns and impact updates, straight to your inbox" — no cadence until one
is real.

**Corrected 2026-10-16, same day:** the first pass fixed only the homepage
instance, which is the one that appeared in the screenshot. Verifying the
deploy against the live HTML showed the claim was still being served, so a
search for the *claim* rather than the instance found five more:

| Location | Was |
|---|---|
| `Footer.tsx` — **every page of the site** | "Weekly impact stories and new campaigns." |
| `/newsletter` visible copy | "Weekly, never daily" |
| `/newsletter` meta description | "Get weekly updates on…" |
| `/newsletter` OpenGraph description | "Weekly updates on…" |
| `/newsletter` OG image subtitle | "Weekly+updates+on…" |

The footer one was the worst: the same unsubstantiated cadence on every page,
not just the homepage. All six are now gone. The lesson is the obvious one —
**grep for the claim, not for the screenshot.**

"No spam" was removed from the homepage card only. It stays on `/newsletter`
and `/register`, where it sits in a list of concrete commitments (one-click
unsubscribe, no data selling) rather than standing alone as filler.

**Not fixed: the scheduler.** Standing up a Cloudflare Worker with nine cron
triggers and the `CRON_SECRET` bearer token is production infrastructure with
its own security surface. It does not belong inside a homepage section pass,
and the owner should decide between the options below.

### Options, with the trade-off

1. **Cloudflare Worker** (what `docs/26` §4 specifies). Free tier covers it;
   crons are declared in `wrangler.toml`; it already fronts the domain.
   Needs the `CRON_SECRET` as a Worker secret.
2. **Fly scheduled machines.** Keeps everything on one platform; costs a
   machine start per job.
3. **GitHub Actions `schedule:`.** Simplest to write, but per `docs/50`
   Actions has never run on this repository and is not yet enabled, and
   scheduled workflows on free runners are throttled and unreliable.

Recommendation: **option 1**, because it is the documented design, the
account already exists, and it is the only one with no per-run cost.

---

## Note on `reconcile`

Until a scheduler exists, reconciliation should be run manually against
production on a known cadence, and the result recorded. A financial control
that silently never executes is worse than one that is known to be manual.
