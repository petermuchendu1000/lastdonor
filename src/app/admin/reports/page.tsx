import { redirect } from 'next/navigation';
import { startOfReportingMonth, startOfReportingYear, startOfReportingMonthsAgo, reportingTimezoneLabel } from '@/lib/reporting-timezone';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { donations, campaigns } from '@/db/schema';
import { eq, sql, gte, and, desc } from 'drizzle-orm';
import dynamic from 'next/dynamic';
import type { Metadata } from 'next';

const FinancialReports = dynamic(
  () => import('@/components/admin/FinancialReports').then((m) => ({ default: m.FinancialReports }))
);

export const metadata: Metadata = {
  title: 'Financial Reports - Admin - LastDonor.org',
  robots: { index: false },
};

export const revalidate = 60;

export default async function AdminReportsPage() {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    redirect('/admin');
  }

  const now = new Date();
  // docs/88 F15.
  const startOfMonth = startOfReportingMonth(now);
  const startOfYear = startOfReportingYear(now);
  const twelveMonthsAgo = startOfReportingMonthsAgo(11, now);

  const realNonRefunded = and(eq(donations.source, 'real'), eq(donations.refunded, false));

  const [
    monthlyRevenue,
    [ytdTotals],
    [mtdTotals],
    [allTimeTotals],
    topCampaigns,
    categoryRevenue,
    [refundTotals],
  ] = await Promise.all([
    // Monthly revenue (12 months)
    db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${donations.createdAt}), 'YYYY-MM')`,
        total: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
        count: sql<number>`count(*)::int`,
        avgDonation: sql<number>`coalesce(avg(${donations.amount}), 0)::int`,
      })
      .from(donations)
      .where(and(gte(donations.createdAt, twelveMonthsAgo), realNonRefunded))
      .groupBy(sql`date_trunc('month', ${donations.createdAt})`)
      .orderBy(sql`date_trunc('month', ${donations.createdAt})`),
    // YTD
    db
      .select({
        total: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
        count: sql<number>`count(*)::int`,
        avgDonation: sql<number>`coalesce(avg(${donations.amount}), 0)::int`,
      })
      .from(donations)
      .where(and(gte(donations.createdAt, startOfYear), realNonRefunded)),
    // MTD
    db
      .select({
        total: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
        count: sql<number>`count(*)::int`,
        avgDonation: sql<number>`coalesce(avg(${donations.amount}), 0)::int`,
      })
      .from(donations)
      .where(and(gte(donations.createdAt, startOfMonth), realNonRefunded)),
    // All-time
    db
      .select({
        total: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
        count: sql<number>`count(*)::int`,
        avgDonation: sql<number>`coalesce(avg(${donations.amount}), 0)::int`,
      })
      .from(donations)
      .where(realNonRefunded),
    // Top campaigns
    db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        slug: campaigns.slug,
        status: campaigns.status,
        raisedAmount: campaigns.raisedAmount,
        goalAmount: campaigns.goalAmount,
        donorCount: campaigns.donorCount,
        category: campaigns.category,
      })
      .from(campaigns)
      .orderBy(desc(campaigns.raisedAmount))
      .limit(15),
    // Revenue by category
    db
      .select({
        category: campaigns.category,
        total: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
        count: sql<number>`count(${donations.id})::int`,
        campaigns: sql<number>`count(distinct ${campaigns.id})::int`,
      })
      .from(donations)
      .innerJoin(campaigns, eq(donations.campaignId, campaigns.id))
      .where(realNonRefunded)
      .groupBy(campaigns.category)
      .orderBy(sql`sum(${donations.amount}) desc`),
    // Refunds
    db
      .select({
        total: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(donations)
      .where(and(eq(donations.source, 'real'), eq(donations.refunded, true))),
  ]);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Financial Reports</h1>
        <p className="text-sm text-muted-foreground">
          Revenue analytics and campaign performance. Months and years are
          counted in {reportingTimezoneLabel()}.
        </p>
      </div>
      <FinancialReports
        monthlyRevenue={monthlyRevenue}
        ytd={ytdTotals}
        mtd={mtdTotals}
        allTime={allTimeTotals}
        topCampaigns={topCampaigns}
        categoryRevenue={categoryRevenue}
        refunds={refundTotals}
      />
    </>
  );
}
