import 'server-only';
import { and, eq, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { donations } from '@/db/schema';

/**
 * What one person has given, PER CURRENCY.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * `src/app/dashboard/(index)/page.tsx:33` ran
 * `COALESCE(SUM(donations.amount), 0)` filtered by DONOR
 * (`donations.user_id` / `donations.donor_email`) with no currency grouping,
 * and rendered the result through `centsToDollars`, which hardcodes USD. The
 * tile's own subtitle said **"Across all campaigns"** - which is precisely
 * the case where the sum is invalid.
 *
 * CLAUDE.md and `docs/92`: *two currencies are never added together. Where a
 * cross-currency total is wanted, report per currency - never sum.* Adding
 * 100 KES to 100 USD yields 200 of nothing.
 *
 * ⚠️ The SAME shape is CORRECT one file away, and the difference is worth
 * stating so nobody "fixes" it: the admin verification route sums
 * `donations.amount` for ONE campaign, and
 * `donations_campaign_currency_fk FOREIGN KEY (campaign_id, currency)
 * REFERENCES campaigns(id, currency)` [verified against the live schema]
 * makes a campaign single-currency. Per campaign the sum is sound; per DONOR
 * it is not, because one person can give to campaigns in different
 * currencies.
 *
 * ── WHY THIS IS A MODULE AND NOT INLINE ─────────────────────────────────────
 *
 * `docs/107`: a unit test cannot reach a server component's database call, so
 * a query written inline in a page is a query no test runs. This one is
 * executed by `donor-totals.integration.test.ts` against real Postgres.
 */

export interface DonorCurrencyTotal {
  currency: string;
  /** Minor units OF THAT CURRENCY - never "cents" (`docs/92`). */
  totalMinor: number;
  donationCount: number;
}

type Selectable = Pick<typeof db, 'select'>;

/**
 * One row per currency the donor has actually given in, biggest first.
 *
 * Returns `[]` for somebody who has never donated, which is every user on
 * this platform today - so the caller must render nothing rather than a zero
 * in an arbitrary currency.
 *
 * ⚠️ Counts only REAL, un-refunded donations, matching the filter the page
 * used before: seed money is fabricated (`docs/101`) and a refunded donation
 * is not something the donor still gave.
 */
export async function donorTotalsByCurrency(
  client: Selectable,
  userId: string,
  userEmail: string,
): Promise<DonorCurrencyTotal[]> {
  const rows = await client
    .select({
      currency: donations.currency,
      totalMinor: sql<number>`COALESCE(SUM(${donations.amount}), 0)::int`,
      donationCount: sql<number>`count(${donations.id})::int`,
    })
    .from(donations)
    .where(
      and(
        or(eq(donations.userId, userId), eq(donations.donorEmail, userEmail)),
        eq(donations.source, 'real'),
        eq(donations.refunded, false),
      ),
    )
    .groupBy(donations.currency)
    .orderBy(sql`2 desc`);

  return rows.map((r) => ({
    currency: r.currency,
    totalMinor: Number(r.totalMinor),
    donationCount: Number(r.donationCount),
  }));
}
