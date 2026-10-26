import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { campaigns, donations } from '@/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { Money } from '@/components/ui/Money';
import { formatDate } from '@/lib/utils/dates';
import { PhaseBadge } from '@/components/campaign/PhaseBadge';
import { Card, CardContent } from '@/components/ui/card';
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
  title: 'Campaign Donors - Dashboard - LastDonor.org',
  robots: { index: false },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CampaignDonorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/dashboard/campaigns');

  const [campaign] = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      // Every donation on this page belongs to THIS campaign, so it is in
      // this currency by database guarantee: donations_campaign_currency_fk
      // on (campaign_id, currency).
      currency: campaigns.currency,
      slug: campaigns.slug,
      creatorId: campaigns.creatorId,
      donorCount: campaigns.donorCount,
    })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);

  if (!campaign) notFound();
  if (campaign.creatorId !== session.user.id && !['editor', 'admin'].includes(session.user.role as string)) {
    redirect('/dashboard/campaigns');
  }

  const donorList = await db
    .select({
      id: donations.id,
      donorName: donations.donorName,
      amount: donations.amount,
      message: donations.message,
      anonymous: donations.isAnonymous,
      phaseAtTime: donations.phaseAtTime,
      donorLocation: donations.donorLocation,
      createdAt: donations.createdAt,
    })
    .from(donations)
    .where(and(eq(donations.campaignId, id), eq(donations.source, 'real')))
    .orderBy(desc(donations.createdAt));

  return (
    <>
      <h1 className="font-display text-2xl font-bold text-foreground">Donors</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {campaign.title} - {campaign.donorCount} total donors
      </p>

      {donorList.length === 0 ? (
        <Card className="mt-6">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No donations have been received yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Donor</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead className="hidden sm:table-cell">Message</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {donorList.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <p className="font-medium text-foreground">
                      {d.anonymous ? 'Anonymous' : d.donorName ?? 'Donor'}
                    </p>
                    {d.donorLocation && !d.anonymous && (
                      <p className="text-xs text-muted-foreground">{d.donorLocation}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <Money minor={d.amount} currency={campaign.currency} precision="exact" />
                  </TableCell>
                  <TableCell>
                    <PhaseBadge phase={d.phaseAtTime as DonationPhase} />
                  </TableCell>
                  <TableCell className="hidden max-w-[200px] truncate sm:table-cell">
                    <span className="text-sm text-muted-foreground">
                      {d.message ?? '-'}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(d.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
