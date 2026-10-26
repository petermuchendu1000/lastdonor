import 'server-only';
import { and, eq, gte, lte, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import { campaigns, donations } from '@/db/schema';
import { inArray } from 'drizzle-orm';

/**
 * Admin money aggregates, PER CURRENCY.
 *
 * ── THE DEFECT THESE EXIST FOR ──────────────────────────────────────────────
 *
 * Fourteen of the fifteen admin pages that render money contained no mention
 * of `currency` at all, and ten of them ran `SUM(donations.amount)` with no
 * currency in the GROUP BY. `/admin` summed today's and this month's donations
 * across every campaign on the platform; `/admin/reports` did the same by
 * month and by category. Each result was rendered through `centsToDollars`,
 * which hardcodes USD.
 *
 * `docs/92`: *two currencies are never added together ... report per currency
 * - never sum.* The platform collects KES and USD, so these were adding
 * shillings to dollars and printing the result with a dollar sign.
 *
 * ⚠️ KES and USD share exponent 2, so every DIGIT was right and only the
 * symbol lied - which is why six thousand tests and nine ratchets never saw
 * it.
 *
 * ── WHY A MODULE ────────────────────────────────────────────────────────────
 *
 * `docs/107`: an admin page's data query is executed by NO test - the
 * integration suite covers API routes, the E2E suite has no signed-in admin
 * fixture, and a unit test cannot reach a server component's database call.
 * Moving these here is what lets `donation-totals.integration.test.ts` run
 * them against real Postgres.
 *
 * ⚠️ Also `docs/107`: never interpolate a bare `Date` into a `sql` template -
 * it is bound with no encoder and throws inside the driver, which is what
 * 500'd every load of `/admin/reports`. These use the typed `gte`/`lte`
 * builders, which carry the column's encoder.
 */

export interface CurrencyTotal {
  currency: string;
  /** Minor units OF THAT CURRENCY - never "cents" (`docs/92`). */
  totalMinor: number;
  donationCount: number;
}

export interface MonthlyCurrencyTotal extends CurrencyTotal {
  /** First instant of the month, UTC. */
  month: string;
}

export interface CategoryCurrencyTotal extends CurrencyTotal {
  category: string;
  /** Distinct campaigns behind this (category, currency) row. */
  campaignCount: number;
}

type Selectable = Pick<typeof db, 'select'>;

export interface DonationWindow {
  since?: Date;
  until?: Date;
  /** Defaults to real, un-refunded money - what every admin total meant. */
  includeSeed?: boolean;
}

function windowFilter(w: DonationWindow): SQL | undefined {
  const parts: (SQL | undefined)[] = [eq(donations.refunded, false)];
  if (!w.includeSeed) parts.push(eq(donations.source, 'real'));
  if (w.since) parts.push(gte(donations.createdAt, w.since));
  if (w.until) parts.push(lte(donations.createdAt, w.until));
  return and(...parts);
}

/** Totals for a time window, one row per currency, biggest first. */
export async function donationTotalsByCurrency(
  client: Selectable,
  w: DonationWindow = {},
): Promise<CurrencyTotal[]> {
  const rows = await client
    .select({
      currency: donations.currency,
      totalMinor: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
      donationCount: sql<number>`count(*)::int`,
    })
    .from(donations)
    .where(windowFilter(w))
    .groupBy(donations.currency)
    .orderBy(sql`2 desc`);

  return rows.map((r) => ({
    currency: r.currency,
    totalMinor: Number(r.totalMinor),
    donationCount: Number(r.donationCount),
  }));
}

/** Monthly series, split by currency. One row per (month, currency). */
export async function donationTotalsByMonthAndCurrency(
  client: Selectable,
  w: DonationWindow = {},
): Promise<MonthlyCurrencyTotal[]> {
  const month = sql<string>`date_trunc('month', ${donations.createdAt})`;
  const rows = await client
    .select({
      month,
      currency: donations.currency,
      totalMinor: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
      donationCount: sql<number>`count(*)::int`,
    })
    .from(donations)
    .where(windowFilter(w))
    .groupBy(month, donations.currency)
    .orderBy(month);

  return rows.map((r) => ({
    month: new Date(r.month).toISOString(),
    currency: r.currency,
    totalMinor: Number(r.totalMinor),
    donationCount: Number(r.donationCount),
  }));
}

/** Totals per campaign category, split by currency. */
export async function donationTotalsByCategoryAndCurrency(
  client: Selectable,
  w: DonationWindow = {},
): Promise<CategoryCurrencyTotal[]> {
  const rows = await client
    .select({
      category: campaigns.category,
      currency: donations.currency,
      totalMinor: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
      donationCount: sql<number>`count(*)::int`,
      // Kept from the query this replaced: the screen shows it as
      // "Campaigns", and dropping it reported 0 for every category.
      campaignCount: sql<number>`count(distinct ${campaigns.id})::int`,
    })
    .from(donations)
    .innerJoin(campaigns, eq(donations.campaignId, campaigns.id))
    .where(windowFilter(w))
    .groupBy(campaigns.category, donations.currency)
    .orderBy(sql`3 desc`);

  return rows.map((r) => ({
    category: String(r.category),
    currency: r.currency,
    totalMinor: Number(r.totalMinor),
    donationCount: Number(r.donationCount),
    campaignCount: Number(r.campaignCount),
  }));
}

/**
 * What each of these donors has given, PER CURRENCY, in ONE query.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `users.total_donated` is a single `integer` column incremented by
 * `payment-service.ts:307` as `total_donated + amount`, with **no currency
 * dimension at all** [VERIFIED from the live schema: one column, one writer].
 * A donor who gives KES 5,000 and US$50 ends up with 505000 - a number in no
 * currency, which cannot be rendered correctly in any of them. Three admin
 * screens printed it with a dollar sign.
 *
 * The column is the defect, so the figure is recomputed from `donations`
 * instead. Grouped by (user, currency) so a list of 200 donors costs ONE
 * query rather than 200 (`docs/87`: the pool is `max: 5`).
 *
 * ⚠️ Matches on `user_id` only, not on `donor_email`. A guest donation that
 * was never linked to an account is not attributable to that account here,
 * which is the same rule `users.total_donated` followed - it is incremented
 * only where a `userId` is present.
 */
export async function donorTotalsForUsers(
  client: Selectable,
  userIds: readonly string[],
): Promise<Map<string, CurrencyTotal[]>> {
  const out = new Map<string, CurrencyTotal[]>();
  if (userIds.length === 0) return out;

  const rows = await client
    .select({
      userId: donations.userId,
      currency: donations.currency,
      totalMinor: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
      donationCount: sql<number>`count(*)::int`,
    })
    .from(donations)
    .where(
      and(
        inArray(donations.userId, [...userIds]),
        eq(donations.source, 'real'),
        eq(donations.refunded, false),
      ),
    )
    .groupBy(donations.userId, donations.currency)
    .orderBy(sql`3 desc`);

  for (const r of rows) {
    if (!r.userId) continue;
    const list = out.get(r.userId) ?? [];
    list.push({
      currency: r.currency,
      totalMinor: Number(r.totalMinor),
      donationCount: Number(r.donationCount),
    });
    out.set(r.userId, list);
  }
  return out;
}

/**
 * What each of these donor EMAILS has given, PER CURRENCY, in one query.
 *
 * The email-keyed companion to `donorTotalsForUsers`, for screens that list
 * guest donors - people who gave without an account, who therefore have no
 * `users` row and no `users.total_donated` at all.
 *
 * ⚠️ Emails are matched exactly as stored. The donor segmentation screen
 * unions registered users and guests, so a caller may need both functions.
 */
export async function donorTotalsForEmails(
  client: Selectable,
  emails: readonly string[],
): Promise<Map<string, CurrencyTotal[]>> {
  const out = new Map<string, CurrencyTotal[]>();
  if (emails.length === 0) return out;

  const rows = await client
    .select({
      donorEmail: donations.donorEmail,
      currency: donations.currency,
      totalMinor: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
      donationCount: sql<number>`count(*)::int`,
    })
    .from(donations)
    .where(
      and(
        inArray(donations.donorEmail, [...emails]),
        eq(donations.source, 'real'),
        eq(donations.refunded, false),
      ),
    )
    .groupBy(donations.donorEmail, donations.currency)
    .orderBy(sql`3 desc`);

  for (const r of rows) {
    if (!r.donorEmail) continue;
    const list = out.get(r.donorEmail) ?? [];
    list.push({
      currency: r.currency,
      totalMinor: Number(r.totalMinor),
      donationCount: Number(r.donationCount),
    });
    out.set(r.donorEmail, list);
  }
  return out;
}
