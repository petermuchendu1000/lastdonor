import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { donations, campaigns } from '@/db/schema';
import { desc, sql, eq } from 'drizzle-orm';
import { DonationsList } from '@/components/admin/DonationsList';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Donations - Admin - LastDonor.org',
  robots: { index: false },
};

export default async function AdminDonationsPage() {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    redirect('/admin');
  }

  const [recentDonations, [stats], campaignOptions] = await Promise.all([
    db
      .select({
        id: donations.id,
        amount: donations.amount,
        donorName: donations.donorName,
        donorEmail: donations.donorEmail,
        message: donations.message,
        isAnonymous: donations.isAnonymous,
        source: donations.source,
        refunded: donations.refunded,
        createdAt: donations.createdAt,
        campaignId: donations.campaignId,
        campaignTitle: campaigns.title,
        campaignSlug: campaigns.slug,
      })
      .from(donations)
      .innerJoin(campaigns, eq(donations.campaignId, campaigns.id))
      .orderBy(desc(donations.createdAt))
      .limit(200),

    db
      .select({
        totalAmount: sql<number>`COALESCE(sum(${donations.amount}), 0)::int`,
        totalCount: sql<number>`count(*)::int`,
        realCount: sql<number>`count(*) FILTER (WHERE ${donations.source} = 'real')::int`,
        seedCount: sql<number>`count(*) FILTER (WHERE ${donations.source} = 'seed')::int`,
        refundedCount: sql<number>`count(*) FILTER (WHERE ${donations.refunded} = true)::int`,
      })
      .from(donations),

    db
      .select({ id: campaigns.id, title: campaigns.title })
      .from(campaigns)
      .orderBy(campaigns.title),
  ]);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Donations</h1>
        <p className="text-sm text-muted-foreground">
          {stats.totalCount} total &middot; {stats.realCount} real &middot; {stats.refundedCount} refunded
        </p>
      </div>
      <DonationsList
        initialDonations={recentDonations.map((d) => ({
          ...d,
          createdAt: d.createdAt.toISOString(),
        }))}
        stats={stats}
        campaignOptions={campaignOptions}
      />
    </>
  );
}
