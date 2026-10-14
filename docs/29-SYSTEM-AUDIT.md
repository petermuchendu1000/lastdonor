# 29 — System Audit, 2026-10-14

Full-system audit by eight parallel specialist passes. Raw agent reports and all
proof scripts are preserved in `docs/audit-2026-10-14/`.

**Baseline the audit ran against:** commit `50faa2d`. `npm run lint` clean,
`tsc --noEmit` clean, **3977/3977 unit tests passing across 60 files.** Every
finding below is therefore a *latent* defect the current suite does not catch —
which is the single most important fact about the test suite.

---

## 1. Standard of proof, and who verified what

Each agent was required to cite `file:line` and label every finding **CONFIRMED**
(a realistic path traced from a reachable trigger to the failure) or **PLAUSIBLE**
(a real concern not proven reachable). Several findings were proven by *executing*
code rather than reading it: payloads fed through the real sanitiser config,
contrast ratios computed numerically, the Drizzle `PgDialect` exercised directly,
`retryWithBackoff` driven by a harness, `_journal.json` diffed mechanically
against the migration files.

Three verification tiers are used below:

| Tier | Meaning |
|---|---|
| **RE-VERIFIED** | Independently reproduced by the lead session, not just reported |
| **CONFIRMED** | Agent traced it with cited evidence; not independently re-run |
| **NOT REPRODUCED** | Agent claimed it; lead session could not reproduce — see §6 |

**No repository code was modified by the audit.** Only documentation changed.

---

## 2. The gating problem — RESOLVED 2026-10-14 by live inspection

> **Resolved.** Project `vavxdjqufxrsbyohcwdh` was inspected via the Supabase
> Management API: the `public` schema has **0 tables**, **0 custom enums**, no
> `drizzle.__drizzle_migrations` table, **0 `auth.users`**, and storage holds
> **0 objects** in a single private `verification` bucket. The database is a
> pre-launch blank slate — nothing was ever applied to it. The project
> `ntnrcedafgmeyajmzvga`, hardcoded for storage in three files, **is not in the
> account**.
>
> This resolves §2.2's flip-table in the best possible direction: there is no
> drift to reconcile, so the repair is to fix `_journal.json` and apply all 33
> migrations onto an empty database. It also means **no real money, no donors,
> no seed data and no stored documents exist**, so P0-1/P0-1b never materialised
> here and P0-2 is moot in fact (see `docs/33` §1). The code defects were real
> and are fixed; the exposure did not occur in this project.
>
> The analysis below is retained because the repo-side migration defects it
> documents are unchanged and still must be repaired before any deploy.

### The original analysis (repo-side defects, still valid)

This blocks severity ranking on roughly a third of the register and must be
resolved first.

**RE-VERIFIED facts:**

- `src/db/migrations/meta/_journal.json` has **9 entries**; there are **33 `.sql`
  files**. Last journaled tag is `0008_add-veriff-session-fields`. Only 9
  snapshots exist.
- `node_modules/drizzle-orm/migrator.js:12` iterates **only** `journal.entries`
  and reads `${tag}.sql` per entry. It never lists the directory. So
  `npm run db:migrate` silently applies 9 of 33 migrations.
- Consequently **24 migrations are invisible to the migrator**, including `0015`
  (the donations unique index), `0027` (11 CHECK constraints), and `0028` (RLS).
- `db:generate` would diff against the `0008` snapshot and emit a migration
  re-creating `0009`–`0030`, including DROP/CREATE on indexes.

**Both commands are now marked ⛔ DO NOT RUN in `CLAUDE.md`.** Running
`db:generate` today could emit a migration dropping the only replay protection.

**Two deductions from the fact that the application evidently functions:**

1. Had only `0000`–`0008` applied, 34 `schema.ts` columns and 9 enum values would
   not exist and the app would fail constantly. It does not. Therefore
   **out-of-band scripts applied schema changes**, and what they applied is
   recorded nowhere. The 8 ad-hoc scripts in the repo root and `scripts/` are
   symptoms of this.
2. Had `0015` never applied, `onConflictDoNothing({ target: stripePaymentId })`
   at `payment-service.ts:103` would raise Postgres **42P10** and every Stripe
   webhook would abort. So either `0015` was applied out-of-band, **or donations
   are silently failing now.**

### 2.1 Six queries that resolve this

Run in the Supabase SQL editor; no credential sharing required.

```sql
SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at;          -- what Drizzle thinks it applied
SELECT indexname, indexdef FROM pg_indexes WHERE tablename='donations';  -- does replay protection exist?
SELECT conname FROM pg_constraint
  WHERE conrelid='campaigns'::regclass AND contype='c' ORDER BY 1;       -- did 0027 apply?
SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' ORDER BY 1;                                -- does impact_updates exist?
SELECT source, count(*) AS donations, sum(amount)/100.0 AS total
  FROM donations GROUP BY source;                                        -- real vs simulated money
SELECT relname, relrowsecurity FROM pg_class
  WHERE relname IN ('donations','campaigns','users');                    -- is RLS on?
```

### 2.2 Findings whose severity flips on the answer

| Finding | If the migration applied | If it did not |
|---|---|---|
| Donation idempotency | Replay protection works | No unique index → 42P10 → **every webhook aborts** |
| Refund path (§3 P0-3) | CHECK violation → rollback → money divergence | Refund succeeds but silently allows `released > raised` |
| `campaigns_released_lte_raised` + 10 other CHECKs | Enforced | Absent; all those invariants are code-only |
| `impact_updates` table | Page works | Server Component 500s |
| 7 declared-but-unmigrated indexes | Present | Seq scans on every campaign render |

---

## 3. P0 — fix before any real donor traffic

### P0-1 · Verification documents (government IDs, medical records) are publicly readable · **RE-VERIFIED**

`BUCKET_NAME = 'media'` (`src/lib/supabase-storage.ts:14`) is the same bucket as
avatars. `verification/documents/route.ts:144` persists `getPublicUrl(...)` — a
permanent, unauthenticated URL — into `verificationDocuments.fileUrl`.
`grep -rn createSignedUrl src/` returns **zero hits**: no private access path
exists anywhere in the codebase. `next.config.ts:22` whitelists
`/storage/v1/object/public/**` on that host, confirming public serving.

**`docs/06:248` and `docs/21:388,1775` claim 15-minute presigned admin-only
URLs. That control was never built.** This false claim predates this audit and is
why the whole pre-existing doc set needs verification, not just additions.

*Immediate mitigation (no code):* set the `media` bucket to private. Breaks
avatar display (cosmetic); stops the exposure.
*Fix:* separate private bucket, signed URLs behind `requireRole(['admin'])`,
migrate existing objects, then rotate the exposed paths.

### P0-1b · Info-request response documents are also publicly readable · **RE-VERIFIED, added 2026-10-14**

**This audit missed it.** `src/app/api/v1/info-requests/[requestId]/route.ts:263`
returns `getPublicUrl()` for `info-request-responses/<campaignId>/<requestId>/*`
uploaded into the public `BUCKET_NAME`. These are the documents campaigners send when
an admin requests further verification evidence — the same category of sensitive
material as P0-1, by the same mechanism. Found by the security implementation pass,
not by this audit, because the audit scoped the verification-documents route and not
`info-requests`. Not fixed in `d6450e3`: adding the prefix to the private list would
have converted a leak into a 500 in a file that change did not own.

### P0-2 · Simulated donations inflate the totals real donors rely on · **RE-VERIFIED**

`simulation-engine.ts:330-341` increments **the same** `campaigns.raisedAmount`
and `donorCount` columns that the real Stripe path increments at
`payment-service.ts:113-114`. Not a parallel counter — the same ones.

Per agent report (CONFIRMED, not independently re-run): `src/db/public-select.ts`
exposes those blended totals publicly while its own header forbids exposing
`source`/`simulationFlag`; `reconcile/route.ts:56` encodes
`expectedTotal = realTotal + seedTotal` as the intended invariant; and these
campaigns are published `status:'active'` and accept real money.

**This is a product and legal decision, not a bug.** Real donors making financial
decisions are shown fabricated activity that is deliberately indistinguishable
from real activity. Pending the owner's statement of intent, no technical fix is
proposed here. If the intent is pre-launch seeding, the requirement is a hard
purge plus a guarantee that seed rows can never reach a public total. If the
intent is production behaviour, this document records that the engineering
recommendation is not to ship it.

### P0-3 · Refunds diverge from Stripe, silently · **RE-VERIFIED**

`payment-service.ts:465-469` reduces `raisedAmount` on refund but never touches
`totalReleasedAmount`. `0027_oblique_audit_enforcement.sql:18` defines
`CHECK (total_released_amount <= raised_amount)`. If that constraint is live,
refunding on a partially-released campaign violates it, the transaction rolls
back, and `refunded` stays `false`. `webhook/route.ts:102-105` then swallows the
error and returns 200 — commented *"Still return 200 to prevent Stripe retries
for application errors"* — so Stripe never retries. **Stripe has refunded the
donor; the database permanently disagrees, and nothing flags it.**

### P0-4 · Donation receipts fail silently, with exactly one attempt · **RE-VERIFIED**

A four-link chain in which every link independently defeats detection:

1. The Resend SDK **never throws** — `node_modules/resend/dist/index.js:~555-591`
   returns `{data:null, error:{…}}` for non-2xx *and* from inside its own `catch`,
   so even a network failure **resolves**.
2. `retryWithBackoff` (`src/lib/utils/retry.ts:19-32`) retries only inside
   `catch`. A resolved promise returns immediately at `return await fn()`. So
   `maxRetries: 3` performs **one** attempt (agent harness: `attempts made: 1`).
3. `payment-service.ts:321` discards the resolved value and never inspects
   `.error`.
4. `donations` has **no receipt-state column** — `emailSent` exists on
   `notifications` (`schema.ts:793`) and `refundRecords` (`:956`), not donations.

Net: donor pays, Resend 429s, and there is no receipt, no retry, no dead letter,
no Sentry event, and no record anything failed. **Compounds with the Resend free
tier's 100/day shared cap (`docs/27` §2): the weekly newsletter exhausts the cap,
and every receipt for the rest of that day silently vanishes.**

### P0-5 · Newsletter re-sends to everyone on any retry · **CONFIRMED**

`send-newsletter/route.ts:96-128` loops subscribers from index 0.
`newsletter_subscribers` (`schema.ts:440-446`) has no `last_sent_at` and there is
no send ledger; the only run record is an audit insert *after* the loop. A 300s
timeout leaves no trace, and any re-fire re-emails everyone already sent. Serial
sends at Resend's 2 req/s also cap a run at ~600 subscribers, so the job stops
completing as the list grows.

### P0-6 · GDPR erasure is broken in both directions · **CONFIRMED** (state-independent)

Both relevant migrations are journaled, so this holds regardless of §2.

- `admin/users/[id]/route.ts:450-451` writes `preferences: null, badges: null`
  into NOT NULL columns (`0000:158`, `0002:1`) → **23502 for every donor with ≥1
  donation**.
- `users/me/route.ts:126-172` clears 5 of 21 `ON DELETE NO ACTION` FKs; any donor
  who completed a campaign is referenced by `campaigns.last_donor_id` → 23503 →
  500.

**You cannot currently honour a deletion request.** That is a legal obligation.

---

## 4. P1 — fix before scale or before the Fly/Cloudflare migration

| ID | Finding | Evidence | Verdict |
|---|---|---|---|
| P1-1 | **Creator can over-withdraw.** `withdraw/route.ts:119-125` checks `released − withdrawn` non-transactionally; `totalWithdrawnAmount` is written later by `stripe-connect/webhook:146-151`. Two POSTs with different idempotency keys before the webhook lands both pass and both create real Stripe transfers. `user/balance/route.ts:41-55` *does* subtract pending withdrawals — the asymmetry is the proof. Connect webhook also dedups via a **per-process in-memory `Set`** (`route.ts:14`). | agent 02, 06 | CONFIRMED |
| P1-2 | **Recurring donations charged but never recorded.** `create-checkout/route.ts:111-112` sets `payment_intent_data: undefined` in subscription mode, so metadata lands only on `subscription_data`; `invoice.payment_succeeded` → `payment-service.ts:54-61` finds no `campaignId` and returns. No donation row, no receipt, campaign uncredited. | agent 02 | CONFIRMED |
| P1-3 | **Campaigns can complete twice.** `justCompleted` is decided from a stale read taken outside the transaction (`payment-service.ts:126` vs `:398-402`), and the UPDATE at `:128-134` has no `WHERE status <> 'completed'`. Trigger: two donors completing concurrently via the public unauthenticated `/donations/confirm`. Duplicate completion emails, duplicate celebration post, double payout eligibility. Same defect at `:252` for first-donation email. | agent 02 | CONFIRMED |
| P1-4 | **Admin JWTs live 30 days and role revocation never takes effect.** `auth.ts:95` sets `strategy:'jwt'` with no `maxAge` → `@auth/core`'s 30-day default. The role-based expiry at `:215-220` sets `expires: new Date(0)`, which nothing reads. The `jwt` callback reads the DB role only at sign-in. Demoting a rogue editor has no effect on their live token. | agent 01 | CONFIRMED |
| P1-5 | **Rate limits become bypassable under the planned architecture.** `rate-limit.ts:187,238` keys on the **first `X-Forwarded-For` entry**, which clients can forge. Normalised on Vercel today; **forgeable once behind Cloudflare→Fly per `docs/26`.** Must be fixed as part of that migration: use `CF-Connecting-IP` / right-most hop. | agent 01 | CONFIRMED |
| P1-6 | **Two unauthenticated writes.** `PUBLIC_API_PREFIXES`' `startsWith('/api/v1/campaigns')` exposes `POST`/`DELETE /api/v1/campaigns/<slug>/subscribe`, which act on **any email in the request body** — anyone can subscribe or unsubscribe a third party. Same class at `newsletter/unsubscribe:8-48`. Proven by replaying the prefix matcher over all 111 routes. | agent 01 | CONFIRMED |
| P1-7 | **RLS is inert, and two docs claimed otherwise.** `0028_row_level_security.sql` is 79 lines of **pure comment, zero executable statements**; its own header says it is a template. `scripts/rls-policies.sql:104-112` policies are `USING (true)`. The app connects as the table owner — RLS-exempt without `FORCE ROW LEVEL SECURITY`. There is no database-layer defence. (`docs/27` corrected; `docs/13:690` was right all along.) | agent 01 | **RE-VERIFIED** |
| P1-8 | **ISR amortisation collapses exactly when a campaign goes viral.** `payment-service.ts:233-234` calls `revalidatePath()` on the campaign page *and* the campaign index on **every donation**, against a `revalidate = 60` page. Falsifies `docs/26` §9's capacity model (corrected). | agent 04 | CONFIRMED |
| P1-9 | **Unindexed + unbounded hot reads.** `campaign_updates` has **zero** indexes in any migration or in `schema.ts`, and `campaigns/[slug]/route.ts:53-63` reads it with no `.limit()`. No composite `(campaign_id, created_at)` on `donations` or `campaign_messages`, so the hot `WHERE campaign_id ORDER BY created_at DESC LIMIT 10` reads and sorts the whole partition. `dashboard/finances/page.tsx:29-50` ORs on unindexed `donations.donor_email` → full scan of the global donations table per view. 7 of the 75 declared indexes exist in no migration, including all 3 on `impact_updates`. | agent 04 | **RE-VERIFIED** (index absence) |
| P1-10 | **Echo columns are never incremented.** `messageCount`, `updateCount`, `seedDonationCount` have no increment anywhere in `src/`; the only write is a reset to 0 in `admin/seed/purge/route.ts:61`. **Correction to the agent's claim:** drift is **not** permanent — `cron/reconcile:182-207` sweeps all three nightly, bounding staleness at ~24h. So this is a staleness bug, not corruption. `CLAUDE.md` and `docs/26` §5 corrected. | agent 04, 05 | **RE-VERIFIED** |
| P1-11 | **No lock primitives exist anywhere in `src/`.** The Upstash `SET NX` guard `docs/26` §4 prescribes was never implemented. `runSimulation` writes donation, message and tally as **three un-transacted statements** with a random fake `stripePaymentId` (`simulation-engine.ts:302-337`), so cron overlap doubles volume and breaches the 150% overfund cap. | agent 06 | CONFIRMED |
| P1-12 | **The AI client is the only unbounded caller in the repo.** Neither OpenRouter client sets `timeout` or `maxRetries` (`openrouter.ts:12-18,33-38`), so `openai@6` defaults apply: 10-minute timeout, 2 retries. `call-ai.ts:55-71` builds 8 attempts → up to **24 HTTP requests per `callAI`**, invoked 3× per story inside a 5-item loop. Every other fetch in the repo has a timeout. | agent 06 | CONFIRMED |
| P1-13 | **`/api/v1/health` is unsafe as a liveness probe.** It calls `stripe.balance.retrieve()` (`route.ts:29`) and returns 503 if *any* check fails (`:50`), so a Stripe blip would fail the probe fleet-wide and Fly would kill every machine. Never checks Redis. `docs/26` corrected in `4ad05fc` before deployment. | agent 06 | **RE-VERIFIED** |
| P1-14 | **`/_next/image` is an unauthenticated, unrate-limited server-side fetcher.** `next.config.ts:47` sets `remotePatterns: { hostname: "**" }`, and `middleware.ts` does not match `/_next/image`. CONFIRMED for arbitrary external hosts; internal-IP reach unproven without a running server. | agent 03 | **RE-VERIFIED** (config) |
| P1-15 | **Blind SSRF in four outbound fetches**, all `redirect:'follow'`, none validating host: `image-resolver.ts:124-133,174-181`, `image-validation.ts:43-50`, `fetch-article-body.ts:22-31`. The project's own `INTERNAL_PATTERNS` guard (`url-allowlist.ts:32-47`) **is never imported by the pipeline** — its sole consumer is `user-campaign.ts:2`. Trigger: an indexed article sets `og:image` to a host that 302s to `169.254.169.254`. | agent 03 | CONFIRMED |

---

## 5. P2 — quality bar vs the competitor

| ID | Finding | Verdict |
|---|---|---|
| P2-1 | **`prose` classes emit no CSS.** `@tailwindcss/typography` is a dependency but **never registered** — `grep -c '@plugin' src/app/globals.css` = **0** — and the hand-written replacement at `globals.css:257` targets `.blog-article`, a **different class name**. 11 call sites still use `prose`, including `campaigns/[slug]/page.tsx:454`, the campaign story itself. With preflight's `*{margin:0}` and `list-style:none` resets, the story loses all paragraph spacing, heading sizes and bullets. | **RE-VERIFIED** |
| P2-2 | **Three font variables are referenced but never defined.** `globals.css:9-11` reads `--font-dm-serif-display`, `--font-dm-sans`, `--font-dm-mono`; `layout.tsx` defines `--font-display`, `--font-body`, `--font-mono`. Live-DOM check: the three `dm-*` variables are **UNSET**, the three next/font variables are set. `globals.css` never references `--font-body` at all (`grep -c` = 0), so **DM Sans is downloaded on every page load and never used.** The agent's stronger claim — that the site renders in browser-default serif — is **NOT PROVEN**; see §6. | **RE-VERIFIED** (partial) |
| P2-3 | **"Processing fees are shown before checkout" is false.** `create-checkout/route.ts:98-109` creates a single line item at the donation amount with no fee anywhere, while ten surfaces claim otherwise including `transparency:99-101` and the `DonateAction` JSON-LD. Per `CLAUDE.md`, an unsubstantiated claim is HIGH. The rest of the fee story is consistent and correctly hedged, and nonprofit/501(c)(3) copy is clean. | CONFIRMED |
| P2-4 | **Contrast failures on the conversion path** (computed, not estimated): white on `brand-amber` = **3.19:1** on the donate CTA (WCAG 1.4.3 fail at that size/weight). Dark-mode `ImpactCounter`/`TrustBanner` hard-code `text-white` on `bg-primary` → **2.49 / 2.07 / 1.89:1**. Input borders **1.24:1** (1.4.11 fail). | CONFIRMED |
| P2-5 | **CSP contains `script-src 'unsafe-inline'`** with no nonce (`next.config.ts:~85`), removing containment for any sanitiser bypass. Other headers are solid: frame DENY, nosniff, HSTS preload. | CONFIRMED |
| P2-6 | **Accessibility coverage is narrower than it appears.** `e2e/accessibility.spec.ts` covers 10 pages, **light theme only**, and **neither campaign detail nor the donate flow**. `e2e-11`/`e2e-12` assert inside `if (isVisible())` guards, so they **pass vacuously**. | CONFIRMED |
| P2-7 | **`ImpactUpdateForm.tsx:106` calls `DOMPurify.sanitize` in an SSR'd client component.** dompurify 3.4.0 with no DOM reports `isSupported:false`, `typeof sanitize: undefined` → TypeError. Availability bug, not XSS (the row was sanitised at write time). | CONFIRMED by execution |
| P2-8 | Uncapped `offset` pagination is the remaining pagination gap (`MAX_LIMIT=50` *is* enforced). | CONFIRMED |

---

## 6. Corrections to agent claims

Recorded because an audit that never corrects itself is not an audit.

1. **"Homepage hero CTAs ship `opacity:0` in server HTML" — NOT REPRODUCED.** The
   real server-rendered homepage HTML captured earlier in the same session
   contains **zero** `opacity:0` and zero inline `opacity`/`transform` styles, and
   the CTA text differs from the agent's quote. A live-DOM pass also found no
   element with `opacity < 0.05`. The agent may have rendered a component in
   isolation. **Needs re-test against a fully-booted app before it enters the
   backlog.**
2. **"Site renders in browser default serif" — RESOLVED 2026-10-14: the claim was
   CORRECT.** Proven from the compiled stylesheet plus CSS semantics rather than from
   a page render: `--default-font-family` resolved to a value containing
   `var(--font-dm-sans)`, which nothing defined, and an unresolvable `var()` in a
   non-custom property is invalid at computed-value time, so `html` took the initial
   value. Body text, all 180 `font-display` headings and all 133 `font-mono` figures
   rendered in the UA serif while all three DM families downloaded unused. Fixed in
   `e1fee65`. The original agent's claim was right; its evidence was not. Original
   note follows. **"Site renders in browser default serif" — NOT PROVEN at the time.** My browser check hit
   an error boundary (`h1` read "Something went wrong") because the dev server has
   no `DATABASE_URL`, so the measurement is invalid for the real homepage. The
   *variable mismatch* is verified; the *rendered consequence* is not. Settling it
   requires booting the app with secrets.
3. **Echo-column drift is bounded, not permanent** — `cron/reconcile:182-207`
   sweeps nightly. Severity reduced accordingly (P1-10).

---

## 7. What is genuinely sound

Stated plainly because padding a register to look thorough is its own failure.

- **Authorization is well built.** **No IDOR** across any `[id]`/`[slug]`/
  `[requestId]` route — all verify ownership. Role enforcement correct on **all 56
  admin routes**. Matcher coverage complete, no server actions, no mass assignment.
- **No SQL injection.** Zero `sql.raw`; `search/route.ts:24` escapes LIKE
  metacharacters; ORDER BY is zod-gated. Proven correct via a drizzle `PgDialect`
  repro.
- **The sanitiser allowlist is sound** — 18/18 payloads neutralised through the
  real config; no `style`/`iframe`/`svg`/`on*`/`javascript:`/`data:`. Critically,
  **every HTML sink re-sanitises server-side at read time**, which downgrades the
  unsanitised cron write path to Low.
- **Anonymous-donor redaction works** on both public selects; `donorEmail` is
  never selected. Email templates escape all HTML interpolation.
- **Donation core is correct**: raw-body signature verification; integer-cents
  arithmetic throughout; the 500-cent floor enforced in both DB and validator;
  `payment-service.ts:85-121` properly transactional with atomic SQL increments;
  fund-pool CAS correct.
- **All 17 transactions are free of external I/O** — no pool exhaustion from
  awaiting Stripe or email inside a transaction.
- **No cross-user ISR leak.** Webhooks correctly rate-limit-exempt.
- **Schema drift is one-directional** — zero columns exist in migrations but not
  in `schema.ts` — which makes repair tractable.
- `cron/reconcile` steps 4-5 are convergent and self-healing; `blog-generate` has
  real stuck-work recovery; the rate limiter's in-memory fallback is genuine.

---

## 8. The two themes that matter more than any single finding

**1. Failures are swallowed by construction.** `return 200 to prevent Stripe
retries`; a resolved error value discarded; `console.error` instead of Sentry;
in-memory dedup state; transactions that roll back leaving no marker; a retry
helper that cannot see the error shape its SDK returns. Individually each looks
defensible. Together they mean **you cannot currently detect that anything is
wrong.** Fixing the bugs without fixing the blindness only makes the next batch
invisible too. Every P0 fix in `docs/31` therefore ships with a detection
mechanism, not just a correction.

**2. The gap is between what was declared and what was executed.** Migrations that
are comments. Counters never written. Indexes declared in `schema.ts` and absent
from migrations. A typography plugin installed but never registered. Font
variables referenced but never defined. A guard module written but never imported.
Presigned URLs documented but never built. The per-request logic that *was*
written is good; almost every defect is something assumed to exist.

**This applies to my own prior documents.** Six claims in `docs/26`/`27` and
`CLAUDE.md` were falsified by this audit and corrected in `5e11606` and `6a25252`.
Root cause in each: I read a filename or a `schema.ts` declaration instead of the
executable artifact. Standing rule now recorded in `CLAUDE.md`: **index existence
is verified in migrations, migration contents are read not inferred from names,
and a declared mitigation is not an existing one.**

---

## 9. Test-suite assessment

3,977 unit tests pass; `test/security` alone runs **2,561 assertions in 2.9s**.
The suite is extensive, fast and well-constructed — and it covers **none** of the
P0 findings. It tests the things that already work.

One self-skipping assertion was found: a `SETTINGS_ENCRYPTION_KEY`-gated check
leaves AES-GCM IV uniqueness unverified. And `e2e-11`/`e2e-12` pass vacuously
inside visibility guards.

The gap to close is not coverage percentage — it is **adding the adversarial
cases**: concurrent webhook delivery, refund-after-release, Resend returning an
error value, cron overlap, migration-state assertions, and a11y on the donate
path in both themes.
