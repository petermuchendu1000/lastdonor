import { sql, type SQL } from 'drizzle-orm';

import { campaigns, donations } from '@/db/schema';

/**
 * The amount a campaign may be released on full verification.
 *
 * ── WHY THIS IS A MODULE AND NOT A LINE IN THE ROUTE ────────────────────────
 *
 * This is the single most consequential money write in the product: it is what
 * `approve_t2` sets `campaigns.total_released_amount` to, and that column is
 * what `withdraw/route.ts` pays out against. Until `docs/129` **nothing
 * executed it.**
 *
 * `src/app/api/v1/admin/campaigns/[campaignId]/verification/route.test.ts`
 * mocks `@/db` and then re-implements the statement in JavaScript: it
 * regex-matches the SET expression and sums a fake array. So it verifies the
 * expression's SHAPE and the test's own arithmetic - never that Postgres
 * accepts the statement, never that `LEAST` clamps as assumed, never that
 * `campaigns_released_lte_raised` survives it. `docs/124` is the same lesson
 * from the other side: a mock cannot raise what only the database can.
 *
 * ⛔ The route handler cannot be loaded by the node-environment integration
 * suite - it imports NextAuth, which imports `next/server` (`docs/126`). So
 * the expression moves to where a test can run it, which is exactly what
 * `docs/107` did for `report-periods.ts` ("SO THAT A TEST COULD RUN IT") and
 * `docs/126` did for `auth-lockout.ts`.
 *
 * ⚠️ This is a RELOCATION, not a change of semantics. The SQL rendered by this
 * function is asserted byte-for-byte identical to the inline version it
 * replaced, in `release-amount.integration.test.ts`.
 *
 * ── WHAT THE EXPRESSION HAS TO GET RIGHT ────────────────────────────────────
 *
 * ⛔ It must NOT be `campaigns.raised_amount`. That is a BLENDED figure: the
 * simulation engine increments the same column for donations written with
 * `source = 'seed'`, which are fabricated and carry no money. Releasing it
 * meant a campaign showing $40,000 of which $38,000 was seeded released
 * $40,000 of real platform money to the creator (`docs/29` audit P0).
 *
 * ⚠️ The sum is computed INSIDE the UPDATE, so it is evaluated under the same
 * transaction and row lock that sets `verification_status` - never from an
 * earlier unlocked read, which a concurrent donation or refund can already
 * have staled.
 *
 * ⚠️ `LEAST(..., raised_amount)` keeps `campaigns_released_lte_raised`
 * satisfied. A partially-failed bulk refund zeroes `raised_amount` while
 * leaving some donations un-refunded, and an aborted transaction here would
 * leave the verification un-recorded. [VERIFIED against a real Postgres:
 * without the clamp that case violates the CHECK.]
 */
export function releasableAmountSql(campaignId: string): SQL {
  return sql`LEAST((
        SELECT COALESCE(SUM(${donations.amount}), 0)::int
        FROM ${donations}
        WHERE ${donations.campaignId} = ${campaignId}
          AND ${donations.source} = 'real'
          AND ${donations.refunded} = false
      ), ${campaigns.raisedAmount})`;
}
