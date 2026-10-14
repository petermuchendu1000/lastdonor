# 28 — Tool Alternatives: Keep / Swap Decisions (ADR)

Every incumbent tool re-examined on merits, not on incumbency. For each: the
decision, the reasoning, the alternatives rejected, and the trade-off accepted.

Verified against the codebase on 2026-10-14. Vendor limits marked ⚠️ come from
third-party sources that disagreed; confirm on the vendor's page.

**Summary**

| Tool | Decision | Headline |
|---|---|---|
| Stripe | **Keep** — emphatically | Connect marketplace payouts have no equivalent |
| Supabase | **Partial swap** | Keep Postgres (paid), move Storage → R2 |
| Resend | **Partial swap** | Split bulk from transactional; lock-in is low |
| NextAuth v5 beta | **Keep, but pin exactly** | The caret range is the real risk, not the beta |
| OpenRouter | **Keep** — already optimal | Add a direct OpenAI key for free moderation only |
| Upstash | **Keep, re-scoped** | Rate limiting moves to Cloudflare's edge |
| Sentry | **Keep** | Free tier is generous; don't buy a second error tool |
| Fly.io | **Keep** | Hetzner is the cost play if you want ops for ~70% off |
| Cloudflare | **Keep** | Nothing competes at the free tier |
| Postgres FTS | **Keep** | Don't add a search service you can't justify |

---

## 1. Stripe — Keep (do not touch)

**Decision:** Keep, and treat as non-negotiable infrastructure.

**Why:** This is a marketplace that pays out to campaign creators. Stripe
Connect does custodial marketplace payouts, and the alternatives usually floated
(Paddle, Lemon Squeezy, Polar) are merchant-of-record services for SaaS — they
do not do creator payouts at all, so they are not substitutes. Stripe is also
load-bearing in three further ways: Radar for fraud, Identity for KYC (already
integrated via `campaigns.stripeVerificationId`), and — per doc 25 — the
PaymentIntent metadata is the disaster-recovery substrate that makes `donations`
reconstructible.

**Rejected:** Paddle / Lemon Squeezy / Polar (wrong product category),
PayPal (worse API, no equivalent marketplace primitives).

**Trade-off accepted:** Deep single-vendor dependency on the money path. This is
the correct trade — the DR property it gives you is worth more than
hypothetical portability.

---

## 2. Supabase — Partial swap: keep Postgres, move Storage to R2

**Decision:** Keep Supabase Postgres and **move to a paid plan**. Migrate
Storage to Cloudflare R2.

**Why keep Postgres:** The migration cost is real (33 migrations, RLS policies
from 0028, and a hardcoded project domain in `next.config.ts`,
`src/app/layout.tsx` and `src/lib/validators/url-allowlist.ts`) and the
incumbent is not the problem — the free *plan* is.

**Why Neon was rejected, with the arithmetic:** Neon's free tier suspends
compute after **5 minutes** of inactivity and allows **100 CU-hours per
project per month** ⚠️. This application runs crons every **5 minutes**
(`update-phases`), which matches the idle timeout exactly — so the database
would effectively **never suspend**. At the free tier's 0.25 CU, continuous
operation is ~0.25 × 730 h ≈ **182 CU-hours/month against a 100 CU-hour cap.**
Neon's free tier cannot host this workload. Its 0.5 GB storage cap ⚠️ is a
second ceiling.

The same cron cadence is why Supabase's free tier has *not* been pausing: those
crons generate exactly the database activity that prevents it. The free plan's
real defects here are **no backup retention** and **no point-in-time recovery**,
which is a data-durability problem, not a capacity one.

Neon's copy-on-write branching is genuinely excellent for preview environments
and testing migrations, and is the one reason to revisit this at paid tier.
It does not justify a migration today.

**Why move Storage to R2:** Supabase Storage is used thinly — 8 files, all
avatar and document uploads, with a 5 MB cap. R2 gives 10 GB-month free with
**free egress** ✅, it is already entering the stack for backups (doc 27 §1),
and consolidating removes a provider. Requires updating the three hardcoded
domain references and `src/lib/supabase-storage.ts`.

**Trade-off accepted:** Paying for Supabase sooner than strictly necessary, to
buy PITR. Given this project has already had one data-loss scare, durability
beats thrift.

---

## 3. Resend — Partial swap (split the streams)

**Decision:** Keep Resend for transactional. Add **Brevo** for bulk. Revisit
Postmark only if receipt deliverability degrades.

**Why:** The forcing issue is the quota collision in doc 27 §2, not the vendor.
Lock-in here is low: email templates are plain HTML strings in
`src/lib/email-templates.ts` and `src/lib/email-adaptive.ts`, so changing
provider means swapping the send call, not rewriting templates. That low
switching cost is itself an argument for not agonising over the choice now.

**Rejected:**
- **Postmark** — the strongest transactional deliverability reputation, and a
  legitimate future upgrade for receipts. Rejected now for lack of a usable
  free tier.
- **SES for everything** — cheapest at $0.10/1,000 ⚠️, but no templates, no
  analytics, no suppression management. You would rebuild what Brevo gives free.
- **Replacing Resend entirely** — no benefit while the transactional volume fits
  a free tier and templates are portable.

**Trade-off accepted:** Two email vendors instead of one. Justified: it is also
the correct deliverability architecture, independent of cost.

---

## 4. NextAuth v5 beta — Keep, but pin the version exactly

**Decision:** Stay on Auth.js v5. **Change `"next-auth": "^5.0.0-beta.25"` to
an exact pin.**

**Why the pin matters more than the beta:** a caret range on a pre-release
resolves forward across later pre-releases. `^5.0.0-beta.25` can therefore pull
`beta.32` or later on a fresh install — **unreviewed breaking changes to the
authentication layer of a payments platform, arriving via a lockfile refresh.**
That is the live risk, and it costs one character to fix.

**Why Better Auth was rejected — a specific architectural reason:** Better Auth
defaults to **database sessions**; Auth.js v5 as configured here uses
**JWT** (`src/lib/auth.ts:95`). Per doc 26 §1, stateless JWT is precisely what
makes horizontal scale-out free: no database read per request, no sticky
sessions. Migrating to database sessions would add a DB round trip to **every
authenticated request** and introduce a scaling constraint this system does not
currently have. For this architecture, the migration is a **downgrade**.

Two further points de-risk staying: the Better Auth team took over Auth.js
maintenance in 2025 and has issued joint security updates ⚠️, so "beta" here
does not mean unmaintained; and migration is explicitly manual — sessions,
password hashes and OAuth account links all move by hand.

**Rejected:** Better Auth (DB sessions conflict with the scaling model), Clerk
(per-MAU cost on a platform whose users are mostly anonymous donors — you would
pay for conversions you have not made), Supabase Auth (you do not otherwise use
Supabase Auth; adopting it would deepen a dependency §2 is thinning).

**Trade-off accepted:** Running a pre-release auth library. Mitigated by the
exact pin plus reading the changelog before any deliberate bump.

---

## 5. AI via OpenRouter — Keep; the architecture is already right

**Decision:** Keep OpenRouter as the router. Add a **direct OpenAI key used only
for the free moderation endpoint.**

**Why:** `src/lib/ai/openrouter.ts` already routes through OpenRouter with a
configured fallback key, and `scripts/list-free-models.ts`,
`test-free-models.ts` and `generate-fallback-pool.ts` show model selection is
already treated as data. This is the correct design: **changing model is a
config change, not a migration.** There is nothing to improve structurally.

**Two concrete actions rather than a swap:**
1. **Moderation needs a direct OpenAI key.** OpenRouter routes chat
   completions; the free `/moderations` endpoint is not a chat completion, so
   plan on a direct key for it. The endpoint itself is free ✅, so this adds no
   cost — only a second credential.
2. **Push bulk generation down-market.** Blog and campaign-story generation is
   batch work with no user waiting, which makes it the ideal place for cheap
   models through the fallback pool you already have. Cache generated output
   keyed by prompt hash so retries and reruns cost nothing.

**Rejected:** Direct single-provider SDKs (would give up the routing and
fallback you already built), self-hosted models (GPU cost dwarfs API cost at
this volume).

**Trade-off accepted:** OpenRouter adds a hop and a margin over calling a
provider directly. Worth it for failover and model portability.

---

## 6. Upstash Redis — Keep, but re-scope what it does

**Decision:** Keep Upstash for the ISR cache and cron locks. **Move
first-line rate limiting to Cloudflare's edge.**

**Why:** Today `src/middleware.ts` calls `checkRateLimitAsync` on **every
`/api/*` request**, which is a network round trip ahead of every API handler.
Cloudflare rate limiting rejects abusive traffic **before it reaches Fly at
all** — strictly better: it removes the round trip from the hot path and absorbs
the attack at the edge. Keep the Upstash limiter for per-identity application
logic where an edge rule cannot express the rule, and keep its existing
in-memory fallback.

**Rejected:**
- **Cloudflare KV** — eventually consistent, which makes it **wrong** for rate
  limit counters and outright unsafe for the cron overlap locks in doc 26 §4.
  Acceptable for the ISR cache alone, but not worth splitting stores for.
- **Durable Objects** — correct consistency for counters, but meaningfully more
  code than a Redis `SET NX`.
- **Fly-colocated Valkey** — lowest latency and cheapest, and worth revisiting
  once the ISR cache is hot, since the app is single-region anyway. Rejected now
  because Upstash's HTTP interface needs no VPC and works from Workers too.

**Action regardless of choice:** put the Upstash region in the same geography as
the Fly region, or the latency saving above is partly given back.

**Trade-off accepted:** Rate limiting logic lives in two places (edge rules plus
application code). Acceptable — they serve different purposes.

---

## 7. Sentry — Keep

**Decision:** Keep. Do not add a second error tracker.

**Why:** 50,000 errors, 5 GB logs, 5 M spans and 50 replays ✅ comfortably
exceeds pre-traction needs, and it is already wired through
`instrumentation.ts` with source maps.

**Noted for later:** PostHog (arriving per doc 27 §3) now also does error
tracking, so there is a future consolidation available. Not worth taking now —
Sentry's stack traces, source-map handling and tracing are better, and
consolidating would trade quality for a bill you are not yet paying.

**Rejected:** GlitchTip (Sentry-SDK-compatible and self-hostable, but you would
be running error-tracking infrastructure to save $0), Datadog / New Relic (cost
structure inappropriate at this stage).

---

## 8. Fly.io — Keep, with an honest cost alternative

**Decision:** Keep Fly.

**Why:** Docker-native, simple rolling deploys, health checks, regional
placement next to Postgres, and `min_machines_running` — everything doc 26
depends on, with no orchestration to operate.

**The genuine alternative:** a **Hetzner VPS with Coolify or Dokploy** is
dramatically cheaper for a single-region app — low single-digit euros per month
against Fly's per-Machine pricing. The trade is real: you become responsible for
the host, OS patching, TLS renewal, log rotation and deploy tooling. If
infrastructure cost is the binding constraint, this is the biggest single lever
in the whole stack. If engineering time is the binding constraint, Fly wins.

**Rejected:** Google Cloud Run (scale-to-zero cold starts are wrong for Stripe
webhooks — doc 26 §7), Railway / Render (similar model to Fly without the
regional placement control), Kubernetes anywhere (unjustifiable at this scale).

**Trade-off accepted:** Paying a platform premium for not operating servers.

---

## 9. Cloudflare — Keep

Nothing competes at the free tier for DNS, CDN, WAF, unmetered DDoS mitigation,
Turnstile, Workers and R2 together. **Bunny.net** is cheaper than Cloudflare's
*paid* CDN tiers and worth knowing about, but the free plan here is free.

**Rejected:** Fastly (free tier far narrower), AWS CloudFront (egress pricing).

---

## 10. Postgres FTS — Keep

Keep Postgres full-text search for `/search`. Adding Typesense, Meilisearch or
Algolia before FTS measurably fails is operational overhead with no user-visible
gain. Revisit when you need typo tolerance or faceted search under 50 ms.

---

## What to action from this document

Ordered by value per unit of effort.

1. **Pin `next-auth` exactly.** One character. Removes unreviewed auth changes
   from the auth layer of a payments platform.
2. **Split email streams** (doc 27 §2). Receipts are currently at risk.
3. **Supabase → paid for PITR.** The only paid upgrade that buys durability.
4. **Move rate limiting to Cloudflare's edge.** Removes a round trip from every
   API request and absorbs abuse before origin.
5. **Direct OpenAI key for free moderation**, then wire moderation into
   user-submitted content.
6. **Storage → R2** when touching upload code anyway.
7. **Colocate Upstash region** with Fly.
8. Revisit Neon branching, Postmark, Fly-colocated Valkey and PostHog
   consolidation at paid scale — not before.
