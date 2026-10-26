import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { db } from '@/db';
import { donorTotalsForUsers, donorTotalsForEmails } from '@/lib/admin/donation-totals.server';
import { donations } from '@/db/schema';
import { eq, gte, and, sql } from 'drizzle-orm';
import {
  getCurrency,
  isSupportedCurrency,
  normaliseCurrencyCode,
  SUPPORTED_CURRENCY_CODES,
} from '@/lib/money/currencies';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';
import { logError } from '@/lib/errors';

/**
 * Donor segmentation API.
 *
 * Sources donors from TWO places:
 *   1. Registered users with role='donor' (uses users.totalDonated, donorScore, etc.)
 *   2. Guest donors (donations where user_id IS NULL), aggregated by donor_email
 *
 * The UNION of both is the complete donor set.
 *
 * Predefined segments (via ?segment=...):
 *   all              - every donor (registered + guest)
 *   champions        - donorScore >= 81 (registered only)
 *   major_donors     - gave >= that currency's `majorDonorMinor`; NEEDS ?currency=
 *   recurring        - has recurring donation in last year
 *   new_donors       - first donation in last 30 days
 *   at_risk          - last donation between 180 and 365 days ago
 *   lapsed           - last donation > 365 days ago
 *
 * Custom filters:
 *   minDonated, maxDonated - lifetime giving range, in the MINOR UNITS of
 *                            ?currency (which is then required)
 *   currency               - required by any money filter; one of
 *                            `SUPPORTED_CURRENCY_CODES`
 *   search                 - name/email search
 *   limit, offset          - pagination
 */

/**
 * Build a unified donor view using SQL UNION ALL across registered + guest donors.
 * Returns raw SQL for use in a CTE.
 */
function buildUnifiedDonorCTE() {
  // Registered donors: users with role='donor'
  // Guest donors: aggregated from donations where user_id IS NULL
  return sql`
    unified_donors AS (
      SELECT
        u.id,
        u.name,
        u.email,
        u.donor_type AS "donorType",
        u.total_donated AS "totalDonated",
        u.donor_score AS "donorScore",
        u.last_donation_at AS "lastDonationAt",
        u.created_at AS "createdAt",
        u.preferences,
        'registered' AS "source"
      FROM users u
      WHERE u.role = 'donor'

      UNION ALL

      SELECT
        NULL::uuid AS id,
        MAX(d.donor_name) AS name,
        d.donor_email AS email,
        'individual' AS "donorType",
        COALESCE(SUM(d.amount), 0)::int AS "totalDonated",
        0 AS "donorScore",
        MAX(d.created_at) AS "lastDonationAt",
        MIN(d.created_at) AS "createdAt",
        '{}'::jsonb AS preferences,
        'guest' AS "source"
      FROM donations d
      WHERE d.user_id IS NULL
        AND d.refunded = false
        AND d.donor_email NOT IN (SELECT email FROM users WHERE role = 'donor')
      GROUP BY d.donor_email
    )
  `;
}

export async function GET(request: NextRequest) {
  const requestId = randomUUID();

  try {
    await requireRole(['admin']);
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError,
      { status: 403 },
    );
  }

  try {
  const params = request.nextUrl.searchParams;
  const segment = params.get('segment');
  const limit = Math.min(parseInt(params.get('limit') ?? '50', 10) || 50, 200);
  const offset = parseInt(params.get('offset') ?? '0', 10) || 0;

  /*
    ⛔ MONEY FILTERS ARE PER CURRENCY, AND THE CURRENCY MUST BE NAMED.

    `major_donors` was `"totalDonated" >= 50000` - US$500 as a raw integer,
    applied to every donor whatever they gave in - and `minDonated`/
    `maxDonated` multiplied by a hardcoded 100. All three compared against a
    figure that is `users.total_donated` for a registered donor and
    `SUM(d.amount)` by email for a guest, and NEITHER carries a currency
    (`docs/116`). A donor who gave KES 50,000, about US$385, was called a
    major donor by a United States dollar rule.

    There is no exchange rate in this codebase and `docs/102` forbids one
    deciding anything but display, so these filters cannot be made
    currency-agnostic - they can only be made currency-EXPLICIT. An
    unnamed or uncollectable currency is refused rather than defaulted,
    because defaulting is precisely what the defect was.
  */
  const currencyParam = params.get('currency');
  const moneyFilterRequested =
    segment === 'major_donors' || params.has('minDonated') || params.has('maxDonated');
  let currency: string | null = null;

  if (moneyFilterRequested) {
    const normalised = normaliseCurrencyCode(currencyParam);
    if (!isSupportedCurrency(normalised)) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message:
              `A money filter needs a currency. Pass ?currency= one of ` +
              `${SUPPORTED_CURRENCY_CODES.join(', ')}; amounts in different ` +
              `currencies cannot be compared.`,
            field: 'currency',
            requestId,
          },
        } satisfies ApiError,
        { status: 400 },
      );
    }
    currency = normalised;
  }

  /**
   * Lifetime giving IN ONE CURRENCY, as a correlated aggregate over the
   * donations themselves.
   *
   * ⚠️ Not `"totalDonated"`: that column of the CTE is the currency-blind
   * figure this whole guard exists to stop comparing. Real, un-refunded
   * donations only.
   *
   * ⚠️ Attribution is `user_id` OR `donor_email`, which is what the CTE
   * itself does - a guest row whose email belongs to a `role='donor'` user is
   * excluded from the guest branch, so those donations are the registered
   * donor's. It is therefore WIDER than `donorTotalsForUsers`, which matches
   * on `user_id` alone; see `docs/116` §2.4 for the divergence that leaves.
   *
   * ⛔ `GROUP BY d.currency` IS LOAD-BEARING AND IS NOT TIDINESS. A `HAVING`
   * with no `GROUP BY` is one group over zero rows, so `COALESCE(SUM, 0)` is
   * 0 and `<= anything` is TRUE: the first version of this filter matched
   * every donor who had given NOTHING in the named currency. Probed against
   * real Postgres (`docs/116` §2.3): `?currency=KES&maxDonated=1` returned a
   * USD-only donor. With the `GROUP BY` there are no groups when there are no
   * rows, so EXISTS is false and both comparisons require at least one
   * donation in that currency.
   */
  const givenInCurrency = (compare: 'gte' | 'lte', amountMinor: number) => sql`
    EXISTS (
      SELECT 1 FROM donations d
      WHERE (d.user_id = unified_donors.id OR d.donor_email = unified_donors.email)
        AND d.source = 'real'
        AND d.refunded = false
        AND d.currency = ${currency}
      GROUP BY d.currency
      HAVING COALESCE(SUM(d.amount), 0) ${compare === 'gte' ? sql`>=` : sql`<=`} ${amountMinor}
    )`;

  // Build WHERE conditions for the unified CTE
  const conditions: ReturnType<typeof sql>[] = [];

  if (segment) {
    const now = Date.now();
    switch (segment) {
      case 'all':
        // No extra filter
        break;
      case 'champions':
        conditions.push(sql`"donorScore" >= 81`);
        break;
      case 'major_donors':
        // `currency` is non-null here: `moneyFilterRequested` covers this
        // segment and refuses above when it is absent or uncollectable.
        conditions.push(givenInCurrency('gte', getCurrency(currency).majorDonorMinor));
        break;
      case 'new_donors':
        conditions.push(sql`"createdAt" >= ${new Date(now - 30 * 86400000).toISOString()}::timestamptz`);
        break;
      case 'at_risk':
        conditions.push(sql`"lastDonationAt" <= ${new Date(now - 180 * 86400000).toISOString()}::timestamptz`);
        conditions.push(sql`"lastDonationAt" >= ${new Date(now - 365 * 86400000).toISOString()}::timestamptz`);
        break;
      case 'lapsed':
        conditions.push(sql`"lastDonationAt" <= ${new Date(now - 365 * 86400000).toISOString()}::timestamptz`);
        break;
      case 'recurring': {
        // Find emails with recurring donations in the last year
        const yearAgo = new Date(now - 365 * 86400000);
        const recurringEmails = await db
          .selectDistinct({ email: donations.donorEmail })
          .from(donations)
          .where(
            and(
              eq(donations.isRecurring, true),
              gte(donations.createdAt, yearAgo),
            ),
          );
        const emails = recurringEmails.map((r) => r.email);
        if (emails.length === 0) {
          return NextResponse.json({ ok: true, data: { donors: [], total: 0, limit, offset } });
        }
        // Use ANY array for safety
        conditions.push(sql`email = ANY(${emails})`);
        break;
      }
      default:
        return NextResponse.json(
          { ok: false, error: { code: 'VALIDATION_ERROR', message: `Unknown segment: ${segment}`, requestId } } satisfies ApiError,
          { status: 400 },
        );
    }
  }

  // Custom filters
  const minDonated = params.get('minDonated');
  const maxDonated = params.get('maxDonated');
  const search = params.get('search');
  const donorType = params.get('donorType');
  const minScore = params.get('minScore');
  const maxScore = params.get('maxScore');

  /*
    ⚠️ These took MAJOR units and multiplied by a hardcoded 100 - right for a
    two-decimal currency and 100x wrong for a zero-decimal one (`docs/103`).
    They now take MINOR units directly, which removes the exponent question
    entirely, and compare within the named currency.
  */
  if (minDonated) conditions.push(givenInCurrency('gte', parseInt(minDonated, 10)));
  if (maxDonated) conditions.push(givenInCurrency('lte', parseInt(maxDonated, 10)));
  if (minScore) conditions.push(sql`"donorScore" >= ${parseInt(minScore, 10)}`);
  if (maxScore) conditions.push(sql`"donorScore" <= ${parseInt(maxScore, 10)}`);
  if (donorType && ['individual', 'corporate', 'foundation'].includes(donorType)) {
    conditions.push(sql`"donorType" = ${donorType}`);
  }
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(sql`(name ILIKE ${pattern} OR email ILIKE ${pattern})`);
  }

  const whereSQL = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
    : sql``;

  const cte = buildUnifiedDonorCTE();

  // Count query
  const [{ total }] = await db.execute<{ total: number }>(
    sql`WITH ${cte} SELECT COUNT(*)::int AS total FROM unified_donors ${whereSQL}`,
  );

  // Data query
  const donors = await db.execute<{
    id: string | null;
    name: string | null;
    email: string;
    donorType: string;
    totalDonated: number;
    donorScore: number;
    lastDonationAt: Date | null;
    createdAt: Date;
    preferences: unknown;
    source: string;
  }>(
    sql`WITH ${cte}
    SELECT id, name, email, "donorType", "totalDonated", "donorScore", "lastDonationAt", "createdAt", preferences, source
    FROM unified_donors
    ${whereSQL}
    ORDER BY "totalDonated" DESC, "lastDonationAt" DESC NULLS LAST
    LIMIT ${limit} OFFSET ${offset}`,
  );

  /*
    ⛔ `totalDonated` above is CURRENCY-BLIND and is no longer sent to the
    screen. For a registered donor it is `users.total_donated`, a single
    integer that `payment-service.ts:307` increments with every donation's
    raw amount whatever rail it came over; for a guest it is
    `SUM(d.amount)` grouped by email alone. Either way a donor who gave in
    two currencies gets a number in neither, and the table printed it with a
    dollar sign (`docs/92`).

    Recomputed per currency for the page of donors actually being shown -
    one query each, both capped by `limit`.

    ✅ The SEGMENT THRESHOLDS no longer read it either, as of 2026-10-26
    (`docs/116` §2): they go through `givenInCurrency` above, within a
    currency the caller must name.
  */
  const emails = donors.map((d) => d.email).filter((e): e is string => !!e);
  const ids = donors.map((d) => d.id).filter((i): i is string => !!i);
  const [byUser, byEmail] = [await donorTotalsForUsers(db, ids), await donorTotalsForEmails(db, emails)];

  return NextResponse.json({
    ok: true,
    data: {
      donors: donors.map((d) => ({
        id: d.id ?? `guest:${d.email}`,
        name: d.name,
        email: d.email,
        donorType: d.donorType,
        totalsByCurrency: (d.id ? byUser.get(d.id) : undefined) ?? byEmail.get(d.email ?? '') ?? [],
        donorScore: d.donorScore,
        lastDonationAt: d.lastDonationAt ? new Date(d.lastDonationAt).toISOString() : null,
        createdAt: new Date(d.createdAt).toISOString(),
        tags: ((d.preferences as Record<string, unknown>)?.tags as string[]) ?? [],
        source: d.source,
      })),
      total,
      limit,
      offset,
    },
  });
  } catch (err) {
    logError(err, 'admin-donor-segments', { requestId });
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load donor segments', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
