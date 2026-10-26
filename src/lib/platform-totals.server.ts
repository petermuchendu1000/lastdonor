import 'server-only';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { donations } from '@/db/schema';

/**
 * What the whole platform has raised, PER CURRENCY.
 *
 * ── THE DEFECT THIS EXISTS FOR, verified against live production ────────────
 *
 * `src/app/transparency/page.tsx:36` summed `donations.amount` across the
 * ENTIRE table - no campaign filter, no currency grouping - and `:76`
 * rendered it through `centsToDollars`, which hardcodes USD.
 *
 * On 2026-10-26 the live page at `https://lastdonor.org/transparency` read:
 *
 *     $100.00   Raised So Far
 *
 * while the production database held
 * `[{"currency":"KES","n":2,"total_minor":10000}]` - that is **KES 100.00**,
 * roughly **US$0.77**. The page overstated the platform's lifetime
 * fundraising by about 130x, under a heading promising it "publishes
 * LastDonor statistics ... in one place".
 *
 * CLAUDE.md: *never add a claim the platform cannot substantiate*, and
 * `docs/92`: *two currencies are never added together ... report per currency
 * - never sum*.
 *
 * ⚠️ The SAME shape is CORRECT elsewhere and must not be "fixed":
 * `src/db/real-raised.ts:68-74` correlates its subquery to `campaigns.id`,
 * and `donations_campaign_currency_fk FOREIGN KEY (campaign_id, currency)
 * REFERENCES campaigns(id, currency)` [read from the live schema] makes a
 * campaign single-currency. Per campaign the sum is sound. Platform-wide it
 * is not.
 *
 * ── WHY A MODULE ────────────────────────────────────────────────────────────
 *
 * `docs/107`: a query written inline in a server component is a query no test
 * runs. This one is executed against real Postgres by
 * `platform-totals.integration.test.ts`.
 */

export interface PlatformCurrencyTotal {
  currency: string;
  /** Minor units OF THAT CURRENCY - never "cents" (`docs/92`). */
  totalMinor: number;
  donationCount: number;
}

type Selectable = Pick<typeof db, 'select'>;

/**
 * One row per currency the platform has actually collected, biggest first.
 *
 * Returns `[]` when nothing real has ever been raised, so the caller renders
 * nothing rather than a zero in a currency nobody has given in.
 *
 * ⚠️ REAL and un-refunded only. Seed money is fabricated (`docs/101`) and a
 * refunded donation is not money the platform raised; both filters were in
 * the query this replaces and must survive it.
 */
export async function platformRaisedByCurrency(
  client: Selectable,
): Promise<PlatformCurrencyTotal[]> {
  const rows = await client
    .select({
      currency: donations.currency,
      totalMinor: sql<number>`COALESCE(SUM(${donations.amount}), 0)::int`,
      donationCount: sql<number>`count(${donations.id})::int`,
    })
    .from(donations)
    .where(and(eq(donations.source, 'real'), eq(donations.refunded, false)))
    .groupBy(donations.currency)
    .orderBy(sql`2 desc`);

  return rows.map((r) => ({
    currency: r.currency,
    totalMinor: Number(r.totalMinor),
    donationCount: Number(r.donationCount),
  }));
}
