# 27 — Tooling Stack (Free / Low-Cost, World-Class)

Complete tool inventory to run LastDonor at professional standards on a
pre-traction budget. Organised by capability, with verified free-tier limits.

**On figures:** limits marked ✅ were verified against the vendor's own
documentation on 2026-10-14. Limits marked ⚠️ come from third-party comparison
sites that disagreed with each other — treat those as indicative and confirm on
the vendor's pricing page before committing. Free tiers change often; the
*architecture* of these choices is durable, the numbers are not.

---

## 0. What is already wired up

Audit of the existing stack before adding anything.

| Capability | Tool | Status |
|---|---|---|
| Payments | Stripe (Checkout, Connect, webhooks) | In use, correct |
| Fraud screening | Stripe Radar | Included with payments; priced separately for the Fraud-teams tier |
| KYC / identity | Stripe Identity | In use (`stripeVerificationId` on `campaigns`) |
| Transactional email | Resend | In use — **but see §2, the daily cap is a live problem** |
| Database + storage | Supabase (Postgres + `media` bucket) | In use; 75 indexes, RLS from migration 0028 |
| Cache / rate limit | Upstash Redis | In use; also the ISR cache store per doc 26 |
| Error tracking | Sentry | In use (`instrumentation.ts`) |
| AI | OpenAI | In use (blog + campaign generation) |
| CI | GitHub Actions | In use (`.github/workflows/ci.yml`) |
| Unit / E2E / a11y tests | Vitest, Playwright, `@axe-core/playwright` | In use |

**Gaps this document closes:** bulk email separation, product analytics, content
moderation, bot protection, uptime monitoring, log aggregation, backups,
secret scanning, load testing, status page, SEO instrumentation, support inbox.

---

## 1. Edge, infrastructure, backups

| Need | Tool | Free tier | Why this one |
|---|---|---|---|
| DNS, CDN, WAF, DDoS, TLS | **Cloudflare Free** | Free plan ✅ | Already the plan of record in doc 26. Unmetered DDoS mitigation at the free tier is unmatched. |
| Bot / abuse protection | **Cloudflare Turnstile** | 20 widgets per account, 10 hostnames per widget, volume **not** capped; 7-day analytics ✅ | A privacy-preserving CAPTCHA with no per-challenge cost. Put it on registration, login, donation start, newsletter signup and campaign submission. |
| Scheduled jobs | **Cloudflare Workers** | 100,000 requests/day, 10 ms CPU per request, 100 Workers, 50 subrequests/request ✅ | The cron dispatcher in doc 26 §4 needs 288 invocations/day — ~0.3% of the free allowance. The 10 ms CPU limit is fine because the Worker only dispatches; the work happens on Fly. |
| Backup storage | **Cloudflare R2** | 10 GB-month Standard storage, 1 M Class A ops, 10 M Class B ops per month; **egress free** ✅ | Zero egress cost is the point: restoring a backup costs nothing. Closes the backup gap — this repo currently has no `pg_dump` tooling at all. |
| Image delivery | `next/image` on Fly (`sharp`) | Free (your compute) | Already works. **Cloudflare Images** is the upgrade path: 5,000 unique transformations/month free, but storage and delivery are paid-only ($5/100k stored, $1/100k delivered) ✅ — so don't migrate until compute cost exceeds that. |
| App hosting | **Fly.io** | Pay-as-you-go, no free tier to rely on | ~1–2 small Machines. The one unavoidable fixed cost, per doc 26 §7 (`min_machines_running = 1`). |

---

## 2. Email — the one urgent fix

**The problem, verified against this codebase:** Resend's free tier is
3,000 emails/month **capped at 100/day** ⚠️. This repo has a `send-newsletter`
cron (`vercel.json`, Thursdays 14:00) plus transactional mail for donation
receipts, first-donation celebrations, campaign-completion notices and
verification requests. A newsletter to 150+ subscribers exhausts the daily cap,
and **because bulk and transactional share one quota, donation receipts fail
silently behind it.**

Separating the two streams is mandatory — not for cost, but because mixing bulk
and transactional mail on one sending identity is also the classic way to
destroy transactional deliverability.

| Stream | Tool | Free tier | Rationale |
|---|---|---|---|
| **Transactional** (receipts, auth, notifications) | **Resend** (keep) | 3,000/mo, 100/day ⚠️ | Already integrated; good DX. Move to the $20/mo ≈ 50,000 tier ⚠️ once donations are steady — receipts are revenue-critical and must never queue behind a newsletter. |
| **Bulk / newsletter** | **Brevo** | ~300/day ≈ 9,000/mo ⚠️ | The only option here with real campaign tooling (templates, segments, unsubscribe management). Its free tier is daily, which suits a weekly send. |
| **Bulk at scale** | **Amazon SES** | $0.10 per 1,000, no monthly minimum ⚠️ | The cheapest at volume by an order of magnitude. Adopt when monthly volume makes Brevo's tier binding; costs more engineering (no templates or analytics). |

**Deliverability — all free, all mandatory:**

- **SPF, DKIM, DMARC** DNS records for every sending domain. Use a `p=none`
  DMARC policy first, read the reports, then move to `p=quarantine`.
- **Subdomain separation**: e.g. transactional on one subdomain, bulk on
  another, so a newsletter complaint spike cannot damage receipt delivery.
- **Google Postmaster Tools** — free; the only direct view of Gmail reputation.
- **MXToolbox** — free blacklist and record checks.

---

## 3. Analytics

| Need | Tool | Free tier | Why |
|---|---|---|---|
| Web analytics | **Cloudflare Web Analytics** | Free with Cloudflare ✅ (specific limits not published in the docs I checked) | Cookieless and server-side, so no consent banner — see §9. Zero client JS weight. |
| Product analytics, funnels, session replay, feature flags, A/B | **PostHog Cloud** | ~1 M events, 5 K session replays, 1 M feature-flag requests/month; 1-year retention, 1 project ⚠️ | One tool covering four categories you would otherwise buy separately. Session replay on an abandoned donation flow is the single highest-value diagnostic you can add. Self-hosting is free if you ever need data residency. |
| Revenue analytics | **Stripe Dashboard** | Free | Already the system of record for money. Don't rebuild it. |
| Search performance | **Google Search Console** + **Bing Webmaster Tools** | Free | Non-negotiable for an SEO-driven content strategy. |
| Backlinks / site audit | **Ahrefs Webmaster Tools** | Free for verified own sites | Normally a paid product; free for your own domain. |

**Deliberate omission: Google Analytics 4.** It would force a cookie-consent
banner, which costs conversions on a donation funnel, and PostHog plus
Cloudflare covers the same ground without that tax.

---

## 4. Observability

| Need | Tool | Free tier | Why |
|---|---|---|---|
| Errors + tracing | **Sentry** (keep) | 50,000 errors, 5 GB logs, 5 M spans, 50 replays ✅ | Already wired. The p95 signal in doc 26 §9 comes from here. |
| Uptime + alerting | **Better Stack** or **UptimeRobot** | Free tiers available ⚠️ | Monitor `/api/v1/health` (already exists) plus a campaign page and the donation endpoint. **Alert on the cron jobs too** — a silently dead `update-phases` is invisible otherwise. |
| Log aggregation | **Better Stack Logs** (~3 GB/mo ⚠️) or **Grafana Cloud** (50 GB logs, 10 K metric series, 14-day retention, 3 users ✅) | Free tiers | Fly's own log retention is short. Grafana Cloud's allowance is the more generous of the two. |
| Status page | **Instatus** or **Better Stack** | Free tiers ⚠️ | On a donations platform, a public status page during an incident is a trust instrument, not a nicety. |
| Cron heartbeats | **Healthchecks.io** | Free tier ⚠️ | Dead-man's-switch per cron job: the job pings on success, you get alerted on silence. Pairs directly with the Worker dispatcher. |

---

## 5. Trust & Safety — the category most crowdfunding platforms under-build

This matters more here than in a typical SaaS: you host user-submitted appeals
for money, which attracts fraud, impersonation and distressing content.

| Need | Tool | Cost | Why |
|---|---|---|---|
| Text **and image** moderation | **OpenAI Moderation** (`omni-moderation-latest`) | **Free** ✅ (250 req/min, 5,000/day on the free tier; images to 20 MB) | A free multimodal moderation endpoint is remarkable value. Run every campaign story, update, donor message and uploaded image through it before publish. Note: some categories are text-only and return 0 for image-only input. |
| Payment fraud | **Stripe Radar** | Included with payments (Fraud-teams tier priced separately) ✅ | Already active. Tune the rules. |
| Identity / KYC | **Stripe Identity** | **First 50 verifications free**, then $1.50 per document+selfie, $0.50 per US SSN lookup; custom pricing above 2,000/mo ✅ | Already integrated. 50 free covers early campaign creators exactly. |
| Breached-password blocking | **HaveIBeenPwned Pwned Passwords** | Free, no key required | k-anonymity range API — you send 5 hash characters, never the password. You have credentials auth, so this is a cheap, large security win. |
| Bot / spam | **Cloudflare Turnstile** | Free ✅ | See §1. |
| Email validity | **ZeroBounce** / **NeverBounce** | Small free credit allowances ⚠️ | Optional. An MX-record check plus your existing Zod validation covers most of it for free. |

---

## 6. Security & supply chain

| Need | Tool | Cost | Why |
|---|---|---|---|
| Dependency alerts + patches | **GitHub Dependabot** | Free | The lockfile in this repo was out of sync with `package.json`, which broke `npm ci` and every CI job. Dependabot surfaces that class of drift. |
| Static analysis (SAST) | **GitHub CodeQL** | Free for public repos; paid for private ⚠️ | If the repo stays private, use **Semgrep OSS** free instead. |
| Secret scanning | **GitHub Secret Scanning** + **gitleaks** in CI | Free | Verified: no credentials have ever been committed here. A CI gate keeps it that way. |
| Container scanning | **Trivy** | Free (OSS) | Scans the Fly image you'll build per doc 26. |
| Row-level security | **Supabase RLS** | Included | Already deployed in migration 0028. Keep policies in version control. |
| Secret storage | **Fly secrets** | Free with Fly | Sufficient. Add **Infisical** or **Doppler** (free tiers) only when more than one person needs managed access. |

---

## 7. Search

**Start with what you own: PostgreSQL full-text search** — free, no new
service, and your `/search` route plus 75 indexes already live in Postgres.
With `tsvector` columns and a GIN index this is genuinely good to tens of
thousands of documents.

Graduate to **Typesense Cloud** or self-hosted **Meilisearch** only when you
need typo tolerance and sub-50 ms faceted search. **Algolia**'s free tier
(~10,000 searches/month ⚠️) is the hosted fallback. Do not add a search service
before Postgres FTS demonstrably fails — it is pure operational overhead until
then.

---

## 8. Quality, performance, testing

| Need | Tool | Cost | Why |
|---|---|---|---|
| Unit / integration / E2E | Vitest + Playwright | Free | Already here: 3,977 unit tests, 72 E2E tests across 21 files. |
| Accessibility | `@axe-core/playwright` (present) + **Pa11y CI** | Free | You already have `e2e/accessibility.spec.ts`. Gate merges on it. |
| Performance budgets | **Lighthouse CI** | Free | Run in GitHub Actions; fail the build on Core Web Vitals regressions. Directly feeds SEO. |
| Load testing | **k6** (OSS) | Free | Runs the single pre-launch test in doc 26 §9. |
| Visual regression | **Playwright snapshots** | Free | Already available in your Playwright setup; no paid service needed. |
| Uptime of SEO assets | **IndexNow** | Free | Instant index submission to Bing/Yandex on publish — fits the blog pipeline. |

---

## 9. Compliance & legal

- **Cookie consent: avoid needing one.** Cloudflare Web Analytics and PostHog
  configured cookieless mean no consent banner, which removes both a legal
  surface and a conversion killer. This is a design decision, not an omission —
  if GA4 is ever added, the banner becomes mandatory.
- **Policy pages**: already present (`/privacy`, `/terms`, `/refund-policy`,
  `/campaign-rules`, plus the Stripe compliance pages added in `fadaff7`).
- **DMARC reporting**: free; see §2.
- **Audit trail**: `auditLogs` exists and migration 0027 enforces it. For a
  money-handling platform, treat the audit log as compliance evidence and
  include it in backups.

---

## 10. Support & community

| Need | Tool | Free tier | Why |
|---|---|---|---|
| Support inbox / live chat | **Crisp** or self-hosted **Chatwoot** | Free tiers ⚠️ | You already have a `supportConversations` table — wire it to a real inbox rather than building a UI. |
| Transactional support email | Resend (§2) | — | Reuse the existing sender. |
| Community | Discord / Slack free | Free | Only if the donor community warrants it. |

**Deliberate omission: Intercom.** Excellent and far outside a pre-traction
budget.

---

## 11. Adoption order

Dependency-ordered. Each phase is independently useful, so you can stop at any
point and still be better off.

**Phase 1 — do before launch (all free except Fly):**
1. Split email streams (§2) + SPF/DKIM/DMARC. *Highest urgency: receipts are currently at risk.*
2. Nightly `pg_dump` → R2 (§1). *Closes the backup gap entirely.*
3. Cloudflare Free: DNS, WAF, cache rules, Turnstile on all public forms.
4. OpenAI Moderation on every user-submitted text and image (§5). *Free.*
5. Uptime + cron heartbeat monitoring (§4). *A dead cron is otherwise invisible.*
6. Pwned-password blocking at registration and password change (§5).

**Phase 2 — first month:**
7. PostHog: funnels and session replay on the donation flow.
8. Cloudflare Web Analytics; Search Console + Bing + Ahrefs Webmaster.
9. Log aggregation (Grafana Cloud or Better Stack).
10. Dependabot, secret scanning, Trivy, Lighthouse CI in the pipeline.
11. Public status page.

**Phase 3 — when traction demands it:**
12. Resend paid tier, or SES for bulk.
13. Supabase paid plan for PITR — **the single most important paid upgrade**, given this project has already had one data-loss scare.
14. Dedicated search (Typesense/Meilisearch) if Postgres FTS is measurably insufficient.
15. Cloudflare Images if `sharp` compute exceeds its delivery pricing.

---

## 12. Expected cost

| Phase | Monthly |
|---|---|
| Phase 1 | **Fly compute only** (~1–2 small Machines). Everything else free. |
| Phase 2 | Unchanged — all Phase 2 tools have free tiers that fit pre-traction volume. |
| Phase 3 | Supabase paid (PITR) + Resend paid + Fly. Still well under a single Vercel Pro seat. |

Variable, usage-based: Stripe per transaction, Stripe Identity $1.50 per
verification after the first 50, OpenAI tokens for content generation
(moderation itself is free).

The genuinely unavoidable spend is **Fly compute** and **Supabase paid for
point-in-time recovery**. Everything else in this document has a free tier that
comfortably covers a pre-traction donations platform.
