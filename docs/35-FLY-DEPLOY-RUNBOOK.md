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
| Secrets | 20 prepared in the session scratchpad, **not** in the repo and **not** set on Fly |

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

## 3. Secrets — 20 values, two of them placeholders

Prepared as a reviewable script in the session scratchpad (chmod 600, outside
the repo, never committed). **Secrets must never enter git.**

**Generated fresh, all distinct, satisfying the key-separation rules in
`validate-secrets.ts`:** `NEXTAUTH_SECRET`, `CRON_SECRET`, `PASSWORD_PEPPER`,
`SETTINGS_ENCRYPTION_KEY`, `NEWSLETTER_UNSUBSCRIBE_SECRET`,
`CAMPAIGN_UNSUBSCRIBE_SECRET`.

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

1. **Every campaign image 404s.** `next.config.ts`, `src/app/layout.tsx` and
   `src/lib/validators/url-allowlist.ts` hardcode
   `ntnrcedafgmeyajmzvga.supabase.co` — **a project that is not in this
   account**. Must be repointed at `vavxdjqufxrsbyohcwdh`, ideally via env var
   so it cannot rot again. **Highest-priority follow-up.**
2. **The site is empty.** Zero campaigns. Seeding *campaign content* — stories,
   images, categories — is legitimate and unrelated to the donation-totals
   question in `docs/33`.
3. **Donations fail** at the Stripe call (placeholders).
4. **Crons skip** (no Upstash; fail-closed by design).
5. **Verification document review shows dead links** — the admin UI reads
   `fileUrl` directly and must move to the signed-URL endpoint (`docs/32` §1).

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
  getting this wrong makes every rate limit bypassable.
- Shared ISR cache handler before scaling past one machine (`docs/26` §5).
- Nightly `pg_dump` to R2 (`docs/27` §1) — there is still no backup of anything.
- The open P0/P1 items in `docs/31` and `docs/32` §"Open items".
