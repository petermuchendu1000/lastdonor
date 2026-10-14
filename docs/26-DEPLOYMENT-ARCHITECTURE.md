# 26 — Deployment Architecture (Cloudflare + Fly.io + Supabase)

Target architecture for running LastDonor off Vercel. Every constraint below was
verified against this repository at commit time, not assumed. Claims that depend
on provider behaviour cite the provider; claims that depend on load are marked
as requiring measurement.

---

## 1. Verified properties of this codebase

These are the facts the design is built on. Each was checked directly.

| Property | Value | File / evidence | Consequence |
|---|---|---|---|
| Session strategy | `jwt` | `src/lib/auth.ts:95` | Stateless auth. No DB read per request, no sticky sessions, horizontal scaling is free. |
| Middleware matcher | `/dashboard`, `/notifications`, `/profile`, `/settings`, `/admin`, `/api/*` | `src/middleware.ts` | Public pages (`/`, `/campaigns/*`, `/blog/*`) never enter middleware → fully edge-cacheable. |
| Rate limiting | Upstash call on every `/api/*` | `src/middleware.ts`, `src/lib/rate-limit.ts` | One network round trip ahead of every API handler. |
| Long-running routes | **11 routes > 100s**: 7 × `maxDuration = 300`, 4 × `maxDuration = 120` | all 10 `api/v1/cron/*` + `admin/news-feed/[id]/create-campaign` | **Hard conflict with Cloudflare's 100s proxy ceiling.** Drives the two-hostname design in §3. |
| ISR surface | 26 pages: 16 × 60s, 8 × 300s, 1 × 120s, 1 × 0 | `src/app/**` | Shared cache handler is mandatory above one instance. |
| Dynamic routes | 18 × `force-dynamic` | `src/app/**` | These always reach origin; they set the origin floor. |
| Campaign detail page | `generateStaticParams()` + `revalidate = 60` | `src/app/campaigns/[slug]/page.tsx:26` | Hottest path is ISR, so it is cacheable — the main scaling win. |
| DB driver | `prepare: false`, `max: 5`, `idle_timeout: 20` | `src/db/index.ts` | Already correct for Supavisor transaction mode. No change needed. |
| Indexes | 75 declared | `src/db/schema.ts` | Schema is already indexed; DB is not the first bottleneck. |
| Realtime | Not used | no `.channel()` / realtime subscriptions | No WebSockets, no sticky sessions, no long-lived connection budget. |
| Upload cap | 5 MB | `src/lib/supabase-storage.ts:16` | Far below Cloudflare's 100 MB body cap. **Not a constraint.** |
| Image optimization | `sharp` present | `package.json` | `next/image` works on Fly unchanged. |
| Cron auth | Timing-safe Bearer compare | `src/lib/cron-auth.ts` | Correctly implemented; keep it as the inner guard. |
| Health check | `/api/v1/health` exists but is **NOT safe as a Fly liveness probe** | `src/app/api/v1/health/route.ts:29,50` | **Corrected 2026-10-14 (audit R-09).** It calls `stripe.balance.retrieve()` and returns 503 if *any* dependency check fails, so a Stripe blip would make Fly kill every machine — a self-inflicted outage from a third-party degradation. It also never checks Redis. A liveness probe must test only whether this process can serve. See §10 step 4. |
| Scale | 111 API routes, 86 pages, 30 tables, 33 migrations | — | Single deployable unit; no service split justified yet (§8). |

### Vercel couplings to remove

| Item | Location | Action |
|---|---|---|
| `@vercel/og` | `api/v1/og/page/route.tsx`, `api/v1/og/campaign/[slug]/route.tsx` | Swap import to `next/og` (built into Next 15). |
| `runtime = 'edge'` | `src/app/apple-icon.tsx:3` | Delete the line; run on Node. |
| `crons` array | `vercel.json` | Replaced by the Cloudflare Worker in §4. |
| `output` mode | `next.config.ts` | Add `output: 'standalone'`. |

---

## 2. Design point

An architecture without a stated load target is unfalsifiable. This design is
sized for:

- **Reads dominate.** A crowdfunding site is ~95%+ anonymous reads of campaign
  and blog pages, which are ISR and therefore cacheable.
- **Writes are low-volume and high-value.** Donations are the critical write
  path: each must be durable and idempotent, but there are orders of magnitude
  fewer of them than reads.
- **Background work is heavy but asynchronous.** The AI content pipeline is the
  most compute-hungry part of the system and has no user waiting on it.

That asymmetry is the whole design: **cache the reads at the edge, keep the
write path short and transactional, and move background work off the user-facing
path entirely.**

---

## 3. Topology — the two-hostname rule

This is the keystone decision. Cloudflare's proxy read timeout is **100 seconds
on Free, Pro and Business; raising it is Enterprise-only**. This repo has
**11 routes declaring 120s–300s**. Proxying everything would truncate all ten
cron jobs and the admin campaign-creation route with a 524.

Resolve it with DNS, not by rewriting the routes:

```
                        ┌──────────────────────────────────┐
   Users ──────────────▶│  lastdonor.com      (PROXIED)    │
                        │  Cloudflare: CDN, WAF, cache,    │
                        │  rate limit, TLS, bot control    │
                        └───────────────┬──────────────────┘
                                        │  ≤100s requests only
                                        ▼
   ┌───────────────────┐      ┌──────────────────────┐
   │ Cloudflare Worker │      │   Fly.io app         │
   │ 1 cron trigger    │─────▶│   Next.js standalone │
   │ every 5 min       │ grey │   2+ Machines        │
   │ Bearer CRON_SECRET│ cloud│   region = SUPA_REGION│
   └───────────────────┘      └──────┬───────┬───────┘
                                     │       │
              ┌──────────────────────┘       └──────────────┐
              ▼                                             ▼
   ┌─────────────────────┐                      ┌──────────────────────┐
   │ Supabase            │                      │ Upstash Redis        │
   │ • Postgres 6543 TX  │                      │ • shared ISR cache   │
   │ • Postgres 5432 SESS│                      │ • rate-limit state   │
   │   (migrations only) │                      │ • job locks          │
   │ • Storage (avatars) │                      └──────────────────────┘
   └─────────────────────┘
              ▲
              │  Stripe · Resend · OpenAI  (outbound HTTPS, platform-agnostic)
```

**Two hostnames, one app:**

| Hostname | Cloudflare | Serves | Why |
|---|---|---|---|
| `lastdonor.com` | Proxied (orange) | All user traffic | CDN, WAF, caching, DDoS |
| `origin.lastdonor.com` | **DNS-only (grey)** | Cron + long admin jobs | Bypasses the 100s ceiling entirely |

Protect the grey-cloud hostname with Fly-level controls, since Cloudflare's WAF
is not in front of it: keep `verifyCronAuth` as the inner guard (already
timing-safe), and restrict it to Cloudflare Worker egress where practical. The
secret is the real boundary; the hostname is only a routing device.

**SSL mode must be Full (strict).** Flexible terminates TLS at the edge and
breaks the secure-cookie assumptions NextAuth relies on.

---

## 4. Scheduled work

`vercel.json`'s `crons` array is Vercel-only and does nothing on Fly. Replace it
with **one** Cloudflare Worker holding **one** Cron Trigger at `*/5 * * * *`
that dispatches internally based on wall-clock time.

One trigger rather than ten avoids per-Worker trigger caps and keeps all
scheduling logic in one reviewable file. The Worker is a dispatcher only — it
holds no business logic, so the ten route handlers stay exactly as they are.

```
*/5  → update-phases                        (every 5 min)
*/15 → simulate-donations                   (every 15 min)
*/30 → ingest-news, publish-campaigns       (every 30 min)
0 */6→ fetch-news                           (every 6 h)
daily→ blog-topics 06:00, blog-generate 08:00, reconcile 04:00
weekly→ send-newsletter Thu 14:00, blog-refresh Sun 10:00
```

Each dispatch is `fetch('https://origin.lastdonor.com/api/v1/cron/<job>', {
headers: { Authorization: 'Bearer ' + CRON_SECRET }})`, fire-and-forget with
`waitUntil`. Target the **grey-cloud** hostname so the 300s routes are not
truncated.

**Overlap guard.** `update-phases` runs every 5 minutes with `maxDuration = 120`,
and `simulate-donations` every 15 minutes at 300s. A slow run can overlap its
own next invocation. Take a short-lived Upstash lock (`SET NX` with a TTL
slightly above `maxDuration`) at the top of each cron handler and exit early if
it is held. Without this, concurrent phase mutation is possible.

---

## 5. Caching — the main performance lever

Three layers, each with a distinct job.

**Layer 1 — Cloudflare edge (HTML + assets).**
Public pages never touch middleware, so they are safely cacheable. Cache
`/_next/static/*` and `/_next/image/*` aggressively (immutable, content-hashed).
For ISR HTML, set a Cache Rule with edge TTL at or below the route's
`revalidate`, and `Cache-Control: s-maxage=<revalidate>,
stale-while-revalidate`. **Never** cache any path under `/api/`, `/dashboard`,
`/profile`, `/settings`, `/admin`, or any response carrying `Set-Cookie`.

**Layer 2 — shared Next.js ISR cache (Upstash Redis). Mandatory above one instance.**
Next.js's default incremental cache is per-instance local storage. With two Fly
Machines, a `revalidatePath()` on Machine A leaves Machine B serving stale HTML
indefinitely — the documented multi-replica failure mode. With 26 ISR pages and
36 files calling `revalidatePath`/`revalidateTag`, this is the highest-risk
correctness bug in the whole migration, and it is silent.

Fix: set `cacheHandler` to a Redis-backed module and `cacheMaxMemorySize: 0` in
`next.config.ts`. `@neshca/cache-handler` exists for exactly this; note its
1.9.0 is the last release before 2.0, and v2 drops Next 13/14 support (fine
here — this app is on 15). All instances must share the same `buildId`, which a
single Docker image guarantees.

**Layer 3 — Postgres.** The 75 declared indexes and the `seedDonationCount` /
`messageCount` / `updateCount` echo columns already avoid the N+1 listing
queries. No change needed.

---

## 6. Data layer

**Two connection strings, used for different things:**

| Use | Port | Mode | Why |
|---|---|---|---|
| Application | **6543** | Transaction | Returns the server connection after each query; highest throughput. Port 6543 has been transaction-only since 2025-02-28. Requires `prepare: false` — **already set**. |
| Migrations (`release_command`) | **5432** | Session | Transaction mode cannot hold the session state DDL and advisory locks need. |

**Connection budget.** The driver is `max: 5` per instance, so server-side
demand is `5 × machine_count`. Two machines = 10. Supavisor multiplexes in
transaction mode, so this is comfortable; re-check the pool size before
autoscaling past ~10 machines (50 connections).

**Region colocation is the largest single latency factor.** Most pages are
DB-driven, so place the Fly primary region in the same geography as the Supabase
project. One region close to Postgres beats multi-region with a single primary —
multi-region would put every write a transatlantic hop from its database. Do not
go multi-region until read replicas exist to go with it.

**Backups.** No backup tooling exists in this repo today — no `pg_dump` script,
nothing in CI. Add a nightly `pg_dump` via GitHub Actions to object storage with
retention, and enable Supabase PITR on a paid plan. Free-tier Supabase pauses
after ~7 days of inactivity and carries no backup retention.

---

## 7. The donation write path

The one path where correctness outranks performance.

```
Browser → Stripe Checkout (Stripe hosts the card form; no PAN touches us)
            │
            ▼
   Stripe ──webhook──▶ lastdonor.com/api/v1/donations/webhook
                         1. verify signature over the RAW body
                         2. single DB transaction:
                            insert donation (UNIQUE stripe_payment_id)
                            update campaign counters + last-donor
                         3. post-commit side effects (email, notify)
```

Three properties to preserve:

1. **Idempotency is already enforced in the schema** — `uniqueIndex` on
   `donations.stripe_payment_id` makes a replayed webhook a no-op rather than a
   double-count. This is the right place for it.
2. **Signature verification needs the exact raw body.** Add a Cloudflare WAF
   **skip** rule for `/api/v1/donations/webhook` and
   `/api/v1/stripe-connect/webhook`, exclude them from all cache rules, and keep
   Rocket Loader and HTML minification off those paths. Any edge body rewriting
   breaks verification.
3. **Never scale to zero.** Set `min_machines_running = 1`. A cold start on a
   payment webhook risks a timeout; Stripe retries, but on a payments platform
   the right answer is a warm machine.

Stripe metadata is also the disaster-recovery substrate: `create-checkout`
writes `campaignId`, `donorName`, `donorEmail`, `donorLocation`, `message`,
`isAnonymous`, `isRecurring` and `subscribedToUpdates` onto every
PaymentIntent, which makes the `donations` table reconstructible from Stripe
alone. Preserve that property in any refactor.

---

## 8. What NOT to build

Precision includes refusing complexity that does not pay for itself here.

- **No microservices.** 111 routes in one deployable, with JWT auth and no
  realtime, is a monolith that scales horizontally for free. Splitting it buys
  network hops and distributed failure modes and solves nothing you have.
- **No Kubernetes.** Fly Machines already give rolling deploys, health checks
  and horizontal scale.
- **No separate queue broker (yet).** The crons plus Upstash locks cover current
  background work. Introduce a real queue when a job needs per-item retries and
  a dead-letter queue — most likely the AI pipeline, as volume grows.
- **No read replicas yet.** 75 indexes and echo columns mean Postgres is not the
  bottleneck at this stage. Add replicas when measurement says so, not before.
- **No Next.js on Cloudflare Workers.** `sharp` is unsupported there, Node
  middleware is not yet supported, and the 300s AI routes do not fit the Worker
  execution model. Cloudflare is the edge, not the runtime.

---

## 9. Capacity reasoning

Honest statement: machine sizing cannot be derived without traffic numbers, and
inventing an RPS figure would be exactly the guesswork to avoid. What *can* be
derived is the shape of the load and the knobs.

**Origin load is bounded by the uncacheable surface, not by total traffic.**
With a shared ISR cache and edge caching, a page with `revalidate = 60` costs
the origin ~1 render per 60s *globally*, regardless of whether 100 or 100,000
people view it. So origin cost ≈ (18 `force-dynamic` routes + authenticated
traffic + API calls), plus a bounded ISR revalidation trickle. Anonymous
campaign-page traffic — the bulk of a crowdfunding site — is nearly free.

**Starting point:** 2 × `shared-cpu-2x` (1 GB) Machines, `min_machines_running = 1`,
in the Supabase region. Two for availability during rolling deploys, which is
also what forces the shared cache in §5.

**Then measure these four signals and let them drive sizing:**

| Signal | Where | Act when |
|---|---|---|
| p95 latency on `force-dynamic` routes | Sentry | > 500 ms → profile queries before adding machines |
| Machine CPU / memory | Fly metrics | sustained > 70% → scale up, then out |
| Cache hit ratio | Cloudflare Analytics | HTML hit ratio < 80% → cache rules are wrong |
| Postgres connection saturation | Supabase dashboard | > 70% of pool → revisit `max: 5` × machines |

**One load test worth running before launch:** hit a campaign detail page
through `lastdonor.com` at your expected peak concurrency while a
`simulate-donations` cron is mid-run, and watch cache hit ratio and DB
connections together. That single test exercises the edge cache, the shared ISR
cache, and the cron overlap guard at once.

---

## 10. Migration order

Dependency-ordered; each step is independently verifiable.

1. `output: 'standalone'`, Dockerfile, `.dockerignore`. Verify: container boots locally.
2. Remove Vercel couplings — `next/og` ×2, drop edge runtime from `apple-icon.tsx`. Verify: `npm run build` clean, OG images render.
3. Redis `cacheHandler` + `cacheMaxMemorySize: 0`. Verify: `revalidatePath` on one machine is visible from the other.
4. `fly.toml` — region, `min_machines_running = 1`, `release_command` running `drizzle-kit migrate` over **port 5432**, and a health check on a **new shallow liveness endpoint** (process-only, no dependency calls). **Do NOT point Fly's health check at `/api/v1/health`** — it 503s when Stripe is degraded, which would take the whole fleet down (audit R-09, corrected 2026-10-14). Keep `/api/v1/health` as a deep *readiness/diagnostic* endpoint for humans and uptime monitoring, where a 503 on a Stripe outage is the desired signal. Verify: deploy applies migrations once.
5. Secrets via `fly secrets set` (all of `.env.example`). Verify: `/api/v1/health` reports every check green (as a diagnostic, not as the probe).
6. Upstash locks in all 10 cron handlers. Verify: a forced overlapping invocation exits early.
7. Cron Worker, one 5-minute trigger → grey-cloud hostname. Verify: each job fires on schedule and 300s jobs complete.
8. Cloudflare DNS, Full (strict) TLS, cache rules, WAF skip rules for both webhooks, edge rate limiting. Verify: a real Stripe test webhook validates.
9. Cut DNS over. Verify: the §9 load test.
10. Nightly `pg_dump` in CI + Supabase PITR. Verify: restore the dump into a scratch database.

Step 3 before step 4 matters: deploying two machines without the shared cache
ships the silent staleness bug.

---

## 11. Trade-offs accepted

| Decision | Gain | Cost |
|---|---|---|
| Fly over Vercel | Cost, portability, no 100s/300s platform limits | Dockerfile, cache handler and cron Worker become yours to maintain |
| Two hostnames | 11 long routes work unmodified | A grey-cloud hostname without WAF; secret-dependent |
| Single region | Lowest DB latency, simplest consistency | Higher latency for distant users — mitigated by edge caching reads |
| Monolith | Simple deploys, no distributed failures | Whole app scales as one unit |
| JWT sessions | No DB per request, trivial scale-out | Revocation is not immediate; keep token lifetimes short |
| `min_machines_running = 1` | No cold starts on payment webhooks | Pay for one always-on machine |
| Upstash for cache + locks + rate limit | One dependency, three jobs | Single point of failure — rate limiter already has an in-memory fallback; the ISR cache should degrade to local on Redis failure |
