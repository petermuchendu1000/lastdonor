# 31 — Remediation Plan

Ordered execution plan for `docs/29`. Every item states its **acceptance
criterion as a test**, because per `docs/29` §9 the existing 3,977 tests pass
while every P0 defect is live — so "fixed" means "a test now fails without the
fix," not "the code looks right."

Per `docs/29` §8, **every P0 ships with a detection mechanism, not just a
correction.** A system that cannot report its own failures will regenerate this
register.

---

## Phase 0 — Unblock and contain (hours, not days)

Nothing here needs a code review and most needs no code.

| # | Action | Acceptance criterion |
|---|---|---|
| 0.1 | **Set the `media` bucket to private** in the Supabase dashboard (audit P0-1). Cosmetically breaks avatars; stops the PII exposure immediately. | A previously-working `/storage/v1/object/public/media/verification-documents/...` URL returns 400/403 from an unauthenticated client. |
| 0.2 | **Run the six diagnostic queries** in `docs/29` §2.1 and record the output in this repo. | `docs/29` §2.2's flip-table is resolved: each row reads "applied" or "not applied" with evidence. |
| 0.3 | **Do not run `db:generate` or `db:migrate`** until Phase 1.1 (already marked ⛔ in `CLAUDE.md`). | — |
| 0.4 | **Owner decision on P0-2** (simulated donations in public totals) and on whether real donors are live. | Written answer recorded in this document. Blocks Phase 1. |
| 0.5 | **Split transactional from bulk email** (`docs/27` §2). Independent of every fix below and currently losing receipts. | A newsletter send cannot consume the transactional quota; verified by sending both while the bulk provider is at its cap. |

---

## Phase 1 — P0: correctness and legal exposure

### 1.1 Repair the migration state *first*

Everything schema-related depends on this, and it is the only item that can make
other fixes dangerous if sequenced wrongly.

1. Establish ground truth from Phase 0.2.
2. Reconcile `_journal.json` and `meta/` snapshots with what is actually applied —
   do **not** regenerate from `schema.ts`.
3. Fold the 8 ad-hoc scripts' effects into recorded migrations, then delete the
   scripts.
4. Resolve the `0027` blocker: `failed_login_count` is referenced by a CHECK in
   `0027` but created by **no** migration, so `0027` can never apply cleanly.
5. Resolve the `idx_donations_stripe_payment_id` conflict: `0000:190` creates it
   **non-unique**, `schema.ts:385` declares it unique, and the actual unique index
   lives in unjournaled `0015:49` under a different name.

**Acceptance:** `npm run db:migrate` against a fresh database produces a schema
that matches production, verified by a committed mechanical diff; a CI job fails
if `_journal.json` entry count ≠ `.sql` file count; `db:generate` on a clean tree
emits **no** migration.

### 1.2 Verification documents → private storage (P0-1)

Private bucket, `createSignedUrl` with a short TTL behind
`requireRole(['admin'])`, migrate existing objects, then invalidate old paths.

**Acceptance:** a test asserts no code path can produce a public URL for a
`verification-documents/` key; an integration test asserts an unauthenticated and
a non-admin request both fail; `grep -r getPublicUrl` shows no verification-
document call site. Also **amend `docs/06:248` and `docs/21:388,1775`**, which
document a control that never existed.

### 1.3 Receipt delivery becomes observable (P0-4)

Four fixes, because four independent links each hide the failure:

1. Teach `retryWithBackoff` the result-shaped-error contract (an explicit
   `isFailure` predicate), or wrap Resend so it throws.
2. Inspect the resolved `.error` at every send site.
3. Add receipt state to `donations` (`receipt_status`, `receipt_attempts`,
   `receipt_last_error`) — a dead-letter record, not just a boolean.
4. Report failures to Sentry.

**Acceptance:** a test injecting `{data:null,error:{name:'rate_limit_exceeded'}}`
proves ≥2 attempts, a persisted failure row, and a Sentry capture. A reconciliation
query lists donations with no receipt after N minutes.

### 1.4 Refund path (P0-3)

Reduce `totalReleasedAmount` alongside `raisedAmount`, or reorder so the invariant
holds; and **stop returning 200 on application errors** in the webhook — return
5xx so Stripe retries, with idempotency making retries safe.

**Acceptance:** a test refunds a donation on a partially-released campaign and
asserts `refunded = true` and consistent totals; a test asserts the webhook
returns 5xx when the handler throws.

### 1.5 Newsletter send ledger (P0-5)

Add `last_sent_at` plus a per-send ledger keyed by (campaign/issue, subscriber);
make the loop resumable and idempotent; batch within the provider's rate limit.

**Acceptance:** a test kills the job mid-run, re-fires it, and asserts **zero**
duplicate recipients.

### 1.6 GDPR erasure (P0-6)

Fix the NOT NULL writes in `admin/users/[id]/route.ts:450-451`; define a real
erasure strategy across all 21 `ON DELETE NO ACTION` FKs that retains financial
records while removing personal data (anonymise-in-place for donation rows,
including `campaigns.last_donor_id`).

**Acceptance:** an integration test erases a donor who has donated **and**
completed a campaign, and succeeds; a test asserts no PII remains while donation
amounts and timestamps survive.

---

## Phase 2 — P1: money integrity, then scale

Ordered by blast radius.

| # | Item | Acceptance criterion |
|---|---|---|
| 2.1 | **Over-withdrawal race** (P1-1): make the balance check and the `totalWithdrawnAmount` write atomic — conditional UPDATE with a `WHERE` guard, or reserve on request. Replace the in-memory dedup `Set` with a DB/Redis idempotency record. | Concurrent withdrawal test: exactly one succeeds. Restarting the process does not re-process a Connect event. |
| 2.2 | **Recurring donations** (P1-2): put metadata where `invoice.payment_succeeded` can read it, or resolve `campaignId` from the subscription. | Test: a subscription invoice produces a donation row, a receipt and a campaign credit. |
| 2.3 | **Double completion** (P1-3): decide `justCompleted` from the transaction's own `RETURNING`, and add `WHERE status <> 'completed'`. | Concurrent-completion test: one completion email, one celebration post. |
| 2.4 | **Cron overlap locks** (P1-11): Upstash `SET NX` with TTL > `maxDuration` in all 10 handlers; make `runSimulation`'s three writes one transaction. | Test: a forced overlapping invocation exits early. Heartbeat monitoring per `docs/27` §4. |
| 2.5 | **Auth session hardening** (P1-4): explicit `maxAge`; make role changes take effect (short token TTL + revocation check on privileged paths); delete the `expires: new Date(0)` code that does nothing. | Test: a demoted editor is denied on the next privileged request. |
| 2.6 | **Rate-limit client IP** (P1-5) — **must land before the Cloudflare/Fly cutover.** Trust `CF-Connecting-IP` / right-most hop. | Test: a forged `X-Forwarded-For` does not reset the limit. |
| 2.7 | **Unauthenticated third-party writes** (P1-6): require auth or a signed token on subscribe/unsubscribe; audit every `PUBLIC_API_PREFIXES` entry against sub-route methods. | Test: an unauthenticated subscribe for someone else's email fails. A test enumerates all routes matched by each prefix and asserts each is intentionally public. |
| 2.8 | **Indexes and query shape** (P1-9): index `campaign_updates`; add composite `(campaign_id, created_at)` on `donations` and `campaign_messages`; index or remove the `donor_email` OR-scan; deploy the 7 unmigrated indexes. | Committed `EXPLAIN` output before/after for each hot query. CI asserts every `schema.ts` index exists in a migration. |
| 2.9 | **ISR invalidation** (P1-8): replace per-donation `revalidatePath` with throttled or tag-scoped invalidation; accept bounded staleness on totals (GoFundMe accepts ~5 min — `docs/30` §1). Then land the shared `cacheHandler` from `docs/26` §5. | Load test: origin renders per minute stay flat as donation rate rises. |
| 2.10 | **Echo columns** (P1-10): populate them transactionally **or delete them**. Do not leave a third state. | Test: inserting a message/update moves the counter in the same transaction. |
| 2.11 | **AI client bounds** (P1-12): explicit `timeout` and `maxRetries: 0`; cap total attempts; add a per-run cost ceiling. | Test: a hanging provider aborts within the timeout; max HTTP requests per `callAI` is asserted. |
| 2.12 | **RLS** (P1-7): either implement it properly — dedicated non-owner role, session context on every connection, real policies — or **delete `0028` and the `USING (true)` policies** and stop claiming it. Half-built security is worse than none because it is believed. | Either policies demonstrably block a cross-tenant read under the app's real role, or the claim is removed everywhere. |
| 2.13 | **SSRF** (P1-14, P1-15): import the existing `INTERNAL_PATTERNS` guard into all four fetch sites; block redirects to private ranges; constrain `remotePatterns` from `"**"` to the known CDN hosts. | Test: a URL that 302s to `169.254.169.254` is refused. |
| 2.14 | **Liveness endpoint** (P1-13): add a shallow process-only probe for Fly; keep `/api/v1/health` as the deep diagnostic. Already corrected in `docs/26` (`4ad05fc`). | Fly health check stays green while Stripe is unreachable. |

---

## Phase 3 — P2: the quality bar

| # | Item | Acceptance criterion |
|---|---|---|
| 3.1 | **`prose` emits no CSS** (P2-1) — register `@tailwindcss/typography` via `@plugin`, or rename the 11 call sites to the `.blog-article` classes that actually exist. The campaign story is the product. | Rendered campaign story shows paragraph spacing, heading hierarchy and bullets. Compiled-CSS assertion that `.prose` resolves to real rules. |
| 3.2 | **Font variables** (P2-2) — reconcile the `--font-dm-*` ↔ `--font-display/body/mono` names; reference `--font-body` or stop downloading DM Sans. | Browser test asserts computed `font-family` on body/h1/mono matches intent — **and settles the open question in `docs/29` §6.2.** |
| 3.3 | **Remove the false fee claim** (P2-3) — either show fees before checkout or delete the claim from all ten surfaces including the JSON-LD. Per `CLAUDE.md`, a claim we cannot substantiate is not microcopy. | Test greps user-facing copy and JSON-LD for fee claims and asserts each is substantiated by checkout behaviour. |
| 3.4 | **Contrast on the conversion path** (P2-4) — fix the 3.19:1 donate CTA and the three dark-mode hard-coded `text-white` cases; fix 1.24:1 input borders. | Computed-ratio test asserts ≥4.5:1 (or ≥3:1 where large-text applies) for every token pair on the donate path, **in both themes**. |
| 3.5 | **Close the vacuous tests** (P2-6) — extend a11y coverage to campaign detail and the donate flow in **both** themes; remove `if (isVisible())` guards so `e2e-11`/`e2e-12` can fail. | The suite fails when a real a11y regression is introduced. |
| 3.6 | **CSP** (P2-5) — nonce-based `script-src`, drop `unsafe-inline`. | No inline script executes without a nonce. |
| 3.7 | **SSR DOMPurify crash** (P2-7) and **uncapped offset** (P2-8). | Component renders server-side without throwing; offset is capped. |

---

## Phase 4 — Competitive parity (`docs/30` §1)

Only after Phase 1–2. Shipping share loops on top of unverified money movement
would be building on sand.

1. Attributed donor share links with impact tracking.
2. Auto-generated share creative.
3. Checkout breadth — wallets, guest donation, one-screen amount+tip.
4. Beneficiary and co-organizer roles with direct payout.
5. **The public disbursement ledger** — `docs/30` §2.2 — our most durable
   advantage, and unretrofittable by the incumbent.

---

## Standing rules this audit established

1. **Verify the executable artifact, never the declaration.** Index existence is
   checked in migrations, not `schema.ts`. A migration's contents are read, not
   inferred from its filename. A declared mitigation is not an existing one.
2. **Every fix ships with a failing-test-first acceptance criterion.** 3,977
   passing tests coexisted with every P0 in this register.
3. **Every fix to a silent failure ships a detection mechanism.**
4. **No unsubstantiated user-facing claim**, in product copy, structured data, or
   our own documentation.
5. **Correct the original document; never add a contradicting one.** Six of my own
   claims were falsified here and corrected in place (`5e11606`, `6a25252`,
   `4ad05fc`).
