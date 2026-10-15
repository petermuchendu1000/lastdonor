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
| `37-DB-POOL-WEDGE-INCIDENT.md` | **First production outage (2026-10-14/15): a wedged Postgres pool hung every DB route for 3h+ with a passing health check. Read before touching `src/db/index.ts` — and do NOT re-add `connection: { statement_timeout }`, Supavisor ignores it.** |
| `36-SEED-CONTENT-SANITIZATION.md` | **Why `scripts/seed-news-items.ts` is ⛔ DO NOT RUN (forged press attribution, quotes invented for real officials) and what replaced it. Read before seeding content.** |
| `audit-2026-10-14/` | Raw agent reports + executable proof scripts behind docs/29 |

---

## Commands

```bash
npm run dev            # dev server (Turbopack)
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run test:unit      # Vitest (3977 tests)
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
