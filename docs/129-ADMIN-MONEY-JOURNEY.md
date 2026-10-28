# 129 — The admin money journey: three candidates refuted, one latent finding

**Date:** 2026-10-28
**Journey:** admin, sub-journey 3 of 10 (money), after `docs/128`
**Status:** **no code change.** Three suspected defects were refuted by
measurement; one finding is confirmed, latent, and deliberately not fixed
(§5). `docs/122`'s refund fix is verified end to end for the first time.
**Read before** touching `PATCH /api/v1/admin/donations/[id]`,
`refund-batches/[id]`, or the withdrawal state machine.

---

## 1. Why this is its own journey

`docs/128` walked all 35 admin pages and **pressed nothing** — `docs/88`
pass-2 names *non-campaign write actions* as the open gap. So the admin
journey was split into ten, and this is the one where a click moves, voids or
reverses real money:

```
/admin/donations  /admin/refunds  /admin/payouts
/admin/payout-queue  /admin/fund-releases  /admin/simulation/fund-pool
```

Walked at 1440px and 390px signed in as a real admin, with **write actions
exercised** against a local throwaway Postgres (`ldadmin`). No production row
was written at any point.

⚠️ **The fixture had to be made faithful first.** The E2E fixture seeds only
`stripe`/`USD` donations, but every real donation this platform has taken is
`payhero` in KES (`docs/92`, `docs/122`) — and the admin refund route branches
on `provider !== 'stripe'`. A money walk on Stripe-only rows exercises the
branch real money never takes. `scripts/seed-admin-walk.ts` now seeds a
PayHero KES donation and a `partial_failure` refund batch; the composite FK on
`(campaign_id, currency)` forces that donation onto the KES campaign.

---

## 2. ✅ `docs/122`'s fix, verified by running it

`docs/122` §2 found that a refund on the live rail notified **nobody**: the
non-Stripe branch returned ~60 lines above `notifyDonationRefund`. It was
fixed by reading the code. It had never been executed.

Refunding the PayHero KES donation through the admin UI:

| check | result |
|---|---|
| dialog | *"mark the **Ksh 50.00** donation … On a rail with no refund API the money must then be sent back by hand. This cannot be undone."* |
| API | `200 {refunded:true, changed:true, manualRefundRequired:true, provider:"payhero"}` |
| ledger | `donations.refunded` false → **true** |
| audit row | `donation.refunded severity=warning`, `gatewayRefund: "NOT ISSUED - this gateway has no refund API"`, `manualRefundRequired: true` |
| toast | "Ledger corrected for Ksh 50…" |
| **donor told** | `[notifications] Failed to send email to walk-fixture-donor@example.invalid: Missing API key` |

That last line is the point. The notification **was attempted**; the only
failure is the absent sandbox Resend key. The call site is reached.

⚠️ `notifications` stayed at 2, and that is **correct, not a miss**:
`notifications.user_id` is `NOT NULL` and this donor is a guest. Email is the
only channel a guest has — and the M-Pesa rail creates only guests
(`docs/122` §3).

✅ The retry path refuses honestly too. Pressing **Retry 1 Failed Refund**
answered `409 CONFLICT "No failed records to retry"` and the screen rendered
exactly that. It did not claim success — the `docs/122` §2 property (a UI
asserting an outcome the route never reported) holding on a second surface.

---

## 3. ⛔ Three candidates, all REFUTED by measurement

Recorded so nobody re-investigates them.

### 3.1 "`/admin/payouts` is a queue no admin can act on"

[VERIFIED] Every writer of `campaign_withdrawals` in `src/` is
`user-campaigns/[id]/withdraw/route.ts` or `stripe-connect/webhook/route.ts`.
No admin route or screen writes it, and `PayoutsDashboard.tsx` contains zero
`fetch` calls — only expand and paginate. That reads exactly like `docs/88`
F1, the screen whose door was missing.

**Falsifier: "withdrawals are automatic, so no approval step exists."** Run —
the only status literals ever written are `'processing'`
(`withdraw/route.ts:382, 495, 565`), `'failed'` (`:524`; webhook `:273, :295`)
and `'completed'` (webhook `:170`). The flow is request → immediate transfer →
webhook settles. **The falsifier holds.** A read-only `/admin/payouts` is
correct. Not a defect.

### 3.2 "The refund response contradicts itself across rails"

[VERIFIED] `applyRefundInTx` (`payment-service.ts:664-673`) claims the row
`WHERE id = ? AND refunded = false` and returns `null` when already claimed.
When that claim loses a race the two branches disagree:

- Stripe (`donations/[id]/route.ts:260-265`) → `refunded: true, changed: false` — correct.
- non-Stripe (`:211`) → `refunded: Boolean(applied)` = **`false`** for the same
  state, beside a message asserting "The ledger has been corrected".

And the live rail is the non-Stripe one.

**Falsifier: "does any consumer read `data.refunded`?"** Run — the only caller
is `DonationsList.tsx:160-164`, which **ignores it** and sets `refunded: true`
optimistically from its own state. So there is no user-visible consequence,
and the state is reachable only through a genuine race between the read at
`:121` and the claim. An API-contract inconsistency with no live effect:
recorded, not fixed (Gate 6 asks for the smallest change that fixes a *root
cause*, and there is no live cause here).

### 3.3 "`/admin/donations` sums two currencies"

The page renders `$4,800.00` beside rows of `$1,000.00`, `$3,800.00` and
`Ksh 50.00`. 100000+380000+5000 would be `$4,850.00`.

**Refuted by looking at it**: the tile reads **"Total raised: $4,800.00 ·
Ksh 50.00"** — per currency, never summed, each row in its own currency.
`docs/115`'s admin currency sweep holds.

⚠️ Two of my own measurements were also artifacts, recorded because both look
like findings: `/admin/refunds` reported `rows=0` while showing a figure (it
renders batches as **cards**, not `tbody tr`), and `/admin/payout-queue`
showed `Ksh 0` for a campaign with a donation (my fixture inserts the donation
row directly; `recordGatewayCharge` is what normally increments
`raised_amount`).

---

## 4. What is genuinely well-built here

So a future reader does not re-litigate it:

- The Stripe refund uses `idempotencyKey: refund:${donation.id}`, calls Stripe
  **before** the ledger write, and returns 502 without touching the ledger if
  it fails (`donations/[id]/route.ts:232-244`).
- `applyRefundInTx` clamps `total_released_amount` in the **same UPDATE** that
  lowers `raised_amount`. The comment at `:246-253` records why: the previous
  inline version violated `campaigns_released_lte_raised` *after* Stripe had
  already refunded the donor, and the retry got `charge_already_refunded`.
- The batch retry calls Stripe **outside any DB transaction** (`docs/87`'s
  pool lesson), holds a semaphore, and leaves non-Stripe records `failed` with
  the reason restated rather than retrying a `payhero_` reference against
  Stripe.

---

## 5. ⛔ The one finding: three withdrawal statuses nothing can produce

[VERIFIED three ways]

1. **Code.** `withdrawal_status` has six values; only `processing`, `failed`
   and `completed` are ever written (§3.1). `'requested'` is the column
   default, but the insert at `withdraw/route.ts:382` overrides it with
   `'processing'`.
2. **Schema.** All six exist in `pg_enum`.
3. **Production.** `campaign_withdrawals` holds **0 rows** — with a control
   confirming the table reads, so the empty `GROUP BY` is a real empty table
   and not a failed query.

The consequence is user-facing but dormant:

- `FinancesClient.tsx:131` offers an organiser three filter options —
  `requested`, `approved`, `rejected` — that can never match a row.
- `dashboard/finances/payouts/page.tsx:80` queries
  `inArray(status, ['requested','approved','processing'])`; the first two
  terms are unreachable. Harmless today because `processing` carries it, but
  it encodes a state machine that does not exist.

⛔ **Reported, not fixed, and the reason is proportion.** No withdrawal has
ever existed, so nobody has seen an empty filter. Removing the options treats
a symptom; removing the enum values means a migration against a live money
table for zero present benefit. The root cause is a designed approval step
that was never built — which is a product decision, not a code edit.

⚠️ I checked `PayoutSettingsClient.tsx:229`'s `'rejected'` before counting it:
that is the **Connect account** status, a different enum. Not part of this.

---

## 6. What was NOT checked

- **No production row was written**, and no production money action was taken.
  Every write here was against local `ldadmin`.
- **`fund-pool/allocate` and `fund-pool/disburse` were read, not pressed.**
  [VERIFIED] neither calls any gateway — both only `update(fundPoolAllocations)`
  + `insert(auditLogs)` — so a route named `disburse` disburses nothing. That
  matches `docs/115` §7 ("no fund-pool path credits a campaign") and is
  existing recorded behaviour, not a new finding.
- **The Stripe refund branch was never executed**, only read. It cannot be:
  the card rail does not authenticate (`docs/72`, `docs/125`) and the local
  key is a throwaway. So §4's first two bullets rest on reading.
- **The bulk-cancel refund path** (`admin/campaigns/[id]/cancel`) was not
  walked; it belongs to the review journey.
- **`/admin/donations` overflows 105px at 390px.** Same unresolved class as
  `docs/128` §5 — four admin tables whose mechanism I could not establish and
  deliberately did not patch. Not re-investigated here.
- **No axe/WCAG run** on any money screen.
