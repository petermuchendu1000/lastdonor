/**
 * The period totals behind `/admin/reports`, in one round trip.
 *
 * ── WHY THIS IS NOT INLINE IN THE PAGE ANY MORE ─────────────────────────────
 *
 * It was, and `/admin/reports` answered **500 on every load** because of it.
 * The query is the one piece of that page that cannot be checked by reading
 * it, so it now lives where a test can run it against a real Postgres - see
 * `report-periods.integration.test.ts`.
 *
 * ── THE DEFECT, AND THE RULE IT LEAVES BEHIND ───────────────────────────────
 *
 * ⚠️ [VERIFIED 2026-10-25, against Postgres 16] Interpolating a bare JS
 * `Date` into a `sql` template throws at execution time:
 *
 *   TypeError: The "string" argument must be of type string or an instance
 *              of Buffer or ArrayBuffer. Received an instance of Date
 *
 * A typed builder - `gte(donations.createdAt, someDate)` - knows which column
 * the value is compared against, so it encodes the Date with that column's
 * own `mapToDriverValue`. Inside a `sql` template drizzle has no such
 * information: the value becomes a parameter with **no encoder** and reaches
 * postgres-js as a live `Date` object, which it cannot serialise.
 *
 * This is the same family as the drizzle trap in `docs/101`: a `sql` template
 * silently loses information the typed builders carry, and the loss shows up
 * only when the statement actually runs. There, an unqualified identifier
 * made a subquery return 0 for every row. Here, a parameter with no encoder
 * throws. Neither is visible to typecheck, to a unit test with a mocked
 * driver, or to a grep over the SQL text.
 *
 * ⛔ So: a value interpolated into a `sql` template must be a Column, another
 * `SQL` fragment, or wrapped in `sql.param(value, column)` so the column's
 * encoder is used. `src/db/sql-template-dates.ratchet.test.ts` fails the
 * build on a Date-typed interpolation anywhere in `src/`.
 *
 * ── WHY ONE QUERY AND NOT FIVE ──────────────────────────────────────────────
 *
 * Four period aggregates plus the refund totals used to be five separate
 * queries inside one `Promise.all`, which is over the three-concurrent-query
 * budget `docs/87` sets for a single entry point. They all scan `donations`
 * with the same shape, so `FILTER` collapses them into one scan and one
 * connection.
 */

import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { donations } from '@/db/schema';
import {
  startOfReportingMonth,
  startOfReportingYear,
} from '@/lib/reporting-timezone';

export interface PeriodTotals {
  total: number;
  count: number;
  avgDonation: number;
}

export interface ReportPeriods {
  ytd: PeriodTotals;
  mtd: PeriodTotals;
  allTime: PeriodTotals;
  refunds: { total: number; count: number };
}

/**
 * Year-to-date, month-to-date, all-time and refund figures.
 *
 * Every figure counts REAL, un-refunded donations only, except `refunds`,
 * which counts real refunded ones - fabricated seed money is never reported
 * as revenue (`docs/33`, `docs/41`). Period boundaries come from
 * `REPORTING_TIMEZONE`, not the server's zone (`docs/88` F15).
 */
export async function getReportPeriods(now: Date = new Date()): Promise<ReportPeriods> {
  const startOfMonth = startOfReportingMonth(now);
  const startOfYear = startOfReportingYear(now);

  /*
    ⚠️ `sql.param(value, column)` and NOT `${startOfYear}` - see the header.
    The second argument is the encoder: it is what turns the Date into
    something the driver can send, and omitting it is the 500.
  */
  const yearStart = sql.param(startOfYear, donations.createdAt);
  const monthStart = sql.param(startOfMonth, donations.createdAt);

  const real = sql`${donations.source} = 'real' AND ${donations.refunded} = false`;

  const [row] = await db
    .select({
      ytdTotal: sql<number>`coalesce(sum(${donations.amount}) FILTER (WHERE ${donations.createdAt} >= ${yearStart} AND ${real}), 0)::int`,
      ytdCount: sql<number>`count(*) FILTER (WHERE ${donations.createdAt} >= ${yearStart} AND ${real})::int`,
      ytdAvg: sql<number>`coalesce(avg(${donations.amount}) FILTER (WHERE ${donations.createdAt} >= ${yearStart} AND ${real}), 0)::int`,
      mtdTotal: sql<number>`coalesce(sum(${donations.amount}) FILTER (WHERE ${donations.createdAt} >= ${monthStart} AND ${real}), 0)::int`,
      mtdCount: sql<number>`count(*) FILTER (WHERE ${donations.createdAt} >= ${monthStart} AND ${real})::int`,
      mtdAvg: sql<number>`coalesce(avg(${donations.amount}) FILTER (WHERE ${donations.createdAt} >= ${monthStart} AND ${real}), 0)::int`,
      allTotal: sql<number>`coalesce(sum(${donations.amount}) FILTER (WHERE ${real}), 0)::int`,
      allCount: sql<number>`count(*) FILTER (WHERE ${real})::int`,
      allAvg: sql<number>`coalesce(avg(${donations.amount}) FILTER (WHERE ${real}), 0)::int`,
      refundTotal: sql<number>`coalesce(sum(${donations.amount}) FILTER (WHERE ${donations.source} = 'real' AND ${donations.refunded} = true), 0)::int`,
      refundCount: sql<number>`count(*) FILTER (WHERE ${donations.source} = 'real' AND ${donations.refunded} = true)::int`,
    })
    .from(donations);

  return {
    ytd: { total: row.ytdTotal, count: row.ytdCount, avgDonation: row.ytdAvg },
    mtd: { total: row.mtdTotal, count: row.mtdCount, avgDonation: row.mtdAvg },
    allTime: { total: row.allTotal, count: row.allCount, avgDonation: row.allAvg },
    refunds: { total: row.refundTotal, count: row.refundCount },
  };
}
