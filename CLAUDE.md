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
| `50-CI-PIPELINE-NEVER-RAN-ADR.md` | **GitHub Actions had never run once. AMENDED TWICE; read amendment 2. There were TWO independent blockers, each sufficient on its own. (1) The workflow did not parse: `join(needs.*.result, " ")` — Actions expressions accept ONLY single-quoted literals, and a workflow that fails to parse is never queued, so it emits no run, no check run and no annotation. The YAML was always valid; it is the nested EXPRESSION language that rejected it, which is why five days of local checks saw nothing. Fixed, and now ratcheted by `src/ci-workflows.ratchet.test.ts` (4 rules, each proven by injection). (2) ⛔ STILL OPEN, OWNER-ONLY: `"The job was not started because your account is locked due to a billing issue."` — quoted from the check-run annotation of runs 1 AND 2, which are the only runs in repo history and both failed in 3s with no runner assigned. **Raising the spending budget does NOT clear it** (tested 2026-10-21: identical annotation afterwards) — a lock is not a cap, and settling the payment is what lifts it. The account is out of included minutes (2,000/2,000, $50.00 billable), but that spend is five OTHER private repos; `lastdonor` is public and absent from it, so CI here should cost nothing once unlocked. **So the pipeline CLAUDE.md describes below has still never gated anything, and the integration and E2E suites have never run on any change.** Also: runner pinned to `ubuntu-24.04` (`ubuntu-latest` is migrating to Ubuntu 26 from 2026-10-19), and `runs-on` canNOT read the `env` context.** |
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
| `65-NO-CRON-SCHEDULER-FINDING.md` | **RESOLVED 2026-10-18 (see docs/66). How it was found that NO cron had ever run in production: `vercel.json` is inert on Fly and `audit_logs` confirmed zero scheduled activity, so `reconcile` (a financial control) and 8 other jobs were dead for the platform's whole life. One correction: it says the Cloudflare account has 0 Workers - it had three, another product's, invisible to the read-only token.** |
| `66-CRON-WORKER-ADR.md` | **DEPLOYED AND FIRING since 2026-10-18T00:55:03Z - the first scheduled job in production history. ONE `*/5` trigger because Cloudflare caps Cron Triggers at 5 PER ACCOUNT on free (and the account is SHARED with another product's three Workers), the table lives in `src/lib/cron-schedule.ts` so unit tests cover deployed behaviour, it targets `lastdonor.fly.dev` to dodge the 100s proxy ceiling, exports no `fetch` handler so it has no HTTP surface, and `simulate-donations` is deliberately NOT scheduled. Verified by the Worker's own log (`update-phases ok 200`, 1ms CPU of the 10ms free ceiling) and by a `cron.publish_campaigns` audit row. `reconcile` now runs 04:00 UTC daily and the news pipeline drafts to `under_review` every 30 min. Also records the credential dead ends, including an IP allow-list I advised from a `curl` measurement when the real calls egress from a different, unstable address - measure the path the actual calls take.** |
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
| `77-WIZARD-SCREENS-3-6-AND-THE-REVIEW-CLAIM.md` | **RESOLVED by docs/78 + docs/79 (this row said ⛔ OPEN for two days after the fix shipped - corrected 2026-10-19; both insert paths verified writing `under_review`). History of the finding: campaigns were NOT reviewed before publication. `POST /api/v1/user-campaigns` inserts `status: 'active'` with `publishedAt` set and comments saying "instant-live, no review needed" — yet "reviewed before publication" is claimed in ~30 places across 18 files, including the Organization JSON-LD and the `/compare` table against GoFundMe. The three places that directly contradict the button were corrected; the rest needs an owner decision (gate on `under_review`, or change the claim). Also wizard screens 3-6 de-duplicated, and three unlabelled form fields given accessible names. Read before touching the review claim or `ShareYourStoryForm`.** |
| `78-REVIEW-GATE-ADR.md` | **Resolves docs/77 by making the claim true: `POST /api/v1/user-campaigns` now inserts `status: 'under_review'` with `publishedAt: null`, so nothing a user submits is public until an admin approves it. Approval stamps `publishedAt` (keyed on it being null, not on the previous status), logs `campaign.published` and sends the "Your Campaign Is Live!" email — which used to fire at submission. No turnaround time is quoted anywhere, deliberately. ⛔ `src/lib/news/campaign-publisher.ts` is STILL ungated and produced all 12 live campaigns, so "every campaign is reviewed" is not yet accurate. Read before touching campaign creation or the publish stamp.** |
| `79-REVIEW-GATE-COMPLETED-ADR.md` | **Closes the gate docs/78 half-opened: `src/lib/news/campaign-publisher.ts` now drafts to `under_review` too, so BOTH creation paths are gated and "every campaign is reviewed by a person before it goes live" is true without qualification (the donate-page sentence is restored, and a test ties it to both inserts). The news pipeline is no longer autonomous — it drafts, a person publishes. The 12 previously-live automated campaigns were moved into the queue (zero donations each; reversible from `_review_gate_backup_20261017`), so `/campaigns` is empty until an admin approves them in `/admin/campaigns`. Also fixes the dedup window, which ordered by `publishedAt` and would have generated duplicate campaigns about the same person while the first waited in the queue.** |
| `80-SOFT-404-ADR.md` | **RESOLVED 2026-10-18, and the original diagnosis in it was WRONG. The soft 404 was never about ISR: a probe page that is `force-dynamic`, synchronous, uncached, and whose literal first statement is `notFound()` still answered 200. The cause is `loading.tsx` — it wraps every route beneath its segment in an implicit `<Suspense>`, React flushes the shell (and the 200 status line) before the page finishes, so `notFound()` can swap the body but not the status. Removing `src/app/loading.tsx` turned every probe 200 into a 404, INCLUDING the `revalidate = 60` shape the old doc blamed. Fixed by scoping all five `loading.tsx` files into route groups (`(home)`, `campaigns/(index)`, `blog/(index)`, `dashboard/(index)`, `admin/(index)`); `campaigns/[slug]/loading.tsx` and `blog/[slug]/loading.tsx` were DELETED, so those two pages have no skeleton until someone puts an explicit `<Suspense>` inside the page below the lookup. The ratchet `src/app/soft-404.ratchet.test.ts` found NINE more affected routes behind auth that nobody had looked for. Do NOT add a `loading.tsx` above a route that calls `notFound()`.** |
| `81-DIDIT-IDENTITY-VERIFICATION-ADR.md` | **Didit replaces Stripe Identity (which could never run — same dead key as docs/72). v1, not v2: v2 needs a console `workflow_id` we do not have, and an unexercisable code path is what docs/76 and docs/77 were about. The webhook has NO shared secret on purpose — it reads only a session id and re-fetches the decision over our own authenticated call, so a forged request cannot assert an outcome. Didit's "In Review" is their MANUAL queue and is NOT a pass. Columns `didit_session_id`/`didit_session_url` added in `migrations-v2/0002`; Stripe columns kept for history. Read before touching identity verification.** |
| `82-SMS-FOUNDATION-ADR.md` | **Phone normalisation before any SMS provider. `users.phone` was free text, admin-only, never validated or verified and read by NOTHING — sending to it would have meant sending to whatever somebody typed. `src/lib/phone.ts` (libphonenumber-js, not a regex: `+15551234567` is the right shape and still not dialable) plus `phone_e164` / `phone_verified_at` / `sms_consent_at` in `migrations-v2/0003`, timestamps not booleans per docs/41. `SMS_DEFAULT_REGION` defaults to KE while the site claims `areaServed: United States` — that tension is parked at one constant. ⛔ The Africa's Talking client is NOT built: no credentials exist, so it cannot be probed, and docs/81 forbids shipping an unexercised provider path.** |
| `83-VERIFICATION-WAS-UNREACHABLE.md` | **The Didit flow worked and nobody could reach it. The only link to `/dashboard/campaigns/[id]/verification` was an urgent banner gated on `status === 'active' && donorCount > 0` — both unsatisfiable after docs/79 (everything is `under_review`) and docs/72 (zero donations ever). Nothing failed; a route silently stopped being reachable as a side effect of work in another file. Fixed with `VerificationRow` on every campaign row, in every state. Lesson: trace the path a signed-in person clicks before calling an integration done.** |
| `84-AFRICAS-TALKING-PROBE-ADR.md` | **The SMS provider, probed rather than read about. A FAILED send answers HTTP 201 (`InvalidSenderId` arrives with an EMPTY `Recipients` array, `InvalidPhoneNumber` as `statusCode: 403`), 4xx bodies are `text/plain` so `res.json()` throws, no `Accept: application/json` gets you XML, balance goes NEGATIVE and is not a send guard, and `to=0712345678` is silently resolved to `+254712345678` by THEIR default region — so `sendSms` normalises first. The sandbox needs no Sender ID; the supplied key is sandbox-only (401 against live). Read before touching `src/lib/africastalking.ts` or sending any SMS.** |
| `85-PHONE-VERIFICATION-ADR.md` | **Resolves the storage question docs/82 left open: a `phone_verification_codes` table of its own, because `verification_tokens` is keyed `(identifier, token)` so there is nowhere to hang an attempt count, and an IP rate limit does NOT protect a six-digit code. Five attempts ON THE ROW, 10-minute expiry, one live code per user, 60s resend cooldown, SHA-256 only. Verifying a number is NOT consent to message it. Running in production with SANDBOX credentials, and the UI says so. Read before touching `/api/v1/users/phone`, the `sms` rate-limit tier (its entry must precede `/api/v1/users` in BOTH lookups) or SMS consent.** |
| `86-SMS-PROVIDER-FALLBACK-REJECTED.md` | **⛔ OPEN: the Africa's Talking app we have is `elopis`, ANOTHER PRODUCT'S — its delivery-report callback points at elopis.com. LastDonor needs its OWN app, because callbacks are ONE PER APP (both products cannot work), and the sender ID and opt-out list are shared too. Also: TalkNTalk assessed and rejected as a fallback — not a scam (Techspace Softwares Ltd is real, domain certs since 2025-03) but its delivery-code table is AT's VERBATIM, so it resells the same upstream and is no redundancy at all. Read before adding any SMS provider or reopening the fallback question.** |
| `87-THIRD-POOL-WEDGE-AND-NO-ADMIN-EXISTED.md` | **SEVEN pool wedges on 2026-10-17. Backends sit `state=active` + `wait=Client/ClientRead` with transactions open for HOURS while Postgres itself is healthy, and NOTHING IN POSTGRES BOUNDS IT (`statement_timeout` is not armed waiting on client input; `idle_in_transaction_session_timeout` only fires on `idle in transaction` - proven not to fire). RESOLVED IN A LOCAL LAB (amendment 5): 50 concurrent queries on a pool of 5 are HARMLESS (13ms), so fan-out queueing was never the cause; what wedges is enough concurrent client-side TIMEOUTS to exhaust the pool WITH `pending.cancel()` disabled - 5 timeouts, cancel off, leaves 5 stuck backends and a dead pool. This REVERSES amendments 2-3: cancel SAVES the pool. And `DB_CANCEL_ON_TIMEOUT=0`, amendment 3's experiment, was STILL SET ON FLY - production ran in the wedging configuration for days. Now unset. ⛔ STILL OPEN: production through Supavisor also leaves stuck backends on wide fan-out even with cancel ON, which the lab (direct Postgres) cannot reproduce; every route is now capped at 3 concurrent queries with an AST ratchet (`src/db/pool-fanout.ratchet.test.ts`), and the terminate-by-age watchdog is NOW BUILT (`src/db/wedge-watchdog.ts`, amendment 6): it sweeps every 60s for `active`/`ClientRead` backends with a transaction older than 300s, on its OWN `max: 1` connection because a watchdog that borrows the wedged pool cannot clear it, started from `src/instrumentation.ts`. `DB_WATCHDOG=off` disables, `dry-run` reports only. Proven against the real signature, reproduced with `BEGIN; COPY ... FROM STDIN;` - which also CORRECTS amendment 5: its 5-timeout reproduction exhausted the pool but left backends in `Timeout:PgSleep`, not `ClientRead`. Read with docs/37 and docs/52 before touching `src/db/`.** |
| `88-ADMIN-AUDIT.md` | **Admin audit: 17 defects found, 11 bug classes CLEAN. FIXED+DEPLOYED 2026-10-17: F1 (`/admin/verification` now renders the queue that can actually approve - the API was always correct, only the door was missing; `VerificationDashboard` deleted), F7 (Didit manual-review campaigns no longer filtered out), F6 (dashboard pending-review filtered on 3 values, 2 unmatchable - now `status='under_review'` alone, section always renders), F13 (DELETE now 409s on any non-draft; it used to hard-delete active/completed/under_review), F12 (`realDonationCount` renamed - it never filtered by source), F2 (admin could NOT open any identity document: `fileUrl` is a `supabase-private://` ref and the queue used it as an href; a new GET on the doc route signs + 302s, proven live 302 -> 200 application/pdf), F3 (508-line dead FundReleaseDashboard deleted), F4+F5 (admin had FIVE currency implementations and none used `Money`; `/admin/payouts` rendered $1,250.5 and $1,200 while `/admin` showed $1,250.50 for the SAME row - all now go through `Money`/`centsToDollars`, with PipelineMonitor and SystemSettings' editable input deliberately exempt), F15 (every period boundary was the SERVER's zone while labelled "Today" - now `src/lib/reporting-timezone.ts`, `REPORTING_TIMEZONE` default UTC, and the screens name the zone), F16 (ALL EIGHT capped admin lists stated two totals at once - `/admin/users` said "of 200" with 239 in the table; `ListCount` now prints the page range, the loaded count and the true count, and warns that browser-side search only sees the loaded rows), F18 (half withdrawn - `/admin/audit-log` already scrolled correctly; six tables in four components genuinely had no scroll wrapper), F8 (`/admin/campaigns` fetched the WHOLE table and tallied its tiles in JS over it: 222 campaigns meant 793KB of HTML and a 15,633px page - now capped at 200 with tiles from `GROUP BY status`, because capping alone would have made the tiles lie), F10 (`/api/v1/admin/dashboard` deleted: no callers, and three divergent shapes between the spec, the route and the page), F14 (SIXTEEN inert `revalidate` exports removed - the admin layout's `force-dynamic` governs the subtree, and FOUR of those pages never call `auth()` at all, so that layout line is load-bearing: do NOT add `revalidate` to an admin page). F9 (`/admin/simulation` was not merely inert - it took 15.8s and rendered the ERROR BOUNDARY inside a 200, which is why the pass-1 status-code sweep missed it; it now names all THREE independent blockers, read from the env var, `CRON_JOBS` and the latest `cron.%` audit row, and its query fan-out exceeded the 5-connection pool and triggered the sixth wedge - see docs/87 amendment 4). Every numbered pass-1 finding is now closed. STILL OPEN: pass-2 gaps (12 of 24 pages unmeasured at 390px, per-screen copy, non-campaign write actions). Read N1-N11 before re-checking anything.** |
| `90-NEWS-SOURCE-COVERAGE-ADR.md` | **The GNews replacement, and the 48 dead RSS feeds nobody could see. Measured from the PRODUCTION machine: 72 of 125 feeds live, 5 answering 200 with no items, 48 dead - both wire services gone (`feeds.reuters.com` NXDOMAIN, `feeds.apnews.com` no A record) and ALL FIVE first-responder feeds dead in a category the platform runs campaigns for. The same probe from the sandbox said 49 live / 72 dead because BBC, Guardian, NYT and LA Times 403 the sandbox proxy and 200 from Fly - a list "verified" from a laptop would have deleted nine working feeds. A browser `User-Agent` + `Accept` changed nothing: the blocking is IP/ASN-level. GNews itself covers 37 countries (its own OpenAPI spec) and Egypt is the only African one; NewsData.io is the recommended replacement (any ISO 3166-1 code, 5 per request, 200 credits/day) but is NOT BUILT - no key exists and docs/81 forbids an unexercised provider path. Google News RSS rejected (links are opaque `CBMi…` tokens returning 584KB of JS, not article URLs); GDELT rejected (429 on 3 of 5 requests from Fly at 16-21s spacing). Also: `fetchGNewsArticles` swallowed every error and returned `[]`, so blackout detection for GNews was DEAD CODE. Read before touching `rss-parser.ts`, `gnews-client.ts` or adding a news source.** |
| `91-SOCIAL-PLACEHOLDERS-ADR.md` | **Footer socials as placeholders (X, Instagram, Facebook, LinkedIn, TikTok, YouTube, WhatsApp) without reopening docs/76. The distinction the whole thing rests on: a footer link is a link, but `sameAs` is a machine-readable claim that we OWN that account - so a placeholder (`href: null`) renders as inert text in the footer and is absent from `sameAs` entirely. `layout.tsx` reads `PUBLISHED_SOCIAL_LINKS`, never `SOCIAL_LINKS`, and two tests read the call sites as TEXT because the type system stops complaining the moment someone writes `l.href!`. Placeholders are deliberately visible on the live site (owner's call, over the safer hidden-until-real option) and are text not brand icons, because the icon system is stroke-only (docs/70) and all seven marks are filled. Read before adding a social link or a brand SVG.** |
| `92-PAYHERO-GATEWAY-AND-MULTI-CURRENCY-ADR.md` | **DEPLOYED (v85) AND TAKING MONEY — two real KES 50 donations collected over M-Pesa and recorded 2026-10-21, the first in this codebase's history, the second through the deployed donate page in a real browser (settled in 17.4s; exactly one donation per push with both the callback and the poll live) (supersedes the docs/72 blocker on the KES rail; Stripe is still dead). A multi-currency ledger: a campaign has ONE currency, enforced by a COMPOSITE FK on `(campaign_id, currency)`, which also makes a campaign's currency immutable once money arrives. Four probed PayHero traps, every one absent from or contradicting its docs: `success: true` does NOT mean the payment succeeded (observed alongside `status: "FAILED"`); a BLANK `reference` returns HTTP 200 with ANOTHER MERCHANT'S transaction; our `external_reference` is not a lookup key (404), so PayHero's reference MUST be persisted or the payment is unverifiable; 4xx bodies arrive as `text/plain` carrying JSON under two different error schemas. The callback has NO shared secret because PayHero signs with nothing — it reads one id and re-fetches the outcome (docs/81 shape). Isolated from BETWOIN LTD, the owner's other company on the same account, by an `LD-` reference namespace. Per-PHONE abuse limiting in the database, because an attacker spamming a stranger's number gets that bystander blocked by PayHero for 24h and an IP limit cannot stop it (docs/85). Three guards against a ~130x wrong payout. Its credential audit was itself corrected: the Cloudflare token is VALID (it is an account-owned `cfat_` token that verifies at `/accounts/{id}/tokens/verify`, not `/user/...`), and the supplied Resend key is rejected by Resend while production holds its own - so docs/73 is NOT overturned. Also corrects two of its own claims from the live test: the published fee table is wrong (flat KES 8.9, not KES 6, so 17.8% absorbed at the floor) and the service wallet is a FEE FLOAT that collections DRAIN (~250 collections of headroom), not collected funds. Also: a forged callback claiming a nine-million-shilling success is ignored in production, and PayHero's callback is treated as an accelerator because the status POLL settles payments on its own - whether PayHero posts at all is still unproven. Read before touching money, currency, or either gateway.** |
| `89-ECHO-COUNTERS-AT-THE-SOURCE.md` | **The echo counters are incremented where the rows are written now - use `insertCampaignUpdate`/`insertCampaignMessage` from `src/lib/echo-counters.ts`, never a direct insert (a ratchet enforces it). Found because a reconcile prediction was WRONG: predicted 1 fix, got 4, because `update-phases` had started running two hours earlier and wrote three updates without touching `update_count`. Also records how adding one `server-only` import broke FIVE suites at collection while the summary still read '5898 passed' - 80 tests silently not running - now fixed by aliasing `server-only` in `vitest.config.ts`.** |
| `93-SUBMISSION-RECEIPT-AND-AN-UNKEPT-PROMISE.md` | **The campaign-submission receipt cut from 95 visible words to 43, and the two defects found behind it. ✅ RESOLVED 2026-10-25 (owner decision: reject with a reason - the organiser is emailed the admin's words; the revision loop was offered and NOT taken). Reaching that took three fixes, not one email: the refusal path called `notifyCampaignSuspended`, which iterates SUBSCRIBED DONORS, so an unpublished campaign mailed nobody and returned 200; the Suspend button in `CampaignDetail` posted `publicReason` to a schema requiring `reason`, so it answered 400 EVERY time it was ever pressed; and `PATCH .../[campaignId]` allowed a SECOND, reasonless `under_review -> suspended` door, now removed. History of the finding: a campaign REFUSED at review notified NOBODY, organiser included — `under_review` transitions only to `active` or `suspended`, and the suspend path reaches `notifyCampaignStatusChange`, which returns early for anything outside `['completed','archived']` and addresses DONORS, of which an unpublished campaign has none. The email used to promise "We will email you as soon as it is decided. If anything needs changing first, we will tell you exactly what" — neither half is true, and it is removed rather than the path invented, because what happens to a refused campaign is a policy call. Also: an admin who submitted a campaign got BOTH the receipt and an "[Admin] Review needed" about their own submission (now skipped for the submitter only — every OTHER admin still gets it, and a test pins that half). Also: the preheader is now explicit, because `derivePreheader` was copying the subject into the one slot that could add something. Read before touching the submission mail or adding a review outcome.** |
| `94-PLAIN-LANGUAGE-EMAIL-ADR.md` | **All 45 outgoing emails rewritten for a reader who left school early or reads English as a second language. 20 of 45 were over budget, worst at grade 15.5 (postgraduate) — and the worst prose in the product was the VERIFICATION family, which talks to people about their ID and their money. Now 0 of 45 over, average grade 2.9. Enforced by `src/lib/email-plain-language.ratchet.test.ts` (grade <= 8, no sentence over 20 words, no jargon from the glossary in `src/lib/email-readability.ts`); inspect with `npx tsx scripts/email-readability.ts --verbose`. ⛔ Do NOT raise the budget to make a template pass. Also: an explicit preheader was injecting RAW campaign titles into the markup (`renderEmail` now escapes an explicit preheader and leaves a derived one alone), and FIVE more unsubstantiated claims were removed from outgoing mail — including "sent by a real person on our team, not an automated system" in an automated template, and two Stripe-specific lines on a platform whose live rail is PayHero. Read before writing any email copy.** |
| `96-MANUAL-DEPLOY-FROM-WINDOWS.md` | **`scripts/deploy.ps1`: the owner deploys by hand from PowerShell, and auto-deploy stays off. The script runs the gate BEFORE building, because with CI dark a manual deploy is the only gate there is; it also refuses a dirty tree, a non-main branch or a branch behind origin, and checks health after. `-DryRun` first — there is no PowerShell in the agent sandbox, so it was statically checked and NEVER RUN. Two traps encoded: `$ErrorActionPreference='Stop'` does NOT catch a native non-zero exit (so every call checks `$LASTEXITCODE`), and yet it DOES throw on native stderr merged with `2>&1` (so captures drop to 'Continue'); also `curl` is an alias for `Invoke-WebRequest` on Windows, and ternary/`??` are PS7-only and fail to PARSE on 5.1. ⚠️ CORRECTS A PREMISE: waiting ~10 days for Actions credits probably will not unblock CI — the annotation says the account is LOCKED for billing, raising the budget already failed to clear it, and `lastdonor` is PUBLIC so its minutes are free and absent from the $50 spend (five other private repos). Expect to settle a payment, not wait out a clock.** |
| `95-BIMI-LOGO-ADR.md` | **The logo in the Gmail sender avatar. That slot is NOT a favicon — email clients do not read favicons; it is BIMI, which is a DNS record plus a paid certificate. ✅ BUILT: `public/bimi-logo.svg`, SVG Tiny PS, generated by `scripts/generate-bimi-logo.py` from the real DM Serif Display outlines (a BIMI logo cannot reference a font, so letters must be paths); `src/app/icon.svg` regenerated from the SAME outlines, replacing Georgia `<text>` that fell back to an arbitrary serif on Linux and Android. Pinned by `src/lib/bimi-logo.ratchet.test.ts` — a file that violates the profile is REJECTED silently, with no error anywhere. ⛔ OWNER-ONLY AND BLOCKED: DMARC is `p=none` with NO `rua=`, and BIMI needs `p=quarantine`/`p=reject` with `sp=` and `pct=100`; Google requires a PEM (VMC or CMC) and an SVG-only record is NOT enough for Gmail. Moving DMARC to enforcement can quarantine legitimate mail — collect `rua=` reports first. Read before touching the logo, the favicon or DMARC.** |
| `97-CI-RAN-AND-COST-CONTROLS.md` | **CI EXECUTES as of 2026-10-22 — the owner settled the billing charge and the lock lifted, so run 3 is the first in repo history to reach a runner (settles the one assumption docs/96 §3 left open: a payment lifts it, a quota reset does not). Read before touching `.github/workflows/`, the Node version or anything about Actions cost. ⚠️ CORRECTS THE INSTINCT: this repo is PUBLIC, so its standard-runner minutes are free and it never cost a cent — the $50 is five OTHER private repos, `invest254` alone $44.15, all outside this session's scope. The first run immediately caught three real defects: (1) CI was the ONLY place on Node 20, which was EOL 2026-04-30, while `.nvmrc`, the Dockerfile and every dev machine said 22 — so `fs.globSync` (Node 22+) failed 3 tests in CI and passed everywhere else, and worse, CI could not have caught a Node 22 defect at all; (2) `glob` was imported by FOUR files and declared by NONE, reachable only as a 4-levels-deep transitive dep of `@sentry/nextjs` — a Sentry upgrade would have broken the security-audit gate; (3) no `engines` field stated the Node floor everything assumed. Controls: `timeout-minutes` on every job cuts worst-case exposure from 3,240 to 175 job-minutes (nothing had one; GitHub's default is 360 PER JOB), and `paths-ignore` skips the 28% of commits that are docs-only — with the hazard that this makes a docs-only PR unmergeable if `ci-complete` ever becomes a required check. ⛔ STILL OPEN, OWNER-ONLY: set a SPENDING LIMIT (a budget alerts, a limit stops — raising the budget to 100 did nothing), port the timeouts to the five private repos, and set `TEST_DATABASE_URL` — integration and E2E still never run, now because the secret is absent rather than because jobs are blocked. Records why `node_modules` caching, job consolidation and the `next start` E2E switch were all REJECTED.** |
| `98-INTEGRATION-SUITE-FIRST-RUN.md` | **The integration suite RAN for the first time in the project's history, and it RACED ITSELF. Resolves docs/97 §4 for integration — and the owner action docs/97 asked for was the WRONG answer: `integration-tests` now runs its own `postgres:16` SERVICE CONTAINER with a literal URL, so `TEST_DATABASE_URL` is not referenced by that job at all. ⛔ Setting that secret is REFUSED, not merely risky: the job runs `db:migrate` then a suite whose every file calls `clearDatabase()` in `beforeEach`, and the only connection string this project has is PRODUCTION — it would truncate the live database of a platform holding real money. The finding: three runs from IDENTICAL fresh databases gave 50, 23 and 18 failures, because Vitest parallelises files while all of them truncate one shared database (the symptom is FK violations like `campaigns_creator_id_users_id_fk`, a test whose fixture user a sibling deleted mid-test). `fileParallelism: false` + `sequence.concurrent: false` turned 49 of 50 failures into passes — do NOT remove them to go faster; the run is 20s, and parallelism needs a database per worker (`VITEST_POOL_ID`), not a shared one. The suite was WRITTEN for serial execution and never run, so nobody found the config didn't serialise it. The one real failure was a STALE TEST about money: it asserted a DB `CHECK (amount >= 500)` that `migrations-v2/0005` deliberately dropped for `> 0` when multi-currency landed (500 KES minor units is ~US$0.04 — a real floor on one currency, meaningless on the other); the per-currency floor lives in `CURRENCIES[code].minDonationMinor`. Both halves are now asserted so re-adding the old constraint fails. Verified: `gen_random_uuid()` needs NO extension on PG13+ (in core — the one thing that could have made plain Postgres differ from Supabase), `db:migrate` exits 0, `DATABASE_URL` is the ONLY variable the suite needs, 83/83 on three consecutive fresh databases.** |
| `99-E2E-SEED-FIXTURE-AND-SPEC-DRIFT.md` | **The E2E seed fixture and the spec reconciliation. READ §8 — it supersedes several numbers in §1-§3 of the same doc. The suite collects **292 tests across four projects**, and every figure measured before 2026-10-22 was the **Desktop Chrome project alone** (73); "32 failed / 25 passed" is WITHDRAWN (concurrent axe probes were crashing browsers, so it measured contention), and so is "globalSetup runs before webServer, verified from run output" — it was not verified, and the dependency is now removed rather than asserted. The reconciliation found **five product defects** in code, not specs: (1) the homepage `<ol role="tablist">` with `role="tab"` buttons inside `<li>`s — an ARIA role REPLACES native semantics, so one mistake was three axe violations over 7 nodes; (2) the same class on `/campaigns`, `role="tab"` on a non-focusable span AND on a Link that navigates away, unreachable because the review gate left `completedCount` at 0; (3) the TWO dark-mode toggles each held their own copy of the theme, so using one made the other's next press a silent no-op (one `useDarkMode` hook now, synced by MutationObserver — proven by injection: 3 of 5 new tests fail against the old components while the per-component suite stays green); (4) `DonationForm`'s `role="radiogroup"` had NO roving tabindex and NO key handler, so arrow keys did nothing and a keyboard donor needed NINE tab presses to cross the amounts — fixed via `src/lib/radio-group-keys.ts`, and ⛔ `ShareYourStoryForm` still has FIVE more of the same; (5) the skip link and footer contrast (§4). Also: ten tests across seven files were wrapped in `if (await locator.isVisible())`, and **`isVisible()` does not wait** — the `timeout` option does not make it poll — so those bodies silently skipped and the tests passed asserting nothing; `e2e-18` asserted `toHaveURL(/\/(admin|login)/)`, which passes whether a protected route is guarded or wide open. ⛔ `AUTH_TRUST_HOST=true` is REQUIRED for E2E and was missing from §6: without it every `/api/auth/session` fails with `UntrustedHost` off Vercel, the middleware auth layer goes INERT, and anything branching on being signed in is measured against a broken endpoint. A missing `PASSWORD_PEPPER` 500s every route in a production build and Playwright reports only a webServer timeout with `expected: 0, unexpected: 0`, which reads like a pass. Firefox/WebKit moved behind `PW_ALL_BROWSERS=1` (nothing in the repo installs them; ~146 of 292 tests could only fail) and that WebKit gap is OPEN. `stripe-payment-e2e` is skipped at file level — no card rail (docs/72), and its 120s timeout cost two minutes a run.** |
| `100-RADIO-GROUP-KEYBOARD-ADR.md` | **All SEVEN hand-rolled `role="radiogroup"`s now implement the pattern they claim. An ARIA role is a promise about BEHAVIOUR: a radio group is ONE tab stop with arrow keys inside it, and none of the seven had a key handler or managed `tabIndex` — so arrow keys did nothing (the one interaction a screen reader tells its user to use) and the groups were 23, 7, 6, 3 and 2 tab stops instead of one each. ⚠️ axe did NOT flag any of it: `aria-checked` and the parent role were all correct, and keyboard behaviour is not something axe can see — three of these sat on pages passing a full WCAG 2.1 AA run. Use `onRadioGroupKeyDown` + `rovingTabIndex` from `src/lib/radio-group-keys.ts`; if a new group is a plain list of labels, use a native `<input type="radio">` instead. The first-option fallback in `rovingTabIndex` is LOAD-BEARING — four of the seven groups render with nothing selected, and without it every option would be `-1` and the group unreachable by keyboard. ⛔ Two groups (the review-screen category and relationship editors) pass `{ selectOnMove: false }` and that is NOT a style choice: selecting there calls `setEditField(null)` and UNMOUNTS the group, so select-on-move would let the first ArrowRight commit a value and close the panel, leaving 22 of 23 categories unreachable — a REGRESSION on markup that previously had 23 tab stops. Read §3 before changing any `selectOnMove`.** |
| `101-PRE-VERIFICATION-RAISE-CAP-ADR.md` | **An unverified campaign may now raise only up to a per-currency cap (US$500 / KES 50,000). Money OUT was always gated on verification (`withdraw/route.ts` refuses anything but `fully_verified`, and `createTransfer` has exactly ONE caller) while money IN was gated on campaign STATUS ONLY — so all 20 production campaigns, every one `unverified`, could raise without limit and only discover at payout that they could not be paid. The review gate of docs/78-79 is UNTOUCHED: the owner declined instant go-live, because it would falsify 44 lines across 23 files including the site title itself. ⚠️ Contains the drizzle trap worth reading before writing ANY `sql` template: interpolating a Column renders it **UNQUALIFIED**, so `WHERE ${donations.campaignId} = ${campaigns.id}` emits `WHERE "campaign_id" = "id"`, both resolve to the inner table, and the subquery returns 0 for every row — valid SQL, no error, cap silently never fires. Unit tests, the text ratchet and typecheck ALL passed; only running it against a real Postgres caught it. The cap is measured over REAL un-refunded donations via `src/db/real-raised.ts`, never the seed-blended `raised_amount`. The concurrency overshoot is accepted and TESTED as a known bound, not closed — closing it would mean auto-refunding, which moves money.** |
| `102-FX-RATES-ADR.md` | **Exchange rates, DISPLAY ONLY. Providers chosen by PROBING them from the sandbox AND from the production machine (docs/90 habit): primary `open.er-api.com`, fallback `@fawazahmed0` over jsDelivr. ⚠️ `api.frankfurter.dev` is the obvious clean choice and is USELESS here - ECB reference rates are 29 currencies and `has_KES: false`, and KES is our only working rail. `api.exchangerate-api.com/v4` rejected as FAKE REDUNDANCY (same operator as the primary - the docs/86 lesson); `exchangerate.host` now 401s. TWO TRAPS: the primary reports its OWN errors with **HTTP 200** (`{"result":"error"}`), so `res.ok` proves nothing (docs/92's PayHero trap again); the fallback's keys are lowercase and include crypto (`1inch`, `btc`). Staleness is a REFUSAL - past 48h `convertMinor` returns null and the UI renders nothing, because a money figure you cannot date is worse than none. Attribution is a LICENCE TERM, pinned by a ratchet. The boundary is enforced mechanically: an import allowlist fails the build if any money-writing module can see a rate. Also records a mutation survivor fixed rather than excused (hardcoded `100` vs reading each currency's exponent - the 100x bug waiting for UGX/RWF/XOF), and the finding that `vitest.config.integration.ts` did NOT alias `server-only`, so EIGHT server modules were silently unreachable from the integration suite.** |
| `103-WORLD-CURRENCIES-AND-COUNTRY-DETECTION.md` | **152 currencies, 254 countries and 549 timezones added, with NO gateway (owner's call: gateways later). The design that makes that safe: **KNOWN is not COLLECTABLE**. `CURRENCIES` still means "we can take money in this" and still holds two entries, so none of the 16 money-path consumers changed; `WORLD_CURRENCY_EXPONENTS` means "this is a real currency and we know its decimals". Pouring 152 into `CURRENCIES` would have needed 150 invented floors/caps and could have stranded a campaign in a currency no gateway can settle - the composite FK makes a campaign's currency immutable once money arrives. ⚠️ ISO 4217 and CLDR DISAGREE on 13 currencies (IQD is 3 vs 0 - a factor of 1,000); display follows CLDR, ISO is kept beside it, and a test forbids any of the 13 becoming collectable. ⚠️ CORRECTED 2026-10-24 by docs/105: when this was written `CF-IPCountry` did not exist here (every record `proxied=false`). The apex and `www` ARE proxied now, so it exists on those - but NOT on `origin.lastdonor.org` or `lastdonor.fly.dev`, so it is still not a dependable input and detection stays browser-side by this doc's own reasoning. Detection is browser-side and REFUSES to guess: `Intl.Locale('en').maximize().region` is `US` and `sw` is `TZ`, so a region-less language tag yields NOTHING rather than calling a Kenyan American. Uses `zone.tab` NOT `zone1970.tab` (which merges Uganda into Kenya), and the generator's own gate caught the first version inheriting link TARGET countries - Africa/Kampala links to Africa/Nairobi. 418/418 ICU zones covered.** |
| `104-FX-READER-BUG-AND-BROWSER-VERIFICATION.md` | **The FX snapshot WRITER was widened to 152 currencies and the READER was not, so every read discarded 150 rates and country detection could only ever show KES - 98.7% INERT, and silent, because a missing rate renders as nothing by design. ⚠️ Nothing unit-tested could catch it: the store's round-trip used USD and KES only. Found by putting a REAL browser at `Africa/Kampala`. **The invariant: the snapshot reader's accepted set MUST be a superset of the writer's.** `e2e/local-currency-e2e.spec.ts` now verifies detection in Chromium with real `timezoneId`/`locale` (10 tests, desktop + mobile), including the `UTC`+`sw` case asserting NO figure appears - if `maximize()` is reinstated that becomes `TZS 25,000,000`. One assertion had been passing for the WRONG reason (`getByText('about')` also matches the hidden mobile "About" nav link). ⚠️ ITS CLOUDFLARE SECTION IS SUPERSEDED BY docs/105 §7 (the proxy is ON since 2026-10-24, and the `cf`/`2` sequencing it prescribes was UNSAFE). Its prediction that enabling the proxy would cache almost no HTML was CORRECT and is now measured: ten routes, all `cf-cache-status: DYNAMIC`. Three of the four cutover steps are DONE (`ssl=strict`, verified `2026-10-24T12:28:10Z`; a grey `origin.lastdonor.org` to keep a non-proxied path; a WAF skip rule for the four signature-authed webhooks). The fourth is OWNER-ONLY and gated: the staged `CLIENT_IP_SOURCE = "cf"` / `TRUSTED_PROXY_HOPS = "2"` block in `fly.toml` must be uncommented AND DEPLOYED **before** the orange cloud is flipped on the apex and `www` (`send.`/`rsend.` stay grey for Resend). Flipping first with `xff`/`1` makes every visitor through one Cloudflare datacentre share a rate-limit bucket and locks real users out of login; deploying `cf`/`2` first is safe because `cf-connecting-ip` is simply absent until the proxy is on. §**5.1a**: a `POST` probe cannot tell a missing cron route from a denied one - both answer 401 - so use `GET` and always include a fabricated job name as the control. Also removed 3 inert `revalidate` exports (a page reading `searchParams` is dynamic in Next 15 - proven by an exact 10-of-10 correlation against production).** |
| `105-EDGE-TRUST-AND-CLOUDFLARE-CUTOVER-ADR.md` | **✅ DEPLOYED (v96) AND THE PROXY IS ON (2026-10-24) - read §7 for the verification record, including the two Fly build traps and the proof that a proxied request keys to the VISITOR not the edge (exhaust a bucket directly, then hit the same path through the proxy: a 429 is the only possible answer if `cf-connecting-ip` was trusted AND equals the direct path's peer). The staged Cloudflare cutover (`CLIENT_IP_SOURCE=cf` + `TRUSTED_PROXY_HOPS=2`) was UNSAFE and is replaced. `cf` used to trust `cf-connecting-ip` whenever present, with no evidence the request came through Cloudflare - and `lastdonor.fly.dev` (outside the DNS zone, and the cron Worker's target) plus `origin.lastdonor.org` (grey-cloud on purpose) reach the origin directly FOREVER, so rotating that header mints unlimited rate-limit keys against sign-in, the `sms` tier guarding a six-digit code (docs/85) and PayHero's phone guard (docs/92). ⚠️ **A hop count cannot describe two ingress paths**: via Cloudflare two hops are appended, direct one, and both stay reachable - `2` puts the trusted index on a direct caller's own XFF prefix, `1` keys every proxied visitor by their Cloudflare datacentre and locks real users out of login. `cf` now decides PER REQUEST from the right-most XFF entry (the peer Fly appends, which no caller can choose) and believes `cf-connecting-ip` only when that peer is in Cloudflare's published space (`src/lib/cloudflare-ips.ts`, 15 IPv4 / 7 IPv6 pinned and verified live). `TRUSTED_PROXY_HOPS` is unread in `cf` mode and **stays 1 forever**. Staleness fails SAFE (a new CF range reads as direct, over-counting, never under-counting) and `1.1.1.1` is NOT an edge. ⚠️ The security test written to prevent a bad cutover asserted `cf`->`2` as the SAFE target, so it would have gone green on the unsafe change; its companion covered the forged header only "when CLIENT_IP_SOURCE is unset", which the cutover sets. Read before touching `getClientIp`, `fly.toml`'s client-IP block, or turning the proxy on.** |
| `106-DOCUMENT-SCREENING-ADR.md` | **AI pre-screening of verification documents. BUILT, NOT DEPLOYED. A document with NOTHING flagged is approved without a person; everything else waits. ⚠️ The safety argument is one boundary, traced not assumed: approving a DOCUMENT writes only `verification_documents`, and every writer of `campaigns.verification_status` was enumerated - no path advances a campaign from document approval, so screening cannot authorise a payout or lift the raise cap. ANYTHING THAT COUPLES THE TWO REOPENS THIS DECISION. There is deliberately NO auto-reject, and a MISSING trusted name is 'cannot judge' never 'no mismatch' - no campaign has a verified name today, so that one confusion would auto-approve every document on the platform. ⚠️ Probed OCR error: `ASHA W. MUTISO` came back `ASHAW. MUTISO`, so names compare with ALL SEPARATORS REMOVED. ⛔ TWO 'exit 0 is not success' traps: a vision failure arrives as HTTP 200 with no `choices` key, and `pdftoppm` exited 0 with empty stderr and 0 bytes on a malformed PDF (also: `pdftoppm -` writes a file called `-` into the CWD - use pdftocairo). Only page 1 of a PDF is read, so a clean multi-page document is downgraded. Model list contains only models RUN against a real document (two of my first three were 403/429-only). `campaigns.didit_verified_name` is new; ⛔ the keys inside Didit's `kyc` are UNVERIFIED because a not-started session returns null - the parse REPORTS the keys it saw so the first real session answers it in the log. Didit's own `poa`/`document_ai_documents` may already do this (owner chose bespoke knowingly). Read before touching `src/lib/screening/`, the screening cron or `/admin/screening`.** |
| `107-ADMIN-REPORTS-500-AND-THE-SQL-DATE-TRAP.md` | **`/admin/reports` answered 500 on EVERY load and nothing in the repo could tell: lint, typecheck, 6,855 unit tests, CI and nine ratchets were all green. A JS `Date` interpolated into a `sql` template is bound as a parameter with NO encoder and throws inside the driver (`The "string" argument must be of type string ... Received an instance of Date`) - a typed `gte()` carries the column's encoder, a `sql` template does not. Same family as the docs/101 unqualified-identifier trap: a `sql` template silently discards what the typed builders carry, and only running it against real Postgres finds it. Fixed with `sql.param(value, column)`; the query moved to `src/lib/report-periods.ts` SO THAT A TEST COULD RUN IT. Two checks, both proven by injection: 6 integration tests (all 6 fail against the defect) and a TYPE-DRIVEN ratchet over all 282 interpolating `sql` templates in `src/`. A falsification sweep found the defect in exactly one page. Also: `/dashboard` had the marketing footer too (amends docs/106 §10a). ⛔ Records the open hole: NO admin page's data query is executed by any test. **§8 (added 2026-10-25, found in a browser)**: `/campaigns/[slug]` threw React #418 on EVERY mobile load of a production build and was clean in `next dev` - `formatRelativeTime` reads `Date.now()` inside an ISR page, so the cached HTML and the client disagree; fixed with `<RelativeTime>`, NOT `suppressHydrationWarning`. And every USD campaign (i.e. all of them) showed a dangling "Goal is" with nothing after it, because the label sat OUTSIDE a component that renders nothing by design.** |
| `108-TRUST-NETWORKS-ADR.md` | **Institutional vouchers: a hospital, church, school or registered charity confirms a crisis instead of the organiser uploading documents. BUILT, NOT DEPLOYED (no institution exists anywhere). ⛔ The whole safety argument in one line: a vouch grants `identity_verified` and NOTHING ELSE - it lifts the docs/101 raise cap, releases no money, and does NOT publish anything. `fully_verified` was refused because it RELEASES MONEY in the same transaction, so a third party's email would move funds. Note there are TWO queues: the request's words name the VERIFICATION queue, which is bypassed; the docs/78-79 publication review is untouched, because 'every campaign is reviewed by a person' is claimed in ~44 lines across 23 files. The trust root is an admin: there is NO self-serve institution signup, because anyone who can create one can lift the cap. `representative_*` is ATTRIBUTION, not authentication - v1 has no institutional login, on the docs/76/77/81 rule against shipping unexercised paths. Contained by a rolling 30-day budget that COUNTS REVOKED VOUCHES (otherwise revoke-and-retry is unlimited), per-vouch revocation, and suspension that deliberately does NOT cascade. ⚠️ A repo-wide 'who writes fully_verified' test was WRONG and was DELETED: it missed `didit/webhook/route.ts:137`, which does `.set(update)` from a variable - the docs/101 lesson that a grep proves text, not semantics. What survives is structural and proven by injection (7 tests reading `.update()` targets and `.set({})` keys). Donors are TOLD: 'Confirmed by X - we have not seen the organiser's ID ourselves', with a test forbidding the words verified/verification/document. Read §1.1, §3.1 and §8 before touching any of it.** |
| `109-SUBMIT-REDIRECT-404-ADR.md` | **Finishing the create-campaign wizard sent the organiser to a 404, with no confirmation that anything had been received - reported from production. The redirect was `/campaigns/<slug>?launched=true`, right when campaigns went live instantly; docs/78-79 made the insert `under_review` with `published_at: null`, and the public page serves only active/last_donor_zone/completed/paused/suspended/cancelled. NOTHING FAILED - a redirect stopped being valid because of work in another file (the docs/83 shape). ⚠️ A TEST WAS HOLDING IT IN PLACE: `instant-live-architecture.test.ts` asserted `toContain('?launched=true')` and passed the whole time, while SECTION 5 OF THE SAME FILE already asserted the route does NOT insert `status: 'active'` - the file asserted both halves of a contradiction and nothing compares two assertions to each other. Now redirects to `/dashboard/campaigns?submitted=1` with `SubmittedForReviewNotice`. ⛔ That copy may NOT promise an email on the DECISION (docs/93 deleted exactly that: a refused campaign notifies nobody, still open) and quotes no turnaround time (docs/78). `LaunchSuccessBanner` ('Your campaign is live') was not deleted - `?launched=true` moved to the APPROVAL email, the one moment its words are true. The replacement check DERIVES both ends from source (inserted status vs served statuses) rather than pinning today's answer, and is proven by injection BOTH ways: the production redirect fails 6 tests, and restoring instant-live on both ends makes the rule pass again.** |
| `110-ORGANISER-JOURNEY-ADR.md` | **The product NEVER asked anybody to verify. `notifyVerificationReminder` has FOUR urgency levels and ZERO callers; no verification cron exists; `/how-it-works`, the wizard, the submission receipt and the "your campaign is live" email all never mention it. The only prompt was one grey line on `/dashboard`. ⛔ THREE DEFECTS: the verification screen decided "in progress" from `stripeVerificationId`, which the Didit path NEVER writes (docs/81), so it was permanently false and the status poll NEVER ARMED - an organiser finished the check and the screen never changed (docs/83 a second time); the Didit return at `/dashboard?verification=<slug>` was read by NOTHING; and the guide was linked from the footer, terms, refund-policy, campaign-rules and transparency but from NEITHER the verification screen nor the dashboard. ⚠️ TWO TIERS nothing named: `identity_verified` lifts the docs/101 cap, `fully_verified` is what the withdrawal route requires - a campaign could raise freely and still be unable to take a penny out. Also SEVEN status-label maps, three organiser-facing ones wrong: `FinancesClient` invented `pending_review`/`rejected` (not statuses) and was MISSING `under_review`; the verification screen showed organisers "Identity Verified (Tier 1)". Now one `organiser-journey.ts` feeding six surfaces, plus `campaign-labels.ts`. ✅ §7 RESOLVED 2026-10-25: the reminder ladder ships as `cron/verification-reminders`. The four emails that existed could NOT be wired - every level says "reached its goal N days ago" and three threaten to "send the money back", and [VERIFIED by enumerating every refund call site] NO mechanism sends money back on a clock, so both halves are false. New copy keyed on consequence instead; §7.2 corrects this doc's own proposal that level 4 could reuse the funded ladder. ✅ §9 RESOLVED: `/how-it-works`, `/share-your-story` and the wizard now name the ID check, rendered from `organiserJourneyOutline()` so the marketing page is not a seventh idea of the journey. §9.2 is the defect found doing it - the wizard promised an email "when it is decided", the EXACT sentence docs/93 deleted, sitting above the submit button; the rule was already asserted on the notice and the email and the third surface was swept by NOTHING, so the fix is a sweep (`organiser-promises.test.ts`), not a third assertion. ⛔ §10 OPEN: TEN files quote Stripe's "2.9% + 30c" on a platform where Stripe answers `status:error` and the live rail is PayHero - reported, not half-fixed, because the replacement number needs an owner decision (docs/92: PayHero's own published table is wrong too).** |
| `111-CAMPAIGN-COLLABORATORS-ADR.md` | **Team fundraising: the organiser invites helpers by email, they accept from a link, the organiser can remove anybody. BUILT, NOT DEPLOYED. ⛔ §5a: a collaborator cannot yet REACH a screen to use their capabilities - the API admits them, the dashboard pages are still creator-gated (the docs/83 shape, recorded not half-fixed). ⛔ A collaborator holds CONTENT capabilities only (`post_update`, `edit_content`) and can never withdraw, change the payout account, upload identity documents, delete, change status or invite. That is not caution: [VERIFIED] `withdraw/route.ts:146-154` resolves the payout destination with `eq(users.id, session.user.id)` - the CALLER's Connect account - and passes it to `createTransfer` at 405-408 with NO later creatorId re-check, so the invariant "the credited account belongs to the person owed" is held up by the ownership check 8 lines above and nothing else. Delegating ownership pays a family's money to a helper, silently. TWO tests because one is not enough: the module boundary (what this directory may write) plus the CALL SITES (six sealed routes must not consult `canCollaborate`) - a sealed module is useless if the withdrawal route calls it. Carries a TRIPWIRE ON ITS OWN PREMISE: if the payout destination stops being read from the caller, a test fails so somebody re-reads the decision. ⚠️ `reply_to_message` is absent because no organiser message-reply route EXISTS. §6 CORRECTS ITSELF: the per-person share loop is ALREADY COMPLETE and needed nothing built - `SidebarShareButton` is on the public page, checks `isAuthenticated` and mints `/s/<token>`, and `/dashboard/impact` shows what each link brought in. An earlier draft said it had 'no door in the UI', which was WRONG; the gap was only that nobody is TOLD, so step 4 is one paragraph in the team panel. ⚠️ Rate limiting: the `collab` tier (5/60s) is matched by a PREDICATE not a prefix, because the campaign id is mid-path and matching `/api/v1/user-campaigns` would put the WITHDRAWAL route in an email bucket. Both lookups pinned by test; the real abuse control is the per-campaign cap of 10, not the IP limit.** |
| `112-SHARE-SURFACE-AND-CONTACT-SYNC-ADR.md` | **The public share row had no WhatsApp, no pre-filled copy and no attribution, while THREE other surfaces had all three - and all three of those are post-donation or organiser-only, so the one surface a visitor sees before giving was the weakest (and on a non-donatable campaign it is the ONLY one: `CampaignSidebarClient` renders only when `isDonatable`). Neither share component had a single test, which is how `docs/58`'s fix covered one of two surfaces 300 lines apart. ⚠️ The Facebook/X links are deliberately NOT attributed: closing that needs either minting before the click (rejected by `docs/58` - a mint is a write, so it would credit every page scrolled past) or holding a `window.open` handle across the await, and that handle is `null` when `noopener` is passed - so attribution there costs `rel="noopener"`, which is a security property, not tidiness. A test pins `noopener` BECAUSE the pressure to drop it comes from improving that file. ⛔ Contact sync / SMS invites NOT BUILT, owner decision: the AT app is `elopis` (another product's, `docs/86`), production runs on SANDBOX credentials, the live key 401s, `sendSms` has exactly ONE caller (the verification code), and the feature messages people who are neither users nor consenting - `docs/85` says verifying a number is not consent to message it. Also records a LATENT defect: the OG/Twitter share descriptions render money through `centsToDollars`, which hardcodes USD, while `raisedAmount` is in its row's own minor units; the only non-USD campaign is `archived` and so unservable, so no reader has seen it yet. TikTok has no web share intent - copy-link is the whole integration. |
| `112` §7 (same file) | **The share card: an HTTP 502 for 2 of 14 live campaigns.** A relative or SVG `heroImageUrl` made `ImageResponse` throw mid-stream, so those campaigns had NO share image and every platform fell back to text. ⚠️ The first fix blocked `.svg` alone and was a HALF-FIX - rendering it locally produced `Unsupported image type: image/webp`, and `supabase-storage.ts:149` ACCEPTS webp and avif on upload, so an organiser's own photo could have restored the 502. Extensions cannot settle it (production stores Unsplash URLs with none), so `probeHeroSrc` HEADs the image and accepts only jpeg/png/gif; anything else renders a designed panel. Also: the card printed `$0.00 raised · 0 donors` on every campaign, hardcoded USD, showed cents on round goals, and `og:description` BEGAN WITH THE TITLE so WhatsApp and Facebook printed the headline twice and clamped the second copy before it said anything new. `og:site_name` and `og:url` were absent. ⚠️ Satori traps: a glyph outside the supplied fonts makes it fetch a font over the NETWORK (`Failed to load dynamic font for ✓ ... 400`), `WebkitLineClamp` is ignored without `display: '-webkit-box'`, and the icon ratchet matches RAW TEXT so naming the svg tag in a comment trips it. |
| `113-DIRECT-INSTITUTIONAL-PAYOUTS-ASSESSMENT.md` | **⛔ NOT BUILT, owner decision, and one part is a LEGAL question. Paying a hospital/funeral home directly instead of the organiser. The finding that reframes it: [VERIFIED] money has NEVER left this platform - `campaign_withdrawals` 0 rows, 0 users with a Connect account, 0 campaigns verified enough to withdraw, and the only out-rail is Stripe, which answers `status: error` (docs/72). The live rail's client is COLLECTIONS ONLY (`initiateStkPush`, `getTransactionStatus`, `getWalletBalance`) and whether PayHero can disburse at all is [UNKNOWN] - my unauthenticated probe was NON-DISCRIMINATING (the known-good `initiate-stk-push` returns 404 on GET too, because only POST is routed) and I did not POST to guessed payout endpoints on a wallet shared with BETWOIN LTD. ⚠️ 'Medical billing networks' are not integrable anywhere, but KENYA ALREADY HAS THE PRIMITIVE - a hospital paybill with an account-number field - so the feature is far more tractable on the rail that works than the one that does not. ⛔ Becoming an intermediary that settles third-party debts is CBK/money-transmitter territory. `trusted_institutions` deliberately holds NO payment column (docs/108 refused `fully_verified` because it releases money), so adding payee details reopens that decision. Recommends verified receipts published on the campaign instead: most of the donor trust, no licence, no destination that can be wrong. |
| `114-CURRENCY-RENDERING-SWEEP-ADR.md` | **Every user-facing money figure now names its own currency. `/transparency` published `$100.00` while production held KES 100.00 (~US$0.77) - a ~130x overstatement, from a whole-table `SUM(donations.amount)` rendered by `centsToDollars`. 23 surfaces fixed and verified in a REAL BROWSER on a KES-only fixture (18 routes, 0 dollar figures); four per-currency modules, two more hand-rolled formatters removed (six total, after docs/88 F4/F5), and three bare `<Money>` defaults made REQUIRED props - `DonorFeed` printed a KES 2,500 gift as `$2,500` on the public campaign page. ⚠️ `Math.round(dollars * 100)` in BOTH withdraw handlers: right by coincidence, 100x wrong for a zero-decimal currency. `DonationForm` is legitimately USD (gateway-routed) and is now TRIPWIRED by `donation-form-usd-premise.test.ts`. Also: a fabricated statistic removed, 135 lines of dead code with a currency bug deleted, and one surviving mutation recorded. ⚠️ its admin count (20 components / 46 sites) is CORRECTED by docs/115 to 17 files / 44 sites, and they are now DONE; ⛔ [VERIFIED] **32** user-facing files name Stripe as the processor - not the 10 docs/110 §10 counts - including the footer on every page, on a platform whose only money arrived over M-Pesa.** |
| `115-ADMIN-CURRENCY-AND-TWO-LIVE-DEFECTS.md` | **The admin currency sweep (17 files, 44 direct sites + 10 via local wrappers, verified in a browser across 14 admin routes: 0 dollar figures) and TWO LIVE defects found taking its inventory. (1) `/campaigns` "Load more" rendered EVERY appended card in dollars - the listing API never selected `currency` and `CampaignGrid` parses it with an unchecked `as CampaignData[]` cast; reproduced in a browser, 0/12 dollars before the click and 5/5 after. (2) The campaign-update digest emailed every subscribed donor `$18400.00 of $50000.00 raised` for a KES campaign; `formatCents` now REQUIRES a currency so the compiler enumerated all 28 sites. ⚠️ My first reading of (2) was WRONG and is recorded: receipts are NOT affected - `notifyAdaptiveDonationReceipt` has zero callers and the live PayHero path sends no mail at all. ⛔ `users.total_donated` is a currency-BLIND integer and cannot be rendered in any currency - recomputed per currency from `donations`. Ten admin aggregates now group by currency via `src/lib/admin/donation-totals.server.ts` (13 integration tests). The admin ratchet now checks the PROPERTY (every `<Money>` has a currency) not the symptom, and immediately caught NINE misses in my own sweep. ⛔ Five findings reported not fixed, incl. donor-segment thresholds comparing a currency-blind figure and `fund-pool/allocate` not checking that source and target share a currency (reporting-only: no fund-pool path credits a campaign).** |
| `116-FIVE-FINDINGS-AND-AN-UNGATED-THIRD-PATH.md` | **Closes the five findings docs/115 §7 reported, and found a SIXTH taking the inventory for one of them: ⛔ A THIRD CAMPAIGN-CREATION PATH PUBLISHED WITHOUT REVIEW. `news-pipeline.ts:688` inserted `status: 'active'` with `publishedAt: new Date()` - a machine-generated campaign about a NAMED REAL PERSON, public with nobody having read it - and it is NOT dead code: `CRON_SCHEDULE` runs both `ingest-news` and `fetch-news`, each calls `runNewsPipeline`, and no feature flag sits between the cron and the insert. ⚠️ `publisher-review-gate.test.ts` passed throughout because it NAMED TWO FILES and searched them for the literal `.insert(campaigns)`; this site spells it `.insert(schema.campaigns)` in a file it never opened - the docs/108 lesson again, and the claim 'every campaign is reviewed by a person' is asserted in ~44 lines across 23 files. It also sliced a FIXED 2,600 chars, so adding one comment made it fail with the gate intact. Now DISCOVERS every campaign insert from disk, both spellings, brace-matched - and its first version found SIX inserts because the comment EXPLAINING the fix quotes the forbidden string, so comments are stripped first. Also: campaign currency was UNSETTABLE (all four inserts omitted the column, so every campaign ever created was USD by default on a platform collecting only shillings) - ⛔ now settable by API but STILL NOT REACHABLE FROM ANY SCREEN (docs/83 shape, recorded not half-fixed); donor-segment money thresholds compared a currency-blind `total_donated` against a US dollar rule, now per currency with a REFUSAL when no currency is named, and ⚠️ a `HAVING` with no `GROUP BY` is one group over zero rows, so `maxDonated` matched every donor who had given NOTHING in that currency (probed against real Postgres); 13 sites quoted Stripe's 2.9% + $0.30 on a platform where Stripe cannot take a payment, the rate has never been charged, and ⛔ NO CODE DEDUCTS A PROCESSING FEE AT ALL (`unit_amount: data.amount` with no `application_fee`, `raisedAmount + amount`, `released - withdrawn - pending`) - removed with no substitute number, guarded by `fee-claims.test.ts` (8 -> 14 tests), and the stale test asserting the old claim was replaced not satisfied; the verification screen said 'handled securely by Stripe' while the button calls DIDIT (docs/81); fund-pool allocations could cross a currency boundary; five money settings removed that NOTHING read. Read §4 before touching campaign creation and §5.3 for the three areas reported not changed. **§8 AMENDMENT 2026-10-27: ⛔ §4 FIRED IN PRODUCTION** - five machine-written campaigns naming real people went public unreviewed on 2026-10-18 (`brent-ledbetter`, `nicholas-cabo`, `samuel-pierre-jr`, `maj-sorffly-davius`, `david-l-jones`), proven three ways: `published_at = created_at` with ZERO `campaign.published` audit rows, the news-pipeline audit key set (BOTH modules write `campaign.auto_drafted`, so the discriminator is that only the publisher adds `imageSource`), and HTTP 200 plus sitemap entries. Zero donations. ⛔ STILL LIVE after the fix deployed - the code stops NEW ones, it does not retract existing ones (§8.5 has the three options). ⚠️ TWO of my own conclusions were REFUTED by the data: the OpenRouter 402 is intermittent not total, and the guard that actually held it shut was `simulation.max_concurrent` reading the DEFAULT of 10 (no row existed before 2026-10-25 01:45) - it is now 100 against 13 active, so that accidental guard is GONE. Also: production is reachable over the Supabase MANAGEMENT API even though both pooler ports time out - 'unreachable' was a claim about one transport. Also §8.4: only ONE migration was ever outstanding (`0012`), hashes verified and a full catalog diff clean; and ⛔ `fly.toml:227` sets `release_command = release-migrate`, so A DEPLOY DOES RUN MIGRATIONS - I checked the deploy SCRIPTS, found none, and concluded wrongly.** |
| `117-COLLABORATOR-JOURNEY-ADR.md` | **Accepting an invitation led NOWHERE, and `docs/111` §5a had recorded the gap without anyone seeing what it looked like. Walked in a real browser against a production build: a helper accepted, landed on `/dashboard/campaigns?joined=1` and read “You haven't created any campaigns yet” - while [VERIFIED three ways at the same moment] their row was live and accepted, `GET /api/v1/user-campaigns/<id>` answered 200 for that session and `POST …/updates` answered 201. The grant was REAL and INVISIBLE; a sweep of ALL TWELVE signed-in dashboard routes named the campaign on none. Also: `?joined=1` was read by NOTHING (grep found one occurrence - the redirect that sets it), all three capability screens redirected a helper INTO that empty list, and the accept screen named no campaign at all. ⚠️ The withdrawal probe was NON-DISCRIMINATING at first (400 on validation, before any ownership check) - with a valid UUID key it is 403, and the creator's DIFFERENT error is the control. Fixed with `src/lib/dashboard/my-campaigns.server.ts` (ONE query, `exists` NOT `leftJoin` because two live rows for one person on one campaign would list it twice), collaborators admitted to the three screens BY CAPABILITY, and ⛔ every sealed control hidden from them - team panel, verification, payout destination, journey checklist, donors - because a control that can only 403 is worse than none. ⛔ The module is NOT in `src/lib/collaborators/`: the boundary test rejected it for naming `raisedAmount`, and the allowlist was NOT widened. BOTH seal tests fired and both were extended deliberately. ⚠️ A mutation SURVIVED and the TEST was wrong, not the code: the pending-invite case left `user_id` null so the userId predicate excluded it on its own. Also adds the E2E SIGN-IN FIXTURE `docs/99` §8 said was missing. ⚠️ An invitation is SINGLE USE and the suite is `fullyParallel`, so each accepting test mints its own; and wait for the URL to leave `/login`, never `networkidle`.** |
| `118-CAMPAIGN-LINK-GUARD-ADR.md` | **A notification is a LINK, and `docs/109`'s rule ("before rendering ANY link to `/campaigns/<slug>`, call `hasPublicPage`") was enforced for the UI and NEVER SWEPT over notifications. Two handed a real person a 404: `campaign_archived` linked `/campaigns/<slug>` for the ONE status the page does not serve - so the only condition producing that notification was the only condition under which its link dies, and the recipients are un-refunded DONORS - and `message_flagged` put a UUID in the slug position, wrong on every use. Both [VERIFIED live: archived slug 404, uuid 404, active slug 200 as the control]. ⚠️ The ROOT CAUSE is that NOTHING BUILT A CAMPAIGN LINK: 20+ sites each decided slug-vs-id and public-vs-not, and the organiser routes are SPLIT 3/3 on whether they accept a slug (`[id]`, `updates`, `donors`, `edit` are UUID-only and `notFound()` a slug; `verification`, `impact-update`, `payout-destination` take either) - so two identical-looking lines, one working and one 404ing. Now `src/lib/campaign-links.ts`: `publicCampaignPath` returns **null** (both renderers already handle it) and `organiserCampaignPath` always keys on the ID. `campaignStatus` is a REQUIRED param so tsc enumerated every caller (the docs/115 trick); the 7 zero-caller helpers got it too, so a future caller CANNOT reintroduce the 404. ⚠️ §2.5: write-time guarding is NOT SUFFICIENT - a STORED link ROTS, and one production row was a 404 (valid for 2m39s before the campaign was archived). ✅ §9 RESOLVED (owner): `archived` is now SERVED with a closed notice, which kills §2.1 at source and heals that rotted row with NO backfill - `campaign-visibility.ts` already made exactly that argument for `suspended`/`cancelled` and `archived` had been omitted rather than decided. ⚠️ Rot is NOT eliminated: `ALLOWED_TRANSITIONS` still allows `active -> draft`, so the guard stays and the test naming `archived` was REPOINTED to `under_review`, not deleted. ✅ §10 RESOLVED (owner) for §6: currency is now SELECTABLE in the create wizard, so a campaign can be made in KES and actually collect over the one working rail. Taking that inventory found FIVE hardcoded dollars, one of them ARITHMETIC (`* 100`, right for USD/KES and 100x wrong for the zero-decimal currencies). ⛔ Still open: the 14 existing USD campaigns are untouched and `DEFAULT_CURRENCY` is still USD. §7 has the journey inventory with production row counts.** |
| `119-ORGANISER-DOORS-AND-A-SITEMAP-ANOMALY.md` | **The organiser journey, plus the production verification of docs/118 §9/§10 (v110: archived 404 -> 200 with its notice, `noindex` held, three controls unchanged). ⛔ The journey PROMISED an edit the editor refuses: `organiser-journey.ts:279-287` set `href`+`action`+"Done. You can still edit it." UNCONDITIONALLY while `edit/page.tsx:63` redirects anything outside `['draft','active']`, and BOTH renderers show a button on `step.href && step.action` - docs/83 INVERTED (a door always shown onto a room that refuses to open). ⛔ `/dashboard/campaigns` was in NEITHER nav surface (the mobile nav renders the same sidebar), its three persistent doors all conditional and creator-dependent - so the people docs/117 fixed that list for had no way back to it - while `layout.tsx` spent one of three permitted queries computing `hasCampaigns` and the sidebar destructured it as `_hasCampaigns` and threw it away. ⛔ The Impact Update tile was UNGATED beside two gated siblings and its target redirects a non-creator, and ⚠️ MY OWN docs/117 test had the hole it came through (four named regions, this was the fifth) - now a STRUCTURAL rule finds every child link, and it FAILED FIRST on `edit`, where the rule was wrong not the page (`edit_content` IS delegatable). ⚠️ Gate 3 REFUTED my severity: 9 campaigns would bounce but only 2 have a real organiser - because `creator_id` is NULLABLE and **13 of 14 live campaigns have NO organiser at all**, which is a bigger open finding (nobody to verify, remind or pay). ✅ §2 RESOLVED: Gate 5 caught a sitemap anomaly via a FAILED CONTROL - production advertised ZERO campaign URLs. Cause verified three ways (the Dockerfile's hermetic branch in the log, eight `[build] database read failed` lines, and the build's route table) and it is **7 baked routes, not the 24 `deploy.sh` quotes**, of which only the two SITEMAPS carry a 1h window; the heal was then OBSERVED on `/transparency` (`STALE` with 0 money figures -> `HIT` with 2), so it is not a defect in `sitemap.ts`. Both deploy scripts now report the campaign-URL count at the END of a deploy, and ⛔ the `revalidate` was deliberately NOT lowered. Also two raw enums at organisers and a "Create Campaign" button pointing at the list.** |
| `120-REVIEW-JOURNEY-AND-THE-DOOR-THAT-PUBLISHED.md` | **The review journey, and ⛔ THE DASHBOARD'S OWN "Review" LINK PUBLISHED THE CAMPAIGN ON SAVE. Three mistakes composed: all three push signals (the `/admin` tile, the `[Admin] Review needed` email, the in-app row) pointed at `/admin/campaigns/<id>/edit`; that page coerced anything not `draft` to `'active'`, so an `under_review` campaign reached a select labelled "Initial Status" reading **Active**; and `PUT /api/v1/campaigns/[slug]` took a status with NO transition check, NO audit row, NO email, stamping `publishedAt` UNCONDITIONALLY. So an admin who opened the review link and fixed a typo published the campaign - and the row is indistinguishable in `audit_logs` from one nobody read, which is the evidence docs/116 §8's forensics rest on. ✅ The organiser CANNOT do this: an owner is restricted to seven content fields and `status` is not among them. Found from production - the owner's own submission went public **95 seconds** after `campaign.submitted` with ZERO `campaign.published` rows. Now ONE writer: PUT answers 400 (explicitly, because "Restore to Draft" was a live caller - a silent drop leaves a button that looks like it works), the editor DELETES `status` in edit mode (load-bearing: the resolver IS `createCampaignSchema`, whose `.default('draft')` would otherwise make every save UNPUBLISH the campaign), and `/admin/campaigns/[id]` gained **Approve and publish** - it had Suspend and Cancel and NO way to say yes. ⚠️ The ratchet must RESOLVE `.set(variable)`: the approval route assembles `updates.publishedAt = ...` then `.set(updates)`, so a literal-only sweep sees nothing there and my own first pass allowlisted the wrong file. Also: ⛔ `under_review` removed from `CANCELLABLE` (cancel notifies NOBODY, is terminal, and `cancelled` is publicly viewable) and its button had the docs/93 defect in the ADJACENT statement - `governanceReason || 'policy_violation'` against a `z.enum` lacking it, so **Cancel had never worked**; ⛔ the info-request pause had NO status guard (publishing an unreviewed campaign, `paused` being viewable) and `resume` did not stamp `publishedAt`, the two composing into the only route to a live campaign with a NULL `published_at`; ⛔ with ONE admin a self-submission notified NOBODY (the skip's premise "other admins still get it" is false, and the test hardcodes two admins); the review email printed a KES goal as `$500.00`; `campaign.auto_drafted` rendered as **"Campaign auto-published"** on the only in-app surface showing it; and two `paused` menu items always 400'd. ⚠️ The FIRST injection run was VOID - the backup set omitted one file so rows 6-12 measured a polluted tree; the harness now re-verifies a clean restore after EVERY injection. Read §2, §3 and §12 before touching campaign publication.** |
| `121-MONEY-OUT-JOURNEY-AND-A-CLOSED-LOOP.md` | **The money-out journey: verification → release → payout. [VERIFIED] it has NEVER been entered - 0 verification documents, 0 Didit sessions, 0 Connect accounts, 0 withdrawals, 0 released, and KES 100 sitting unpayable. ⛔ THE ORGANISER COULD NOT COMPLETE VERIFICATION, and it was a closed loop rather than one omission: `identity_verified` was missing from `submittableStates`, `canSubmitForReview` excluded it too, and Step 2's upload form renders ONLY once the ID check has passed - so **the one state where you can attach a document was the one state from which you cannot submit it**. The organiser passed the ID check, was emailed 'send us papers, our team will look at them', uploaded one, and nothing they could do moved anything - and NO ADMIN was told, because `notifyAdminsVerificationSubmitted` lives on the route they could not reach. ⚠️ The test written for it (both ends derived from source, `docs/109` shape) immediately found a SECOND pre-existing divergence: `submitted_for_review` was route-submittable while the component hid it. Also ⛔ the navbar printed a CROSS-CURRENCY sum with a dollar sign - `/api/v1/user/balance` reduced released-minus-withdrawn across every currency and `UserNav` rendered it with a SEVENTH hand-rolled `toLocaleString(..., {currency:'USD'})`; both `docs/114` and `docs/115` walked past it because the ratchet globbed `<Money>` JSX, which a hand-rolled `Intl` call has none of - it now checks the PROPERTY, with no call-site allowlist. Also ⛔ the Withdraw form rendered for a currency `withdraw/route.ts` answers 400 `WRONG_PAYMENT_RAIL` to; ⛔ `notifyWithdrawalFailed` had ZERO callers, so a definite failure told the organiser nothing (now wired on the DEFINITE branch only - emailing 'failed' on the UNKNOWN branch would be unsubstantiated, and that is the branch where the money may have moved); ⛔ two 'business days' turnaround promises in a directory `organiser-promises.test.ts` ALREADY SWEPT (the hole was the pattern: one straddled a full stop, the other broke `\d+` at the hyphen in '1-2'); and ⛔ the verification screen linked its own campaign to a 404 - the THIRD `docs/118` sweep gap in two days. Read §2, §3.1 and §9 before touching verification or payout.** |
| `122-DONOR-AFTER-GIVING-ADR.md` | **What happens to a person after they give. ⛔ A REFUND ON THE LIVE RAIL TOLD THE DONOR NOTHING: `PATCH /api/v1/admin/donations/[id]` branches on `provider !== 'stripe'`, corrects the ledger and RETURNED ~60 lines above `notifyDonationRefund` - so it marked the gift refunded, dropped the campaign total, called NO gateway (PayHero has none) and sent no email and no notification. Both donations this platform has ever taken are `payhero`. ⛔ And the admin was told the opposite: the dialog hardcoded 'via Stripe' and the handler discarded the route's own `manualRefundRequired` message to say 'Refund processed'. New `manualRefundPendingEmail` says what is true (a person sends it back by hand, it has not moved, no turnaround quoted) because `donationRefundedEmail` opens 'We sent your money back'. ⛔ AND A DONOR COULD NOT LEAVE: every email footer points at `/settings`, which was an unconditional `redirect('/dashboard/settings')` behind auth - a login wall for a guest, and the M-Pesa rail creates only guests. Also: the refund title printed KES 50 as '$0.50'; `SubscribeButton` used `useSession` so a 429 silently removed the only subscribe control (docs/44); and THREE unsubstantiated promises - 'Monthly donations can be cancelled' (no cancellation path exists), 'Save campaigns' (no such feature) and 'One-tap checkout' (neither form reads the session). ⚠️ CORRECTS docs/115 twice: the PayHero path DOES send a receipt (the zero-caller family is the ADAPTIVE one), and `formatCents` still defaults to USD in `email-templates.ts`. Thirteen findings reported not fixed, incl. ⛔ a guest cannot be suppressed by any stored mechanism (CAN-SPAM, docs/41), the updates opt-in nobody is offered, and the `update-phases` cron that writes 46 of 46 updates and notifies nobody. Read §2, §3 and §8 before touching refunds, donor mail or unsubscribe.** |
| `audit-2026-10-14/` | Raw agent reports + executable proof scripts behind docs/29 |

---

## Commands

```bash
npm run dev            # dev server (Turbopack)
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run test:unit      # Vitest (7666 pass + 16 skipped, 260 files, as of 2026-10-27)
npm run test:integration  # Vitest + a throwaway Postgres (256 tests, 26 files)
npm run test:e2e       # Playwright: 2 Chromium projects, 22 files
                       #   138 pass / 0 fail / 24 declared skips (docs/99 §8, docs/104 §2)
                       #   In THIS sandbox: PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium
npm run e2e:build      # seed THEN build — use this if you build the server by hand
npm run db:generate    # safe since 2026-10-14 (docs/34): diffs the baseline snapshot
npm run db:migrate     # safe since 2026-10-14 (docs/34): applies the validated baseline
```

**This project runs on Node 22.** `.nvmrc`, `package.json` `engines`, the
Dockerfile's `ARG NODE_IMAGE` and the workflow's `NODE_VERSION` must all
agree, and `src/ci-node-version.ratchet.test.ts` fails the build if they
drift. CI was pinned to Node 20 until 2026-10-22 — a version nothing else
used and which went end-of-life on 2026-04-30 — which is how three tests
came to fail in CI and pass everywhere else. See `docs/97` §5.1.

Before any commit: `npm run lint && npm run typecheck && npm run test:unit`
must all pass. **Run them yourself.** They are no longer the *only* gate,
but they are the fast one and the one you control.

**CI executes as of 2026-10-22, but only when DISPATCHED BY HAND**
(`docs/97` §1a). The owner settled the billing charge, the account lock
lifted, and run 5 is the first fully green run in this project's history:
lint → typecheck → unit → security audit → build, all passing.

⛔ **A `push` or `pull_request` run has still never existed.** All five runs
in repo history are `workflow_dispatch`. The merge to `main` was received by
GitHub (`PushEvent`, `ea3d6e89`) and created no run. Ruled out: `paths-ignore`
(9 of the 12 changed files are outside both patterns), a parse error (the same
commit dispatches green), the trigger definition, and the lock. The likely
cause — **marked as inference** — is that GitHub suppresses workflow runs for
pushes authenticated as a bot, and every push this repository has ever had came
from an agent session. **So do not assume CI gates a push until a
push-triggered run has actually been seen.** `npm ci` must succeed,
so **keep `package-lock.json` in sync with `package.json`** — and note that
`npm ci` installs only what is *declared*: three test files were importing
`glob` as an undeclared transitive dependency of `@sentry/nextjs`, which
worked purely by npm's hoisting. If a test imports a package, declare it.

Every suite now runs in CI — but do not over-trust a green tick, for the
reasons under each:

- ✅ **Integration now runs, with no secret** (`docs/98`). `integration-tests`
  brings its own `postgres:16` service container and a literal
  `DATABASE_URL`, so `TEST_DATABASE_URL` is not referenced by that job.
  **83/83** when `docs/98` landed, verified on three consecutive
  freshly-migrated databases; **149/149** as of 2026-10-25.
  **⛔ Never point `TEST_DATABASE_URL` at production**: that job runs
  `db:migrate` and then a suite whose every file calls `clearDatabase()` in
  `beforeEach`. Run the suite yourself with any throwaway Postgres —
  `DATABASE_URL` is the only variable it needs.
  **Integration tests run SERIALLY and must stay that way**
  (`fileParallelism: false` in `vitest.config.integration.ts`). They share
  one database and each file truncates it, so parallel runs raced: three runs
  from identical fresh databases gave 50, 23 and 18 failures. Do not remove
  those lines to go faster; the run takes ~20s.
- ✅ **E2E RUNS IN CI as of 2026-10-22, and run 8 is the first execution of
  this suite on a runner in the project's history.** Whole pipeline green.
  Like `integration-tests`, the job brings its own `postgres:16` service
  container, and it references **no repository secret at all** — every value
  `validate-secrets.ts` requires is a format or entropy check, so they are
  literal throwaways in the workflow. Per leg: Desktop Chrome 64 passed / 12
  skipped (2.0m), Mobile Chrome 63 passed / 12 skipped / **1 flaky** (2.3m).
  Locally, both legs together: 128 passed, 0 failed, 24 skipped in 241s.

  ⛔ **One flaky test is not "green"** (`docs/99` §8.6). `e2e-03` failed its
  first attempt on the mobile leg with a strict-mode violation reporting
  **five** `<article>` elements where the fixture seeds four campaigns, and
  passed on retry — the job is green because `retries: 2`. It does not
  reproduce locally (6 loads at the same device, 4 articles every time), the
  SSR HTML has exactly 4, and `CampaignGrid.loadMore` dedupes by id, so
  pagination is ruled out. The raw error is kept in `docs/99` §8.6 for
  whoever meets it again.

  The earlier "32 failed / 25 passed" in this file is **withdrawn** — that
  run had concurrent axe probes crashing browsers, so it measured
  contention.

  The reconciliation that got there found **five product defects in
  application code**, not in specs — invalid tablist ARIA on the homepage
  and the same class on `/campaigns`, two dark-mode toggles holding stale
  copies of one global, and a `role="radiogroup"` with no roving tabindex
  or arrow keys. Read `docs/99` §8 before touching `e2e/`.

  **All 24 skips are declared in specs with named reasons** — 14 for the
  dead Stripe card rail (`docs/72`), 10 for the missing sign-in fixture.
  **Never gate a test body on `if (await locator.isVisible())`**: that
  method does NOT wait (its `timeout` option does not make it poll), so ten
  tests across seven files were silently skipping their bodies and
  reporting a pass. Assert with `expect(...).toBeVisible()`, or declare the
  skip.

  **If you run E2E locally**, use **`npm run e2e:build`** (= seed, then
  build) if you build by hand — `globalTeardown` empties the fixture after
  every run, and `next build` prerenders `/donate`, so building without
  seeding bakes in "not accepting donations" and fails 14 tests with no
  code change. `DATABASE_URL` must point at a throwaway Postgres (the
  fixture refuses the Supabase pooler, Supabase direct hosts, Fly internal
  and an unset URL), and `docs/99` §6 lists the rest — including
  **`PASSWORD_PEPPER`**, whose absence 500s every route in a production
  build while Playwright reports only a `webServer` timeout with zero tests
  collected, and **`AUTH_TRUST_HOST=true`**, without which every
  `/api/auth/session` fails with `UntrustedHost` off Vercel and the
  middleware's auth layer goes inert.

  Only the two Chromium projects run by default. Firefox and WebKit sit
  behind `PW_ALL_BROWSERS=1` because nothing in this repo installs them;
  that **WebKit gap is open and uncovered**, not closed.
- **Docs-only changes do not trigger CI at all** (`paths-ignore` on
  `docs/**` and `**/*.md`). Safe today because no test reads markdown —
  but if branch protection is ever added requiring `ci-complete`, a
  docs-only PR becomes unmergeable. `docs/97` §6.2 has the fix.

Every job declares `timeout-minutes`, and a ratchet enforces it: no job over
30 minutes, no pipeline over 200 job-minutes. **Do not raise a timeout to
make a job fit** — GitHub's default is 360 minutes per job, which was
3,240 job-minutes of silent exposure across the nine job instances before
this landed.

---

## Deployment is manual, and the owner runs it

Owner instruction, 2026-10-22: **do not deploy.** Land work on a branch,
run the gate, and stop there. The owner deploys from their own Windows
machine with **`.\scripts\deploy.ps1`** (see `docs/96`), which runs
lint + typecheck + unit tests before building, refuses a dirty tree or a
branch behind its remote, and reads the health endpoint afterwards.
⛔ **`scripts/deploy.sh` is NOT the bash equivalent, and this line used to say
it was.** [VERIFIED 2026-10-27 by reading it] that script runs **no gate at
all**: lines 31-73 parse flags, set `SSL_CERT_FILE`, check `FLY_API_TOKEN` and
call `flyctl deploy`. There is no lint, no typecheck, no test, no dirty-tree
check, no branch check and no health read. It is a flag wrapper, and the
reasons it exists are `--depot=false` and the proxy CA, not safety. **If you
deploy with it, you are the gate** — run
`npm run lint && npm run typecheck && npm run test:unit` yourself first. Either
script needs `fly auth login` or an **org-scoped** `FLY_API_TOKEN` — a builder-
or deploy-scoped token cannot see the app — and takes roughly 6 minutes
(measured: 364s for v109).

This means **`main` can be ahead of production**. Do not infer the
deployed version from the repository: read it with
`fly status --app lastdonor`, and remember that `/api/v1/health` reports
`commit: "local"` and tells you nothing about which commit is live.

**A new cron job needs TWO deploys, in order: the app, then the Worker.**
Added 2026-10-24. `workers/cron/src/index.ts` imports `dueJobs` from
`src/lib/cron-schedule.ts`, so the schedule is **bundled into the Worker at
`wrangler deploy` time** — it is not read from the app at runtime. Adding a
row to `CRON_SCHEDULE` therefore changes nothing in production until the
Worker is redeployed, and redeploying the Worker *first* makes it call a
route the live image does not serve yet (a 404 the Worker logs and nothing
else surfaces). Deploy the app, confirm the route answers **401** rather
than 404 unauthenticated, then redeploy the Worker. ✅ `refresh-fx-rates`
was the worked example and is now DEPLOYED AND FIRING: first run
**2026-10-25T02:00:05Z**, 151 rates stored, verified from the production
database (`docs/105` §7.7a). **Every job in `CRON_SCHEDULE` is now observed
firing in production**, `verification-reminders` included (first run
**2026-10-25T09:00:05Z**, `docs/110` §7.5a — and the adjacent `*/5` ticks are
the control: both dispatched two jobs and neither included it, so the daily
predicate is not firing on every tick). ⚠️ The Worker logs the HTTP status and
deliberately never reads the response body, so `ok 200` proves a job RAN and
says nothing about what it did — that is in its `cron.%` audit row.

**The Cloudflare proxy is ON as of 2026-10-24 (v96), and that ordering
constraint is now spent.** See `docs/105` §7. The resolver decides per request
and is correct whether the proxy is on or off, so there is nothing left to
sequence. ⛔ Do NOT raise `TRUSTED_PROXY_HOPS` to 2 to "account for
Cloudflare" — a hop count cannot describe two ingress paths, and both of this
app's paths stay reachable.

⚠️ **Deploying from a sandbox: Fly's default depot builder does not work
here** — `x509: certificate signed by unknown authority`, because its gRPC
client ignores `SSL_CERT_FILE`. Use **`--depot=false`**. And `--build-only`
does NOT push the image (it only tags it on the builder, and an unreleased
image is garbage-collected within the hour), so a later `--image` release
fails with `Could not find image`. Run the full deploy, or pass `--push`.

When you touch `.github/workflows/`, remember that a valid YAML file can still
be an invalid workflow: Actions expressions are a second language nested inside
it, and GitHub only parses them server-side. `src/ci-workflows.ratchet.test.ts`
covers the four defects known to be fatal and locally invisible.

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
- **Echo counters are incremented at the source. Use the helper.**
  Resolved 2026-10-18, see `docs/89-ECHO-COUNTERS-AT-THE-SOURCE.md`.
  `update_count`, `message_count` and `seed_donation_count` were never
  incremented by anything for four years of this codebase's life;
  `cron/reconcile` repaired them nightly. That stopped being survivable
  when the scheduler went live (docs/66) and `update-phases` began
  writing an organiser update every five minutes: measured the same
  night, the drift went from 1 campaign to 4 in 53 minutes.
  **Insert campaign updates and messages through
  `insertCampaignUpdate` / `insertCampaignMessage` in
  `src/lib/echo-counters.ts`**, passing your transaction handle when
  you have one. A ratchet fails the build on a direct
  `.insert(campaignUpdates)` or `.insert(campaignMessages)`. Reconcile
  step 5 remains the backstop and should now find nothing.

- **No request may issue more than THREE concurrent database queries.**
  Added 2026-10-17, see `docs/87` amendment 5. The pool is `max: 5`
  (`src/db/index.ts`), shared by every request on the machine, and the
  admin layout's `auth()` takes one of those alongside every admin page.
  `src/db/pool-fanout.ratchet.test.ts` walks the AST of every page,
  route and lib file, resolves helper calls three levels deep, and fails
  the build if any entry point exceeds three or if `max` changes.
  `/admin/settings` used to issue seven and took 15,330ms in production
  while leaving backends stuck in `active`/`Client/ClientRead`; the same
  page now answers in ~400ms. If a screen needs more data, collapse the
  queries (FILTER aggregates and scalar subqueries usually turn several
  counts into one round trip) or run a second batch after the first.
  Do not raise the number to make a page pass.

- **A campaign has exactly one currency, and two currencies are never added
  together.** Added 2026-10-21, see `docs/92`. Every amount column is an
  INTEGER in the MINOR units of its row's currency — not "cents", because
  UGX, RWF, XOF and XAF are zero-decimal and dividing those by 100
  understates them 100x. `donations` and `payhero_payment_requests` each
  carry a **composite foreign key** on `(campaign_id, currency)` referencing
  `campaigns (id, currency)`, which makes the rule a database guarantee and
  makes a campaign's currency **immutable once any donation exists**. Get a
  currency's exponent and bounds from `src/lib/money/currencies.ts`; render
  through `formatMoney` or `<Money minor currency>`. `getCurrency` throws on
  an unknown code rather than defaulting to USD, because a shilling figure
  with a dollar sign still looks like money. Where a cross-currency total is
  wanted, report per currency — never sum.

- **`donations.stripe_payment_id` is the provider-reference column for every
  gateway**, and `donations.provider` says which. Values are namespaced
  (`pi_…`, `payhero_…`, `seed_…`) so two gateways cannot collide in the
  unique index that is the platform's only replay guard. **Read `provider`
  before calling any gateway API** — handing a `payhero_…` reference to
  `stripe.refunds.create` is the bug all four refund paths had. The column's
  name is a known misnomer, recorded as debt in `docs/92`.

- **A PayHero outcome is never read from a callback body.** PayHero signs its
  callbacks with nothing at all, so `settlePayHeroRequest` reads only the
  `ExternalReference` we minted and then asks PayHero over our own
  authenticated call. Same shape as the Didit webhook (`docs/81`). It also
  refuses any reference outside the `LD-` namespace, which is what isolates
  this platform's money on an account shared with BETWOIN LTD.

- **Never call PayHero's `transaction-status` with a blank reference.** It
  answers HTTP 200 with a DIFFERENT MERCHANT'S transaction (probed four
  times, 2026-10-21). `getTransactionStatus` refuses an empty reference
  before building a request; do not add a fallback.

- **Outgoing email is written for a reader who left school early, or reads
  English as a second language.** Added 2026-10-21, see `docs/94`. Grade 8 or
  below, no sentence over 20 words, and no word from the glossary in
  `src/lib/email-readability.ts`. A ratchet fails the build on any template
  over the budget. Say who does what ("We refunded your donation", never
  "your donation has been refunded" — a passive sentence hides whether the
  reader must act), one idea per sentence, and name the thing the reader
  would name ("your ID", not "verification documents"). Check your copy with
  `npx tsx scripts/email-readability.ts --verbose`, which names the long
  sentences and the plain replacement for each piece of jargon. **Do not
  raise the budget to make a template pass.**

- **A colour written inline in an email template needs a dark-mode rule in
  the shell.** Added 2026-10-21, see `docs/94` §9 and the `docs/67`
  amendment. The shell's dark block recolours five CLASSES; templates write
  colour inline on the element, and inheritance stops there — so the card
  went dark and the text did not. Measured in Chromium: **light 0 elements
  below WCAG AA, dark 45, worst 1.31:1 where 4.5:1 is required.** Panel
  backgrounds count too: lightening text inside a pale inline `background:`
  leaves light-on-light. `src/lib/email-dark-mode.ratchet.test.ts` fails the
  build on any uncovered colour; verify for real with
  `npx tsx scripts/email-contrast.ts`, and look at it with
  `npx tsx scripts/email-screenshot.ts <dir>`. A reading-level score says
  nothing about whether the words can be seen.

- **The brand mark is generated, never hand-drawn, and `ImageResponse`
  needs the font BYTES.** Added 2026-10-22, see `docs/95`.
  `scripts/generate-bimi-logo.py` emits both `public/bimi-logo.svg` and
  `src/app/icon.svg` from the real DM Serif Display outlines, so they
  cannot drift from each other or from the brand face. `apple-icon.tsx`
  renders through **Satori, which has NO system fonts** — naming a family
  gets you Satori's built-in sans, silently, with a 200 response; it must
  be handed the file, which is why that route is `runtime = 'nodejs'` and
  not `edge`. An apple-touch-icon is also full bleed with no radius,
  because iOS masks it to a squircle and a second radius shows the gap.

- **An explicit email preheader is escaped; a derived one is not.**
  `renderEmail` handles this. Do not move it to the call sites: the obvious
  way to write a preheader is `` `We got your gift to ${p.campaignTitle}` ``,
  which interpolates raw attacker-controlled text into the document. See
  `docs/94` §4.

- **No module may construct a client at import time from credentials the
  build does not have.** Added 2026-10-22, see `docs/97` §5.4.
  `src/lib/supabase-storage.ts` called `createClient(url ?? '', key ?? '')`
  at module scope — and `createClient('')` throws `supabaseUrl is
  required`, so the `?? ''` that looks like tolerance is the opposite, with
  a `console.warn` in front of it saying "not set" as though execution
  continues. `next build` imports every route handler to collect page data,
  so **any build without Supabase credentials failed entirely**, and a
  contributor without them could not build the app. Build the client on
  first use, read `process.env` *inside* the accessor so the laziness is
  real, and raise a named error when it is genuinely needed and missing.
  `src/lib/supabase-storage.lazy.test.ts` pins it.

  The reason this survived is the more useful lesson:
  `test/security/verification-document-privacy.test.ts` had already met the
  wall and **stubbed the variables to get past it**, recording the throw in
  a comment as a fact to work around. If you find yourself setting an env
  var so a module can be imported, that is a defect in the module, not
  setup. Check whether `npm run build` survives without it.

- **A currency the platform KNOWS is not a currency it can COLLECT.** Added
  2026-10-24, see `docs/103`. `CURRENCIES` (`src/lib/money/currencies.ts`)
  means money can be taken in it: it carries a `gateway`, donation bounds and
  a pre-verification cap, and 16 money-path files read it. It still holds two
  entries. `WORLD_CURRENCY_EXPONENTS` (`src/lib/money/world-currencies.ts`)
  holds **152** and means only "real currency, known decimals" — it is for
  formatting and for an approximate converted figure.
  **Adding a country is a data change; making its currency collectable is a
  deliberate edit to `CURRENCIES` once a gateway exists.** `getCurrency` still
  throws for the other 150, and a test pins that. Regenerate the tables with
  `python3 -I scripts/generate-world-currencies.py` — never hand-edit a
  `*.generated.ts`.

  ⚠️ **ISO 4217 and CLDR disagree about 13 currencies** and both are right:
  ISO defines a subunit (the Iraqi fils, the Somali cent) that nobody quotes,
  and CLDR sets the display digits to 0. For IQD that is a factor of **1,000**.
  Display follows CLDR; `ISO_MINOR_UNITS` is kept beside it; and a test
  **forbids any of the 13 becoming collectable** until someone checks which
  convention the gateway expects.

- **Country detection is browser-side, and refuses to guess.** Added
  2026-10-24, see `docs/103`. ⛔ There is **no `CF-IPCountry`**: every
  `lastdonor.org` DNS record is `proxied=false` and responses carry no
  `cf-ray`, so Cloudflare is not in the request path at all and `docs/26`'s
  edge layer does not exist (that doc is amended). Fly supplies no country
  header either. Use `detectLocale` from `src/lib/geo/detect-country.ts`.

  ⚠️ **Never use `Intl.Locale(tag).maximize()` to find a region.**
  `'en'` maximizes to **US** and `'sw'` to **TZ** — CLDR's likeliest regions,
  not facts about the visitor — so it would tell a Kenyan on an English-only
  browser they are American and show them dollars. Only an **explicit** region
  in the tag counts; otherwise render nothing. Timezone beats language,
  because a Kenyan browsing in `en-US` is the common case. And the timezone
  table is built from **`zone.tab`, not `zone1970.tab`**: the latter merges
  countries that share a clock, which puts Kampala in Kenya.

- **The FX snapshot reader must accept everything the writer stores.** Added
  2026-10-24, see `docs/104`. `narrowToSupported` (writer, `fx-providers.ts`)
  and `parseFxSnapshot` (reader, `fx-store.server.ts`) BOTH require the
  collectable currencies and keep the known ones best-effort. They were once
  out of step — the writer stored 152 rates, the reader kept 2 — and country
  detection then displayed KES and nothing else, with no error anywhere.
  **If you narrow one, narrow both.** A missing rate renders as nothing by
  design, so this class of defect is invisible without a browser.

- **A page that reads `searchParams` must not export `revalidate`.** Added
  2026-10-24, see `docs/104` §4. Such a page is dynamic in Next 15, so the
  directive is inert — measured against production, all four such routes
  answer `private, no-cache, no-store` while all five that do not read
  `searchParams` answer `s-maxage=300`.
  `src/app/revalidate-honesty.ratchet.test.ts` fails the build on the
  combination. Same class as the sixteen inert exports `docs/88` removed from
  admin.

- ✅ **Cloudflare NOW fronts this site, as of 2026-10-24.** See `docs/105` §7.
  The apex `A`/`AAAA` and `www` are proxied (`cf-ray` present, `server:
  cloudflare`); **`origin.lastdonor.org` and `lastdonor.fly.dev` are
  deliberately NOT**, and the cron Worker targets the latter so the 100s proxy
  ceiling still does not apply to cron (`docs/66`). `send.`/`rsend.` are
  Resend mail records and would break if proxied. `ssl` is **`strict`**, and
  one WAF skip rule covers the four signature-authenticated webhooks —
  verified reaching the app through the edge, not challenged.

  ⚠️ **Two ingress paths now exist, permanently.** That is what `docs/105` is
  about: a request can arrive through Cloudflare or straight at the origin, so
  **no configuration value can describe "how many proxies are in front"**.
  `getClientIp` decides per request. ⛔ Do NOT set `TRUSTED_PROXY_HOPS` to 2.

  **`CF-IPCountry` now exists on proxied requests** — but it is ABSENT on the
  two grey hostnames, so it is not a reliable input, and country detection
  stays browser-side by the `docs/103` decision. Do not rewire it without
  reading both docs.

  ⚠️ **The flip bought no HTML caching**, as `docs/104` predicted: all ten
  routes measured answer `cf-cache-status: DYNAMIC`. And `s-maxage` on an HTML
  route is **inert at the edge too** — Cloudflare's default rules select by
  file extension, so `/login`'s `s-maxage=31536000` does nothing without an
  explicit Cache Rule (`docs/105` §7.5). Note `docs/26` says `.com`
  throughout and **no `.com` zone exists** — the domain is `.org`.

- **An exchange rate is for display, and never for accounting.** Added
  2026-10-24, see `docs/102`. Convert with `convertMinor` from
  `src/lib/money/fx-convert.ts` and render through `<ApproxMoney>` - the only
  component allowed to show a converted figure, and the one that carries the
  required provider attribution. A converted number is never written to an
  amount column, never summed across currencies, and never decides a payout,
  refund, cap or goal: the one-currency-per-campaign rule is a composite FK
  (`docs/92`), and a rate is the one thing that makes breaking it look
  reasonable. `src/lib/money/fx-display-only.ratchet.test.ts` holds an IMPORT
  ALLOWLIST - a money-writing module that imports FX fails the build.

  Rates come from `open.er-api.com` (fallback `@fawazahmed0` via jsDelivr),
  refreshed daily by `cron/refresh-fx-rates` into one `site_settings` row.
  **Staleness is a refusal**: past `MAX_FX_AGE_HOURS` (48) conversion returns
  `null` and the UI shows nothing rather than an undated figure. Check the
  providers for real with
  `FX_LIVE_CONTRACT=1 npx vitest run src/lib/money/fx.contract.live.test.ts`.
  ⚠️ The primary answers **HTTP 200 for its own errors**, so never read
  `res.ok` as success.

- **An unverified campaign has a raise cap, and a `sql` template must
  qualify its identifiers.** Added 2026-10-24, see `docs/101`. Money in is
  capped per currency until a person has checked the organiser's ID
  (`unverifiedCapMinor` in `src/lib/money/currencies.ts`; exempt states are
  exactly `identity_verified` and `fully_verified`). Enforce it with
  `checkRaiseCap` from `src/lib/campaign-raise-cap.ts` **before** calling a
  payment provider — after the charge, enforcing a cap means refunding. Feed
  it from **`realRaisedMinorSql`** (`src/db/real-raised.ts`), never
  `campaigns.raised_amount`, which is blended with fabricated seed money.
  A ratchet discovers money-in routes from disk, so a new collection route
  without the cap fails the build.

  ⚠️ **The transferable part**: interpolating a Column into a `sql` template
  renders it **unqualified**. `WHERE ${donations.campaignId} = ${campaigns.id}`
  emits `WHERE "campaign_id" = "id"`; inside a subquery both names resolve to
  the inner table, the predicate is never true, and the query returns 0 for
  every row with no error at all. `alias()` does not fix it. Qualify with
  `sql.identifier(getTableName(t))` and `sql.identifier(col.name)`. **A grep
  over SQL text proves the text, not the semantics** — this passed unit tests,
  a text ratchet and typecheck, and was caught only by running it against a
  real database.

- **A `sql` template must not bind a bare `Date`.** Added 2026-10-25, see
  `docs/107`. `gte(donations.createdAt, d)` encodes `d` with that column's
  `mapToDriverValue`; `` sql`${donations.createdAt} >= ${d}` `` cannot - the
  value becomes a parameter with **no encoder** and postgres-js throws
  `The "string" argument must be of type string ... Received an instance of
  Date`. This 500'd **every load of `/admin/reports`** while lint, typecheck,
  6,855 unit tests and the fan-out ratchet all passed. Use
  **`sql.param(value, column)`**, or step out of the template and use
  `gte`/`lte`/`between`. `src/db/sql-template-dates.ratchet.test.ts` asks the
  TypeScript **checker** for the type of every interpolation in every `sql`
  template in `src/` and fails the build on a `Date` - a grep cannot do this,
  because `${since}` is fine as a string and fatal as a Date and the two read
  identically.

  ⚠️ **No admin page's data query is run by any test** (`docs/107` §7). The
  integration suite covers API routes, the E2E suite has no signed-in admin
  fixture, and a unit test cannot reach a server component's database call. An
  admin screen's query is checked by reading it. If you change one, run it.

- **A hand-rolled `role="radiogroup"` must behave like one.** Added
  2026-10-22, see `docs/100`. Seven groups in this codebase are
  `<div role="radiogroup">` holding `<button role="radio">`, because the
  tiles carry icons, two lines of text and badges that a native radio
  cannot style. That trade is fine; what is not fine is claiming the role
  without the behaviour. **A radio group is ONE tab stop with arrow keys
  inside it** — all seven had no key handler and no `tabIndex` management,
  so arrow keys did nothing and the groups were up to 23 tab stops each.
  Use **`onRadioGroupKeyDown` and `rovingTabIndex` from
  `src/lib/radio-group-keys.ts`**, and when the options are a plain list of
  labels prefer a native `<input type="radio">` over either.

  Two things to know before you touch it. The first-option fallback in
  `rovingTabIndex` is **load-bearing**: four groups render with nothing
  selected, and without it every option is `-1` and the group is
  unreachable by keyboard. And `{ selectOnMove: false }` on the two
  review-screen editors is **not a preference** — selecting there unmounts
  the group, so selecting on move would let the first arrow press close the
  panel and strand 22 of 23 options. ⚠️ **axe cannot see any of this**: it
  checks `aria-checked` and the parent role, both of which were already
  right, and three of these groups sat on pages passing a full WCAG 2.1 AA
  run.

- **The root layout must not read a dynamic API, and the signed-in tools have
  no public footer.** Added 2026-10-24, see `docs/106` §10a; extended to
  `/dashboard` 2026-10-25, see `docs/107` §6. `src/app/layout.tsx` is the only
  root layout, so everything it renders wraps every route - which put a
  newsletter signup and a marketing footer on all 24 admin pages and on every
  organiser dashboard screen, both of which have their own navigation shell.
  The footer is now gated by `PublicFooterGate` (a client component taking the
  server-rendered `<Footer />` as children) using `showsPublicFooter` from
  `src/lib/public-chrome.ts`; `PRIVATE_PREFIXES` is `['/admin', '/dashboard']`.

  ⛔ **Do NOT branch on `headers()` in the root layout** to do this. It is the
  obvious fix and a dynamic API there opts EVERY route out of static rendering:
  measured, the build is 216 routes at **181 dynamic / 32 static / 3 ISR**, and
  all 35 would have gone dynamic. The gate keeps it at 181/32/3 exactly.

  ⛔ **The navbar is NOT gated**: the admin sidebar has no sign-out, so it is an
  administrator's only way out. And the predicate is **anchored** -
  `startsWith('/admin')` also matches `/administrator`.

  ⚠️ Verifying this needs the rendered DOM, not `page.content()`: that includes
  the RSC flight payload, where the footer's serialized output still appears, so
  a naive grep matches both the fixed and broken versions.

- **An institutional vouch grants `identity_verified` and nothing else.**
  Added 2026-10-25, see `docs/108`. A verified organisation (hospital, church,
  school, registered charity) can confirm a crisis instead of the organiser
  uploading documents. That lifts the `docs/101` raise cap and is ALL it does:
  it releases no money, and it does not touch `campaigns.status`, so the
  `docs/78`/`docs/79` publication review still happens. ⛔ `fully_verified` is
  refused because the admin verification route writes
  `total_released_amount` in the same transaction that sets it - a third
  party's word must never move money.

  Use `recordVouch` / `revokeVouch` from `src/lib/trust-network/vouch.ts`; the
  decisions are in `decide.ts` and have no database in them.
  `vouch-boundary.test.ts` reads the directory's `.update()` targets and
  `.set({})` keys and fails the build if anything there writes a money column,
  another table, `campaigns.status` or the status literal. ⛔ Do not widen that
  allowlist to let a change through - that reopens the decision.

  ⚠️ **There is no self-serve institution signup, and that is the security
  model.** Anyone who can create an institution can lift the cap on any
  campaign it vouches for. An admin creates one and must say how they checked
  it. `representative_*` on a vouch is ATTRIBUTION, not authentication, and no
  screen may imply otherwise.

  ⚠️ **The vouch budget counts REVOKED vouches.** It is a rate of assertions:
  if revoking returned budget, an institution could vouch, revoke, vouch,
  revoke forever. And revocation only un-verifies a campaign whose
  `verification_source` is `institution_vouch` - a NULL source means UNKNOWN,
  never "this vouch's doing".

  Donors are told, in `VouchedByBadge`: "Confirmed by X - they told us this
  need is real. We have not seen the organiser's ID ourselves." A test forbids
  the words *verified*, *verification*, *document* and *we checked* in that
  copy, because one edit to "Verified" makes it a claim the platform cannot
  substantiate and nothing else would notice.

- **A relative timestamp on a cached page must not be rendered on the server.**
  Added 2026-10-25, see `docs/107` §8.1. `formatRelativeTime` reads
  `Date.now()`, and `/campaigns/[slug]` is ISR with `revalidate = 60`, so the
  cached HTML said "just now" while the client said "5m ago" - **React error
  #418 on every mobile load of a production build**, and clean in `next dev`
  (no ISR cache) and at desktop width (the donor feed is mobile-only). Use
  **`<RelativeTime>`** from `src/components/ui/RelativeTime.tsx`: the server
  renders the absolute date, which is true whenever the cache entry is served,
  and the relative form appears after mount. ⛔ Not `suppressHydrationWarning`
  - that hides the warning and keeps the wrong figure.

- **A label for a figure that may render nothing goes INSIDE the component.**
  Added 2026-10-25, see `docs/107` §8.2. `/campaigns/[slug]` wrote
  `<span>Goal is </span><LocalAmount …/>`, and `LocalAmount` renders nothing
  when converting would tell the reader nothing - including a USD campaign
  read from the United States, which is every production campaign. The public
  page showed "Goal is" and empty space. Pass `label` to `ApproxMoney`/
  `LocalAmount` instead. The general rule: a component that renders nothing by
  design is invisible until somebody looks at it in a browser, and anything
  beside it does not disappear with it.

- **A CSS variable in this project holds a complete colour, so it is never
  wrapped in `hsl()`.** Added 2026-10-25, see `docs/107` §8.3. `--chart-1` is
  `#0F766E`, so `hsl(var(--chart-1))` is `hsl(#0F766E)` - not a colour. The
  browser falls back silently: **every chart in `/admin` drew in the wrong
  colour and the bar chart drew solid black.** The form is correct in the
  shadcn/ui convention the markup was copied from, where tokens are bare HSL
  triplets, and is indistinguishable from it at the call site. Write
  `var(--chart-1)`. `src/app/design-tokens.ratchet.test.ts` fails the build on
  any `hsl(`/`rgb(` wrapper around a variable, and checks first that the
  tokens really are hex - if they ever become triplets, the rule inverts.

- **Where a flow redirects must be able to render what the flow just created.**
  Added 2026-10-25, see `docs/109`. The create-campaign wizard sent organisers
  to `/campaigns/<slug>?launched=true` and they got a **404**: the insert is
  `under_review` (`docs/78`, `docs/79`) and the public page does not serve that
  status. Nothing threw - both ends were right and the line between them was
  stale, the `docs/83` shape. It now goes to
  `/dashboard/campaigns?submitted=1`.

  ⚠️ **A test was holding the defect in place**, and the lesson is sharper than
  the bug: `instant-live-architecture.test.ts` asserted the old redirect by
  reading source TEXT, while section 5 of the same file already asserted the
  new insert. One file, both halves of a contradiction, green throughout -
  because no test compares two assertions to each other.
  `src/app/share-your-story/submit-redirect.test.ts` replaces it by DERIVING
  both ends from source (the status the route inserts, the statuses the page
  serves) and only then deciding what the redirect may be, so it stays correct
  if the review gate is ever reconsidered.

  ⛔ The confirmation copy may not promise an email when a campaign is
  **decided** - `docs/93` removed exactly that sentence, because a refused
  campaign notifies nobody and that is still open - and quotes no turnaround
  time. `LaunchSuccessBanner` ("Your campaign is live") is reachable only from
  the **approval** email now, which is the one moment its words are true.

  ⚠️ **Before rendering ANY link to `/campaigns/<slug>`, call `hasPublicPage`**
  from `src/lib/campaign-visibility.ts`. The same defect had a second door:
  the "View" button on every `/dashboard/campaigns` row linked there for every
  status, so an organiser whose campaign was still in the queue got the same
  404 from their own dashboard. The constant is asserted equal to the page's
  own `getCampaign` filter, parsed from source, so the two cannot drift.

- **A link to a campaign is BUILT, never written by hand.** Added 2026-10-27,
  see `docs/118`. Use **`publicCampaignPath({ slug, status })`** and
  **`organiserCampaignPath(campaignId, screen?)`** from
  `src/lib/campaign-links.ts`. The rule above was enforced for links in the UI
  and **never swept over notifications** - a notification is a link too, just
  stored in a column - so two of them handed real donors a 404:
  `campaign_archived` linked `/campaigns/<slug>` for the one status the page
  does not serve, and the message-moderation route put a **UUID in the slug
  position**. [VERIFIED live: an archived slug and a UUID both 404; an active
  slug 200, which is the control.]

  ⚠️ **The organiser routes are split 3/3 on whether they accept a slug.**
  `[id]`, `[id]/updates`, `[id]/donors` and `[id]/edit` are
  `if (!UUID_RE.test(id)) notFound()`; `verification`, `impact-update` and
  `payout-destination` take either. So two identical-looking lines - one
  passing a slug to a child, one to the bare route - behave differently, which
  is what let the mistake spread. `organiserCampaignPath` keys on the id,
  which is correct on all seven.

  ⛔ **`null` is a real return value and must be handled, not coerced.** Both
  renderers already do (`NotificationsClient.tsx:279-285` shows plain text,
  `NotificationBell.tsx:246-249` does not navigate), so an unlinkable
  notification still says what happened. `campaignStatus` is a **required**
  parameter on the notification helpers precisely so `tsc` names every call
  site; an optional one would have let every existing 404 compile.

  ⚠️ **Write-time guarding is not enough: a stored link ROTS.** `docs/118`
  §2.5 - one production row was a 404, valid for 2m39s before its campaign was
  archived, and the read side revalidates nothing. ✅ Resolved for the common
  case by `docs/118` §9: **`archived` is now served with a closed notice**, so
  that row heals with no backfill. ⛔ Rot is NOT eliminated -
  `ALLOWED_TRANSITIONS` permits `active -> draft` and `draft` has no public
  page - so keep the guard, and keep in mind every newly created campaign is
  `under_review`.

  ⛔ **Serving a status is not indexing it.** `isIndexable` and the two sitemap
  lists stay `active|last_donor_zone|completed`; a URL both submitted in a
  sitemap and served `noindex` is a contradiction Google reports.
  `campaign-visibility.test.ts` reads all three lists from source so making a
  status viewable can never quietly advertise it.

- **Everything an organiser is told about getting paid comes from one module.**
  Added 2026-10-25, see `docs/110`. `src/lib/organiser-journey.ts` computes the
  ordered path - each step's state, a plain sentence, **what it unblocks**, and
  the link - and the submitted notice, both dashboard lists, the campaign page
  and the verification screen all render from it. Use `organiserJourney` for a
  full ladder and `nextOrganiserAction` for a single row. ⛔ Do not add a
  seventh partial idea of the journey to a screen; add the step here.

  ⚠️ **"Verified" is two tiers with two different consequences.**
  `identity_verified` lifts the `docs/101` raise cap; `fully_verified` is what
  `withdraw/route.ts` requires. A campaign can be past the cap and still unable
  to pay out. Never label `identity_verified` as "verified" - a test forbids it.

  ⛔ The copy may not promise an email when a campaign is **decided**
  (`docs/93`, still open) and quotes **no turnaround time** (`docs/78`). Tests
  assert both against every state.

- **Refusing a campaign at review carries a reason, and there is exactly one
  path for it.** Added 2026-10-25, see `docs/93`. The organiser is emailed the
  admin's words (`notifyCampaignRefused` / `campaignRefusedEmail`), so the
  reason is required: `POST /api/v1/admin/campaigns/[campaignId]/suspend`,
  whose schema demands at least three characters.

  ⛔ **`PATCH /api/v1/admin/campaigns/[campaignId]` must not regain
  `under_review -> suspended`.** It takes `{ status }` and nothing else, so
  every refusal through it was reasonless AND silent. It was the only route to
  `suspended` that endpoint had, and removing it is what makes the decision
  hold - re-adding it reopens a door that cannot notify anybody.

  ⚠️ **One status, two situations.** Suspending a LIVE campaign is an
  investigation: it has donors, and `notifyCampaignSuspended` tells them their
  money is safe. Suspending an `under_review` campaign is a REFUSAL: it was
  never public, so it has no donors, and the organiser is the one who needs
  telling. The route branches on `previousStatus === 'under_review'` and logs
  `campaign.refused` rather than `campaign.suspended`. The old code called the
  donor function for both, which sent zero emails and returned 200.

  ⚠️ The reason is **admin-typed free text rendered into an email**, so it is
  escaped - the `docs/94` §4 hazard. The copy promises no re-review (the
  revision loop was not taken), no turnaround time (`docs/78`) and nothing
  about money being sent back.

- **A campaign collaborator holds CONTENT capabilities and nothing else.**
  Added 2026-10-25, see `docs/111`. An organiser can invite helpers by email;
  they may `post_update` and `edit_content` and that is the whole list
  (`src/lib/collaborators/capabilities.ts`). Check with `canCollaborate`, and
  evaluate it **after** the ownership check — it issues a query, and the
  owner's path must not pay for it (`docs/87`, pool `max: 5`).

  ⛔ **`NEVER_DELEGATED` is not documentation.** A collaborator can never
  withdraw, change the payout account, upload identity documents, delete a
  campaign, change its status, or invite anybody. Moving an entry between the
  two lists reopens the decision in `docs/111` §1.

  ⚠️ **Why, traced:** `withdraw/route.ts:146-154` resolves the payout
  destination with `eq(users.id, session.user.id)` — the **caller's** Connect
  account — and passes it to `createTransfer` at 405-408, with no later
  `creatorId` re-check. So *"the credited account belongs to the person owed"*
  is held up by the ownership comparison eight lines above and nothing else.
  Delegating ownership pays a family's money to a helper, silently. The
  call-site test carries a **tripwire on that premise**: if the destination
  ever stops being read from the caller, it fails so somebody re-reads the
  decision.

  ⛔ **Two tests, and one is not enough.** The module boundary (what
  `src/lib/collaborators/` may write) plus the **call sites** (six sealed
  routes must not consult `canCollaborate`, found by walking the tree). A
  sealed module is worthless if the withdrawal route calls into it.

  ⚠️ `requireOwner` in `user-campaigns/[id]/route.ts` takes the capability
  **per call site** — `'edit_content'` for GET and PUT, nothing for DELETE.
  Baking it into the shared helper would have widened DELETE by accident.

  ⚠️ The invite route **sends email**, so it has its own `collab` rate-limit
  tier matched by a predicate, not a prefix: the campaign id is mid-path, and
  matching `/api/v1/user-campaigns` would put the withdrawal route in a
  five-a-minute email bucket. Both lookups must agree (`docs/85`). The real
  abuse control is `MAX_LIVE_COLLABORATORS`, not the IP limit.

  ⛔ **`/collaborate/accept` must not accept on load.** Mail clients and link
  scanners fetch emailed URLs before a person sees them, so a GET that mutates
  hands the membership to whichever machine opened the message first. The page
  renders a button.

- **A verification reminder states a consequence, never a countdown.** Added
  2026-10-25, see `docs/110` §7. `cron/verification-reminders` runs daily and
  sends one of four levels - first real donation, approaching the raise cap,
  at the cap, funded but unpayable - each **at most once per campaign for its
  whole life**, with a 24-hour floor between any two. The rules are pure
  (`src/lib/verification-reminders.ts`); the queries are in
  `verification-reminders.server.ts` **so that a test can execute them**
  (`docs/107`); the route is the loop and the mail.

  ⛔ **Do not wire `verificationReminderEmail`** (the older four-level
  ladder). Every level of it opens with "reached its goal N days ago" and
  three threaten to return the donations - and [VERIFIED 2026-10-25, by
  enumerating every refund call site] **no mechanism sends money back on a
  clock**: all refunds are admin-initiated, and `deadlineDays` exists only as
  a field an admin types into an info request. A cron is what turns dormant
  bad copy into mail somebody receives.

  ⚠️ `identity_verified` **lifts the raise cap**, so for that campaign all
  three cap levels are FALSE - the state a naive "not fully verified" filter
  would mail. Measure money with `realRaisedMinorSql`, never
  `raised_amount` (`docs/101`); a failed send still spends its level, by
  design, and `audit_logs.details.emailed` records which.

- **Organiser-facing status words live in `src/lib/campaign-labels.ts`.** Added
  2026-10-25, see `docs/110` §4. There were seven status maps and three
  verification maps; three of the organiser ones had drifted - one invented two
  statuses that do not exist while missing four that do, and another showed
  "Identity Verified (Tier 1)". ⚠️ A missing key is not a blank: every map falls
  back to the raw value, so drift reaches the reader as `under_review`. Use
  `campaignStatusLabel` / `verificationStatusLabel`; the test reads completeness
  from the database enums rather than retyping the list. ⛔ `src/components/admin/`
  is deliberately NOT consolidated - two audiences, two vocabularies.

- **One module mints the attributed share link, and the social intent links
  keep `rel="noopener"`.** Added 2026-10-25, see `docs/112`. Resolve a
  sharer's `/s/<token>` with `mintAttributedUrl` from
  `src/lib/attributed-share.ts` - on demand, never at render (a mint is a
  write, and `docs/58` refused crediting a share to every campaign somebody
  scrolled past), bounded, and falling back to the plain URL on any failure
  including an `unknown` session read (`docs/44`).

  ⛔ **Do not attribute the Facebook or X links.** The only two ways to do it
  are minting before the click, which `docs/58` rejected, and holding a
  `window.open('', '_blank')` handle across the mint - and that handle is
  `null` when `noopener` is passed. Attribution is a growth metric;
  reverse-tabnabbing is a security property. `ShareButtons.test.tsx` asserts
  `noopener` on all three external links precisely because the pressure to
  remove it comes from trying to improve that file.

- **A share card's image is probed before it is rendered, and its money is
  the row's own currency.** Added 2026-10-25, see `docs/112` §7. Build the
  card's decisions with `ogCardModel` and its description with
  `campaignShareDescription` - never a template literal at the call site, and
  never `centsToDollars`, which hardcodes USD while every amount column is in
  its own row's minor units (`docs/92`).

  ⛔ **`ImageResponse` does not fail gracefully.** An image Satori cannot
  decode throws mid-stream and the route answers **HTTP 502** - which is what
  2 of 14 live campaigns were serving. `probeHeroSrc` makes one HEAD request
  and accepts only `image/jpeg`, `image/png`, `image/gif`; everything else
  renders the designed fallback. Do not replace it with an extension check:
  production stores Unsplash URLs with no extension, and uploads accept webp
  and avif (`supabase-storage.ts:149`), neither of which Satori can decode.

  ⛔ **`og:description` must never begin with the title.** Every platform
  renders `og:title` as a heading with the description clamped beneath it, so
  a description that opens with the title shows the same sentence twice and
  is truncated before it adds a fact. A test asserts it, and reads the page
  source so a new literal next door cannot reintroduce it.

  ⚠️ In a Satori card, a character outside the supplied fonts triggers a
  NETWORK font fetch (`docs/95`), and `WebkitLineClamp` does nothing unless
  `display` is `'-webkit-box'`.

  ⛔ **Type sizes come from `src/lib/og-card-metrics.ts`, never a literal.**
  Added 2026-10-25, see `docs/112` §8. One image goes to every platform and
  nothing in it is responsive, so each size must survive the NARROWEST
  rendering: a message bubble gives a 1200px card **290-322px**, a 3.7-4.1x
  downscale, against ~400px (3.0x) in a feed. At the old scale the TITLE
  rendered at **10.6px** and four of six elements were illegible. The rule is
  `cardPx = effectivePx x downscale`, in two tiers - title and amount against
  4.14x, everything else against 3.00x - and a test RECOMPUTES it rather than
  pinning today's numbers.

  ⛔ **The title is sized to FIT, never clamped.** Added 2026-10-25, see
  `docs/112` §9. It used to cut off at three lines with an ellipsis, so a long
  appeal lost the end of its own sentence in every share of it - and the
  validator allows **200 characters**. `fitTitle` walks a ladder from 60px to
  a floor of 24 and takes the largest size that fits.
  ⚠️ It **measures** against the real font and does not count characters: `M`
  advances 2.8x `i` in DM Serif Display, so a character rule is wrong by that
  much. `@shuding/opentype.js` is a DECLARED dependency for this (the
  `docs/97` `glob` lesson), with its probed API in
  `src/types/shuding-opentype.d.ts`.

  ⛔ **The card is emitted as JPEG via `sharp`, not PNG.** `ImageResponse`
  produces PNG only, and production was serving **798-928KB** cards. ⚠️ The
  ~300KB WhatsApp ceiling is **community-observed, not documented by Meta**,
  and sources conflict (300KB vs 600KB) - treat it as a safety target, not a
  fact. Quality 90 lands the same cards at 47-141KB.

- **What an organiser agreed to is RECORDED, as a timestamp, by the server.**
  Added 2026-10-25, see `docs/113` §10.2. The wizard has always shown a real
  clickwrap notice and the client has always posted `agreedToTerms: true`,
  `confirmedTruthful: true` and `beneficiaryConsent: true` as hard-coded
  literals - the validator's `z.literal(true)` is a gate that CANNOT FAIL,
  because the client is what sets it - and the create route persisted none of
  them. The agreement was given; the record was not kept. Build it with
  `consentRecord` from `src/lib/campaign-consent.ts`.

  ⛔ **Timestamps, not booleans** (`docs/41`, `docs/82`): a boolean cannot
  answer "before or after we changed the terms", which is the only question
  ever asked afterwards. ⛔ **The server stamps its own clock** - a consent
  built from a client field is a claim the submitter made about themselves.

  ⛔ **`beneficiary_consent_at` is NULL when the relation is `self`**, because
  the wizard shows no second notice then; recording it anyway fabricates a
  consent nobody was asked for. `requiresBeneficiaryConsent` is read by BOTH
  the screen and the route so the two cannot drift (`docs/109`). ⚠️ Bump
  `TERMS_VERSION` in the same commit that edits `/terms` - nothing enforces
  it, and a stale value attests to the wrong document.

- **Every path that creates a campaign is gated, and the gate test DISCOVERS
  its own inputs.** Added 2026-10-26, see `docs/116` §4. A campaign may not be
  inserted `active` with a `publishedAt` by anything except the admin create
  route `/api/v1/campaigns`, where an administrator choosing 'active' IS the
  human review. There were THREE non-admin creation paths and `docs/78`/`docs/79`
  knew about two: `runNewsPipeline` (`src/lib/news/news-pipeline.ts`, reached by
  the `ingest-news` and `fetch-news` crons) published machine-generated
  campaigns about named real people with nobody reading them.

  ⛔ **It escaped the gate test because the test named two files by hand** and
  searched them for the literal `.insert(campaigns)` - this site spells it
  `.insert(schema.campaigns)`. `src/lib/news/publisher-review-gate.test.ts` now
  walks `src/`, matches both spellings and brace-matches the `.values({…})`
  object. **Do not replace that discovery with a file list**, and do not slice
  a fixed number of characters after the insert: the version that took 2,600
  failed when a comment pushed `status: 'under_review'` past the window.

  ⚠️ **Strip comments before any such sweep.** The comment explaining why an
  insert is no longer `active` necessarily quotes `status: 'active'`, so a
  raw-source match reports the fix as the defect - and the first discovery
  found six inserts in four files, two of them prose.

- **A campaign's currency is chosen at the insert and never written again.**
  Added 2026-10-26, see `docs/116` §3. All four `insert(campaigns)` sites used
  to omit the column, so every campaign ever created took the `'USD'` default
  on a platform collecting only shillings. Both create schemas now carry
  `currency`, restricted to **collectable** currencies (`SUPPORTED_CURRENCY_CODES`,
  not the 152 of `WORLD_CURRENCY_EXPONENTS` - `docs/103`) and defaulting to
  `DEFAULT_CURRENCY`.

  ⛔ `updateCampaignSchema` is `createCampaignBase.partial()`, so it ACCEPTS
  `currency`. What stops a write is that `PUT /api/v1/campaigns/[slug]` builds
  `updateValues` field by field and `currency` is not in the list. **Never
  replace that with `...data`** - `src/lib/validators/campaign-currency-immutable.test.ts`
  fails on a spread and sweeps every `.update(campaigns).set({…})` in `src/`.

  Goal bounds are per currency (`minGoalMinor`/`maxGoalMinor`) and their
  messages render through `formatMoney`, so a shilling goal is never reported in
  dollars. ⚠️ The KES figures are POLICY NUMBERS on the `docs/101` ×100 scale,
  like `unverifiedCapMinor`, not conversions.

- **An organiser chooses the campaign's currency, and no screen assumes
  dollars.** Added 2026-10-27, see `docs/118` §10. `docs/116` §3 made
  `currency` settable by the API and recorded that it was reachable from **no
  screen**, so every campaign ever created took the `USD` default - and
  `docs/118` §6 found the consequence: all 14 active production campaigns are
  USD routed to a Stripe key that does not authenticate, so not one of them
  can take a donation. The create wizard now offers `SUPPORTED_CURRENCY_CODES`
  (the two collectable ones, never the 152 known ones - `docs/103`).

  ⛔ **Convert with `majorToMinor(major, currency)`, never a literal `* 100`.**
  The wizard had `parseInt(form.goalAmount, 10) * 100`, which is right for USD
  and KES and **100x wrong** for UGX, RWF, XOF and XAF (`docs/92`). It was
  latent only because currency was unsettable; making it settable is exactly
  what would have armed it. Render a figure with `formatMoney`, and an input's
  inline prefix with **`currencySymbol`** - derived from `Intl`, because a
  second hand-kept symbol map drifts from the one `formatMoney` already uses.
  ⚠️ `currencySymbol('KES')` is **`"Ksh"`, three characters**, and the goal
  input's left padding switches on that length.

  ⛔ **Use a NATIVE `<select>`, not an eighth hand-rolled `role="radiogroup"`.**
  `docs/100` had to retrofit a key handler and roving `tabIndex` onto seven of
  them, and says so itself: a plain list of labels should be a native control.

  ⚠️ **A currency restored from `localStorage` must be validated.**
  `getCurrency` deliberately throws on an unsupported code, and that value
  reaches it through `majorToMinor` and `currencySymbol`, so a corrupted draft
  would crash the wizard on render. The wizard already guarded
  `fundraisingFor` and `beneficiaryRelation` on restore for the same reason.

  ⛔ Still open: the 14 existing USD campaigns are **untouched** (a currency is
  immutable once any donation exists, `docs/92`), and `DEFAULT_CURRENCY` is
  still `USD`, so an organiser who ignores the selector still creates a
  campaign that cannot collect. Both are owner calls (`docs/118` §10.6).

- **No user-facing surface quotes a processing rate, and only server, admin and
  policy surfaces may name the processor.** Added 2026-10-26, see `docs/116` §5.
  Thirteen sites said "Stripe charges 2.9% plus 30 cents" and several did the
  arithmetic down to "the campaign receives $48.25". Stripe cannot take a
  payment here (`docs/72`), that rate has never been charged to anybody
  (`docs/92`: PayHero's real fee is a flat KES 8.9 against a published KES 6),
  and ⛔ **nothing deducts a processing fee at all** - `create-checkout` sets
  `unit_amount: data.amount` with no `application_fee`, `payment-service.ts`
  credits `raisedAmount + amount`, and `withdraw/route.ts` computes
  `released - withdrawn - pending`.

  ⛔ **Do not substitute another number.** `src/app/fee-claims.test.ts` fails
  the build on a percent-plus-fixed rate, on "30 cents", and on a processor
  name outside a documented allowlist - and asserts positively that the 0%
  disclosure still exists, so the rule cannot be satisfied by deleting the fee
  section. The allowlist covers server code, admin screens and the privacy,
  terms and refund-policy pages, where naming a sub-processor is a COMPLIANCE
  DISCLOSURE rather than a claim.

- **An admin money filter names its currency or is refused.** Added 2026-10-26,
  see `docs/116` §2. `GET /api/v1/admin/donors/segments` compared
  `"totalDonated" >= 50000` - US$500 as a bare integer against a column with no
  currency at all - so a KES 50,000 donor was classified by a dollar rule. The
  threshold is now `CURRENCIES[code].majorDonorMinor` and `minDonated`/
  `maxDonated` take MINOR UNITS, with a 400 when no supported currency is
  passed. Defaulting is what the defect was.

  ⚠️ **A `HAVING` with no `GROUP BY` is one group even over zero rows**, so
  `COALESCE(SUM(amount), 0) <= X` is TRUE for a donor who has given nothing in
  that currency. Proven against real Postgres: `?currency=KES&maxDonated=1`
  returned a USD-only donor. `GROUP BY d.currency` in `givenInCurrency` is
  load-bearing.

- **A step may offer an action only if its target will accept it.** Added
  2026-10-27, see `docs/119`. Use **`isOrganiserEditable`** from
  `src/lib/campaign-editability.ts` before rendering any link to
  `/dashboard/campaigns/<id>/edit`. `organiser-journey.ts` set the `write`
  step's `href`, `action` and the sentence "Done. You can still edit it."
  unconditionally, while `edit/page.tsx` redirects anything outside
  `['draft','active']` - and both renderers show a button on
  `step.href && step.action`, so nothing stood between the step and the
  organiser. Every newly submitted campaign is `under_review`, which is the
  whole time they are waiting.

  ⚠️ This is **`docs/83` inverted**: not a working route with no door, but a
  door always shown onto a room that refuses to open. Same rule as `docs/117`
  §3.3 from the other side.

  ⛔ Do NOT merge this list with `createCampaignSchema`'s
  `status: z.enum(['draft','active'])`. That is which status an **admin may
  create** a campaign in - the same two values for unrelated reasons.

  ⚠️ And note the test shape: once the page CALLS the helper there is one
  decider, so "the two ends agree" is a check that cannot fail. The ratchet
  forbids a fourth site hardcoding the pair, and carries a control asserting
  both screens still call the helper - otherwise deleting the call sites
  would satisfy it.

- **Every nav-gating flag must mean what the page it opens contains.** Added
  2026-10-27, see `docs/119`. `/dashboard/campaigns` was in **neither**
  navigation surface, and `dashboard/layout.tsx` spent one of three permitted
  queries (`docs/87`) computing `hasCampaigns` which `DashboardSidebar`
  destructured as `_hasCampaigns` and discarded. Use **`hasAnyCampaign`** from
  `src/lib/dashboard/my-campaigns.server.ts`: it shares `liveMembership` with
  `listMyCampaigns`, so the nav entry cannot disagree with the list's
  contents. A creator-only count hid the door from exactly the people
  `docs/117` fixed the list for.

  ⚠️ `DashboardMobileNav` **renders `DashboardSidebar`**, so there is one nav
  list, not two to keep in step.

- **A tile is gated by whether its target will serve the viewer.** Added
  2026-10-27, see `docs/119` §5. The Impact Update tile was ungated beside two
  gated siblings while its target filters on `creatorId` and redirects - so a
  collaborator was ejected from the campaign by a control they were shown.
  ⛔ `submit_impact_update` is in **neither** `DELEGATABLE` nor
  `NEVER_DELEGATED`; `isDelegatable` fails closed, so gate the tile. Adding it
  to `DELEGATABLE` reopens `docs/111` §1 - an impact update reports how a
  family's money was spent.

  ⚠️ **A hand-written list of sealed regions is only as good as whoever
  remembered to extend it.** `collaborator-screens.test.ts` named four and
  missed this one. It now also derives every child link from source and
  requires each to be gated or named deliberately open - and the open set is
  exactly the two delegatable surfaces (`updates`, `edit`), because the first
  version of that rule flagged `edit` and **the rule was wrong, not the page**.

- **A badge that states a future allowance must check the future is
  possible.** Added 2026-10-27, see `docs/119` §9.1.
  `PendingVerificationBadge` takes a **required** `isDonatable`, because it
  printed *"This campaign can raise up to $500.00 until we do"* directly above
  *"It can no longer take donations"* - a claim the platform cannot
  substantiate, which CLAUDE.md forbids outright.

  ⚠️ **The class predates serving `archived`** and was found by LOOKING at a
  screenshot, not by any assertion: `isDonatable` is
  `active || last_donor_zone`, so `completed`, `paused`, `suspended` and
  `cancelled` have all been served and non-donatable for months, and a
  `completed` campaign renders the same banner today. Serving `archived`
  (`docs/118` §9) added one more instance and is what made somebody look.

  ⛔ A control test asserts the badge **still renders** on a live unverified
  campaign. Gating it must never become a way to quietly delete a disclosure
  donors are owed.

- **A deploy without `--prerender` blanks SEVEN baked routes, and two of them
  are the sitemaps.** Added 2026-10-27, see `docs/119` §2. The build has no
  `DATABASE_URL`, `src/db/build-phase.ts` fail-softs the read to zero rows, and
  the empty render is frozen into the image for `revalidate` seconds. Measured
  against v111, from the build's own route table - **not the 24 routes
  `scripts/deploy.sh:18-22` and the `Dockerfile` both quote**, which is the
  count of routes *exporting* `revalidate`, most of them dynamic and never
  baked:

  | Window | Routes |
  |---|---|
  | **1h** | `/sitemap.xml`, `/blog/sitemap.xml` |
  | 5m | `/donate`, `/transparency`, `/last-donor-wall`, `/cancelled-campaigns`, `/campaigns/category/[category]` |

  ✅ **It repairs itself** - [VERIFIED on the sitemap itself, 07:10Z, about an
  hour after the deploy] three requests answered `STALE` with **0** campaign
  URLs, then `HIT` with **14** (56 entries against the 42-entry static floor),
  then `HIT` again. Confirmed first on a 5-minute sibling: `/transparency`
  went `STALE` with **0** money figures to `HIT` with **2**, so runtime ISR
  regeneration does read the database. So this is neither a defect in
  `sitemap.ts` nor a recurrence of the permanent docs/46 one. ⚠️ **Measure it
  with TWO requests**: stale-while-revalidate means the first request after
  expiry serves the stale copy and only schedules the refresh, so one request
  reads as a failure.

  Both deploy scripts now print the sitemap's campaign-URL count at the END of
  a deploy, because the build's eight `[build] database read failed` lines
  scroll 200 lines past where the operator is looking, and 42 URLs with no
  campaign entries looks healthy unless you count what is absent. ⛔ Do NOT
  lower the sitemap's `revalidate` to shrink the window - 3600 is argued on its
  own terms in `sitemap.ts:30-52`; the fix is the flag.

  ⚠️ Two of those eight build lines say `The connection pool may be wedged;
  see ... docs/37`. That is the driver waiting out a 15s timeout with no
  `DATABASE_URL` at all - a build artifact, **not** a pool wedge. ⚠️ And the
  whole thing was found because a positive control failed: the archived slug
  was absent from the sitemap, but so was the active one, which **voided the
  measurement** until diagnosed. Take a pre-deploy baseline of anything you
  intend to assert afterwards.

- **A refund on a rail with no refund API still tells the donor, and never
  says the money has been sent.** Added 2026-10-27, see `docs/122` §2.
  `PATCH /api/v1/admin/donations/[id]`'s non-Stripe branch corrects the ledger
  and must call **`notifyManualRefundPending`** before it returns — it used to
  return ~60 lines above `notifyDonationRefund`, so every real donor this
  platform has had would have been refunded in silence. ⛔ Do not reuse
  `donationRefundedEmail` there: it opens *"We sent your money back"* and
  quotes 5 to 10 working days, and on that rail no gateway was called at all.
  ⚠️ The admin UI must read the route's `manualRefundRequired` rather than
  assume success, and must not name a gateway it did not use.

- **`/settings` must work signed out.** Added 2026-10-27, see `docs/122` §3.
  `renderEmail`'s footer points **every** template there under "Manage your
  notifications" and no caller passes `footerLinks`, so it is the only opt-out
  link in the product's outgoing mail. It was an unconditional
  `redirect('/dashboard/settings')`, i.e. a login wall — and the M-Pesa rail
  creates only guests. ⛔ It offers a human (`support@lastdonor.org`), not a
  one-click button: there is no stored suppression for an address with no
  `newsletter_subscribers` and no `donor_campaign_subscriptions` row, and
  `unsubscribeMechanism(null)` already reaches that conclusion.
  ⛔ **Still open and larger than a link** (`docs/122` §8.3): `sendEmailOnly`
  applies no suppression at all, `notifyCampaignStatusChange` mails every
  un-refunded real donor with no preference check, and the three opt-out
  stores are independent — there is no "stop all contact" switch.

- **`isCapExempt` and `hasCheckedOrganiserId` are separate predicates, and
  must stay separate.** Added 2026-10-27, see `docs/121` §10.1. One answers
  "may this campaign raise without limit", the other "has a person seen this
  organiser's ID". The lists are identical today. `PendingVerificationBadge`
  was keyed on the cap one, so widening the cap exemption — a money decision —
  silently **hid a donor disclosure** on every campaign in document review.
  ⛔ Do not re-share them to remove a duplicate list. ⚠️ The only thing between
  that money edit and the donor-facing claim was the control `docs/119` §9.1
  left behind, written for a different change.

  ⚠️ And a fix that OPENS a path owns what is down it. `docs/121` §2 made
  `documents_uploaded` reachable by organisers for the first time, which armed
  two defects that had sat harmlessly behind the dead end: the journey ladder
  told them to redo the ID check they had just passed, and the raise cap came
  back. Both found by looking at a screenshot, not by any assertion — the
  third time in three days.

- **The status the ID check grants must be a status the organiser can act
  from.** Added 2026-10-27, see `docs/121`. The path to being paid is
  `identity_verified` → upload documents → **submit them** → an admin presses
  `approve_t2` → `fully_verified`, which is the only status
  `withdraw/route.ts` accepts. `identity_verified` was missing from
  `submittableStates`, `canSubmitForReview` excluded it, and Step 2's upload
  form renders only once the ID check has passed — so **the only state in
  which an organiser could attach a first document was the only state from
  which they could not submit it**, and no admin was told, because the
  notification lives on the route they could not reach.

  `verification-submittable.test.ts` derives the route's list AND the
  component's gate from source and requires them to agree, rather than pinning
  either. ⛔ Do not add a status to one end only. ⚠️ That test found a second
  divergence the moment it was written (`submitted_for_review` was
  route-submittable and component-hidden), which is the point of comparing two
  ends instead of asserting one.

- **One module formats money, and the ratchet checks that property, not
  `<Money>` tags.** Added 2026-10-27, see `docs/121` §3.
  `GET /api/v1/user/balance` summed `released − withdrawn` across every
  currency into one integer and `UserNav` rendered it with
  `toLocaleString('en-US', { currency: 'USD' })` — the **seventh** hand-rolled
  formatter after the six `docs/88` F4/F5 and `docs/114` removed — so a KES
  10,000-minor balance printed as **$100.00** in the navbar of every signed-in
  page. Both currency sweeps missed it because
  `money-currency.ratchet.test.ts` globbed `<Money …>` JSX and a hand-rolled
  `Intl` call has no tag.

  That ratchet now also matches `Intl.NumberFormat(…, {currency})` and
  `.toLocaleString(…, {currency})` across `src/**/*.{ts,tsx}`. ⛔ **It has no
  call-site allowlist and must not grow one** — the last legitimate formatter
  (a literal `EXAMPLE_CENTS` in an explainer, never wrong) was converted to
  `formatMoney` rather than excepted, because an exception that has to be
  maintained is how the seventh one came to be written. Group per currency in
  **SQL** where you can, so two currencies never share an accumulator.

- **Only a currency the payout rail can pay may be offered a withdraw form.**
  Added 2026-10-27, see `docs/121` §4. `withdraw/route.ts` refuses anything but
  `PLATFORM_PAYOUT_CURRENCY` with `400 WRONG_PAYMENT_RAIL` — deliberate, and
  the one line between the KES ledger and `stripe.transfers.create` under
  `'usd'`. `FinancesClient` gated its form on `isVerified && balance > 0` and
  nothing else, so a shilling campaign showed a live Withdraw button the server
  rejects (`docs/119`'s rule). The predicate is derived from the route's own
  constant so the two cannot drift.

  ⚠️ And `notifyWithdrawalFailed` is called on the **definite**-failure branch
  only. The other branch is the UNKNOWN outcome, where the platform does not
  know whether the transfer went through — "your withdrawal failed" there is a
  claim it cannot substantiate, and it is the one case where the money may
  actually have moved.

- **`organiser-journey.ts`'s `payoutAccount` fact is deliberately left
  unset.** Added 2026-10-27, see `docs/121` §9.3. It looks like an oversight —
  nothing sets it, so the payout step is permanently "later". ⛔ **Do not wire
  it until the Connect rail works.** `isConnectAvailable` returns `true` on an
  authentication error by design, so the "Connect with Stripe" button renders
  and the POST answers `500 "Payment service configuration error"`. Setting the
  fact to `'missing'` would make the journey tell organisers to add a payout
  account and send them to a 500 — creating the `docs/119` violation the field
  looks like it would fix.

- **A campaign is published by ONE route, and the editor never carries a
  status.** Added 2026-10-27, see `docs/120`. Publishing means
  `PATCH /api/v1/admin/campaigns/[campaignId]`, which checks
  `ALLOWED_TRANSITIONS`, stamps `published_at` **only when it is null**, writes
  the `campaign.published` audit row and emails the organiser "Your Campaign Is
  Live!" - plus the dedicated pause / resume / suspend / cancel routes for the
  states that carry a reason. `src/db/campaign-publication-writers.ratchet.test.ts`
  sweeps `src/` and allows exactly two UPDATE writers of `published_at`.

  ⛔ **`PUT /api/v1/campaigns/[slug]` answers 400 to any `status`.** It used to
  accept one and, on `'active'`, stamp `published_at` - with no transition
  check, no audit row and no email. And `/admin`'s own "Review" link, the
  `[Admin] Review needed` email and the in-app notification all pointed at
  `/admin/campaigns/<id>/edit`, which coerced anything not `draft` to
  `'active'` and PUT the whole form back. **So an admin who opened the review
  link and fixed a typo published the campaign**, and the row it produced is
  indistinguishable in `audit_logs` from one nobody ever read - the evidence
  `docs/116` §8's forensics depend on. ✅ An organiser could never do it: a
  campaign owner is restricted to seven content fields and `status` is not one.

  ⛔ **Edit mode DELETES `status` from the payload, and that is the fix, not
  tidiness.** `createCampaignSchema` declares
  `status: z.enum(['draft','active']).default('draft')` and `CampaignEditor`'s
  resolver IS that schema, so zod fills the field whether or not a control
  renders it. Removing the select alone would make every admin save post
  `status: 'draft'` and **unpublish** the campaign.

  ⚠️ **A sweep over `.update(campaigns)` must resolve `.set(variable)`.** The
  approval route builds `const updates = {...}`, then
  `updates.publishedAt = new Date()`, then `.set(updates)` - six of the 43
  sites in `src/` pass a variable, and a literal-only sweep sees nothing at the
  one that matters. My own first pass reported `published_at` as having a single
  writer for exactly that reason. The `docs/108` lesson again: a grep proves
  text, not semantics.

  ⚠️ **And an injection run needs a verified clean restore between
  injections.** `docs/120` §11.1: the first run's backup set omitted one file,
  so one injection persisted and seven later rows were measured against a
  polluted tree while printing PASS. The tell was a non-zero failure count
  after the final restore.

- **Refusing a campaign at review is `suspend`, never `cancel`.** Added
  2026-10-27, see `docs/120` §5. `under_review` is not in `CANCELLABLE` and not
  in `canCancel`, because cancelling notifies **nobody** (there is no
  organiser-facing call in the route, and the donor refund mails short-circuit
  when a campaign has no donations, which an unpublished one never does), is
  **terminal** (`ALLOWED_TRANSITIONS.cancelled` is empty and nothing resumes
  it), and `cancelled` is publicly viewable - so it would give a never-reviewed
  appeal about a named real person a permanent public page. This enforces
  `docs/93`'s decision rather than making a new one.

  ⚠️ **The Cancel button had the `docs/93` defect in the adjacent statement.**
  It sent `governanceReason || 'policy_violation'` into
  `z.enum(CANCELLATION_REASONS)`, which does not contain `policy_violation`, and
  the dialog's only input was free text - so the default 400'd and so did every
  sentence a human typed. **Cancel had never worked.** The comment directly
  above those lines is `docs/93`'s own record of fixing that class on the
  Suspend line; the fix did not sweep one statement down. The dialog now builds
  a native `<select>` from `CANCELLATION_REASONS` itself.

- **An admin surface that links to `/campaigns/<slug>` needs the same guard as
  every other surface.** Added 2026-10-27, see `docs/120` §11.3. `docs/118`'s
  rule was swept over the public UI and over notifications and **not** over
  `src/components/admin/`, where six sites built the link by hand.
  `CampaignDetail`, `GovernancePanel` and `VerificationQueue` now use
  `publicCampaignPath` - every campaign in the verification queue is
  `under_review`, so that link was a 404 on every row. Found in a browser:
  Next **prefetches** the link, so it surfaced as an unexplained console 404
  during the review walk. ⛔ Three more (`AdminDashboard`, `UserDetail`,
  `admin/screening`) are reported and unfixed in `docs/120` §12 - their row
  shapes carry no status, so guarding them means changing the queries too.

- **A collaborator must be able to REACH what they were granted, and see
  nothing else.** Added 2026-10-27, see `docs/117`. `/dashboard/campaigns`
  lists campaigns a person created OR helps with, via `listMyCampaigns` from
  `src/lib/dashboard/my-campaigns.server.ts`; the three campaign screens admit
  a collaborator by capability. Before this the API admitted them and no
  screen did, so accepting an invitation landed on "You haven't created any
  campaigns yet".

  ⛔ **The hiding is the load-bearing half.** A helper must not see the team
  panel, the verification link, "Where the money goes", the organiser journey
  prompt or the donors list - `invite_collaborator`, `upload_identity` and
  `change_payout_account` are in `NEVER_DELEGATED` and those routes answer
  403. A control that can only fail is worse than no control.
  `collaborator-screens.test.ts` brace-matches each gate and fails the build
  if a section escapes one.

  ⚠️ **Viewing is MEMBERSHIP, not a capability.** The detail page calls
  `resolveCampaignRole`, never `canCollaborate` - every entry in the
  `DELEGATING` map PERFORMS the capability it names, and a view-only page
  there would read as though rendering were a delegated power.

  ⛔ **A query that must name a money column does not belong in
  `src/lib/collaborators/`.** That directory is sealed by
  `collaborator-boundary.test.ts`; this module needed `raisedAmount` for a
  dashboard row, so it lives under `src/lib/dashboard/` instead. The
  allowlist was not widened, and must not be.

  ⚠️ Use `exists`, not a `leftJoin`, to fold membership into the list: the
  partial unique index is per `(campaign_id, invited_email)`, so one person
  who accepted two invitations to one campaign holds two live rows and a join
  lists it twice.

- **ISR needs a shared cache handler** above one instance. 26 pages use
  `revalidate` and 36 files call `revalidatePath`/`revalidateTag`; without a
  shared handler, multi-instance deploys serve stale HTML silently. See
  `docs/26` §5.

---

## Working autonomously

Owner instruction, 2026-10-18: **when you find a bug or a defect while
doing something else, fix it.** Do not stop to ask whether a clear
defect is in scope - investigate it, fix it, test it, document it, and
say what you did. Reserve questions for things only the owner can
decide: a credential, a product or policy call, a trade-off with no
right answer, or an action that destroys data.

This is why several docs here read as "found while doing something
else". That is the intended way to work on this codebase, not a
digression.

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
