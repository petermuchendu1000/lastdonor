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

---

## Commands

```bash
npm run dev            # dev server (Turbopack)
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run test:unit      # Vitest (3977 tests)
npm run test:e2e       # Playwright (72 tests, 21 files)
npm run db:generate    # generate Drizzle migration from schema
npm run db:migrate     # apply migrations
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
- **Donation idempotency lives in the schema** — the unique index on
  `donations.stripe_payment_id` makes replayed Stripe webhooks no-ops. Never
  drop it.
- **Stripe metadata is the disaster-recovery substrate.** `create-checkout`
  writes full donor context onto every PaymentIntent, which makes `donations`
  reconstructible from Stripe alone. Preserve this in any refactor.
- **Echo columns** (`seedDonationCount`, `messageCount`, `updateCount`) are
  denormalised counters that exist to avoid N+1 queries on listing pages. Keep
  them updated in the same transaction as the rows they count.
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
