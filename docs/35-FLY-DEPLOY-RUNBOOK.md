# 35 — Fly.io Deploy Runbook

Prepared 2026-10-14. **Nothing in §3 onward has been executed.** Setup is
complete up to the point of creating infrastructure and writing production
secrets; those steps are deliberately left for the owner to authorise.

Implements `docs/26`. Depends on the baseline in `docs/34`.

---

## 1. Why Fly and not Vercel

Decided by the owner, 2026-10-14: there is no usable Vercel account (and any
existing one carries pending bills). Fly is also the target in `docs/26`, so
this skips the interim Vercel step that was otherwise recommended for a faster
feedback loop.

**Accepted trade-off:** the iteration loop is a deploy per change (minutes),
not a push-to-preview (seconds). There is no preview-per-branch equivalent
configured. If per-change latency becomes the bottleneck, revisit.

---

## 2. State at time of writing — verified

| Item | State |
|---|---|
| Fly token | Valid. Org `personal` (PETER MUCHENDU), 5 existing apps. **No `lastdonor` app yet.** |
| `flyctl` | v0.4.117 installed at `/usr/local/flyctl/bin/flyctl` |
| Database | `vavxdjqufxrsbyohcwdh` (eu-north-1), **empty** — 0 tables. See `docs/33` §1. |
| Schema | One validated baseline, `docs/34`. Applied by `release_command` on first deploy. |
| Storage | Bucket `verification` exists, private, empty. |
| `Dockerfile`, `fly.toml`, `.dockerignore` | Present |
| `output: 'standalone'` | Set (`f31a1ff`) |
| Secrets | 17 prepared in the session scratchpad, **not** in the repo. Staged on Fly 2026-10-14. |

### Verified fly.toml properties

- `primary_region = "arn"` — Stockholm, colocated with the Supabase project in
  eu-north-1. `docs/26` §6: this is the largest single latency decision.
- `auto_stop_machines = "off"` and `min_machines_running = 1` — `docs/26` §7, no
  cold starts on Stripe webhooks.
- Health check `path = "/api/v1/live"`, **never** `/api/v1/health`. The latter
  calls `stripe.balance.retrieve()` and 503s on any dependency failure, so it
  would fail the probe fleet-wide during a Stripe blip and Fly would kill every
  machine (`docs/32` §11, audit R-09).
- `release_command` runs a `release-migrate` wrapper that **hard-fails if
  `MIGRATION_DATABASE_URL` points at port 6543**, and reads `out` back from
  `drizzle.config.ts` through drizzle-kit's own TS loader so the journal check
  cannot drift from the folder drizzle-kit will actually read.

---

## 3. Secrets — 17 values, two of them placeholders

Prepared as a reviewable script in the session scratchpad (chmod 600, outside
the repo, never committed). **Secrets must never enter git.**

**Generated fresh, all distinct, satisfying the key-separation rules in
`validate-secrets.ts`:** `NEXTAUTH_SECRET`, `CRON_SECRET`, `PASSWORD_PEPPER`,
`SETTINGS_ENCRYPTION_KEY`, `NEWSLETTER_UNSUBSCRIBE_SECRET`,
`CAMPAIGN_UNSUBSCRIBE_SECRET`.

**Deliberately NOT secrets** (amended 2026-10-14, was 20 values): the staging
script also set `CLIENT_IP_SOURCE`, `TRUSTED_PROXY_HOPS` and
`NEXT_PUBLIC_APP_URL`. All three were removed. The first two are plain config
that belongs in `fly.toml` `[env]`, and they were being staged with values
*opposite* to the ones in that file — two contradictory sources for one security
control (see `docs/32` §4, and §7 below). `NEXT_PUBLIC_APP_URL` is inlined by the
compiler at build time, so a secret for it is inert and purely misleading; it is
a `[build.args]` entry. Caught before the first deploy, so no release ever
carried them.

**Derived or retrieved:** `DATABASE_URL` (pooler **6543**, transaction mode —
the app sets `prepare: false` for it), `MIGRATION_DATABASE_URL` (**5432**,
session mode, for DDL), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the
anon key (pulled via the Management API), `SUPABASE_PRIVATE_BUCKET=verification`,
`RESEND_API_KEY`.

**Placeholders — the app boots, donations do not work:**
`STRIPE_SECRET_KEY=sk_test_PLACEHOLDER…` and
`STRIPE_WEBHOOK_SECRET=whsec_PLACEHOLDER…`. Both satisfy the regex and length
checks in `validate-secrets.ts`, which is the only reason the app can start
without real keys. **Every page works; `/donate` fails at the Stripe call.**
Replace before any real traffic.

**Not set, with consequences stated:**

| Missing | Consequence |
|---|---|
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Rate limiting falls back to in-memory (works, per-instance). **Cron locks have no backend, so 9 of 10 jobs fail CLOSED and skip** (`docs/32` §9) — deliberate, safe, but means no background activity. `reconcile` still runs. |
| `OPENROUTER_API_KEY` | AI content pipeline inert. |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Google sign-in unavailable; credentials login works. |
| `SENTRY_DSN` | No error tracking. |
| `GNEWS_API_KEY`, `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY` | News ingestion and image resolution inert. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Creator payout webhooks unverifiable. |

---

## 3a. `next build` no longer requires a database — RESOLVED 2026-10-14

**The analysis below was wrong in one decisive way and is kept with its
correction, per `CLAUDE.md` ("update the affected doc rather than adding a
contradicting one").** It said an empty database would let these pages
"pre-render as empty and fill in via `revalidate`". That conflated **empty of
rows** with **empty of tables**. Only the second was true, and a missing
relation *throws* rather than returning no rows:

```
relation "blog_posts" does not exist      (42P01)
Export encountered an error on /blog/sitemap.xml/route, exiting the build.
```

The DB-*unreachable* case was verified by experiment; the
reachable-but-schemaless case — the only one that applies to a first deploy —
never was. The first deploy failed on it. Root cause and resolution are in
`docs/34` §5a; the mechanism is `src/db/build-phase.ts`, which fails soft on a
database read **only** while `NEXT_PHASE=phase-production-build` and is inert at
runtime.

**Verified hermetic 2026-10-14.** `next build` with the Dockerfile's exact
build-stage environment and `DATABASE_URL` pointed at a dead address
(`127.0.0.1:1`) — a stricter condition than the real one, since every query
fails rather than just the missing relations — exited **0** and generated
**118/118 static pages** with zero prerender errors and zero build errors. The
guard logged 4 `ECONNREFUSED` lines, one per prerender worker process.

**Consequences for this runbook:**

- `--build-secret database_url=…` is **no longer required**. It is still
  harmless and still worth passing when the schema exists, because real data
  pre-renders real pages instead of empty ones. On a virgin database it changes
  nothing.
- CI builds no longer need a live database, which is the "hermetic build"
  follow-up the original text below deferred. That follow-up is now done.
- The two `generateStaticParams()` try/catch blocks from `7b9e033` are now
  redundant with the client-level guard. They are harmless and left in place:
  they log a clearer, route-specific warning.

The original analysis follows, for the reasoning about *which* routes query at
build time, which is still accurate.

---

## 3b. Original analysis — `next build` requires a reachable database (superseded by §3a)

**Verified 2026-10-14 by building with Postgres unreachable.** 24 pages combine
`export const revalidate` with a `@/db` query, so Next pre-renders them at build
time and each one needs the database. With it unreachable the build dies, e.g.
`Export encountered an error on /campaigns/category/[category]`.

**Mitigated, partially:** `generateStaticParams()` in
`src/app/campaigns/[slug]/page.tsx` and `src/app/blog/[slug]/page.tsx` now fail
soft, returning `[]` and logging a warning. Those two were the highest-value
cases — they enumerate every campaign and post, so they fail first and loudest —
and returning `[]` is correct regardless: both pages set `revalidate`, so a page
that is not pre-rendered simply renders on first request. Same end state, one
request later.

**Not mitigated:** the remaining 22 pages query inside the page body. Making them
all fail soft is a refactor, not a fix, and was deliberately not attempted.

**Consequence for deploying ~~the build needs a reachable database~~** —
superseded by §3a; the build is now hermetic. Retained because the BuildKit
secret mechanism below is still how `DATABASE_URL` reaches the build when you
*do* want real data pre-rendered, and it still must never land in a layer or in
`docker history`:

```bash
flyctl deploy --app lastdonor --ha=false \
  --build-secret database_url='postgresql://...:6543/postgres'
```

The pooled 6543 URL is correct here — the build only issues SELECTs. Our database
is empty, so these pages pre-render as empty and fill in via `revalidate` once
seeded.

**Follow-up for a hermetic build** — **DONE 2026-10-14**, exactly as sketched
here: a build-phase guard in the data layer (Next sets
`NEXT_PHASE=phase-production-build`) returning empty results instead of
throwing, rather than 22 individual try/catch blocks. See
`src/db/build-phase.ts` and §3a. Worth noting that this was already identified
as the right fix and deferred as "a refactor, not a fix" — the first deploy
then failed for precisely the reason it was meant to prevent.

---

## 4. Steps the owner must authorise

Each creates infrastructure or writes production state.

```bash
export PATH="/usr/local/flyctl/bin:$PATH"
export FLY_API_TOKEN='<the org token>'

# 1. Create the app (no deploy yet)
flyctl apps create lastdonor --org personal

# 2. Stage the secrets (--stage: written but not released, so no deploy fires)
bash <scratchpad>/secure/set-secrets.sh

# 3. First deploy. The release_command creates the ENTIRE schema from the
#    docs/34 baseline before any machine serves traffic.
flyctl deploy --app lastdonor --ha=false

# 4. Verify
flyctl status --app lastdonor
curl -sS https://lastdonor.fly.dev/api/v1/live        # expect 200, shallow
curl -sS https://lastdonor.fly.dev/api/v1/health      # deep: DB + Redis + Stripe
```

`--ha=false` keeps it to one machine for the first deploy. Note `docs/26` §5:
**a second machine requires the shared ISR cache handler**, which is not yet
implemented — 26 pages use `revalidate` and 36 files call `revalidatePath`, so
multi-instance without it serves stale HTML silently. Stay at one machine until
that lands.

---

## 5. Expected state immediately after first deploy

**Working:** homepage, campaign browse and detail, blog, static and policy
pages, registration and credentials login, admin shell, `/api/v1/live`.

**Not working, by design, until follow-ups land:**

1. ~~**Every campaign image 404s.**~~ **RESOLVED before first deploy.** The
   three hardcoded `ntnrcedafgmeyajmzvga.supabase.co` literals — a project
   verified absent from this account — now derive the host from
   `NEXT_PUBLIC_SUPABASE_URL` (falling back to `SUPABASE_URL`, then to a named
   constant) via `src/lib/supabase-host.ts`. See §5a.
2. **The site is empty.** Zero campaigns. Seeding *campaign content* — stories,
   images, categories — is legitimate and unrelated to the donation-totals
   question in `docs/33`.
3. **Donations fail** at the Stripe call (placeholders).
4. **Crons skip** (no Upstash; fail-closed by design).
5. **Verification document review shows dead links** — the admin UI reads
   `fileUrl` directly and must move to the signed-URL endpoint (`docs/32` §1).

---

## 5a. Supabase storage host is derived, not hardcoded

Fixed 2026-10-14, before the first deploy, because shipping it broken would
have meant a second deploy to fix the most visible thing on the site.

**What was wrong.** Three call sites each carried the literal
`ntnrcedafgmeyajmzvga.supabase.co`:

| Call site | Effect of the dead host |
|---|---|
| `next.config.ts` `images.remotePatterns` | `/_next/image` refuses every real upload URL → broken image for every campaign |
| `src/app/layout.tsx` preconnect/dns-prefetch | A TCP+TLS handshake to a host that does not resolve, on every page load |
| `src/lib/validators/url-allowlist.ts` | Our own storage URLs fail the SSRF guard, so the news image pipeline cannot fetch what it just uploaded |

**What it is now.** `src/lib/supabase-host.ts` exports `SUPABASE_HOST`, derived
from `NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL`, with
`FALLBACK_SUPABASE_HOST = 'vavxdjqufxrsbyohcwdh.supabase.co'` for local builds
and unit tests. The `process.env` reads are static member expressions so the
compiler inlines the `NEXT_PUBLIC_` value into any client bundle that reaches
the allowlist; a dynamic lookup would be `undefined` in the browser.

**`next.config.ts` duplicates the derivation rather than importing it.** Next
loads that file through its own TypeScript transpiler, and a failed import
there kills the build outright. Two lines of duplication is a smaller risk than
that. The duplication is pinned by
`test/security/image-optimizer-hosts.test.ts`, which reads the **real exported
config** and asserts that the only `*.supabase.co` pattern in it equals
`SUPABASE_HOST`, plus a regression test that the dead project name never
reappears. Divergence fails CI instead of silently 404ing every image.

**Build-time requirement.** `images.remotePatterns` is serialised into the build
output, so the host must be correct at build time, not boot time. `fly.toml`
passes `NEXT_PUBLIC_SUPABASE_URL` as a `[build.args]` entry and the Dockerfile
declares the matching `ARG`/`ENV` in the builder stage. A Fly *secret* cannot
do this job — `NEXT_PUBLIC_*` is compiled in.

**Rejected: an `images.remotePatterns` wildcard such as `**.supabase.co`.** It
would have been one line and needed no plumbing, but it re-opens audit P1-14 in
miniature: the optimiser would fetch from any Supabase project on earth,
including an attacker's, and the pattern cap (`docs/26`; 50 entries) is a scarce
resource already spent one-per-publisher.

**Also changed:** `NEXT_PUBLIC_APP_URL` in `[build.args]` now points at
`https://lastdonor.fly.dev` rather than `https://lastdonor.org`. No DNS points
at Fly yet, so the previous value would have inlined a non-resolving origin into
every absolute client-side URL. **Flip it back in the same change that cuts DNS
over, and redeploy** — it is compiled in, so no secret can override it later.

**Still open:** the admin verification review path (§5 item 5) is unaffected by
this; it reads `fileUrl` directly and still needs the signed-URL endpoint.

---

## 6. Rollback

`flyctl releases --app lastdonor` then `flyctl deploy --image <previous>`, or
`flyctl apps destroy lastdonor` to remove it entirely.

**The schema is not rolled back by either.** The baseline is additive onto an
empty database, so the rollback for the schema is dropping the `public` schema
and re-running — acceptable only while there is no data, which is true today
and will not be true after the first real donation.

---

## 7. Before real traffic

Not optional, and tracked elsewhere:

- Real Stripe keys, and a verified webhook endpoint.
- `CLIENT_IP_SOURCE=cf` and `TRUSTED_PROXY_HOPS=2` **if and when Cloudflare goes
  in front** (`docs/32` §4). Until then `xff`/`1` is correct for Fly alone;
  getting this wrong makes every rate limit bypassable. This paragraph was
  already correct on 2026-10-14 while `fly.toml` carried `cf`/`2` anyway — the
  runbook and the config disagreed and the config was wrong. Both now say
  `xff`/`1`, set in exactly one place (`fly.toml` `[env]`), with the flip
  documented inline next to the values.
- Shared ISR cache handler before scaling past one machine (`docs/26` §5).
- Nightly `pg_dump` to R2 (`docs/27` §1) — there is still no backup of anything.
- The open P0/P1 items in `docs/31` and `docs/32` §"Open items".
