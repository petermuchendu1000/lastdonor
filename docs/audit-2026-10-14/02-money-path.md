# Audit 02 — Money Path (LastDonor)

Scope: Stripe webhooks, payment-service transaction boundaries, money arithmetic,
refunds/reversals, payouts/fund release, seed-donation contamination, phase logic.
Read-only audit. **No live database and no Stripe key**, so every concurrency finding is
reasoned from source + migration SQL rather than observed; Stripe object-model claims
(subscription-invoice metadata, partial-refund events) are from the documented model.

Line numbers are from the working tree at audit time (HEAD, 2026-10-14).

---

## Findings index

| ID | Severity | Verdict | Title | file:line | Mechanism | Concrete trigger | Evidence | Fix sketch | Effort |
|---|---|---|---|---|---|---|---|---|---|
| M-01 | **Critical** | CONFIRMED | Seed donations inflate the public `raisedAmount`/`donorCount` real donors decide on | `src/lib/seed/simulation-engine.ts:330-341`; `src/db/public-select.ts:35-36,74-75` | Seed inserts increment the *same* campaign counter columns as real donations; `source` is deliberately excluded from the public boundary | A news-pipeline campaign is published `status:'active'` (`campaign-publisher.ts:325,341`) and accepts real checkout (`create-checkout/route.ts:53-56`) while its displayed total is mostly fabricated | `reconcile/route.ts:56` `expectedTotal = realTotal + seedTotal` proves it is by design; `reconcile/route.ts:150` recomputes with no `source` filter | Move seed into a separate `seedRaisedAmount` column and render it separately, or disclose simulated activity on the page | L |
| M-02 | **High** | CONFIRMED | Creator can withdraw more than released (in-flight withdrawals not debited) | `src/app/api/v1/user-campaigns/[id]/withdraw/route.ts:119-125` | Balance = `released - withdrawn`, read non-transactionally; `totalWithdrawnAmount` is only incremented later by the Connect webhook | Authenticated creator POSTs `/withdraw` twice with *different* `idempotencyKey`s before `transfer.created` lands; both pass the check, both create a real Stripe transfer | `stripe-connect/webhook/route.ts:146-151` is the only writer of `totalWithdrawnAmount`; `user/balance/route.ts:41-55` *does* subtract pending — the asymmetry is the gap | Conditional UPDATE `SET totalWithdrawnAmount = totalWithdrawnAmount + $amt WHERE totalReleasedAmount - totalWithdrawnAmount >= $amt`, check rowcount, *then* call Stripe | M |
| M-03 | **High** | CONFIRMED | Recurring donations are charged but never recorded | `src/app/api/v1/donations/create-checkout/route.ts:111-112,125-140` | In subscription mode `payment_intent_data` is `undefined`; metadata lands on `subscription_data` only, so the invoice PaymentIntent has no `campaignId` | Any donor selects "monthly". `invoice.payment_succeeded` → `extractMetadata` returns null → nothing recorded | `webhook/route.ts:80-87` → `payment-service.ts:54-61` returns null; `checkout.session.completed` path also dead because `session.payment_intent` is null in subscription mode (`webhook/route.ts:71`) | Put campaign metadata on the Subscription *and* copy it to each invoice PI, or resolve `campaignId` from `invoice.subscription` metadata in the handler | M |
| M-04 | **High** | CONFIRMED | Campaign can complete twice — duplicate completion emails, duplicate celebration post, double `lastDonorCount` | `src/lib/services/payment-service.ts:126` | `justCompleted` is decided from a stale non-locking read taken *outside* the transaction (`:398-402`); the completion UPDATE has no `WHERE status <> 'completed'` | Two donors finish checkout concurrently on a campaign at/near goal; both browsers POST the **public, unauthenticated** `/api/v1/donations/confirm` (`middleware.ts:17`) at once, or confirm races the webhook for the other PI | `:128-134` unconditional UPDATE; `:144-149` second "Campaign Goal Reached!" row; `:137-139` double `users.lastDonorCount`; `:267-284` second completion email; `:252` same bug for "first donation" | `UPDATE campaigns SET status='completed' ... WHERE id=$1 AND status <> 'completed' RETURNING id`; derive `justCompleted` from rowcount | S |
| M-05 | **High** | CONFIRMED | Refund rolls back against `campaigns_released_lte_raised` *after* Stripe already refunded | `src/lib/services/payment-service.ts:465-469`; `src/db/schema.ts:354` | Refund decrements `raisedAmount` but never `totalReleasedAmount`; if `released > raised - amount` the CHECK fires and the whole tx aborts | Refund any donation on a campaign that passed `approve_t2` (`verification/route.ts:166` sets `released = raisedAmount`) | `src/db/migrations/0027_oblique_audit_enforcement.sql:18` confirms the CHECK is live; `webhook/route.ts:102-105` swallows the error and returns 200 so Stripe never retries | Clamp `totalReleasedAmount` to the new `raisedAmount` inside the same tx (`LEAST(...)`) and reconcile against withdrawn | M |
| M-06 | **High** | CONFIRMED | Bulk refund zeroes `raisedAmount` including seed + failed-refund money; reconcile then resurrects a 100%-fabricated total | `src/app/api/v1/admin/campaigns/[campaignId]/cancel/route.ts:263-267` | Only `source='real'` rows are refunded (`:169-184`) but the whole total is zeroed, unconditionally on `failedCount > 0` too | Admin cancels a simulated campaign that has taken real donations; next reconcile run restores `raisedAmount` to the seed-only sum | `reconcile/route.ts:143-177` recomputes `SUM(amount) WHERE refunded=false` with no `source` filter and auto-corrects upward, logging severity `critical` | Decrement by the actual refunded sum rather than assigning 0; skip rows whose refund failed | M |
| M-07 | Medium | CONFIRMED | Partial refund decrements the **full** donation amount and permanently latches `refunded` | `src/lib/services/payment-service.ts:451-469` | Handler ignores `charge.amount_refunded` / `charge.refunds`, uses `donation.amount` (`:466`) and sets `refunded = true` (`:463`) | Admin issues a $10 partial refund in the Stripe Dashboard on a $100 donation: `raisedAmount` drops $100, `donorCount -1`, and every later refund on that charge is a no-op via the `:460` guard | Stripe emits `charge.refunded` for each refund against a charge, partial included | Use the event's refund amount; keep a `refundedAmount` integer column instead of a boolean | M |
| M-08 | Medium | CONFIRMED | Webhook failures are swallowed as HTTP 200, and the event is marked processed *before* it succeeds | `src/app/api/v1/donations/webhook/route.ts:38-41,102-105` | `processedEvents.add()` runs pre-switch; the catch returns 200. Any transient failure loses the event permanently — Stripe will not retry a 200 and an in-instance retry is deduped | M-05's CHECK violation, a pooler blip, or any throw inside `processPaymentSuccess` → donation silently absent while the donor is charged | Same shape at `stripe-connect/webhook/route.ts:52-55,83-86`. **Mitigated for genuine replays**: `idx_donations_stripe_payment_id` + `onConflictDoNothing` + the `:105` early return do make duplicates no-ops | Add to the set only after success; return 500 on error so Stripe retries; persist processed event ids in a table (the in-memory set is per-instance, and `docs/26` is multi-instance) | S |
| M-09 | Medium | CONFIRMED | Reconcile cron aborts on the first CHECK violation, and discards the `donorCount` drift it computed | `src/app/api/v1/cron/reconcile/route.ts:158-178` | Step 4's loop has no per-row try/catch (step 1 has one at `:52-85`); the auto-correct at `:175` can violate `campaigns_released_lte_raised` → caught only at `:221` → remaining drifts and step 5 (echo columns) never run | Any campaign with `totalReleasedAmount > 0` drifting downward | `:42` selects `donorCount` and `:78-81` never writes it — detected drift is thrown away | Wrap each row in try/catch; also correct `donorCount`; clamp released before writing raised | S |
| M-10 | Medium | CONFIRMED (release) / PLAUSIBLE (payout leg) | `totalReleasedAmount` is assigned not accumulated, releases 100% of raised with no fee reserve, and would include seed money on a converted campaign | `src/app/api/v1/admin/campaigns/[campaignId]/verification/route.ts:164-166` | `updateFields.totalReleasedAmount = campaign.raisedAmount` overwrites rather than adds, and `raisedAmount` is the real+seed mixed total | `approve_t2`. Re-release is bounded by the transition table (`:143-148`), so this is not unbounded | Platform's Stripe balance is raised minus ~2.9%+30c, so a full withdrawal must fail — `withdraw/route.ts:191-192` already carries copy for `balance_insufficient`. **Payout leg is PLAUSIBLE only**: `simulationFlag: true` is written solely by the news pipeline (`campaign-publisher.ts:341`, `news-pipeline.ts:508`) which sets no `creatorId`, and no API path assigns `creatorId` to an existing campaign (only `user-campaigns/route.ts:171` at creation), so the `withdraw/route.ts:93` ownership check cannot pass today. `convert/route.ts:63-69` clears `simulationFlag` but leaves the seed-inflated `raisedAmount` | Release `SUM(real, non-refunded donations) - platform/Stripe fees`, as an increment; refuse release on any campaign with seed rows | M |
| M-11 | Medium | CONFIRMED | Connect webhook mutations are not idempotent; a redelivered `transfer.reversed` inflates available balance | `src/app/api/v1/stripe-connect/webhook/route.ts:200-216` | Unconditional `GREATEST(0, totalWithdrawnAmount - transfer.amount)`; dedup is an in-memory `Set` (`:14,52-55`), per-instance and lost on restart | Stripe redelivers `transfer.reversed` (or it hits a second instance) → double decrement → feeds M-02 | `:137-152` is the mirror case (unconditional `status:'completed'` + increment); neither handler checks the withdrawal belongs to the metadata campaign | Guard with `WHERE status='processing'` / `WHERE status='completed'`; persist processed event ids | S |
| M-12 | Low | CONFIRMED | Public donor count ignores refunds while the raised total beside it does not | `src/app/page.tsx:107-108`; `src/app/transparency/page.tsx:36-37` | `totalRaised` filters `refunded = false`; `totalDonors` (`COUNT(DISTINCT donorEmail)`) does not | Any refund | Both filter `source='real'`, so these *aggregate* stats are free of seed — M-01 is about per-campaign `raisedAmount`, not these | Add `AND refunded = false` to the donor count | S |
| M-13 | Low | CONFIRMED | Seed donation writes are non-transactional and skip the `seedDonationCount` echo column | `src/lib/seed/simulation-engine.ts:302-338,396-430` | Separate insert-donation / insert-message / update-campaign statements, no `db.transaction`; a mid-sequence failure diverges `raisedAmount` from `donations` until reconcile | Any error between `:302` and `:338` (AI call, pooler timeout) | `seedDonationCount` is never incremented anywhere — only zeroed by `admin/seed/purge/route.ts:61` and recomputed by `reconcile/route.ts:189-207`, contrary to the CLAUDE.md echo-column rule | Wrap each donation in `db.transaction` and increment `seedDonationCount` in it | S |
| M-14 | Low | CONFIRMED | `phaseAtTime` uses a stale read; the 90% status threshold disagrees with the phase label | `src/lib/services/payment-service.ts:86,150`; `src/lib/utils/phase.ts:5` | `:86` uses `campaign.raisedAmount + amount` from the pre-tx read at `:398`, not the `RETURNING` value at `:118` — despite the comment at `:85` claiming the opposite | Concurrent donations receive the same phase label | `phase.ts:5` `<= 90 → closing_in` means `last_donor_zone` needs >= 91%, while `payment-service.ts:150` flips status at `newRaised >= goalAmount * 0.9`. Label/status disagree between 90% and 91%. Display only | Compute phase from the `RETURNING raisedAmount`; align the two thresholds | S |

---

## Q6 — definitive answer: can seed donations contaminate real money?

**Displayed-to-real-donors totals: YES, confirmed, by design.**
`simulation-engine.ts:330-341` and `:424-430` increment `campaigns.raisedAmount` and
`campaigns.donorCount` — the identical columns `payment-service.ts:113-114` increments for
real money. `public-select.ts:35-36` and `:74-75` expose both columns on the public campaign
detail and card selects, and that file's own header (`:11-14`) states `source`,
`simulationFlag`, `simulationConfig` and `campaignProfile` must **never** appear publicly —
so the fabricated donations are intentionally indistinguishable from real ones. Seed
donor names, locations and messages are mirrored onto the public message wall
(`simulation-engine.ts:315-326` → `publicMessageSelect`, consumed at
`campaigns/[slug]/page.tsx:116`). These campaigns are published `status:'active'`
(`campaign-publisher.ts:325`) and accept real donations (`create-checkout/route.ts:53-56`).
`reconcile/route.ts:56` (`expectedTotal = realTotal + seedTotal`) and `:150`
(`SUM(d.amount) FILTER (WHERE d.refunded = false)`, no `source` filter) both confirm the
mixed total is the intended invariant, not drift.

**Aggregate platform stats: NO.** `page.tsx:107`, `transparency/page.tsx:36`,
`api/v1/stats/route.ts:16`, `admin/page.tsx:27,41,101`, `admin/reports/page.tsx:31,116`,
`admin/dashboard/route.ts:38,52,78` and `admin/seed/stats/route.ts:20,28` all filter
`source = 'real'`. Admin views separate real/seed explicitly
(`admin/donations/page.tsx:47-48`).

**Donor email: NO.** Seed rows carry generated fake addresses
(`generateRealisticEmail`), and both bulk-email paths filter `source='real'`
(`admin/bulk-emails/route.ts:135`, `[id]/send/route.ts:213`). The seed engine writes no
`donorCampaignSubscriptions` rows.

**Real payouts: not reachable through today's API** — see M-10's evidence cell. The
arithmetic *would* release seed money (`verification/route.ts:166` releases
`campaign.raisedAmount`), but no simulated campaign has a `creatorId` and no route assigns
one, so `withdraw/route.ts:93` blocks it. This is one schema edit or one admin DB write
away from being live, and `convert/route.ts:63-69` deliberately turns a seed-inflated
campaign into a non-simulated one without touching `raisedAmount`.

**Real money on simulated campaigns** is handled deliberately: `payment-service.ts:174-189`
routes those donations into `fundPoolAllocations` with `status:'pending'` for manual
disbursement, and `reconcile/route.ts:112-138` alerts an admin above $1,000.

---

## Sub-areas examined where I found nothing

- **Raw-body signature verification.** Both webhooks call `await request.text()` and pass
  that string straight to `stripe.webhooks.constructEvent`
  (`donations/webhook/route.ts:18-28`, `stripe-connect/webhook/route.ts:32-42`). No parse /
  re-serialise anywhere. Clean.
- **Stripe↔DB amount reconciliation.** The insert uses `paymentIntent.amount` from the
  verified/retrieved Stripe object (`payment-service.ts:84`), never a client-supplied
  value — so DB amount equals Stripe amount by construction. The `create-checkout` flow
  never passes the client amount through to recording.
- **`donations_amount_check` vs API validation.** `>= 500` in
  `migrations/0000_square_chronomancer.sql:112` matches `.min(500)` in
  `validators/donation.ts:15` (max `10_000_000`, `.int()`). `npx vitest run
  src/lib/validators/donation.test.ts` → **16/16 passed**, including the 499/500 and
  10,000,000/10,000,001 boundaries and non-integer rejection. Mitigated.
- **Money arithmetic.** All amounts are integer cents. The only float use is `/100` with
  `.toFixed(2)`/`toLocaleString` for display and email (`payment-service.ts:147,334`) and
  percentage display — exact below 2^53. No float accumulation, no currency conversion;
  every Stripe call hardcodes `currency: 'usd'` (`create-checkout/route.ts:86,101`,
  `create-intent/route.ts:70`). Payout currency comes from the Connect account
  (`withdraw/route.ts:129`) and is not cross-checked against `usd` — noted, no finding.
- **Duplicate donation rows / replay.** `idx_donations_stripe_payment_id`
  (`schema.ts:385`, present in `migrations/0000:112` block) plus
  `.onConflictDoNothing({ target: donations.stripePaymentId })` and the
  `insertResult.length === 0` early return (`payment-service.ts:103-105`) genuinely make
  all four callers safe — `webhook/route.ts:55`, `:74`, `:84` and the public
  `confirm/route.ts:56`. **This control works as documented in CLAUDE.md.** It is only the
  *failure* path (M-08) that is unprotected.
- **Events for unknown campaigns.** `payment-service.ts:404-410` logs and returns; no
  phantom rows. Missing metadata is rejected at `:54-61`.
- **Raw `IN ${array}` templates** (`cancel/route.ts:250`, `reconcile/route.ts:45`). I
  generated the SQL with drizzle's own `PgDialect` (scratch repro at
  `scratchpad/repro/insql.mjs`): `IN ${arr}` correctly emits `IN ($1, $2, $3)`. Not a bug;
  both call sites also guard the empty-array case (`:247`, `:36`).
- **Fund-pool disbursement.** `admin/fund-pool/disburse/route.ts:61-70` is a
  compare-and-swap (`WHERE status = 'allocated'`), so double-disbursement is blocked at the
  DB. Only the audit-log `totalDisbursed` (`:57`) is computed from the stale pre-check read.
- **`update-phases` cron double-completion.** It no longer performs completion at all
  (`route.ts:13-20`, `:41-55` only generate organizer updates), so it cannot complete a
  campaign twice. The double-completion risk is entirely M-04's in `payment-service.ts`.
- **Auto-refund of donations on completed campaigns** (`payment-service.ts:413-423`) has no
  Stripe idempotency key, so confirm + webhook racing the same PI issues two refund
  requests — Stripe rejects the second (`charge_already_refunded`) and `:420-422` logs it.
  Mitigated externally; no finding.
- **Cron auth.** `verifyCronAuth` is called by `simulate-donations/route.ts:15`,
  `reconcile/route.ts:14` and `update-phases/route.ts:23`.
- **`publicDonationSelect`** (`public-select.ts:81-89`) is defined but has no consumers —
  dead code, no exposure.

## Note outside the money path
`/api/v1/donations/confirm` is public and unauthenticated (`middleware.ts:17`) and accepts
an arbitrary `paymentIntentId`/`sessionId`, returning `paymentIntent.amount`
(`confirm/route.ts:62`). Donation recording stays idempotent, but it is an amount oracle
for any guessed/leaked `pi_`/`cs_` id, and it is the trigger surface that makes M-04
trivially reachable.
