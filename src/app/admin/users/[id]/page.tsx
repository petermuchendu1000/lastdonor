import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { users, donations, campaigns, auditLogs } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { UserDetail } from '@/components/admin/UserDetail';
import { donorTotalsByCurrency } from '@/lib/donor-totals.server';
import { refreshDonorScore } from '@/lib/donor-scoring.server';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'User Detail - Admin - LastDonor.org',
  robots: { index: false },
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PageProps = { params: Promise<{ id: string }> };

export default async function AdminUserDetailPage({ params }: PageProps) {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    redirect('/admin');
  }

  const { id } = await params;

  if (!UUID_REGEX.test(id)) {
    notFound();
  }

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      location: users.location,
      avatarUrl: users.avatarUrl,
      totalDonated: users.totalDonated,
      campaignsSupported: users.campaignsSupported,
      lastDonorCount: users.lastDonorCount,
      badges: users.badges,
      preferences: users.preferences,
      createdAt: users.createdAt,
      phone: users.phone,
      donorType: users.donorType,
      organizationName: users.organizationName,
      address: users.address,
      lastDonationAt: users.lastDonationAt,
      donorScore: users.donorScore,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!user) {
    notFound();
  }

  // Refresh donor score on page load so admin sees current value
  const freshScore = await refreshDonorScore(id);

  const recentDonations = await db
    .select({
      id: donations.id,
      amount: donations.amount,
      currency: donations.currency,
      donorName: donations.donorName,
      isAnonymous: donations.isAnonymous,
      campaignTitle: campaigns.title,
      campaignSlug: campaigns.slug,
      phaseAtTime: donations.phaseAtTime,
      source: donations.source,
      createdAt: donations.createdAt,
    })
    .from(donations)
    .innerJoin(campaigns, eq(donations.campaignId, campaigns.id))
    .where(eq(donations.userId, id))
    .orderBy(desc(donations.createdAt))
    .limit(20);

  /*
    ⛔ `users.total_donated` is not rendered: one integer, no currency
    dimension (`docs/92`). Recomputed from `donations` by the module that
    the user-facing dashboard already uses, so both screens agree.
  */
  const donationTotals = await donorTotalsByCurrency(db, user.id, user.email ?? '');

  const recentAudit = await db
    .select({
      id: auditLogs.id,
      eventType: auditLogs.eventType,
      severity: auditLogs.severity,
      details: auditLogs.details,
      timestamp: auditLogs.timestamp,
    })
    .from(auditLogs)
    .where(eq(auditLogs.actorId, id))
    .orderBy(desc(auditLogs.timestamp))
    .limit(10);

  const currentUserId = session.user?.id ?? '';

  return (
    <UserDetail
      user={{
        ...user,
        donationTotals,
        donorScore: freshScore,
        createdAt: user.createdAt.toISOString(),
        lastDonationAt: user.lastDonationAt?.toISOString() ?? null,
        address: (user.address ?? null) as import('@/types').DonorAddress | null,
      }}
      donations={recentDonations.map((d) => ({
        ...d,
        createdAt: d.createdAt.toISOString(),
      }))}
      auditEntries={recentAudit.map((a) => ({
        ...a,
        timestamp: a.timestamp.toISOString(),
      }))}
      currentUserId={currentUserId}
    />
  );
}
