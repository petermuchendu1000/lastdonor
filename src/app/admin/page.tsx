import { auth } from '@/lib/auth';
import { db } from '@/db';
import { donations, campaigns, newsletterSubscribers, users } from '@/db/schema';
import { eq, sql, gte, and, inArray } from 'drizzle-orm';
import { AdminDashboard } from '@/components/admin/AdminDashboard';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin Dashboard - LastDonor.org',
  robots: { index: false },
};

async function getDashboardStats() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

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

  const [monthLaunched] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaigns)
    .where(
      and(
        gte(campaigns.publishedAt, startOfMonth),
        inArray(campaigns.status, ['active', 'last_donor_zone', 'completed']),
      ),
    );

  const [monthCompleted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaigns)
    .where(
      and(
        gte(campaigns.completedAt, startOfMonth),
        eq(campaigns.status, 'completed'),
      ),
    );

  const activeCampaigns = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      slug: campaigns.slug,
      raisedAmount: campaigns.raisedAmount,
      goalAmount: campaigns.goalAmount,
      donorCount: campaigns.donorCount,
    })
    .from(campaigns)
    .where(inArray(campaigns.status, ['active', 'last_donor_zone']))
    .orderBy(campaigns.createdAt);

  const recentDonations = await db
    .select({
      id: donations.id,
      donorName: donations.donorName,
      amount: donations.amount,
      isAnonymous: donations.isAnonymous,
      createdAt: donations.createdAt,
      campaignTitle: campaigns.title,
      campaignSlug: campaigns.slug,
    })
    .from(donations)
    .innerJoin(campaigns, eq(donations.campaignId, campaigns.id))
    .where(eq(donations.source, 'real'))
    .orderBy(sql`${donations.createdAt} desc`)
    .limit(10);

  /*
    Campaigns waiting on an admin (docs/88 F6).

    This used to filter on `verificationStatus = 'pending'` AND
    `status = 'draft'` AND `source = 'manual'`. All three were wrong at
    once by 2026-10-17:

      - submissions are created `unverified`, never `pending`
        (`user-campaigns/route.ts:189`);
      - docs/78 changed submissions from `draft` to `under_review`;
      - docs/79 gated the news pipeline too, so the queue is mostly
        `source: 'automated'`, which the third filter excluded.

    Two of the three could never match anything, so the first screen an
    admin sees reported nothing to review while 12 campaigns waited. The
    queue is defined by `status`, which is the column the review gate
    actually sets, and by nothing else: who created it does not change
    whether a person still has to look at it.
  */
  const pendingReview = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      slug: campaigns.slug,
      category: campaigns.category,
      goalAmount: campaigns.goalAmount,
      creatorId: campaigns.creatorId,
      source: campaigns.source,
      createdAt: campaigns.createdAt,
    })
    .from(campaigns)
    .where(eq(campaigns.status, 'under_review'))
    .orderBy(campaigns.createdAt);

  // Resolve creator names for pending campaigns
  const creatorIds = pendingReview
    .map((c) => c.creatorId)
    .filter((id): id is string => id != null);
  const creatorMap = new Map<string, string>();
  if (creatorIds.length > 0) {
    const creators = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, creatorIds));
    for (const c of creators) {
      creatorMap.set(c.id, c.name ?? 'Unknown');
    }
  }

  const pendingCampaigns = pendingReview.map((c) => ({
    id: c.id,
    title: c.title,
    slug: c.slug,
    category: c.category,
    goalAmount: c.goalAmount,
    /*
      Every automated draft has a null `creatorId`, so this column read
      "Unknown" for the whole queue. "Unknown" implies we lost the
      answer; the news pipeline is the answer.
    */
    creatorName: c.creatorId
      ? (creatorMap.get(c.creatorId) ?? 'Unknown')
      : c.source === 'automated'
        ? 'News pipeline'
        : 'Unknown',
    createdAt: c.createdAt.toISOString(),
  }));

  return {
    today: {
      donationCount: todayDonations.count,
      donationTotal: todayDonations.total,
      newSubscribers: todaySubs.count,
    },
    month: {
      donationCount: monthDonations.count,
      donationTotal: monthDonations.total,
      newSubscribers: monthSubs.count,
      campaignsLaunched: monthLaunched.count,
      campaignsCompleted: monthCompleted.count,
    },
    activeCampaigns,
    pendingCampaigns,
    recentDonations: recentDonations.map((d) => ({
      ...d,
      createdAt: d.createdAt.toISOString(),
    })),
  };
}

export default async function AdminDashboardPage() {
  const session = await auth();
  const isAdmin = session?.user?.role === 'admin';
  const stats = await getDashboardStats();

  return <AdminDashboard stats={stats} isAdmin={isAdmin} />;
}
