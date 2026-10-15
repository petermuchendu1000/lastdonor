# 41 — Journey Remediation Decisions (ADR), 2026-10-15

Decisions taken while fixing the donor, creator, admin and cron journeys on
branch `claude/eloquent-curie-c84uj3`. Commits: `2b9ea44` (auth UI), `9a14dc6`
(auth API), `3ccfe1e` (refund accounting), `0b92f75` (payouts), `224e069`
(email), `df87a9b` (cron and seed), `685d0cf` (`.env.example`), `17f20f8`
(trust copy and dead links), `c2aa51c` (volume-limit response shape, §8 and §9).
§9 is here specifically because it **reverses** a rationale that `df87a9b`
recorded in a code comment and that §3 describes, and `CLAUDE.md` forbids
leaving two contradicting rationales on disk.

Each section states what was decided, why, what was rejected, and the trade-off
accepted. The rejected options are the point: they are what stops the decision
being reopened.

**Evidence standard.** Every claim about this codebase carries a `path:line`
reference and is marked **verified** (read in the tree on 2026-10-15) or
**assumed**. Claims taken from a vendor's or regulator's text carry the source
and the date it was read. Where a diff shows *what* changed but no comment or
commit text records *why*, the rationale is labelled **reconstructed** rather
than presented as the author's. §11 indexes every claim marked assumed.

**Line numbers.** Taken from the committed tree (`17f20f8` for §1-§7 and §10,
`c2aa51c` for §8-§9). Several files were being edited concurrently by
other agents while this was written (`src/lib/unsubscribe-tokens.ts`,
`src/lib/notifications.ts`, `src/app/api/auth/register/route.ts`,
`src/app/register/page.tsx`, `src/components/admin/BulkEmailDashboard.tsx`), so
for those the symbol name is load-bearing and the line number is a hint.

**Related documents.** `docs/29` (audit findings these fix), `docs/31` (plan),
`docs/32` (earlier remediation ADR; §7a there owns the unsubscribe-token module
consolidation), `docs/33` (seed-donation disclosure — **amended by §4 below**),
`docs/34` (migration baseline, load-bearing for §6),
`docs/39` (**owns the registration enumeration oracle**, server route and page,
in more detail than §7 here restates) and `docs/40` (**owns unsubscribe-token
ownership and the campaign-update footer links**). §5 and §7 below deliberately
do not re-decide anything those three documents decide; where the topics touch,
they cross-reference instead.

**Numbering.** This document was drafted as `39` and is `41` because two
parallel agents landed `docs/39-REGISTRATION-PAGE-ENUMERATION-ADR.md` and
`docs/40-CAMPAIGN-UNSUBSCRIBE-LINK-ADR.md` on disk first. Per `CLAUDE.md`,
existing docs are never renumbered and the next free number wins.

| § | Decision |
|---|---|
| 1 | Refund accounting has exactly one writer, and Stripe is authoritative |
| 2 | Release and payout never disburse seed money |
| 3 | Volume guards live inside the shared publisher, not in each caller |
| 4 | Seed donations fail closed on an environment opt-in, not an admin setting |
| 5 | Outbound mail is consent-gated and carries a real sender identity |
| 6 | The bulk-email recipient filter lives in `audit_logs.details` (known debt) |
| 7 | Open-redirect defence by origin comparison; reset tokens kept out of Sentry |
| 8 | A volume limit is a rate limit (429), not a server error |
| 9 | A rate-limited batch item must not abort the batch (reverses §3's `break`) |
| 10 | An unsubstantiated refund guarantee was removed, not substantiated |
| 11 | Index of claims marked assumed |

---

## 1. Refund accounting has exactly one writer, and after Stripe moves money the DB converges to Stripe

**Decided.** `applyRefundInTx` / `applyRefund` in
`src/lib/services/payment-service.ts:578,668` is the **sole writer** of
`donations.refunded`. Every refund path calls it:

- admin single refund — `src/app/api/v1/admin/donations/[id]/route.ts:175`
- bulk refund on campaign cancel — `src/app/api/v1/admin/campaigns/[campaignId]/cancel/route.ts:278`
- refund-batch retry — `src/app/api/v1/admin/refund-batches/[id]/route.ts:253`
- the `charge.refunded` webhook — `src/lib/services/payment-service.ts:759`

**Verified** 2026-10-15: the only statement in `src/` that writes that column is
`payment-service.ts:585` (`grep` for `set({ refunded`; the other matches are
response bodies in `admin/donations/[id]/route.ts:144,186,204,208`).

Two invariants are enforced there and nowhere else:

1. **The claim is the first statement of the transaction** —
   `UPDATE donations SET refunded = true WHERE id = $1 AND refunded = false
   RETURNING …` (`payment-service.ts:582-596`). Of two concurrent deliveries
   exactly one gets a row back, so exactly one decrements the campaign.
2. **`total_released_amount` is clamped in the same `UPDATE` that lowers
   `raised_amount`** (`payment-service.ts:607-613`), both `SET` expressions
   reading the pre-`UPDATE` value, so released is pulled down only as far as the
   new raised figure. The constraint being respected is
   `campaigns_released_lte_raised` (`src/db/schema.ts:354`, created by the
   baseline at `src/db/migrations-v2/0000_cheerful_robbie_robertson.sql:259`).

**Why one writer rather than four correct callers.** The pre-fix state, recorded
in the commit message of `3ccfe1e` and consistent with the diffs: four
independent implementations, of which one respected the CHECK and three did not.
The failure they shared is not a typo but a shape — each caller refunded at
Stripe first and then wrote its own idea of the ledger, so each one could abort
*after* the money had moved. Fixing them individually leaves a fifth caller free
to repeat it, and nothing in the type system would notice. A single writer that
owns both the claim and the clamp means a new caller inherits both or does not
compile against the column at all.

**Why the code no longer aborts after Stripe has moved money, and which side is
authoritative.** **Stripe is authoritative; the database converges to it.** Once
`refunds.create` returns, the donor's money is on its way back and no DB
transaction can recall it, so a database error must never be allowed to present
itself as "the refund did not happen":

- Every Stripe refund call now carries an idempotency key
  (`refund:<donationId>` at `admin/donations/[id]/route.ts:156`,
  `cancel/route.ts:225`, `refund-batches/[id]/route.ts:199`, and
  `refund:auto:<paymentIntentId>` at `payment-service.ts:704`), so a retry
  returns the same refund object rather than creating a second one or answering
  `charge_already_refunded`.
- The ledger write cannot abort on the CHECK, because the clamp is in the same
  statement as the decrement.
- Losing the race is not an error. When the claim returns no row, the admin
  route answers 200 with `changed: false`
  (`admin/donations/[id]/route.ts:184-187`) and the webhook returns early
  (`payment-service.ts:762`), because another writer has already recorded the
  same Stripe-side fact.
- The webhook deliberately has **no** pre-flight `refunded` read
  (`payment-service.ts:753-758`): the previous read-outside-then-write-inside
  pattern let two concurrent deliveries each decrement a $5 refund as $10 and
  two donors. The conditional claim is the only durable dedup; the in-process
  `processedEvents` set is per-instance.

**Rejected: per-caller compensating updates.** Let each site adjust the totals
itself and add a repair pass (`cron/reconcile`) to fix the drift afterwards.
Rejected for three reasons. (a) It was the status quo, and it produced four
divergent behaviours. (b) `reconcile` cannot repair this class of damage: its
invariant is `expectedTotal = realTotal + seedTotal`
(`src/app/api/v1/cron/reconcile/route.ts`, step 1; `docs/33` §3 cites it at
`cron/reconcile:56`), so a refund recorded at Stripe but not in the DB looks
*consistent* to it. (c) `reconcile` was itself disabled by the same missing
clamp: its auto-correct had no `LEAST` and its step-4 loop no per-row
`try/catch`, so one bad row threw, the job returned 500, and step 5 never ran —
every run, on the same row. Both are fixed in place
(`reconcile/route.ts:95,179-205`), but a repair job cannot be the primary
control for the thing that breaks it.

**Rejected: abort the transaction and surface a 500 when the ledger write
fails.** This is what the code did. It leaves Stripe and the DB disagreeing with
the DB claiming authority: `donations.refunded` false, totals unchanged, no
audit row, and a retry that gets `charge_already_refunded` from Stripe — so the
donation looks un-refunded forever while the creator can still withdraw the
money. Recorded in the `3ccfe1e` commit message as the observed P0; the audit
reference is `docs/29` P0-3.

**Rejected: one batch `UPDATE … WHERE id IN (…)` for a bulk refund.** Cheaper,
and it is what both bulk paths did (`cancel/route.ts`, `refund-batches/[id]`
before `3ccfe1e`). It cannot clamp per campaign, and the cancel path paired it
with `raisedAmount: 0, donorCount: 0` under an `if (refundedCount > 0)` guard —
so 3 of 10 refunds succeeding left the ledger claiming the campaign had raised
nothing while 7 donors still held their money. Now each successful refund is
applied through the single writer in a loop (`cancel/route.ts:277-285`), and the
sum removed is exactly the sum actually refunded.

**Trade-offs accepted.**

- **One transaction and three statements per donation** instead of one batch
  `UPDATE`, on a path that already makes one network call to Stripe per
  donation. Correctness is worth more than the round trips here.
- **`refund:<donationId>` would dedup a second legitimate partial refund.**
  Nothing in `src/` issues partial refunds today (**verified**: all four call
  sites pass only `payment_intent`), so this is latent, not live. Recorded in
  the `3ccfe1e` commit message as a known follow-up.
- **`releasedBelowWithdrawn` is recorded and consumed by nothing.** It is
  computed at `payment-service.ts:626`, returned, and written into
  `audit_logs.details` (`:645`). **Verified** 2026-10-15 that no other file in
  `src/` reads it. A refund that claws released funds below
  `total_withdrawn_amount` is a real cash shortfall, and today the only thing
  that happens is an audit row at severity `warning`.
- **Seed donations do not adjust the ledger.** `adjustCampaign` defaults to
  `row.source !== 'seed'` (`payment-service.ts:600`), so refunding a fabricated
  donation flips the flag and writes the audit row but leaves `raised_amount`
  inflated. Consistent with the blended-totals design in `docs/33`; it is a
  consequence of that unresolved decision, not an independent one.
- **Donors whose Stripe refund failed are no longer emailed** "your donation has
  been refunded" (`cancel/route.ts:299-307`). The trade-off is that a donor
  whose refund failed now hears nothing at all until an operator notices the
  `partial_failure` batch status.

**Not a decision of this commit.** `admin/donations/[id]/route.ts:113-119`
rejects `refunded: false` ("Refunds cannot be reversed"). **Verified** by
`git log -S`: that guard dates from the initial commit `e79523b`, which is why
the old increment-on-un-refund branch the diff deletes was already unreachable.

---

## 2. Release and payout never disburse seed money

**Decided.** The lump-sum release on full verification is computed from the
`donations` table, not from `campaigns.raised_amount`:

```sql
total_released_amount = LEAST((
  SELECT COALESCE(SUM(amount), 0)::int FROM donations
  WHERE campaign_id = $1 AND source = 'real' AND refunded = false
), raised_amount)
```

`src/app/api/v1/admin/campaigns/[campaignId]/verification/route.ts:183-191`,
inside a transaction that holds `FOR UPDATE` on the campaign row and
re-validates the state transition under the lock (`:196-215`). `raised_amount`
is deliberately **not** selected into the handler any more (`:92-97`), so it
cannot be used as a release basis by accident.

That is the whole guard, because withdrawal is already bounded by the released
figure: `availableBalance = total_released_amount - total_withdrawn_amount -
sum(pending withdrawals)`
(`src/app/api/v1/user-campaigns/[id]/withdraw/route.ts:278-281`), evaluated
inside the same locked reservation transaction.

**Why.** `raised_amount` is a **blended** figure: the simulation engine writes
`source = 'seed'` donations and the same column counts them, and
`public-select.ts` suppresses `source` (`docs/33` §3). `approve_t2` used to set
`totalReleasedAmount = campaign.raisedAmount`, so a campaign at $40,000 of which
$38,000 was fabricated would release $40,000 of **real platform money** to a
creator. That is not an accounting error, it is the platform paying out money no
donor ever gave. Recorded in the `0b92f75` commit message; the SQL in the diff
corroborates it.

**Rejected: subtract a seed total afterwards.** Read `raised_amount`, read the
seed sum, subtract, write. Rejected: it is the unlocked read-then-write shape
that `docs/29` P0-3 and §1 above are about. The old code read `raised_amount`
outside the transaction, so a donation or refund landing in between made the
written figure wrong, and an over-large figure aborted the whole approval on the
CHECK *after* the documents had been marked approved. Computing inside the
`UPDATE` under `FOR UPDATE` removes the window rather than narrowing it.

**Rejected: a `campaigns.real_raised_amount` column maintained by triggers.**
Faster to read and it would make the invariant declarative. Rejected here for
the reason in §6: it needs a schema change, and the correct source of truth
already exists in `donations`. Also, `CLAUDE.md` records that the existing
denormalised counters (`seedDonationCount`, `messageCount`, `updateCount`) are
never incremented anywhere, so adding another echo column to a codebase with
three broken ones needs the rule in §6 settled first.

**Trade-offs accepted.**

- **A creator can see "raised" far above "available to withdraw" with no
  explanation.** `FinancesClient` renders raised, released and available side by
  side (`src/components/dashboard/FinancesClient.tsx:350-368`). On a seeded
  campaign the gap is the fabricated portion, and per `docs/33` §2 the platform
  does not disclose it — so the UI cannot explain the difference without
  reversing the owner's decision. This is the sharpest user-visible consequence
  of leaving `docs/33` open, and it now exists in the creator dashboard, not
  only in theory. **Rationale reconstructed**: no comment in `0b92f75` addresses
  the creator-facing gap.
- **An aggregate query at approval time** instead of a column read. Once per
  campaign per lifetime; irrelevant.
- **Release is clamped by `LEAST(…, raised_amount)`.** If a partially-failed
  bulk refund has already zeroed `raised_amount` while leaving some donations
  un-refunded, the release is clamped to the lower figure rather than aborting
  the approval. Recorded at `verification/route.ts:179-182`.

**Adjacent payout decisions from `0b92f75`**, kept here because a future reader
of "payouts" will look for them. All **verified** by reading the files.

- **Withdrawals were 100% dead.** `withdrawalRequestSchema` requires
  `idempotencyKey` as a non-optional UUID (`src/lib/validators/payout.ts:56-58`)
  and both withdrawal UIs sent only `{ amount }`. Every attempt was a 400 and
  the campaigner saw the raw validator message. Both UIs now mint a key per
  form-fill, not per click (`FinancesClient.tsx:177-178`,
  `PayoutSettingsClient.tsx:178-179`), so a double-click dedups and a retry
  after a lost response reuses the same key.
- **Campaign state is re-checked under the lock.** Status must be in
  `['active','last_donor_zone','completed']` (`withdraw/route.ts:23,226`),
  verification must still be `fully_verified` (`:233`), and an open
  `refund_batches` row with status `processing` blocks the withdrawal (`:239-250`).
  So an admin cancelling a fraudulent campaign wins the race against a creator
  draining the released balance while the per-donor refunds trickle out.
- **Unknown transfer outcomes do not free money.** `isDefiniteTransferFailure`
  (`withdraw/route.ts:38-52`) releases the reservation only for
  `balance_insufficient` and Stripe's `InvalidRequest` / `Authentication` /
  `Permission` error types; anything else (timeout, dropped connection, 5xx)
  leaves the row in `processing` with `UNKNOWN_OUTCOME:` prefixed on
  `failureReason` (`:427-430`) and answers 502 telling the creator not to retry.
  The default is "unknown" on purpose.
- **Non-USD payouts are refused, not converted.** `PLATFORM_PAYOUT_CURRENCY`
  and `isSupportedPayoutCurrency` live in the validator module so clients can
  share them (`src/lib/validators/payout.ts:21-25`), the withdraw route hard-fails
  on a mismatch (`withdraw/route.ts:173`), and `mapAccountToStatus` surfaces
  `unsupportedCurrency` at account level (`src/lib/stripe-connect.ts:227`) so the
  creator learns before the moment of transfer. The ledger is USD cents end to
  end and there is no FX conversion anywhere in the codebase, so transferring the
  same integer under another currency code silently pays the wrong amount.
- **`verified` no longer requires `charges_enabled`**
  (`stripe-connect.ts:200`). `createExpressAccount` requests only the
  `transfers` capability, so `charges_enabled` can legitimately stay false
  forever on these accounts, and gating on it meant the status was unreachable.
- **Only a `completed` withdrawal may debit `total_withdrawn_amount`**
  (`src/app/api/v1/stripe-connect/webhook/route.ts:268-276`), and
  `transfer.created` now also excludes `failed` rows (`:175`). Stripe does not
  guarantee event ordering, so a `transfer.reversed` arriving before its
  `transfer.created` previously debited a counter nothing had credited.

---

## 3. Volume guards live inside the shared publisher, not in each caller

**Decided.** The three limits that bound automated campaign creation — the
phase-out floor, `campaign_creation_daily_limit`, and
`simulation.max_concurrent` — are implemented once in
`src/lib/news/volume-guards.ts:84` (`checkCampaignVolumeGuards`) and called from
inside `publishCampaignFromNewsItem`
(`src/lib/news/campaign-publisher.ts:132-144`), at step 1b: after the free
`NOT_FOUND` / `ALREADY_CREATED` checks and **before** the article-body fetch and
every AI call. A refusal is returned as a first-class outcome
`{ code: 'VOLUME_LIMIT', guard }` (`campaign-publisher.ts:49`), not an
exception. Opting out requires writing `{ bypassVolumeGuards: true }` at the
call site (`campaign-publisher.ts:98,132`); **verified** 2026-10-15 that nothing
in `src/` sets it outside a test.

**Why, and what the rejected per-caller design actually cost.** The comment
block at `volume-guards.ts:1-34` records it: `runNewsPipeline` had always
enforced all three limits in its own loop, and the two *other* paths that
publish campaigns did not —
`/api/v1/cron/publish-campaigns` (every 30 minutes per `vercel.json`) and the
admin "Create" button
(`/api/v1/admin/news-feed/[id]/create-campaign`). Both reach
`publishCampaignFromNewsItem`, which enforced dedup and quality and no volume
limit at all. **Observed on 2026-10-14**: four manual `publish-campaigns` runs
created **12 campaigns** against a `campaign_creation_daily_limit` of 10 and a
`simulation.max_concurrent` of 10, with nothing logged as rate-limited.

The same incident had a second cause, recorded separately at
`campaign-publisher.ts:507-531`: the batch selector computed
`[...military.slice(0,2), ...other.slice(0,3)].slice(0,5)`, whose comment said
"max 5 total" but whose code also capped non-military items at 3 — so a
candidate set with 0 or 1 military items could never fill 5 slots, giving
`4 + 3 + 3 + 2 = 12` over four runs where `5 + 5 + 2` was expected. Replaced by
`selectBalancedCandidates` (`campaign-publisher.ts:535`), which takes the
military picks first and fills the remainder, and deliberately does **not**
relax the military ceiling when the others cannot fill the batch.

So the rejected design is not hypothetical: per-caller checks were the design,
and two of three callers simply did not have them. Guards inside the shared
publisher are inherited by construction, and the admin path inherits them
without any code of its own (**verified**: the admin route calls the publisher
with only `auditEventType`).

**Rejected: cache the counts once per run and add an in-run counter.** This is
what `news-pipeline.ts` does, and it still does
(`src/lib/news/news-pipeline.ts:344-371,518-526`: one read of the daily count
and the active-simulated count per run, plus `campaignsCreatedThisRun`). It is
correct inside a single loop and wrong across concurrent callers: the
`publish-campaigns` cron and an admin click overlap, each holds its own cached
baseline, and each believes it has the whole remaining budget. The two modules
now at least share the fallbacks `DEFAULT_CAMPAIGN_DAILY_LIMIT` and
`DEFAULT_MAX_CONCURRENT_SIMULATED` (`volume-guards.ts:50,53`, imported at
`news-pipeline.ts:38-41`) so the numbers cannot drift. **Known residual, flagged
here rather than claimed as fixed:** the pipeline's own cached checks were not
replaced by `checkCampaignVolumeGuards`, so two enforcement implementations
still exist. Retiring the cached pair in favour of the shared guard is the
follow-up.

**Rejected: enforce the limits in each cron route before the loop.** Cheaper
(one check per run) and it reads naturally. Rejected: it puts the control at the
caller again, which is the defect, and it cannot see the campaigns the loop
itself creates.

**Rejected: a hard cap in code.** Every threshold stays a setting read at check
time (`site_settings.campaign_creation_daily_limit`,
`simulation.max_concurrent`, and `calculateAutoVolume()`); this module decides
nothing on its own (`volume-guards.ts:32-33`).

**Cost accepted: three aggregate queries per publish attempt.** One dynamic
import plus `calculateAutoVolume()`, one `count(*)` over
`campaigns WHERE source = 'automated' AND published_at >= start of UTC day`, and
one `count(*)` over `campaigns WHERE simulation_flag AND status IN
('active','last_donor_zone')` (`volume-guards.ts:90-141`). On a path that
already spends 4-6 AI calls per item this is not measurable, and it is the price
of being correct when a cron batch and an admin click overlap. The guards also
run before the article fetch and before the first AI call, so a refusal costs
three queries and zero AI spend — which is what makes §9's decision to continue
the batch cheap.

**Also in `df87a9b`, verified and recorded here because they share the file set.**

- **A failed news source is no longer an empty news source.**
  `fetchFemaDeclarations` and `fetchWeatherAlerts` now throw on transport or
  HTTP failure instead of returning `[]`
  (`src/lib/news/fema-client.ts:44-47,74-78`,
  `src/lib/news/weather-alerts.ts:52-56,82-86`). The pipeline derives
  `allFailed` from `Promise.allSettled` rejections, so a client that never
  rejects could never be counted as failed and a total blackout surfaced as HTTP
  200, severity `info`, `fetched: 0`. RSS mode gets the same treatment by a
  different route: zero articles from 125 feeds is now a `critical` audit row
  (`news-pipeline.ts:188-198`).
- **The pipeline is bounded.** `MAX_NEW_ARTICLES_PER_RUN = 40` applied *before*
  the insert so the overflow stays undeduplicated for the next run
  (`news-pipeline.ts:92,226-232`), and `MAX_PIPELINE_ERRORS = 20` with an
  `errorsOmitted` counter, because `result.errors` is written verbatim into one
  `audit_logs.details` JSONB row (`news-pipeline.ts:103,107-119`).
- **`fetch-news` was the only AI cron budgeted below 300s.** Raised 120 → 300 in
  both the route (`src/app/api/v1/cron/fetch-news/route.ts:11-23`) and
  `CRON_LOCKS` (`src/lib/locks.ts:313-321`), with `locks.test.ts` asserting the
  two match so they cannot drift.

---

## 4. Seed donations fail closed on an environment opt-in, not an admin setting

**This section amends `docs/33-SEED-DATA-DISCLOSURE-DECISION.md`.** Read
`docs/33` first: it records the owner's decision (§2) that seed donations are to
remain indistinguishable from real ones in public totals, and the engineering
refusal to implement that (§3), with the question left **Open** (§7). Nothing
here reverses either. `docs/33` has been amended with a dated pointer to this
section.

**Decided.** `/api/v1/cron/simulate-donations` refuses with **403** unless the
process environment carries
`SEED_DONATIONS_OPT_IN=fabricated-donations-acknowledged`. The check is
`seedDonationsOptedIn()` (`src/lib/seed/simulation-engine.ts:54-57`), called at
`src/app/api/v1/cron/simulate-donations/route.ts:36` — **ahead of** the overlap
lock, the settings reads, and every write. The Vercel cron entry for the job was
removed (`vercel.json`; the `*/15 * * * *` line is deleted in `df87a9b`), and
the variable is documented in `.env.example:148-155` (added in `685d0cf`).

Three details are deliberate and recorded in the code:

- **Not a setting.** `simulation.enabled` defaults to `false` in
  `SETTING_DEFAULTS`, and until 2026-10-15 that default plus a missing scheduler
  was the *entire* thing standing between a live deployment and fabricated
  money-shaped rows in public campaign totals — and both are suppliable, the
  first by one checkbox in the admin UI (writable through
  `/api/v1/admin/simulation/settings`), the second by any Vercel deploy, since
  `vercel.json` shipped the schedule. The gate is in the environment because the
  only party who can accept the decision in `docs/33` §2 is the one who controls
  the deployment, and an admin session (or a compromised one) is not that party
  (`simulation-engine.ts:23-42`).
- **Not a boolean.** `=true` is what someone copies in by reflex while
  pattern-matching other flags; the sentinel has to be typed deliberately and
  names what it switches on (`simulation-engine.ts:40-47`).
- **403, not 200-with-skipped.** A deployment that schedules this job without
  the opt-in is misconfigured, and the failure should be visible in the
  dispatcher rather than quietly no-op for months
  (`simulate-donations/route.ts:24-34`). Contrast §5, where a newsletter run
  without a postal address answers 200 with `skipped: true`: skipping a
  newsletter costs a week of mail and self-corrects, whereas a seeding job that
  starts running writes rows into public totals that `docs/33` §3 shows cannot
  be withdrawn without making those totals visibly decrease. **Rationale for the
  newsletter side reconstructed**; the 403 side is recorded in the code.

**Rejected: an admin-UI toggle (including a confirmation modal or a typed
phrase).** This is the design the pre-existing `simulation.enabled` setting
already implemented, and it is too cheap a trigger for the act in question.
Publishing fabricated donations into a live appeal's totals is irreversible in
practice (`docs/33` §3: removal makes public totals decrease, `cron/reconcile`
flags the drawdown as drift against `expectedTotal = realTotal + seedTotal`, and
`last_donor_*` plus the Last Donor Wall point at seed rows), it influences
strangers' financial decisions, and it is exactly the conduct the regulatory
actions in `docs/30` §2.1-2.2 concern. A control whose blast radius is
irreversible should not be reachable from a session cookie.

**Rejected: deleting the cron route and the simulation engine.** It would settle
`docs/33` §7 unilaterally in engineering's favour, and `docs/33` §6 lists
legitimate things the engine does (seeded *campaigns* with `raised_amount = 0`
are not the objection). Refusing by default while leaving the mechanism intact
keeps the owner's option open at the cost of one environment variable.

**Rejected: leaving the Vercel cron entry in place and relying on the 403.**
Rejected because a scheduled job that 403s every 15 minutes trains operators to
ignore it. With the entry removed, scheduling it is a deliberate act that
pairs with setting the variable.

**Trade-off accepted, and a known weakness.** The gate is at the **route**, not
in `runSimulation`. **Verified** 2026-10-15 that `runSimulation`
(`simulation-engine.ts:394`) has exactly one caller in `src/`
(`simulate-donations/route.ts:95`), so today the gate is in fact ahead of every
write path — but a second caller added later would not inherit it. The
structurally safer placement is inside `commitSeedDonation`
(`simulation-engine.ts:274`), which is where the rows are actually written. This
is the same argument §3 makes about guards belonging in the shared writer, and
it is not yet applied here.

**Also decided in `df87a9b`: fabricated rows leave Stripe's identifier
namespace.** Seed donations now use `seed_<uuid>`
(`generateSeedPaymentId`, `simulation-engine.ts:358-369`) instead of `pi_` plus
24 random alphanumerics. `donations.stripe_payment_id` carries the UNIQUE index
that `CLAUDE.md` names as the only replay protection against duplicate Stripe
webhooks, and `payment-service.ts` relies on it through
`onConflictDoNothing({ target: stripePaymentId })` — so a fabricated id inside
Stripe's namespace could collide with a real PaymentIntent and make that
`onConflictDoNothing` **silently swallow a real donation**, leaving Stripe
holding the money and the database holding no row. The prefix also makes seed
rows greppable (`LIKE 'seed_%'`), which the purge and launch-gate options in
`docs/33` §6 need. `scripts/seed-new-campaign-donations.ts` was marked
⛔ DO NOT RUN with the same reasoning plus the forged-attribution defect from
`docs/36` (`scripts/seed-new-campaign-donations.ts:1-40`).

---

## 5. Outbound mail is consent-gated and carries a real sender identity

`docs/32` §7a owns the decision to consolidate newsletter unsubscribe tokens
into one module. This section covers the send-side decisions only.

### 5.1 No postal address, no newsletter run

**Decided.** `MAILING_POSTAL_ADDRESS` has **no default**, and the newsletter
cron skips the entire run when it is unset — before generating content, before
selecting recipients, before any send
(`src/app/api/v1/cron/send-newsletter/route.ts:54-67`; the reader is
`mailingPostalAddress()` at `src/lib/unsubscribe-tokens.ts:46`, with the refusal
reason at `:51`). The skip writes an audit row at severity `warning` and returns
200 with `{ skipped: true, sent: 0, reason }`. The bulk-email path omits the
address line entirely rather than substituting anything
(`src/app/api/v1/admin/bulk-emails/[id]/send/route.ts:285-294`).

**Why.** The footer previously hardcoded `1234 Main St, Suite 100, Washington,
DC 20001` (**verified** in the `224e069` diff of `send-newsletter/route.ts`) and
presented it as the sender's address. Under `CLAUDE.md`'s rule that trust copy is
a factual assertion, a placeholder address is not a formatting detail: it is an
affirmative false statement about who is sending the mail, in the one field a
recipient or a regulator would use to find the sender.

**Legal basis, cited and dated.**

- **15 U.S.C. §7704(a)(5)(A)(iii)** requires that a commercial electronic mail
  message include "a valid physical postal address of the sender" (clause
  quoted; read 2026-10-15 at `law.cornell.edu/uscode/text/15/7704`). This is the
  requirement the gate implements, and the citation in the code
  (`unsubscribe-tokens.ts:51-71`) is correct.
- **Correction to the `224e069` commit message**, which says a send without a
  postal address "violates CAN-SPAM 16 CFR 316". The address requirement is
  **statutory**, not in the FTC rule. 16 CFR Part 316 contains §316.1 Scope,
  §316.2 Definitions, §316.3 Primary purpose, §316.4 warning labels for
  sexually oriented material, §316.5 "Prohibition on charging a fee or imposing
  other requirements on recipients who wish to opt out", §316.6 Severability
  (section titles read 2026-10-15 at `law.cornell.edu/cfr/text/16/part-316`).
  Cite §7704(a)(5)(A)(iii) for the address.
- **Second correction.** `unsubscribe-tokens.ts:111` describes a 400 on an
  already-mailed one-click link as "a CAN-SPAM §316.5 defect". §316.5 is about
  **fees and conditions** imposed on opting out; the opt-out *mechanism*
  requirements are statutory, at §7704(a)(3) (a functioning internet-based
  opt-out mechanism, clearly and conspicuously displayed, capable of receiving
  requests for at least 30 days after sending) and §7704(a)(4) (no covered
  message more than 10 business days after an opt-out request). The code's
  conclusion — that breaking live unsubscribe links is a compliance defect and
  not cosmetic — stands; the subsection pointer does not. §316.5's body text was
  not read in this session, only its title, so the claim that it does not reach
  broken links is **assumed**.
- **Whether these messages are "commercial electronic mail messages" at all is
  ASSUMED, not asserted.** The statute distinguishes commercial messages from
  transactional or relationship messages, and 16 CFR §316.3 governs the
  primary-purpose test; neither §7702's definitions nor §316.3's text was read
  here. The controls are built to be correct under the stricter reading. This
  document does not state that the platform is or is not CAN-SPAM compliant —
  that is a legal conclusion the project cannot substantiate, and `CLAUDE.md`
  forbids asserting it. What is verifiable is narrower and is what is claimed:
  the newsletter and bulk paths now carry a configured sender postal address and
  a working one-click opt-out, or they do not send.

**Rejected: send without the address.** It is the behaviour that existed before
the hardcoded placeholder and the one an "it is only the footer" reading
suggests. Rejected: the address is a required element of the message under the
stricter reading, and the decision not to ship it cannot be made per-send by
whoever is deploying.

**Rejected: a placeholder address, or `NEXT_PUBLIC_APP_URL` as a stand-in.**
This is what the code did. A false postal address is worse than none: it is a
specific, checkable, untrue claim about the operator, and it would make the
platform's own compliance footer the least trustworthy text on the page. Same
call as the 501(c)(3) disclaimer removed in `13a2726`.

**Rejected: refuse per-message rather than per-run.** The cron would then send
nothing while reporting a per-recipient failure count, and the audit row would
not say why. Skipping the run and recording the single reason is the legible
failure.

**Trade-off accepted.** An operator who forgets the variable gets no newsletter
and a 200 response; only the audit row and the server log say why. This is a
deliberately quiet failure on a weekly job (`vercel.json`: `0 14 * * 4`), and
the mitigation is documentation (`.env.example:138-141`, added in `685d0cf`)
rather than code. Contrast §4, where the same class of misconfiguration answers
403.

### 5.2 One-click unsubscribe by signed token, not a logged-in preference page

**Scope note.** This covers the **newsletter and bulk-admin** send paths only.
Campaign-update footer links, and which module owns which token format, are
decided in `docs/40`; the module consolidation itself is `docs/32` §7a. Read
those before changing anything about token shape.

**Decided.** Every bulk and newsletter message carries RFC 8058 one-click
headers — `List-Unsubscribe: <https URL>` plus
`List-Unsubscribe-Post: List-Unsubscribe=One-Click`
(`unsubscribe-tokens.ts:157-165`, used at `send-newsletter/route.ts:162-165`,
`bulk-emails/[id]/send/route.ts:202`, and
`src/app/api/v1/newsletter/subscribe/route.ts:69,80`) — and the URL carries an
HMAC-SHA256 token over the `newsletter_subscribers.id`
(`unsubscribe-tokens.ts:74-87`). No login, no account, no session. When no
subscriber row exists for the address the mechanism degrades to a `mailto:` to
the published support mailbox and the one-click header is **not** advertised,
because a mail client must not POST to a `mailto:`
(`unsubscribe-tokens.ts:140-155`).

**RFC 8058, cited and dated.** "Signaling One-Click Functionality for List Email
Headers", January 2017, read 2026-10-15 at `rfc-editor.org/rfc/rfc8058.txt`. The
spec: the `List-Unsubscribe-Post` value is the literal
`List-Unsubscribe=One-Click`; the receiver performs an HTTPS POST to the URI in
`List-Unsubscribe`; "The URI SHOULD include an opaque identifier or another
hard-to-forge component" and "The server handling the unsubscription SHOULD
verify that the opaque or hard-to-forge component is valid"; the POST must not
carry cookies or HTTP authorization; the sender must not answer with a redirect.
The signed token is what satisfies the hard-to-forge requirement and the
no-cookies constraint simultaneously: it is the only way the endpoint can
identify the recipient when the request arrives with no session.

**Assumed, not verified:** RFC 8058 also requires the message to carry a valid
DKIM signature covering both headers. Whether the Resend sending domain's DKIM
signature covers `List-Unsubscribe` and `List-Unsubscribe-Post` is a DNS and
provider configuration question that cannot be answered from this repository.
What would verify it: inspect the `DKIM-Signature` `h=` tag on a delivered
message from each send path.

**Rejected: a logged-in preference page.** The platform has one
(`AccountPageClient` preferences, `src/components/user/AccountPageClient.tsx`),
and it is not an opt-out mechanism for this audience. Most bulk recipients are
**guest donors with no account at all** (the `guest_donors` filter exists
precisely because `donations.userId IS NULL` is common), so "sign in to
unsubscribe" is not a mechanism they can use. It also fails RFC 8058 directly:
the one-click POST arrives with no cookies by specification, so a
session-gated endpoint cannot honour it.

**Rejected: an unsigned `?email=` link.** Trivially forgeable, which makes the
endpoint a tool for unsubscribing other people, and it is exactly what RFC 8058
tells senders to avoid.

**Rejected: expiring or single-use tokens.** An unsubscribe link that stops
working is itself the compliance defect — §7704(a)(3)'s mechanism must keep
working for at least 30 days after the message is sent, and mail sits in inboxes
far longer. Single-use redemption state also needs a schema change. Replay is
harmless because the operation is idempotent and terminal
(`unsubscribe-tokens.ts:37-41`).

**Rejected: reusing `NEXTAUTH_SECRET` as the signing key.**
`NEWSLETTER_UNSUBSCRIBE_SECRET` is required with no fallback
(`unsubscribe-tokens.ts:74-80`): reusing the session secret for a public,
never-expiring, emailed token widens its blast radius for no benefit.

**Trade-off accepted.** A mail client that prefetches the link can unsubscribe
someone who never clicked (already recorded as the trade-off in `docs/32` §7,
which notes the endpoint performs the action on `GET`). Fail-quiet is the safe
direction for a consent flow.

### 5.3 Bulk recipients are filtered on stored consent, and the broadest audience needs explicit confirmation

**Decided.** `resolveBulkEmailRecipients`
(`src/lib/bulk-email-recipients.ts:229`) is the single predicate used by both
the create-time preview count (`src/app/api/v1/admin/bulk-emails/route.ts:99`)
and the send (`bulk-emails/[id]/send/route.ts:163`), and every resolution passes
through `filterOptedOut` (`bulk-email-recipients.ts:161-221`), which drops
anyone opted out via any of the three sources the platform actually holds:

1. `newsletter_subscribers.unsubscribed_at` — the global opt-out, and the only
   one that works for guest donors;
2. `donor_campaign_subscriptions.subscribed = false` — per-campaign, applicable
   only to a campaign-scoped send;
3. `users.preferences` — `emailNotifications === false` or
   `emailCampaignUpdates === false`.

**Why.** The send route previously applied a *fixed* predicate ("every real,
un-refunded donation, optionally scoped to a campaign") that consulted **none**
of those sources, so the only question asked about a recipient was whether an
email address existed for them. And because `campaignId` is optional on a draft,
one POST on an unscoped draft mailed **every donor who had ever donated**
(`bulk-email-recipients.ts:4-14`, which records this as the audit P0). The
confirmation dialog's "Send to N recipients" came from a *different* predicate
again, so the number an admin confirmed was unrelated to who received the mail.

**The broadest audience now requires an explicit second act.** An unscoped draft
is refused unless the request body carries `confirmAllDonors: true`
(`bulk-emails/[id]/send/route.ts:132-137`), and both the create and send paths
enforce a hard ceiling, `BULK_EMAIL_MAX_RECIPIENTS` with a default of 5,000
(`bulk-email-recipients.ts:47-52`; enforced at `bulk-emails/route.ts:101-107`
and `send/route.ts:166-172`). `subscribed_donors` without a campaign resolves to
nobody rather than silently widening (`bulk-email-recipients.ts:72-74`).

**Rejected: "has an email address" as the predicate.** It was the behaviour.
Under the stricter reading of §7704(a)(4) a send to someone who has opted out is
the violation the opt-out mechanism exists to prevent, and GDPR Art. 7(3)
provides that "The data subject shall have the right to withdraw his or her
consent at any time" (quoted; read 2026-10-15 at `gdpr-info.eu/art-7-gdpr/`) —
a withdrawal that the sending path does not read is not a withdrawal. **Assumed,
from memory and not re-verified in this session:** the final sentence of Art.
7(3), that it shall be as easy to withdraw consent as to give it. **Assumed:**
that GDPR applies to this platform's recipients at all, which depends on where
they are and is not a question this repository answers.

**Rejected: suppress only on `newsletter_subscribers`.** Simplest, one query.
Rejected: it ignores the per-campaign opt-out that the campaign subscribe flow
writes and the account-level preference the UI presents, so two of the three
opt-outs the platform offers would have been decorative.

**Rejected: a confirmation dialog alone for the all-donors case.** The dialog
existed and showed a count from the wrong predicate. The gate is server-side and
the count is now computed by the same function that resolves the send, so the UI
cannot be the only thing standing between a click and the whole donor base.

**Trade-offs accepted.**

- **`users.preferences` is consulted only for addresses that match a user row.**
  Guest donors have no preferences, so their only opt-out is the newsletter row
  or the per-campaign flag. That is a property of the data model, not of this
  change.
- **The campaign-updates preference is honoured only for the update and
  thank-you digests** (`src/lib/notifications.ts:1356,1401`, via
  `getSubscribedDonors(..., { respectCampaignUpdatesPreference: true })` at
  `:381`). Campaign *status* changes (paused, suspended, resumed) are not
  suppressed by it, because they concern money the donor has already given.
- **`emailNewCampaigns` was removed from the preferences schema rather than
  wired up** (`src/lib/validators/user.ts:64-77`): it was written by the UI and
  read nowhere, and nothing in `src/` sends a new-campaign alert. A toggle that
  records a consent decision the platform cannot act on is worse than no toggle.
  `emailNotifications` was added in the same change because the opposite had
  happened: `notifications.ts` read it as the sole gate on roughly twenty
  transactional emails while the schema stripped it, so no user could turn it
  off.
- **Account deletion does not clear the newsletter list.** The `224e069` commit
  message says deletion "clears the address from mailing state in the same
  transaction … (GDPR Art. 7(3) withdrawal and Art. 17 erasure)". **That claim
  is not supported by the code.** Verified 2026-10-15: the DELETE transaction
  (`src/app/api/v1/users/me/route.ts:127-175`) anonymises donations, nulls four
  foreign keys, deletes the `users` row and writes an audit row; it does not
  touch `newsletter_subscribers`, and no write to that table appears anywhere in
  `224e069` outside the subscribe route. Consequences, verified by reading the
  queries: a surviving `newsletter_subscribers` row with `unsubscribed_at IS
  NULL` still receives the weekly newsletter
  (`send-newsletter/route.ts:95-96,133-135`); and because deleted users'
  donations are rewritten to `deleted@lastdonor.org`, that address becomes a
  bulk-email candidate with no opt-out row behind it. Both are open defects, not
  decisions. GDPR Art. 17 (right to erasure) is the relevant provision and the
  deletion flow is otherwise built for it; this specific gap means the erasure is
  incomplete for mailing state.

---

## 6. The bulk-email recipient filter is persisted in `audit_logs.details`, not in a new column

**Decided.** The `recipientFilter` an admin chooses at draft time is written
into `audit_logs.details` on the `bulk_email.created` row
(`src/app/api/v1/admin/bulk-emails/route.ts:118-131`) and read back at send time
by `loadPersistedRecipientFilter` (`src/lib/bulk-email-recipients.ts:256-269`),
which selects the most recent `bulk_email.created` row for that target id. When
no usable value is recovered the send is **refused**, not defaulted
(`bulk-emails/[id]/send/route.ts:146-158`).

**Why there is anywhere to put it at all.** `bulk_emails` has no
`recipient_filter` column (**verified**: `src/db/schema.ts` has no such field,
and the create route writes only `templateName`, `subject`, `bodyHtml`,
`recipientCount`, `campaignId`), so before this change the admin's choice was
used for a preview count and then discarded. The send then applied its own fixed
predicate. Two sends of the same draft could reach two different audiences, and
neither matched the number the admin confirmed.

**Why not a column, stated honestly.** The code comments justify it as
"migrations are frozen — CLAUDE.md"
(`bulk-email-recipients.ts:24-28`, `bulk-emails/route.ts:118-122`,
`bulk-emails/[id]/send/route.ts:140-144`). **That premise is stale.**
`docs/34` §6 records that as of 2026-10-14 `npm run db:generate` and
`npm run db:migrate` are both safe again, and `CLAUDE.md` now says so in the
commands table and in the migrations convention: future schema changes follow
the normal flow of editing `schema.ts`, generating, reviewing the SQL and
deploying, with new migrations going to `src/db/migrations-v2/`. So the accurate
reason this is not a column is narrower and worth writing down rather than
inheriting: at the time this change was made the baseline had been validated but
not yet applied to any database (`docs/34` §4, §5), and the branch's other work
was not shipping a schema change, so adding the project's first incremental
migration on top of an unapplied baseline would have coupled an email bug fix to
the migration path's first real exercise. That is a reasonable call for one
release and a bad one to leave standing.

**Rejected: default the filter at send time** (for example to `all_donors`, or
to "campaign-scoped if a campaign is set"). Rejected: this is precisely the
defect. A guessed default is what let one POST reach the entire donor base, and
a default is indistinguishable from a recovered value in the audit trail
afterwards.

**Rejected: require the client to resend the filter on every send.** The route
does accept an explicit `recipientFilter` in the body as a recovery path
(`send/route.ts:145-149`), but making it the only mechanism moves the record of
what an admin chose from the server to whatever the browser happens to still
have, and a stale tab would then silently redefine the audience.

**Rejected: `bulk_emails.template_name` or the body HTML as a proxy.** They do
not encode the audience.

**Trade-off accepted, and the failure mode.** `audit_logs` is an append-only
event log, not a durable attribute store, and this makes one of its rows
load-bearing for a future write. If the `bulk_email.created` row is lost or
pruned, the draft becomes **unsendable through the UI**: the send answers 400
`VALIDATION_ERROR` and the admin must re-create the draft, or re-send with an
explicit filter. (`BulkEmailDashboard.tsx` detects that message by regex and
offers a filter picker, which is itself a symptom: there is no distinct error
code for it.) **Verified** 2026-10-15 that nothing in `src/` or `scripts/`
deletes from `audit_logs` today, so no pruning exists yet; `docs/06`
(line 341) states a one-year retention for authentication events, so a retention
job is contemplated and would introduce exactly this failure. Also verified: the
lookup is `eventType = 'bulk_email.created' AND targetId = <id>` ordered by
timestamp, so it depends on that event type string never being renamed.

**Known debt, and the migration that retires it.** Add
`recipient_filter` to the `bulkEmails` table in `src/db/schema.ts` as a
not-null-with-default enum or text column, run `npm run db:generate` so the
incremental migration lands in `src/db/migrations-v2/` (never in
`src/db/migrations/` — `docs/34` §2), backfill from
`audit_logs.details->>'recipientFilter'` for existing drafts, then delete
`loadPersistedRecipientFilter` and the body-level `recipientFilter` recovery
path. Until then the audit write at `bulk-emails/route.ts:124-131` is
**load-bearing, not decorative**, and must not be moved, renamed or made
conditional.

---

## 7. Auth: origin comparison for redirects, and reset tokens kept out of Sentry

**Scope note.** The anti-enumeration half of commits `2b9ea44` and `9a14dc6` —
the uniform 201 on a duplicate registration, the unconditional bcrypt, the decoy
hash, the collapse of the login error codes, and the page-level leak that
survived the route fix — is **owned by `docs/39`**, which covers it in more
detail than this section would. It is not restated here. This section records
only the two decisions `docs/39` does not cover: the open-redirect defence and
the Sentry scrubbing. For the login-page copy decisions that follow from the
collapsed error codes, see `docs/32` §8 and `docs/39`.

### 7.1 Open redirect: compare origins with the WHATWG URL parser

**Decided.** `safeCallbackUrl` resolves the candidate against this origin and
compares origins, returning `/dashboard` on any mismatch or parse failure
(`src/app/login/page.tsx:38-51` and `src/app/register/page.tsx:54-67`, kept
byte-identical). Server-side, where there is no `window`, it resolves against
the reserved sentinel origin `https://ssr.invalid`, which still resolves relative
paths identically while rejecting anything carrying an authority. Only
`pathname + search + hash` is returned, so a successful parse cannot smuggle an
origin through.

**Why prefix checks fail, verified independently.** The previous guard was
`if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard'`. The
payload `/\evil.com` satisfies both tests. Run in this environment on
2026-10-15:

```
$ node -e 'console.log(new URL("/\\evil.com","https://lastdonor.org/login").href)'
https://evil.com/
```

and the new check rejects it (`new URL("/\\evil.com","https://ssr.invalid").origin`
is `https://evil.com`, so the origin comparison fails). The attack is credential
phishing with the platform's own domain as the lure: the victim is sent to
`https://lastdonor.org/login?callbackUrl=/\evil.com`, sees the genuine login page
on the genuine domain, types real credentials and is navigated cross-origin to
an attacker clone. The commit message for `2b9ea44` cites Next's App Router
`isExternalURL` as an origin comparison (`app-router.js:59-61`), i.e. the router
will genuinely leave the site for this value; **that specific line reference was
not re-verified here** and is **assumed**. The browser-side normalisation of `\`
to `/`, which is what makes the payload work at all, is verified above
independently of the router.

**Rejected: `startsWith('/')` plus a `//` test.** The shipped code. It is a
character-prefix test standing in for a URL question, and it misses `/\`,
`/\\`, and anything else the parser normalises. The commit message also records
that `docs/audit-2026-10-14/03` rated this finding Low/PLAUSIBLE on the
reasoning that `router.push` treats the value as an in-app path, and asks for it
to be re-rated CONFIRMED. This document concurs: the payload is verified above.

**Rejected: an allowlist of permitted callback paths.** Safe, and it would also
pin the redirect surface. Rejected as disproportionate: the set of legitimate
in-app destinations is every authenticated route, including dynamic ones, so the
allowlist would have to be a pattern list maintained forever, and the origin
comparison already answers the only question being asked.

**Rejected: tests that assert the source text contains the guard.** Four such
tests existed and are **why this shipped**: they asserted the presence of
`startsWith('/')` and `startsWith('//')` in the source, which `/\evil.com`
satisfies. They were replaced with behavioural tests that lift the real function
out of each page, compile it, and run 11 off-origin payloads through it, each
payload first re-asserted to be genuinely off-origin so the test cannot go
vacuous (`src/lib/validators/instant-live-architecture.test.ts`). The general
rule: a security test that reads the implementation instead of running it
asserts the author's intent, not the behaviour.

**Also decided: the callback target keeps its query string.** Middleware now
builds `pathname + search` (`src/middleware.ts:223-228`), so a filtered
dashboard view returns filtered, and the header sign-in link carries the current
path and query (`src/components/layout/Navbar.tsx:61-91`). `SignInLink` reads
`useSearchParams`, so every call site wraps it in `Suspense` or Next cannot
statically prerender any page embedding the navbar — recorded at
`Navbar.tsx:73-78` because a future reader removing the boundary would break
prerendering, not the link.

### 7.2 Anti-enumeration: see docs/39 and docs/32 §8

The uniform-response design for registration (identical 201 and body shape on a
duplicate address, a fresh UUID instead of the existing user's id, the HIBP
check and `hashPassword` both run **before** the existence lookup so that
neither the outcome nor the latency depends on whether the address is taken,
and the `DECOY_PASSWORD_HASH` counterpart in `authorize()` at
`src/lib/auth.ts:111-112,335`) is **recorded in `docs/39`**, together with the
page-level leak that survived the route fix and the alternatives weighed.
`docs/32` §8 records the earlier login-side collapse of four error codes into one
`invalid_credentials`, whose dead error UI commit `2b9ea44` finally fixed
(`src/app/login/page.tsx:59-88,122-135`). Neither is restated here.

**Three verified items from `9a14dc6` that neither document covers**, recorded so
they are not lost between the two:

- **A password reset now clears the lockout counters in the same `UPDATE`**
  (`src/app/api/v1/auth/reset-password/route.ts:92-99`). `authorize()` checks the
  lockout *before* verifying the password and only a successful sign-in cleared
  it, so a user who tripped the 5-attempt lockout and then reset their password
  was still refused with the new one until the 15-minute window aged out.
  Proving control of the mailbox is stronger evidence of ownership than a
  password, so there is no security argument for keeping the lock on.
- **An orphaned but valid reset token is burned and answered byte-identically to
  an unknown token** (`:101-118`). `verification_tokens` has no foreign key to
  `users`, so a token can outlive its user; the endpoint previously reported
  "Password has been reset successfully" having updated zero rows, and a
  *distinct* error here would have reported "this address had an account and no
  longer does".
- **The admin security-question route now uses `verifyPassword`** rather than
  `bcrypt.compare` against a peppered hash — a comparison that could only ever
  return false, so a correct password was always rejected.

### 7.3 Reset tokens must never reach Sentry

**Decided.** `src/instrumentation-client.ts` installs `beforeSend`,
`beforeSendTransaction` and `beforeBreadcrumb` hooks that redact the values of
the `token` and `email` query parameters from every outgoing payload: request
URL, `query_string`, request headers (so `Referer`), request data, transaction
name, message, breadcrumbs, `contexts.trace.data`, tags, extras and exception
values (`scrubSensitiveUrl`, `scrubSentryEvent`, `scrubSentryBreadcrumb`, and the
`Sentry.init` wiring at the end of the file). The matcher is deliberately
string-based rather than `new URL()`, because these values also appear in
relative paths, `Referer` headers, bare query strings with no leading `?`, and
free-text error messages. The leading `(^|[?&#])` is what keeps `csrf_token=`
and `mytoken=` out of scope. The reset layout is also now `robots: { index:
false, follow: false }` (`src/app/login/reset-password/layout.tsx:12-18`), the
only auth layout that lacked it.

**Why.** `/login/reset-password?token=…&email=…` carries a working
account-takeover credential valid for one hour, and the Sentry browser SDK
attaches `window.location.href` to events and navigation breadcrumbs. This
client runs with `tracesSampleRate: 0.1` and `replaysOnErrorSampleRate: 1.0`, so
roughly a tenth of reset-page loads and all of those that threw were uploading a
live credential to a third-party event store readable by more people than can
read the user's mailbox.

**Rejected: scrubbing server-side only, or relying on Sentry's data-scrubbing
settings.** The leak is in the browser SDK's own default enrichment, so the only
place to stop it before it leaves the device is these hooks. A server-side or
project-side setting would also be invisible to anyone reading this repository.

**Rejected: moving the token out of the URL in this change.** It is the real
fix — a POST body or a one-time-exchange cookie removes the class of problem
rather than mitigating it — and it is recorded as the follow-up at
`src/app/api/v1/auth/forgot-password/route.ts:66-85`, because it needs the reset
page changed too.

**Residual, recorded in the file and repeated here because it is not fixed:**
Session Replay ships its own envelope, which `beforeSend` does not pass through.
`beforeBreadcrumb` covers the navigation breadcrumbs replay reuses, but a
complete fix needs `replayIntegration({ beforeAddRecordingEvent })` or excluding
`/login/reset-password` from replay entirely. Until then, a replay of a reset
page may still carry the URL.

---

## 8. A volume limit is a rate limit, not a server error

**Commit `c2aa51c`** (drafted here while it was still uncommitted; lines
re-checked against the committed file).

**Decided.** A `VOLUME_LIMIT` outcome from the publisher is answered **429**
with the `ApiError` code `RATE_LIMITED`, handled ahead of the generic status
mapping (`:68-87`). The message is the publisher's own text (which already
carries the limit and the current count, formatted by `volume-guards.ts`) plus a
`GUARD_RESET_HINT` sentence per guard (`:17-24`) saying whether waiting helps.

**Why.** There was no arm for this code, so it fell through
`statusMap[result.error.code] ?? 500` to **500 INTERNAL_ERROR** — telling an
admin the server had crashed when they had merely hit the daily cap. The daily
limit, `simulation.max_concurrent` and the phase-out floor are settings working
as configured; a settings-driven refusal is not a fault.

**The shared error union was deliberately not widened.** `RATE_LIMITED` already
exists in the `ApiError` code union (`src/types/api.ts:19`) and
`src/lib/errors.ts:23` already pairs it with status 429 and a default message —
**both verified** 2026-10-15. So this is a mapping decision inside one route, not
a change to the platform's error contract, and no other consumer of `ApiError`
has to learn a new code.

**Rejected: a new `VOLUME_LIMIT` member of the `ApiError` union.** More precise
for this one caller, at the cost of a public error code every client and every
`switch` over `ApiError` would have to handle, for a condition that already has a
standard HTTP status and an existing code with the same meaning.

**Rejected: 200 with a `skipped` marker.** It is the right answer for a cron
(see `docs/32` §9 on held locks), and the wrong one for a synchronous admin
click: the admin asked for a campaign and did not get one, so the response must
not be a success.

**Rejected: 409 CONFLICT or 422.** Neither carries "try later", and neither can
carry `Retry-After` meaningfully.

**`Retry-After` is sent only for `daily_limit`** (`:79-86`), computed as the
seconds to the next 00:00 UTC (`secondsUntilUtcMidnight`, `:27-31`), because the
daily counter's reset is a knowable instant: the guard counts automated campaigns
with `published_at >= start of UTC day` (`volume-guards.ts:103-116`). For
`max_concurrent` and `phase_out` the header is **omitted**, because there is no
knowable reset time — a slot frees when an active simulated campaign completes
or is closed, and the phase-out floor lifts only when fewer real campaigns are
active or an operator changes the settings. A fabricated number is worse than
none: a client would back off for exactly as long as the invented value and then
retry into the same refusal, and `Retry-After` is a statement about when the
condition clears. The hint sentences carry the same information in prose
instead, which is honest about being qualitative.

**Residual risk, flagged by the implementer and verified here.** `statusMap`
(`:89-97`) still has no `VOLUME_LIMIT` key. The early return at `:68` is the only
thing preventing the `?? 500` fallback at `:114`, so deleting or reordering that
branch silently restores the original defect with no type error. Adding
`VOLUME_LIMIT: 429` to `statusMap` as a belt-and-braces default would remove the
coupling; it was not done, because the response also needs the hint and the
conditional header, which the generic path cannot produce.

---

## 9. A rate-limited batch item must not abort the batch (reverses the rationale in the previous comment)

**Commit `c2aa51c`**, the same commit as §8 (drafted here while it was still
uncommitted; lines re-checked against the committed file).

**Decided.** When a volume guard refuses an item, the batch **records it and
continues** (`:89-103`). Refusals go into a separate `rateLimited: string[]`
(`:66`) and a `volumeLimited` counter; `errors` holds only real failures, so the
audit row stays at severity `info` on a rate-limited run
(`:115-125`) and both arrays are returned to the caller (`:127-135`).

**This reverses a rationale recorded in the code it replaces.** The version
committed in `df87a9b` pushed the refusal into `errors` and then `break`-ed, with
the comment: "Recorded, and the batch stops: every remaining item would hit the
same guard, and re-asking is three more aggregate queries each." Per `CLAUDE.md`,
the reversal is stated here rather than left as two contradicting rationales on
disk:

- **The cost argument was right about the price and wrong about the value.**
  Three aggregate queries per remaining item is correct (§3), but the guards run
  at step 1b of `publishCampaignFromNewsItem`
  (`src/lib/news/campaign-publisher.ts:124-144`) — before the article-body fetch
  and before every AI call — so each remaining item costs those three queries and
  **zero AI spend**. With `MAX_PER_RUN = 5` the worst case is twelve extra
  aggregate queries per run. That is not a cost worth dropping the tail of the
  batch for.
- **"Every remaining item would hit the same guard" is not true for all three
  guards.** `max_concurrent` counts campaigns currently `active` or
  `last_donor_zone` (`volume-guards.ts:131-139`), and
  `/api/v1/cron/update-phases` runs every 5 minutes per `vercel.json`, so a slot
  can free up **during** a run. A `break` can never notice that; re-asking can.
  For `daily_limit` and `phase_out` the original reasoning holds within a single
  run, and the cost of being wrong is the twelve queries above.
- **The audit severity was the louder defect.** For a job that runs every 30
  minutes against a daily limit, hitting the limit is the *expected steady
  state*, not a fault. Putting it in `errors` flipped the audit row to
  `severity: 'warning'` on every rate-limited run, which trains operators to
  ignore the warning that is supposed to mean something went wrong, and makes the
  real `errors` entries harder to find.
- **Dropping the tail silently loses information.** With the `break`, the
  candidates after the refusal got no outcome at all: not published, not
  rate-limited, not errored, just absent from a summary that still reported
  `qualifiedItems: 5`. Every candidate now gets an outcome.

**Rejected: keep the `break` but classify the refusal as non-error.** It fixes
the audit severity and keeps the cheap exit, and it is the minimal change.
Rejected for the two substantive reasons above: a `max_concurrent` slot freeing
mid-run is unobservable to it, and the tail still has no outcome.

**Rejected: `continue` but stop after N consecutive refusals.** A tunable with no
principled value, for a loop bounded at five items.

**Trade-off accepted.** A run that is fully rate-limited now performs up to five
guard evaluations (fifteen aggregate queries) and publishes nothing, where the
`break` version performed one and published nothing. In exchange the audit row
tells the truth about severity, the summary accounts for every candidate, and a
slot freeing mid-run is used. The §8 route and this one now diverge in shape on
purpose: a synchronous admin request answers 429 for the one item it was asked
about, while a batch job reports per-item outcomes and keeps going.

---

## 10. An unsubstantiated refund guarantee was removed rather than substantiated

**Decided.** Commit `17f20f8`. `FundraiserPreviewModal` promised prospective
organisers "We guarantee a full refund for up to a year in the unlikely event
that something goes wrong", linking to `/trust`. The claim is **removed** and the
copy now states the real policy and links to the page that exists
(`src/app/share-your-story/FundraiserPreviewModal.tsx:251-259`).

**Why.** Two verified facts, both checked on 2026-10-15:

- **`/trust` does not exist.** There is no `src/app/trust` directory, so the only
  substantiation the modal offered was a 404. (Verified: `ls src/app/trust` →
  no such file or directory; no reference to `/trust` remains anywhere in
  `src/`.)
- **The real policy is materially narrower.** `src/app/refund-policy/page.tsx`
  states that "Donations are generally final after processing" with refunds
  reviewed in six enumerated situations (`:56-73`), and that a request should be
  emailed "within 30 days of the donation when possible", is usually reviewed
  within 5 business days, and is refunded only "If approved" (`:89-99`). It also
  lists four situations where refunds may not be available (`:102-112`),
  including a donor changing their mind after funds have been released. An
  unconditional one-year guarantee is not that policy.

Per `CLAUDE.md`, trust copy is a factual assertion, not microcopy, so the claim
goes rather than the link getting fixed — the same call made for the 501(c)(3)
disclaimer removed in `13a2726`.

**Rejected: create a `/trust` page so the link resolves.** It is the smaller
diff and it would have made the audit finding disappear. Rejected because it
substantiates nothing: writing a page that repeats the guarantee does not create
the guarantee. An unconditional one-year refund commitment is a business and
financial decision — it binds the platform's own funds after money has been
released to a creator — and it needs a policy change and an owner, not a copy
edit. If the guarantee is wanted, the order is: decide it, write the policy,
then write the page, then make the claim.

**Rejected: soften the claim to "refunds may be available for up to a year".**
Still a one-year window the policy does not offer, and a hedged false claim is
harder to audit than a plain one.

**Minor precision note.** The replacement copy says requests are "reviewed case
by case". `refund-policy` does not use that phrase; it enumerates qualifying
situations and says refunds are issued "If approved". "Case by case" is a fair
paraphrase of an enumerate-then-approve policy and is **not** a quotation of it.
Noted so nobody later treats the modal's wording as the authoritative phrasing.

**Also in `17f20f8`: the dashboard "Help Center" link.** It pointed at `/help`,
which has never existed, so every signed-in user clicking help in their dashboard
got a 404. It now offers `/donor-faq` (a real page) and the support mailbox
already published in `/refund-policy`
(`src/components/dashboard/DashboardSidebar.tsx:239-256`), with a comment telling
future editors not to reinstate a link to a page that is not in `src/app`.

**Dead-link audit.** The commit records that all 29 distinct static internal
hrefs under `src/app` and `src/components` were audited and that `/trust` and
`/help` were the only two resolving to no page. **Independently verified
2026-10-15 by a different method**: extracting static `href="/…"` literals from
`.tsx` files under those directories and resolving each against `src/app` found
26 distinct literals and **no** dead link remaining — the single apparent miss
was the string `/help` inside the explanatory comment quoted above. The
conclusion (no dead static internal links remain) is verified; the figure **29**
is **assumed**, since my extraction excluded `.ts` files, template literals and
paths deeper than two segments and so counts differently.

---

## 11. Index of claims marked assumed

Everything below is explicitly *not* verified in this document. Each entry says
what would settle it.

1. **§5.1 — 16 CFR §316.5 does not reach broken unsubscribe links.** Only the
   section *title* was read (`law.cornell.edu/cfr/text/16/part-316`,
   2026-10-15). Settle by reading §316.5's body text in the eCFR.
2. **§5.1 — that these messages are "commercial electronic mail messages" under
   CAN-SPAM at all.** Neither 15 U.S.C. §7702's definitions nor 16 CFR §316.3's
   primary-purpose test was read. Settle with counsel, or at minimum by reading
   both and classifying each send path (newsletter, bulk admin email,
   transactional notification) separately.
3. **§5.1 — the §7704(a)(3) 30-day mechanism-availability and §7704(a)(4)
   10-business-day figures.** These come from a retrieval tool's paraphrase of
   the Cornell page (2026-10-15), not from a quotation of the statute. Settle by
   reading (a)(3) and (a)(4) directly.
4. **§5.2 — that the Resend sending domain's DKIM signature covers
   `List-Unsubscribe` and `List-Unsubscribe-Post`,** as RFC 8058 requires.
   Settle by inspecting the `DKIM-Signature` `h=` tag on a delivered message
   from each send path.
5. **§5.3 — that GDPR applies to this platform's recipients.** Depends on where
   data subjects are; not answerable from this repository.
6. **§5.3 — the final sentence of GDPR Art. 7(3)** ("as easy to withdraw as to
   give"). Only the first sentence was quoted from `gdpr-info.eu/art-7-gdpr/` on
   2026-10-15. Settle against the Official Journal text of Regulation (EU)
   2016/679.
7. **§7.1 — that Next's App Router performs a genuine cross-origin navigation
   for `/\evil.com` via `isExternalURL` at `app-router.js:59-61`.** The URL
   normalisation is verified here; the router line reference is from the
   `2b9ea44` commit message and was not re-read. Settle by reading that file in
   `node_modules/next` at the installed version, or with a browser test.
8. **§10 — the figure of 29 distinct static internal hrefs.** My independent
   audit used a narrower extraction and found 26. The conclusion that no dead
   static internal link remains is verified; the count is not.

Two further items are **reconstructed rationales**, not assumptions: the
newsletter path's choice of 200-with-skipped over 403 (§4, §5.1), and the absence
of any creator-facing explanation for the gap between displayed raised and
withdrawable balance on a seeded campaign (§2). In both cases the code records
*what* it does and not *why*, and the reasoning given here is this document's,
not the implementer's.
