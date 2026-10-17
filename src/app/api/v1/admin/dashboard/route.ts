import { NextResponse } from 'next/server';
import { startOfReportingDay, startOfReportingMonth } from '@/lib/reporting-timezone';
import { requireRole } from '@/lib/auth';
import { db } from '@/db';
import { donations, newsletterSubscribers } from '@/db/schema';
import { eq, sql, gte, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';
import { logError } from '@/lib/errors';

export async function GET() {
  const requestId = randomUUID();

  try {
    await requireRole(['admin']);
  } catch {
    const error: ApiError = {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Admin access required', requestId },
    };
    return NextResponse.json(error, { status: 403 });
  }

  try {
  const now = new Date();
  // docs/88 F15, kept in step with src/app/admin/page.tsx.
  const startOfDay = startOfReportingDay(now);
  const startOfMonth = startOfReportingMonth(now);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [todayDonations] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
    })
    .from(donations)
    .where(
      and(
        gte(donations.createdAt, startOfDay),
        eq(donations.source, 'real'),
        eq(donations.refunded, false),
      ),
    );

  const [monthDonations] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
    })
    .from(donations)
    .where(
      and(
        gte(donations.createdAt, startOfMonth),
        eq(donations.source, 'real'),
        eq(donations.refunded, false),
      ),
    );

  const [todaySubs] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(newsletterSubscribers)
    .where(gte(newsletterSubscribers.subscribedAt, startOfDay));

  const [monthSubs] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(newsletterSubscribers)
    .where(gte(newsletterSubscribers.subscribedAt, startOfMonth));

  // Daily donations for chart (last 30 days)
  const dailyDonations = await db
    .select({
      date: sql<string>`date_trunc('day', ${donations.createdAt})::date::text`,
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
    })
    .from(donations)
    .where(
      and(
        gte(donations.createdAt, thirtyDaysAgo),
        eq(donations.source, 'real'),
        eq(donations.refunded, false),
      ),
    )
    .groupBy(sql`date_trunc('day', ${donations.createdAt})`)
    .orderBy(sql`date_trunc('day', ${donations.createdAt})`);

  return NextResponse.json({
    ok: true,
    data: {
      today: {
        donationCount: todayDonations.count,
        donationTotal: todayDonations.total,
        newSubscribers: todaySubs.count,
      },
      month: {
        donationCount: monthDonations.count,
        donationTotal: monthDonations.total,
        newSubscribers: monthSubs.count,
      },
      dailyDonations,
    },
  });
  } catch (err) {
    logError(err, 'admin-dashboard', { requestId });
    const error: ApiError = {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to load dashboard data', requestId },
    };
    return NextResponse.json(error, { status: 500 });
  }
}
