import { redirect } from 'next/navigation';
import { startOfReportingMonthsAgo, reportingTimezoneLabel } from '@/lib/reporting-timezone';
import { getReportPeriods } from '@/lib/report-periods';
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

export default async function AdminReportsPage() {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    redirect('/admin');
  }

  const now = new Date();
  // docs/88 F15.
  const twelveMonthsAgo = startOfReportingMonthsAgo(11, now);

  const realNonRefunded = and(eq(donations.source, 'real'), eq(donations.refunded, false));

  /*
    docs/87 amendment 5. This was SEVEN queries in one `Promise.all`
    against a pool of five. The four period aggregates and the refund
    totals all scan `donations` with the same shape, so they are one
    query of FILTER aggregates now, in `getReportPeriods` - which lives
    in a module of its own because an inline `sql` template is the one
    part of this page no test could run. It answered 500 on every
    load; see `src/lib/report-periods.ts`.
  */
  const [monthlyRevenue, periods, topCampaigns] = await Promise.all([
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
    getReportPeriods(now),
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
  ]);

  // Runs after the batch: nothing depends on it, and three concurrent
  // queries plus the layout's auth() is already the pool's capacity.
  const categoryRevenue = await db
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
    .orderBy(sql`sum(${donations.amount}) desc`);


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
        ytd={periods.ytd}
        mtd={periods.mtd}
        allTime={periods.allTime}
        topCampaigns={topCampaigns}
        categoryRevenue={categoryRevenue}
        refunds={periods.refunds}
      />
    </>
  );
}
