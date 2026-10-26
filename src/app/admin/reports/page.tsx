import { redirect } from 'next/navigation';
import { startOfReportingMonthsAgo, reportingTimezoneLabel } from '@/lib/reporting-timezone';
import { getReportPeriods } from '@/lib/report-periods';
import {
  donationTotalsByMonthAndCurrency,
  donationTotalsByCategoryAndCurrency,
} from '@/lib/admin/donation-totals.server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { desc } from 'drizzle-orm';
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
    /*
      ⛔ Was `SUM(donations.amount)` grouped by month ALONE, so a month with
      KES and USD donations plotted one point that was the two added together
      (`docs/92`). Split by currency, through a module so a test can run it
      (`docs/107` §7). Still one query.
    */
    donationTotalsByMonthAndCurrency(db, { since: twelveMonthsAgo }),
    getReportPeriods(now),
    // Top campaigns
    db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        slug: campaigns.slug,
        status: campaigns.status,
        currency: campaigns.currency,
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
  const categoryRevenue = await donationTotalsByCategoryAndCurrency(db);


  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Financial Reports</h1>
        <p className="text-sm text-muted-foreground">
          Revenue analytics and campaign performance. Months and years are
          counted in {reportingTimezoneLabel()}.
        </p>
      </div>
      {periods.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No real donations have been recorded yet.
        </p>
      ) : (
        /*
          ⛔ ONE SECTION PER CURRENCY, not one blended report. A campaign is
          single-currency by composite FK; the PLATFORM is not, and every
          figure on this page used to be a sum across both rails printed with
          a dollar sign (`docs/92`). With a single currency this renders
          exactly what it did before.
        */
        periods.map((p) => (
          <FinancialReports
            key={p.currency}
            currency={p.currency}
            monthlyRevenue={monthlyRevenue
              .filter((m) => m.currency === p.currency)
              .map((m) => ({
                month: m.month.slice(0, 7),
                total: m.totalMinor,
                count: m.donationCount,
                avgDonation: m.donationCount > 0 ? Math.round(m.totalMinor / m.donationCount) : 0,
              }))}
            ytd={p.ytd}
            mtd={p.mtd}
            allTime={p.allTime}
            topCampaigns={topCampaigns.filter((c) => c.currency === p.currency)}
            categoryRevenue={categoryRevenue
              .filter((c) => c.currency === p.currency)
              .map((c) => ({
                category: c.category,
                total: c.totalMinor,
                count: c.donationCount,
                campaigns: 0,
              }))}
            refunds={p.refunds}
          />
        ))
      )}
    </>
  );
}
