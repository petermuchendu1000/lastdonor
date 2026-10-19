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
| `92-PLAIN-LANGUAGE-PASS-ADR.md` | **Plain-language pass over all 18 public pages. Measured BEFORE touching anything: mean Flesch Reading Ease 40, 17 of 18 pages under 60; the cause was keyword lists written as sentences for search engines. Two central corrections: the fee sentence is now scoped ("2.9% plus 30 cents **on a US card**") in ~12 files, because unscoped it is a false claim to a donor outside the US; and `src/app/plain-language.ratchet.test.ts` could not SEE the prose it guarded - it read only copy FIELDS, so every `<p>` and `<li>` was invisible and it passed on the old `/editorial-standards` (ease 36) exactly as happily as the rewritten one (77). `JSX_TEXT` now reads body text, with comments STRIPPED FIRST (without that it reported 15 code comments as donor copy). Second blind ratchet in one day, after the pool fan-out one - prove a ratchet against a known-bad input before trusting it. Baselines are 0 long sentences and 0 comma-chains and may only shrink. Also: the harness itself had to be fixed (it scored the `/campaigns` card grid as one 200-word sentence at grade 80). Read before changing a fee sentence or adding user-facing copy.** |
| `93-EMPTY-SITEMAP-ROOT-CAUSE.md` | **⛔ The sitemap shipped with ZERO campaign pages while the database held 13 active ones - the only pages that can take money were absent from the file Google fetches. docs/46 saw the same symptom and blamed static generation; `revalidate=3600` turned "empty forever" into "empty for an hour after every deploy" and left the cause. The cause: `deploy.sh --prerender` passes a SESSION-mode URL (port 5432, Supabase caps the project at `pool_size: 15`), `next build` pre-renders 24+ DB routes across several workers each opening a `max: 5` pool, the pool is exhausted (`EMAXCONNSESSION`, in every build log the whole time) and `withBuildPhaseFailSoft` swallows it BY DESIGN so those routes pre-render EMPTY and the build still passes. Fixed with `...(IS_PRODUCTION_BUILD ? { max: 1 } : {})` AFTER the `max: 5` literal, so the pool-fanout ratchet's text assertion still holds; a new ratchet test pins the override, because deleting it breaks nothing visible. Verify by grepping the build log for `database read failed` (expect 0), NOT by the exit code or a 200 on /sitemap.xml - both were green throughout. A fail-soft is where defects go to be silent. Read with docs/37/52/87 before touching `src/db/`.** |
| `94-FINOQ-SECOND-RAIL-FOUNDATION.md` | **FinoQ (formerly PayHero) as a SECOND payment rail beside Stripe - the currency foundation is built, the CLIENT IS ⛔ NOT BUILT (no credentials; docs/81 forbids an unexercised provider path). The "over 30 African countries" from the sales call is NOT substantiated by anything FinoQ publishes: the only working API is `POST /api/v2/payments` with `provider` of `m-pesa` or `sasapay`, NO country and NO currency parameter, and their own site says "for Kenyan Businesses". PAPSS ("more than 30 African countries") is the likely origin - bank settlement, not consumer checkout. Same shape as docs/90 (GNews) and docs/86 (TalkNTalk). Built instead, the docs/82 way: `src/lib/utils/currency.ts` is now currency-aware (EXTENDED, never a sixth implementation - see docs/88 F4/F5) with USD defaults so all 40 call sites are unchanged. **`toProviderUnits` is the 100x guard: FinoQ takes WHOLE SHILLINGS, we store cents** - it throws rather than rounds, and the exponent is a TABLE because UGX/RWF/XOF are zero-decimal. `migrations-v2/0005`: `stripe_payment_id` becomes NULLABLE (a FinoQ row has no Stripe id) WITHOUT dropping `idx_donations_stripe_payment_id` - NULLs do not collide, and a new CHECK keeps `provider='stripe' -> id IS NOT NULL`; adds `provider`, `provider_reference` (unique per provider, both rails redeliver webhooks) and `currency`. Done NOW because donations/refunds/raised are all 0 rows, so no backfill; validated against the live DB in `BEGIN … ROLLBACK`. ⛔ STILL OPEN: credentials, the written country list, per-currency minimum (`amount >= 500` is 500 MINOR units - KES 5.00 is ~4 US cents), `areaServed: United States`, and that STK push is a push-to-phone + callback flow, NOT the redirect `DonationForm`/docs/42 assume. Read before touching donation money or adding a provider.** |
| `95-INBOUND-EMAIL-OPTIONS.md` | **⛔ `lastdonor.org` has NO MX RECORD, so all TEN published addresses BOUNCE - `support@` appears in 69 places and `privacy@` carries a GDPR/CCPA promise to respond "within 30 days". Sending was always fine (Resend DKIM + SPF on the `send.` subdomain, DMARC `p=none`), which is why docs/73 reads "mail delivery is NOT broken" - that doc is about OUTBOUND only and is amended to say so. Same lesson as docs/83: nobody traced the half of the path a real person takes. Cloudflare Email Routing gives ADDRESSES, NOT MAILBOXES: free, receive-and-forward only, 200 rules/domain, 200 destinations/account, 25 MiB inbound; "Email Sending" is a SEPARATE beta product needing Workers Paid. So Cloudflare stops the bouncing today but you cannot REPLY as `support@` from it - that needs Zoho/Google or Gmail send-as over SMTP. Owner must do it: this session's `CF_API_TOKEN` cannot see the zone, and the destination inbox needs a click-through verification. Read before publishing any new @lastdonor.org address.** |
| `89-ECHO-COUNTERS-AT-THE-SOURCE.md` | **The echo counters are incremented where the rows are written now - use `insertCampaignUpdate`/`insertCampaignMessage` from `src/lib/echo-counters.ts`, never a direct insert (a ratchet enforces it). Found because a reconcile prediction was WRONG: predicted 1 fix, got 4, because `update-phases` had started running two hours earlier and wrote three updates without touching `update_count`. Also records how adding one `server-only` import broke FIVE suites at collection while the summary still read '5898 passed' - 80 tests silently not running - now fixed by aliasing `server-only` in `vitest.config.ts`.** |
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
