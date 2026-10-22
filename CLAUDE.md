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
| `93-SUBMISSION-RECEIPT-AND-AN-UNKEPT-PROMISE.md` | **The campaign-submission receipt cut from 95 visible words to 43, and the two defects found behind it. ⛔ OPEN, OWNER DECISION: a campaign REFUSED at review notifies NOBODY, organiser included — `under_review` transitions only to `active` or `suspended`, and the suspend path reaches `notifyCampaignStatusChange`, which returns early for anything outside `['completed','archived']` and addresses DONORS, of which an unpublished campaign has none. The email used to promise "We will email you as soon as it is decided. If anything needs changing first, we will tell you exactly what" — neither half is true, and it is removed rather than the path invented, because what happens to a refused campaign is a policy call. Also: an admin who submitted a campaign got BOTH the receipt and an "[Admin] Review needed" about their own submission (now skipped for the submitter only — every OTHER admin still gets it, and a test pins that half). Also: the preheader is now explicit, because `derivePreheader` was copying the subject into the one slot that could add something. Read before touching the submission mail or adding a review outcome.** |
| `94-PLAIN-LANGUAGE-EMAIL-ADR.md` | **All 45 outgoing emails rewritten for a reader who left school early or reads English as a second language. 20 of 45 were over budget, worst at grade 15.5 (postgraduate) — and the worst prose in the product was the VERIFICATION family, which talks to people about their ID and their money. Now 0 of 45 over, average grade 2.9. Enforced by `src/lib/email-plain-language.ratchet.test.ts` (grade <= 8, no sentence over 20 words, no jargon from the glossary in `src/lib/email-readability.ts`); inspect with `npx tsx scripts/email-readability.ts --verbose`. ⛔ Do NOT raise the budget to make a template pass. Also: an explicit preheader was injecting RAW campaign titles into the markup (`renderEmail` now escapes an explicit preheader and leaves a derived one alone), and FIVE more unsubstantiated claims were removed from outgoing mail — including "sent by a real person on our team, not an automated system" in an automated template, and two Stripe-specific lines on a platform whose live rail is PayHero. Read before writing any email copy.** |
| `96-MANUAL-DEPLOY-FROM-WINDOWS.md` | **`scripts/deploy.ps1`: the owner deploys by hand from PowerShell, and auto-deploy stays off. The script runs the gate BEFORE building, because with CI dark a manual deploy is the only gate there is; it also refuses a dirty tree, a non-main branch or a branch behind origin, and checks health after. `-DryRun` first — there is no PowerShell in the agent sandbox, so it was statically checked and NEVER RUN. Two traps encoded: `$ErrorActionPreference='Stop'` does NOT catch a native non-zero exit (so every call checks `$LASTEXITCODE`), and yet it DOES throw on native stderr merged with `2>&1` (so captures drop to 'Continue'); also `curl` is an alias for `Invoke-WebRequest` on Windows, and ternary/`??` are PS7-only and fail to PARSE on 5.1. ⚠️ CORRECTS A PREMISE: waiting ~10 days for Actions credits probably will not unblock CI — the annotation says the account is LOCKED for billing, raising the budget already failed to clear it, and `lastdonor` is PUBLIC so its minutes are free and absent from the $50 spend (five other private repos). Expect to settle a payment, not wait out a clock.** |
| `95-BIMI-LOGO-ADR.md` | **The logo in the Gmail sender avatar. That slot is NOT a favicon — email clients do not read favicons; it is BIMI, which is a DNS record plus a paid certificate. ✅ BUILT: `public/bimi-logo.svg`, SVG Tiny PS, generated by `scripts/generate-bimi-logo.py` from the real DM Serif Display outlines (a BIMI logo cannot reference a font, so letters must be paths); `src/app/icon.svg` regenerated from the SAME outlines, replacing Georgia `<text>` that fell back to an arbitrary serif on Linux and Android. Pinned by `src/lib/bimi-logo.ratchet.test.ts` — a file that violates the profile is REJECTED silently, with no error anywhere. ⛔ OWNER-ONLY AND BLOCKED: DMARC is `p=none` with NO `rua=`, and BIMI needs `p=quarantine`/`p=reject` with `sp=` and `pct=100`; Google requires a PEM (VMC or CMC) and an SVG-only record is NOT enough for Gmail. Moving DMARC to enforcement can quarantine legitimate mail — collect `rua=` reports first. Read before touching the logo, the favicon or DMARC.** |
| `97-CI-RAN-AND-COST-CONTROLS.md` | **CI EXECUTES as of 2026-10-22 — the owner settled the billing charge and the lock lifted, so run 3 is the first in repo history to reach a runner (settles the one assumption docs/96 §3 left open: a payment lifts it, a quota reset does not). Read before touching `.github/workflows/`, the Node version or anything about Actions cost. ⚠️ CORRECTS THE INSTINCT: this repo is PUBLIC, so its standard-runner minutes are free and it never cost a cent — the $50 is five OTHER private repos, `invest254` alone $44.15, all outside this session's scope. The first run immediately caught three real defects: (1) CI was the ONLY place on Node 20, which was EOL 2026-04-30, while `.nvmrc`, the Dockerfile and every dev machine said 22 — so `fs.globSync` (Node 22+) failed 3 tests in CI and passed everywhere else, and worse, CI could not have caught a Node 22 defect at all; (2) `glob` was imported by FOUR files and declared by NONE, reachable only as a 4-levels-deep transitive dep of `@sentry/nextjs` — a Sentry upgrade would have broken the security-audit gate; (3) no `engines` field stated the Node floor everything assumed. Controls: `timeout-minutes` on every job cuts worst-case exposure from 3,240 to 175 job-minutes (nothing had one; GitHub's default is 360 PER JOB), and `paths-ignore` skips the 28% of commits that are docs-only — with the hazard that this makes a docs-only PR unmergeable if `ci-complete` ever becomes a required check. ⛔ STILL OPEN, OWNER-ONLY: set a SPENDING LIMIT (a budget alerts, a limit stops — raising the budget to 100 did nothing), port the timeouts to the five private repos, and set `TEST_DATABASE_URL` — integration and E2E still never run, now because the secret is absent rather than because jobs are blocked. Records why `node_modules` caching, job consolidation and the `next start` E2E switch were all REJECTED.** |
| `audit-2026-10-14/` | Raw agent reports + executable proof scripts behind docs/29 |

---

## Commands

```bash
npm run dev            # dev server (Turbopack)
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run test:unit      # Vitest (6303 tests, 191 files, as of 2026-10-22)
npm run test:e2e       # Playwright (72 tests, 21 files)
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

Two things are still not gated, so do not over-trust a green tick:

- ⛔ **The integration and E2E suites have still never run on any change.**
  They now skip *cleanly* rather than being blocked — `TEST_DATABASE_URL`
  is not set as a repository secret, so the `config` job reports
  `has-db=false` and both jobs skip, which `ci-complete` accepts by design.
  Owner action; see `docs/97` §4.
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
`scripts/deploy.sh` is the bash equivalent for Linux/macOS. Either needs
`fly auth login` or an **org-scoped** `FLY_API_TOKEN` — a builder- or
deploy-scoped token cannot see the app — and takes roughly 6 minutes.

This means **`main` can be ahead of production**. Do not infer the
deployed version from the repository: read it with
`fly status --app lastdonor`, and remember that `/api/v1/health` reports
`commit: "local"` and tells you nothing about which commit is live.

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
