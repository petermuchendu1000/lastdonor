# LastDonor — Working Agreement

Crowdfunding platform. Next.js 15 (App Router) · TypeScript · Drizzle/Postgres
(Supabase) · NextAuth v5 · Stripe · Tailwind 4. Deployed per `docs/26`.

---

## Documentation is part of the work, not a follow-up

**Every architectural decision gets written down in `docs/`, in the same commit
as the change that implements it.** A decision that exists only in a chat
transcript or a commit message is lost.

### What requires a doc

- Choosing or replacing a technology, service or vendor
- Changing the deployment topology, hosting, or data flow
- A schema change that alters invariants (not routine columns)
- A security, compliance or trust-and-safety control
- Any non-obvious trade-off a future reader would otherwise re-litigate

### How

- Numbered sequentially: `docs/NN-TOPIC-IN-CAPS.md`. Next free number wins;
  never renumber existing docs, since other docs cite them.
- State **what was decided, why, what was rejected, and the trade-off accepted.**
  The rejected options are the most valuable part — they stop the decision
  being reopened every quarter.
- **Mark every claim as verified or assumed.** If a limit, price or platform
  behaviour came from a vendor's docs, cite it and date it. If it is an
  assumption, say so explicitly. Vendor limits drift; undated numbers rot
  silently and are worse than no number.
- Update the affected existing doc rather than adding a contradicting one. If a
  decision is reversed, amend the original and note the reversal.

### Current index

| Doc | Subject |
|---|---|
| `01`–`25` | Product, brand, architecture, content, ops, research |
| `26-DEPLOYMENT-ARCHITECTURE.md` | Cloudflare + Fly.io + Supabase topology, caching, capacity |
| `27-TOOLING-STACK.md` | Free/low-cost tool inventory by capability |
| `28-TOOL-ALTERNATIVES-ADR.md` | Keep/swap decisions per tool, with rejected alternatives |
| `29-SYSTEM-AUDIT.md` | **Full-system audit (2026-10-14). Read before touching money, auth, storage or migrations.** |
| `30-GOFUNDME-BENCHMARK.md` | Competitor benchmark: parity gaps, attack surface, corrections to docs 22/23 |
| `31-REMEDIATION-PLAN.md` | **Ordered fix plan with per-item acceptance criteria. Start here for work.** |
| `32-REMEDIATION-DECISIONS-ADR.md` | **Decisions taken implementing docs/31, with rejected alternatives. Read before revisiting auth, storage, CSP or cron locks.** |
| `34-MIGRATION-BASELINE-ADR.md` | **Why there is one baseline and two migration dirs. Read before any schema change.** |
| `33-SEED-DATA-DISCLOSURE-DECISION.md` | **Owner decision on seed-donation disclosure + engineering objection. Read before touching the simulation engine or public totals.** |
| `38-SENTRY-INTEGRATION.md` | **Where the Sentry DSN lives and why (build arg vs secret), the `VERCEL_ENV` environment-tag fix, and why `tunnelRoute` is disabled — it was POSTing every client error to a 404.** |
| `37-DB-POOL-WEDGE-INCIDENT.md` | **First production outage (2026-10-14/15): a wedged Postgres pool hung every DB route for 3h+ with a passing health check. Read before touching `src/db/index.ts` — and do NOT re-add `connection: { statement_timeout }`, Supavisor ignores it.** |
| `36-SEED-CONTENT-SANITIZATION.md` | **Why `scripts/seed-news-items.ts` is ⛔ DO NOT RUN (forged press attribution, quotes invented for real officials) and what replaced it. Read before seeding content.** |
| `39-REGISTRATION-PAGE-ENUMERATION-ADR.md` | **Why `/register` no longer auto-signs-in and both outcomes render one "check your email" screen. Read before touching the register page, its mail, or anything that branches on whether an address exists.** |
| `40-CAMPAIGN-UNSUBSCRIBE-LINK-ADR.md` | **Why `src/lib/unsubscribe-tokens.ts` owns both unsubscribe token formats, and why campaign footers mint a token over `campaignId` with a mailto fallback. Read before touching unsubscribe links or the campaign-subscribe route.** |
| `41-JOURNEY-REMEDIATION-ADR.md` | **One writer for refund accounting, payouts that cannot disburse seed money, volume guards inside the shared publisher, the `SEED_DONATIONS_OPT_IN` fail-closed gate (amends docs/33), mail consent + CAN-SPAM, and why the bulk-email filter lives in `audit_logs.details`. Read before touching refunds, payouts, outbound mail or the publish crons.** |
| `42-DONATION-RECEIPT-VERIFICATION-ADR.md` | **Why a donation receipt is rendered only from a Stripe-verified state (never from `?donation=success&amount=`), why `/donate` hides the form when the general fund row is missing, and why submit is guarded by a `useRef` latch. Read before touching the donate pages, the confirm route or `create-checkout`'s return URL.** |
| `46-LOGIN-ERRORS-SITEMAP-WALLET-POLICY-ADR.md` | **Why a wrong password and a database outage now render different messages (without reopening the docs/32 enumeration oracle), why `src/app/sitemap.ts` needs `revalidate` at all, and why `payment=(self "https://js.stripe.com")`. Read before touching login failure copy, the sitemap, or the security headers.** |
| `45-BROWSE-FILTER-HONESTY-ADR.md` | **Why `/search` forwards its params, why an unrecognised filter value is reported instead of silently widening the list, the category label/value alias table, and why keyword search strips HTML in SQL. Read before touching `/campaigns` browse params, `src/lib/campaign-search.ts` or the listing API's `q` match.** |
| `44-SESSION-READ-RATE-LIMIT-ADR.md` | **Why `GET /api/auth/session` has its own limiter tier (120/60s) instead of the 10/60s sign-in tier, why `SessionProvider` is seeded with `session={null}` behind `SessionBootstrap` (a bare mount costs two session reads, not one), and why a 429 must render as "unknown" and never as signed out. Read before touching `src/lib/rate-limit.ts` tiers, `src/components/Providers.tsx` or anything that branches on `useSession().status`.** |
| `43-CAMPAIGN-PAGE-STALE-MESSAGES-AND-UNKNOWN-SLUG-ADR.md` | **Why the message wall re-reads its API on mount, and why an unresolved campaign lookup is a 5xx and never a 404. Read before touching `src/app/campaigns/[slug]/page.tsx`, `src/hooks/usePollingList.ts` or anything that decides 404 vs 5xx from a DB error.** |
| `47-MONEY-TYPOGRAPHY-AND-ZERO-STATE-ADR.md` | Why `Money` is the only currency renderer, and the unfunded-campaign state |
| `48-NAVBAR-BENCHMARK-ADR.md` | Navbar measured against GoFundMe. Section 1 of the landing-page pass |
| `49-HERO-BENCHMARK-ADR.md` | Hero measured against GoFundMe. Section 2 of the landing-page pass |
| `50-CI-PIPELINE-NEVER-RAN-ADR.md` | **GitHub Actions had never run once, and the four defects that would have kept it red.** |
| `51-CARDS-AND-HOMEPAGE-CONSOLIDATION-ADR.md` | Card anatomy, and six content sections merged into two |
| `52-POOL-WEDGE-RECURRENCE-INCIDENT.md` | **The pool wedge recurred and the docs/37 guard was part of the cause. Read with docs/37 before touching `src/db/`.** |
| `53-HERO-IMAGERY-AND-MOBILE-FIRST-ADR.md` | Hero imagery, the mobile image, and the H1 brand/SEO question |
| `54-DEPLOY-BUILD-PERFORMANCE.md` | Deploy build caching: what was measured, and the honest negative result |
| `55-CAMPAIGN-LISTING-BENCHMARK-ADR.md` | The campaign listing: compact cards on phones |
| `56-STEPS-SECTION-AND-AN-OFF-BRAND-FONT.md` | The steps section, and why font questions must be verified against the deployed page |
| `57-ATTRIBUTED-SHARE-LOOP-ADR.md` | **`/s/<token>` → cookie → Stripe metadata → `donations.share_link_id`. Why share tokens are random, not signed, and why redirects must use `appBaseUrl()`. Read before touching share links.** |
| `58-IMPACT-DASHBOARD-ADR.md` | **"Your impact": the GoFundMe spec it was built from, why anonymity is resolved in SQL, and the visit-counting bug proven against the live database. Read before touching `src/lib/share-impact.ts` or the share-link mint route.** |
| `59-FEE-SECTION-BENCHMARK-ADR.md` | **The fee band: a ledger instead of a donut that claimed 100%, the `--surface-ink` token, GoFundMe's verified published fees, and why the 12px footnote is `white/65`. Also: measure the measuring harness. Read before touching `WhereYourMoneyGoes` or homepage section lengths.** |
| `60-CATEGORY-GRID-MOBILE-ADR.md` | **Why `grid` with only `sm:grid-cols-2` gave phones one column (1,944px for 81 words), why the per-card "Browse ->" span and its `aria-label` were removed, and the mobile height budget for the homepage. Read before touching `CategoryShowcase` or adding a responsive grid.** |
| `61-HOMEPAGE-FAQ-COLLAPSE-ADR.md` | **Why the homepage FAQ is collapsed (the `FAQPage` JSON-LD, not the `open` attribute, earns the rich result), the invalid `<details>`-inside-`<dl>` markup it replaced, and the homepage mobile height budget across docs/59-61. Read before touching `HomepageFAQ`.** |
| `62-CAMPAIGN-ROW-BENCHMARK-ADR.md` | **Why the homepage shows three campaign cards on a phone and six on desktop, and the recorded-but-not-taken case for changing the card zero state (amends docs/47). Read before changing the homepage campaign row.** |
| `63-HOW-IT-WORKS-MERGE-ADR.md` | **Why "What LastDonor Does" and "3 Steps" became one interactive stepper, where `#ai-answer` lives now (the JSON-LD `speakable` selector depends on it), why tab panels stack in one grid cell, and the finding that our CSP blocks `unsafe-eval` so NO client component hydrates in `next dev` - verify interactivity with `next build && next start`.** |
| `64-DEV-CSP-AND-TRUST-BAR-ADR.md` | **Why `next.config.ts` adds `'unsafe-eval'` and `ws://localhost` to the CSP in DEVELOPMENT ONLY (without it React never hydrates in `next dev` and every client component is silently inert), with the byte-diff proving production is unchanged. Also the trust bar rebuild. Read before touching the CSP.** |
| `65-NO-CRON-SCHEDULER-FINDING.md` | **⛔ OPEN: NO cron has ever run in production. `vercel.json` is inert on Fly, the Cloudflare Worker that should replace it does not exist (account has 0 workers), and `audit_logs` confirms zero scheduled activity. `reconcile` (a financial control) and 8 other jobs are dead. Read before relying on any cron.** |
| `66-CRON-WORKER-ADR.md` | **The cron Worker: ONE `*/5` trigger because Cloudflare caps triggers at 5 PER ACCOUNT on free, why the table lives in `src/lib/cron-schedule.ts` (so unit tests cover the deployed code), why it targets `lastdonor.fly.dev`, and why `simulate-donations` is never scheduled. ⛔ Built and tested but NOT DEPLOYED: needs a Cloudflare token with Workers Scripts:Edit.** |
| `67-EMAIL-SHELL-ADR.md` | **One email shell for all 44 templates: why tables and VML (Outlook renders through Word), why no SVG or web fonts (Gmail strips both), the derived preheader, and FIVE fabricated statistics removed from outgoing mail. Read before touching `email-shell.ts`, `email-templates.ts` or `email-adaptive.ts`.** |
| `68-UPLOAD-BUCKET-HERO-DEDUP-NOTIFICATIONS.md` | **⛔ Every image upload was failing: `BUCKET_NAME = 'media'` but no `media` bucket existed (`NoSuchBucket`), returning a generic 500 that read as transient. Bucket created with limits mirroring `validateFile`. Also the hero/trust-bar duplication and the avatar notification badge. Read before touching uploads or `NotificationBell`.** |
| `69-FOOTER-MOBILE-ADR.md` | **Why footer link groups use `columns-2` on a phone and not a paired grid (a paired cell is DOM-adjacent but visually split, breaking focus order), why the homepage `<Newsletter />` section was removed as a duplicate of the footer strip, and the claims cut from the brand block. Read before touching the footer.** |
| `70-ICON-SYSTEM-ADR.md` | **The icon system: one grid, one stroke (1.75), a five-step size scale, `aria-hidden` by default. Import icons from `@/components/ui/icon`, never `@heroicons` directly - two ratchet tests stop the counts growing. Explains why 105 icons were NOT hand-redrawn, and the three attempts `ZeroFeeIcon` took.** |
| `71-CAMPAIGNS-AND-DETAIL-BENCHMARK-ADR.md` | **`/campaigns` and the detail page vs GoFundMe: our cards are already 2x denser, the real gap was 486px of chrome before the first card (58% of the fold vs their 28%). Three filter pills duplicated the Filters sheet, the tab strip showed "Completed 0", and the sticky donate bar said "0% funded" while the sidebar said "Be the first to donate". Also: the card zero state finally swapped (amends docs/47), and em dashes removed from 10 of 12 campaign stories.** |
| `71-CAMPAIGNS-AND-DETAIL-BENCHMARK-ADR.md` | `/campaigns` and the campaign detail page; the card zero state, finally changed |
| `72-DONATE-AND-CHECKOUT-BENCHMARK-ADR.md` | **⛔ OPEN: the platform cannot take a single donation. `STRIPE_SECRET_KEY` on Fly is the `sk_test_…0000` placeholder and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is empty in the image, so `create-checkout` 500s for every campaign and `donations` has 0 rows. Also the donate-page benchmark: 1,095px of sitewide chrome below the pay button, the 0% fee ledger, and why GoFundMe's preset ladder cannot be copied (they A/B test it — amends docs/47). Read before touching `/campaigns/[slug]/donate`, `DonationForm` or `create-checkout`.** |
| `73-EMAIL-DELIVERY-DIAGNOSIS.md` | **Mail delivery is NOT broken: the production Resend key works, `lastdonor.org` is verified, and all 7 emails ever sent were delivered. Almost nothing sends because every other template hangs off a donation (zero, docs/72) or a cron (never ran, docs/65). Read before debugging outbound mail.** |
| `74-PASSWORD-RESET-PATH-ADR.md` | **The reset path proven end to end against production (send → delivery → link → single-use token). Why `forgot-password` now sends an email on ALL THREE branches — including "you sign in with Google", which previously returned silence forever — without reopening the docs/32 oracle. Also the two templates docs/67 missed (the reset and the donor receipt, both inline in route handlers) and the unescaped `donorName` in the receipt. Read before touching forgot-password or the receipt.** |
| `75-CREATE-WIZARD-BENCHMARK-ADR.md` | **The create-campaign wizard vs GoFundMe, screen by screen. Screen 1 asked its question THREE times (step hero, a marketing h1 repeated on all six screens, and an h2) before the two buttons that answer it, plus a dead `STEPS` array naming the screens a fourth time. 2,715px against their 844px. One heading per screen now, and it is the question and the h1. `data-checkout` is renamed `data-focus-flow` and now covers this flow too. ⛔ Screens 2-6 not yet done. Read before touching `ShareYourStoryForm`.** |
| `76-GOAL-SCREEN-AND-SOCIAL-LINKS-ADR.md` | **Wizard screen 2 promised two things the product does not do: an "Automated goal setting" toggle (default ON, "Recommended") saying the goal would start at $600 and ramp — `autoGoal` was never POSTed, no column stores it, no job raises it — and a hardcoded "typically aim to raise $5,000" on a platform with zero donations. Both removed; `compute-starting-goal.ts` is ⛔ NOT WIRED. Also: the Organization `sameAs` claimed a LinkedIn and an X profile that both 404. `src/lib/social-links.ts` is now the one list feeding both the footer and `sameAs`, empty until real handles exist. Read before adding a social link or re-wiring auto-goal.** |
| `77-WIZARD-SCREENS-3-6-AND-THE-REVIEW-CLAIM.md` | **⛔ OPEN: campaigns are NOT reviewed before publication. `POST /api/v1/user-campaigns` inserts `status: 'active'` with `publishedAt` set and comments saying "instant-live, no review needed" — yet "reviewed before publication" is claimed in ~30 places across 18 files, including the Organization JSON-LD and the `/compare` table against GoFundMe. The three places that directly contradict the button were corrected; the rest needs an owner decision (gate on `under_review`, or change the claim). Also wizard screens 3-6 de-duplicated, and three unlabelled form fields given accessible names. Read before touching the review claim or `ShareYourStoryForm`.** |
| `78-REVIEW-GATE-ADR.md` | **Resolves docs/77 by making the claim true: `POST /api/v1/user-campaigns` now inserts `status: 'under_review'` with `publishedAt: null`, so nothing a user submits is public until an admin approves it. Approval stamps `publishedAt` (keyed on it being null, not on the previous status), logs `campaign.published` and sends the "Your Campaign Is Live!" email — which used to fire at submission. No turnaround time is quoted anywhere, deliberately. ⛔ `src/lib/news/campaign-publisher.ts` is STILL ungated and produced all 12 live campaigns, so "every campaign is reviewed" is not yet accurate. Read before touching campaign creation or the publish stamp.** |
| `79-REVIEW-GATE-COMPLETED-ADR.md` | **Closes the gate docs/78 half-opened: `src/lib/news/campaign-publisher.ts` now drafts to `under_review` too, so BOTH creation paths are gated and "every campaign is reviewed by a person before it goes live" is true without qualification (the donate-page sentence is restored, and a test ties it to both inserts). The news pipeline is no longer autonomous — it drafts, a person publishes. The 12 previously-live automated campaigns were moved into the queue (zero donations each; reversible from `_review_gate_backup_20261017`), so `/campaigns` is empty until an admin approves them in `/admin/campaigns`. Also fixes the dedup window, which ordered by `publishedAt` and would have generated duplicate campaigns about the same person while the first waited in the queue.** |
| `80-SOFT-404-ADR.md` | **⛔ OPEN: a nonexistent campaign/blog/category slug answers HTTP 200 with `x-nextjs-cache: HIT` — `revalidate` + `notFound()` means the not-found render is cached and a cached entry is served 200 whatever status it asked for. `noStore()` is NOT the fix: tried 2026-10-17 and reverted, it 500s all three routes because an unknown slug renders through on-demand ISR generation. It passed lint, typecheck, 5,679 tests AND `next dev` — only production showed it. Reproduce against `next build && next start` before retrying.** |
| `81-DIDIT-IDENTITY-VERIFICATION-ADR.md` | **Didit replaces Stripe Identity (which could never run — same dead key as docs/72). v1, not v2: v2 needs a console `workflow_id` we do not have, and an unexercisable code path is what docs/76 and docs/77 were about. The webhook has NO shared secret on purpose — it reads only a session id and re-fetches the decision over our own authenticated call, so a forged request cannot assert an outcome. Didit's "In Review" is their MANUAL queue and is NOT a pass. Columns `didit_session_id`/`didit_session_url` added in `migrations-v2/0002`; Stripe columns kept for history. Read before touching identity verification.** |
| `82-SMS-FOUNDATION-ADR.md` | **Phone normalisation before any SMS provider. `users.phone` was free text, admin-only, never validated or verified and read by NOTHING — sending to it would have meant sending to whatever somebody typed. `src/lib/phone.ts` (libphonenumber-js, not a regex: `+15551234567` is the right shape and still not dialable) plus `phone_e164` / `phone_verified_at` / `sms_consent_at` in `migrations-v2/0003`, timestamps not booleans per docs/41. `SMS_DEFAULT_REGION` defaults to KE while the site claims `areaServed: United States` — that tension is parked at one constant. ⛔ The Africa's Talking client is NOT built: no credentials exist, so it cannot be probed, and docs/81 forbids shipping an unexercised provider path.** |
| `83-VERIFICATION-WAS-UNREACHABLE.md` | **The Didit flow worked and nobody could reach it. The only link to `/dashboard/campaigns/[id]/verification` was an urgent banner gated on `status === 'active' && donorCount > 0` — both unsatisfiable after docs/79 (everything is `under_review`) and docs/72 (zero donations ever). Nothing failed; a route silently stopped being reachable as a side effect of work in another file. Fixed with `VerificationRow` on every campaign row, in every state. Lesson: trace the path a signed-in person clicks before calling an integration done.** |
| `84-AFRICAS-TALKING-PROBE-ADR.md` | **The SMS provider, probed rather than read about. A FAILED send answers HTTP 201 (`InvalidSenderId` arrives with an EMPTY `Recipients` array, `InvalidPhoneNumber` as `statusCode: 403`), 4xx bodies are `text/plain` so `res.json()` throws, no `Accept: application/json` gets you XML, balance goes NEGATIVE and is not a send guard, and `to=0712345678` is silently resolved to `+254712345678` by THEIR default region — so `sendSms` normalises first. The sandbox needs no Sender ID; the supplied key is sandbox-only (401 against live). Read before touching `src/lib/africastalking.ts` or sending any SMS.** |
| `85-PHONE-VERIFICATION-ADR.md` | **Resolves the storage question docs/82 left open: a `phone_verification_codes` table of its own, because `verification_tokens` is keyed `(identifier, token)` so there is nowhere to hang an attempt count, and an IP rate limit does NOT protect a six-digit code. Five attempts ON THE ROW, 10-minute expiry, one live code per user, 60s resend cooldown, SHA-256 only. Verifying a number is NOT consent to message it. Running in production with SANDBOX credentials, and the UI says so. Read before touching `/api/v1/users/phone`, the `sms` rate-limit tier (its entry must precede `/api/v1/users` in BOTH lookups) or SMS consent.** |
| `86-SMS-PROVIDER-FALLBACK-REJECTED.md` | **⛔ OPEN: the Africa's Talking app we have is `elopis`, ANOTHER PRODUCT'S — its delivery-report callback points at elopis.com. LastDonor needs its OWN app, because callbacks are ONE PER APP (both products cannot work), and the sender ID and opt-out list are shared too. Also: TalkNTalk assessed and rejected as a fallback — not a scam (Techspace Softwares Ltd is real, domain certs since 2025-03) but its delivery-code table is AT's VERBATIM, so it resells the same upstream and is no redundancy at all. Read before adding any SMS provider or reopening the fallback question.** |
| `87-THIRD-POOL-WEDGE-AND-NO-ADMIN-EXISTED.md` | **⛔ OPEN. FIVE pool wedges on 2026-10-17. Backends sit `state=active` + `wait=Client/ClientRead` with transactions open for HOURS, pinning Supavisor slots while Postgres itself is healthy. NOTHING IN POSTGRES BOUNDS THIS: `statement_timeout` is not armed while waiting on client input, `idle_in_transaction_session_timeout` only fires on `idle in transaction` (we set 5min — IT DOES NOT FIRE, proven), and tcp keepalives see a live Supavisor peer. The only working remedy is `pg_terminate_backend` by transaction age, which restored service twice with no deploy and no restart. LEADING HYPOTHESIS (unproven): docs/52's `pending.cancel()` leaves the extended-query sequence without its Sync and CREATES these — test by disabling it. `pg_cron` is NOT installed, so a watchdog needs an owner decision. Also: there were ZERO admin accounts, so all 31 admin pages were unreachable. Read with docs/37 and docs/52 before touching `src/db/`.** |
| `88-ADMIN-AUDIT.md` | **Admin audit: 17 defects found, 11 bug classes CLEAN. FIXED+DEPLOYED 2026-10-17: F1 (`/admin/verification` now renders the queue that can actually approve - the API was always correct, only the door was missing; `VerificationDashboard` deleted), F7 (Didit manual-review campaigns no longer filtered out), F6 (dashboard pending-review filtered on 3 values, 2 unmatchable - now `status='under_review'` alone, section always renders), F13 (DELETE now 409s on any non-draft; it used to hard-delete active/completed/under_review), F12 (`realDonationCount` renamed - it never filtered by source), F2 (admin could NOT open any identity document: `fileUrl` is a `supabase-private://` ref and the queue used it as an href; a new GET on the doc route signs + 302s, proven live 302 -> 200 application/pdf). STILL OPEN: F3,F4,F5,F8,F10,F14,F15,F16,F18 and pass-2 gaps (12 of 24 pages unmeasured at 390px, per-screen copy, non-campaign write actions). Read N1-N11 before re-checking anything.** |
| `audit-2026-10-14/` | Raw agent reports + executable proof scripts behind docs/29 |

---

## Commands

```bash
npm run dev            # dev server (Turbopack)
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run test:unit      # Vitest (5546 tests, 144 files, as of 2026-10-16)
npm run test:e2e       # Playwright (72 tests, 21 files)
npm run db:generate    # safe since 2026-10-14 (docs/34): diffs the baseline snapshot
npm run db:migrate     # safe since 2026-10-14 (docs/34): applies the validated baseline
```

Before any commit: `npm run lint && npm run typecheck && npm run test:unit`
must all pass. CI runs lint → typecheck → unit → security audit → integration →
build → E2E, and `npm ci` must succeed, so **keep `package-lock.json` in sync
with `package.json`** — a desynced lockfile fails every job.

---

## Conventions that are load-bearing

These exist for a reason; changing them has consequences beyond the local file.

- **Auth is JWT** (`src/lib/auth.ts`), not database sessions. This is what makes
  horizontal scaling free. Do not switch to DB sessions without reading
  `docs/26` §1.
- **The DB driver sets `prepare: false`** (`src/db/index.ts`) because Supabase's
  pooler runs in transaction mode on port 6543. Do not remove it. Migrations
  use port 5432 (session mode).
- **Middleware is default-deny.** New API routes are protected unless added to
  `PUBLIC_API_PREFIXES` in `src/middleware.ts`. Add to that list deliberately.
- **Cron routes authenticate via `verifyCronAuth`** (timing-safe Bearer compare).
  Every new cron route must call it.
- **The client session is read once, through `SessionBootstrap`.** Resolved
  2026-10-15, see `docs/44-SESSION-READ-RATE-LIMIT-ADR.md`. The outer
  `SessionProvider` is deliberately seeded with `session={null}`: that is what
  stops it fetching on mount and echoing its own BroadcastChannel announcement
  back into a second `GET /api/auth/session`. Do not remove that prop and do not
  mount a bare `SessionProvider`. Components that branch on being signed in use
  `useAuthState()` from `src/lib/auth-state.ts`, not `useSession().status`:
  a 429 or a failed read must render as **unknown**, never as signed out.
- **Migrations: one baseline, two inert directories.** Resolved 2026-10-14, see
  `docs/34-MIGRATION-BASELINE-ADR.md`. `drizzle.config.ts` points at
  `src/db/migrations-v2/`, which holds a single baseline generated from
  `schema.ts` — 179 statements, 31 tables, 24 enums, in 659 lines — that was
  validated against the live database inside `BEGIN … ROLLBACK` before adoption.
  (Corrected 2026-10-14: "659 statements" was the line count.) `src/db/migrations/`
  retains the original 33 files for history and is **inert**: the migrator reads
  only the journal of the directory `out` names (`drizzle-orm/migrator.js:12`).
  **Add new migrations to `migrations-v2/`, never to `migrations/`.**

  Why the old directory was abandoned: it holds **two overlapping lineages that
  cannot be replayed together** — `0007_smart_tusk.sql` (journaled) is a late
  regenerated baseline creating 15 enum types that `0015`, `0018` and `0019`
  (unjournaled) create again. Proven by a dry run failing with
  `42710: type "notification_type" already exists` against a database confirmed
  to hold zero enums. Separately `0027` adds a CHECK for `failed_login_count`,
  a column no migration there creates.

- **Donation idempotency — RESOLVED 2026-10-14.** The baseline creates
  `CREATE UNIQUE INDEX "idx_donations_stripe_payment_id"`, so the canonical name
  is genuinely UNIQUE and `onConflictDoNothing({ target: stripePaymentId })` in
  `payment-service.ts:103` is sound. This supersedes the earlier warning that
  `0000:190` created that name NON-unique while only unjournaled `0015:49`
  created a unique one under a different name. **Never drop this index** — it is
  the only replay protection against duplicate Stripe webhooks.

- **Stripe metadata is the disaster-recovery substrate.** `create-checkout`
  writes full donor context onto every PaymentIntent, which makes `donations`
  reconstructible from Stripe alone. Preserve this in any refactor.
- **Echo columns are currently BROKEN, not a convention to uphold.**
  `seedDonationCount`, `messageCount` and `updateCount` were intended as
  denormalised counters to avoid N+1 listing queries. Verified 2026-10-14: they
  are **never incremented anywhere** in `src/` — the only write is a reset to 0
  in `admin/seed/purge/route.ts:61`. Do not trust their values and do not cite
  them as a performance mitigation. Either populate them in the same transaction
  as the rows they count, or delete them. See docs/29.

  **Amended 2026-10-16 (docs/66):** the `reconcile` cron *does* repair them.
  Its first ever run reported `echoColumnFixes: 7`. They drifted because that
  job had never executed (docs/65), not because nothing repairs them. Once the
  cron Worker is deployed they are corrected daily. The underlying defect
  stands: nothing increments them in the transaction that creates the rows.
- **ISR needs a shared cache handler** above one instance. 26 pages use
  `revalidate` and 36 files call `revalidatePath`/`revalidateTag`; without a
  shared handler, multi-instance deploys serve stale HTML silently. See
  `docs/26` §5.

---

## Claims and verification

This project handles other people's money and publishes appeals on behalf of
real people. Accordingly:

- **Never add a claim the platform cannot substantiate.** A "501(c)(3)
  nonprofit" disclaimer was deliberately removed in `13a2726`; a stale test
  still asserting it was corrected rather than the claim restored. Trust copy is
  a factual assertion, not microcopy.
- **Prefer verifying to assuming.** When a test and the code disagree, work out
  which one drifted before changing either — in the last audit, 7 of 8 failures
  were stale tests and 1 was a real config regression.
- **Report test and CI results as they are**, including failures and anything
  skipped.
