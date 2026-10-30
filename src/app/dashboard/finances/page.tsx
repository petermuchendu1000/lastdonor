import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { donations, campaigns } from '@/db/schema';
import { eq, desc, and, or } from 'drizzle-orm';
import { Money } from '@/components/ui/Money';
import { donorTotalsByCurrency } from '@/lib/donor-totals.server';
import { publicCampaignPath } from '@/lib/campaign-links';
import { formatDate } from '@/lib/utils/dates';
import { PhaseBadge } from '@/components/campaign/PhaseBadge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { DonationPhase } from '@/types';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Donation History - Finances - LastDonor.org',
  robots: { index: false },
};

export default async function DonationHistoryPage() {
  const session = (await auth())!;

  const userEmail = session.user!.email ?? '';
  const donorMatch = or(eq(donations.userId, session.user!.id!), eq(donations.donorEmail, userEmail))!;

  const donationList = await db
    .select({
      id: donations.id,
      amount: donations.amount,
      // Every amount column is in the MINOR UNITS OF ITS OWN ROW'S currency
      // (`docs/92`); without this the table printed shillings as dollars.
      currency: donations.currency,
      phaseAtTime: donations.phaseAtTime,
      createdAt: donations.createdAt,
      campaignTitle: campaigns.title,
      campaignSlug: campaigns.slug,
      campaignStatus: campaigns.status,
      campaignPublishedAt: campaigns.publishedAt,
    })
    .from(donations)
    .innerJoin(campaigns, eq(donations.campaignId, campaigns.id))
    .where(
      and(
        donorMatch,
        eq(donations.source, 'real'),
        eq(donations.refunded, false),
      ),
    )
    .orderBy(desc(donations.createdAt));

  /*
    ⛔ This used to be `donationList.reduce((sum, d) => sum + d.amount, 0)`
    rendered through `centsToDollars`. This page is ONE DONOR across every
    campaign they have given to, which is precisely the case where a campaign's
    single-currency guarantee (the composite FK of `docs/92`) does not apply:
    adding 100 KES to 100 USD yields 200 of nothing, and printing it with a
    dollar sign states a figure the platform cannot substantiate.

    `donorTotalsByCurrency` carries the identical filter (donor match, real,
    un-refunded) and is executed against real Postgres by
    `donor-totals.integration.test.ts` (`docs/107`). Awaited after the list, so
    this page still issues at most one query at a time (`docs/87`).
  */
  const totals = await donorTotalsByCurrency(db, session.user!.id!, userEmail);

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-[14px] text-[#6B7280]">
          {donationList.length} donation{donationList.length !== 1 ? 's' : ''}
          {totals.length > 0 ? ' totaling ' : ''}
          {totals.map((t, i) => (
            <span key={t.currency}>
              {i > 0 ? ' and ' : ''}
              <span className="font-mono font-semibold text-[#0F766E]">
                <Money minor={t.totalMinor} currency={t.currency} precision="exact" />
              </span>
            </span>
          ))}
        </p>
      </div>

      {donationList.length === 0 ? (
        <div className="mt-6 rounded-xl border border-[#E5E7EB] bg-white p-12 text-center dark:border-white/10 dark:bg-white/5">
          <p className="text-[14px] text-[#6B7280]">
            You haven&apos;t made any donations yet.{' '}
            <Link href="/campaigns" className="font-medium text-[#0F766E] hover:underline">
              Browse campaigns
            </Link>
          </p>
        </div>
      ) : (
        <div className="mt-4 relative overflow-x-auto rounded-xl border border-[#E5E7EB] bg-white dark:border-white/10 dark:bg-white/5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {donationList.map((d) => {
                const publicHref = publicCampaignPath({
                  slug: d.campaignSlug,
                  status: d.campaignStatus,
                  publishedAt: d.campaignPublishedAt,
                });
                return (
                <TableRow key={d.id}>
                  <TableCell>
                    {/*
                      `docs/109`: a campaign the donor gave to can since have
                      been moved out of the served statuses - `docs/79` did
                      exactly that to twelve live campaigns - and this link
                      would then 404 from the donor's own history.
                    */}
                    {publicHref ? (
                      <Link
                        href={publicHref}
                        className="font-medium text-[#0F766E] hover:underline"
                      >
                        {d.campaignTitle}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">{d.campaignTitle}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <Money minor={d.amount} currency={d.currency} precision="exact" />
                  </TableCell>
                  <TableCell>
                    <PhaseBadge phase={d.phaseAtTime as DonationPhase} />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <span className="text-[13px] capitalize text-[#6B7280]">
                      {d.campaignStatus === 'last_donor_zone' ? 'Last Donor Zone' : d.campaignStatus}
                    </span>
                  </TableCell>
                  <TableCell className="text-[13px] text-[#6B7280]">
                    {formatDate(d.createdAt)}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
