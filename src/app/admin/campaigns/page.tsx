import { db } from '@/db';
import { campaigns, users } from '@/db/schema';
import { desc, inArray, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { CampaignsList } from '@/components/admin/CampaignsList';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Campaigns - Admin - LastDonor.org',
  robots: { index: false },
};

/*
  docs/88 F8. This fetch had no LIMIT: every campaign row, every column
  the list renders, serialised into the HTML on every load. Measured in
  production at 222 campaigns: 222 rendered rows, 793 KB of HTML, a
  15,633px page and 4,871 DOM nodes, for a table whose first screen
  shows about eight. The cost is linear in a table that only grows.

  200 matches every other admin list (docs/88 F16). The cap is reported
  on screen rather than hidden, which is the whole point of F16: a
  silent cap is how /admin/users came to state two different totals.
*/
const FETCH_LIMIT = 200;

export default async function AdminCampaignsPage() {
  /*
    This list is deliberately open to an editor - it is the only door to the
    campaign whose updates `POST /api/v1/admin/campaigns/[campaignId]/updates`
    admits them to post. The row actions are not: `Change Status`, `Delete`
    and the form behind `Edit` all require `admin`. `docs/133`.
  */
  const session = await auth();
  const isAdmin = session?.user?.role === 'admin';

  const allCampaigns = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      slug: campaigns.slug,
      status: campaigns.status,
      category: campaigns.category,
      source: campaigns.source,
      verificationStatus: campaigns.verificationStatus,
      creatorId: campaigns.creatorId,
      // The row's own currency; without it these screens printed every
      // campaign's money as dollars (`docs/92`).
      currency: campaigns.currency,
      raisedAmount: campaigns.raisedAmount,
      goalAmount: campaigns.goalAmount,
      donorCount: campaigns.donorCount,
      createdAt: campaigns.createdAt,
    })
    .from(campaigns)
    .orderBy(desc(campaigns.createdAt))
    .limit(FETCH_LIMIT);

  // Resolve creator names for user-submitted campaigns
  const creatorIds = allCampaigns
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

  /*
    Status tiles come from SQL, not from the rows above (docs/88 F8).

    They used to be counted in JS over the unbounded fetch, which was
    correct only because the fetch was unbounded. Capping it without
    moving these would have reproduced F16 exactly: a tile reading
    "Draft 210" over a list that can only reach 200 of them.
  */
  const statusRows = await db
    .select({ status: campaigns.status, count: sql<number>`count(*)::int` })
    .from(campaigns)
    .groupBy(campaigns.status);

  const statusCounts: Record<string, number> = {};
  let totalCampaigns = 0;
  for (const row of statusRows) {
    statusCounts[row.status] = row.count;
    totalCampaigns += row.count;
  }

  // Map to client-safe shape (serialize dates, resolve creator names)
  const campaignData = allCampaigns.map((c) => ({
    id: c.id,
    title: c.title,
    slug: c.slug,
    status: c.status,
    category: c.category,
    verificationStatus: c.verificationStatus,
    source: c.source ?? 'editorial',
    creatorName: c.creatorId ? (creatorMap.get(c.creatorId) ?? null) : null,
    currency: c.currency,
    raisedAmount: c.raisedAmount,
    goalAmount: c.goalAmount,
    donorCount: c.donorCount,
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
  }));

  return (
    <CampaignsList
      campaigns={campaignData}
      statusCounts={statusCounts}
      totalCampaigns={totalCampaigns}
      isAdmin={isAdmin}
    />
  );
}
