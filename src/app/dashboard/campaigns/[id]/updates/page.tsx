import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { canCollaborate } from '@/lib/collaborators/can-collaborate';
import { db } from '@/db';
import { campaigns, campaignUpdates } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { CampaignUpdatesClient } from '@/components/dashboard/CampaignUpdatesClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Campaign Updates - Dashboard - LastDonor.org',
  robots: { index: false },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CampaignUpdatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/dashboard/campaigns');

  const [campaign] = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      slug: campaigns.slug,
      status: campaigns.status,
      creatorId: campaigns.creatorId,
    })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);

  if (!campaign) notFound();
  /*
    ⛔ Creator, staff, OR a collaborator holding `post_update`.

    This was a bare `creatorId !== session.user.id -> redirect`, so a helper
    who had accepted an invitation was bounced to `/dashboard/campaigns` -
    which, for them, was an EMPTY list. The API has always admitted them
    (POST /api/v1/user-campaigns/[id]/updates checks this same capability and
    answered 201 in a browser on 2026-10-27), so the grant was real and had
    no door. `docs/117`.

    ⚠️ `canCollaborate` is evaluated LAST on purpose: it issues a query, and
    every route here is capped at three concurrent ones (`docs/87`). The
    creator's path - the common one - must not pay for it.
  */
  const isOwner = campaign.creatorId === session.user.id;
  const isStaff = ['editor', 'admin'].includes(session.user.role as string);
  if (!isOwner && !isStaff && !(await canCollaborate(id, session.user.id, 'post_update'))) {
    redirect('/dashboard/campaigns');
  }

  const updates = await db
    .select({
      id: campaignUpdates.id,
      title: campaignUpdates.title,
      bodyHtml: campaignUpdates.bodyHtml,
      updateType: campaignUpdates.updateType,
      createdAt: campaignUpdates.createdAt,
    })
    .from(campaignUpdates)
    .where(eq(campaignUpdates.campaignId, id))
    .orderBy(desc(campaignUpdates.createdAt));

  const serialized = updates.map((u) => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
  }));

  const canPost = ['active', 'last_donor_zone'].includes(campaign.status);

  return (
    <>
      <h1 className="font-display text-2xl font-bold text-foreground">Campaign Updates</h1>
      <p className="mt-1 text-sm text-muted-foreground">{campaign.title}</p>

      <CampaignUpdatesClient
        campaignId={id}
        updates={serialized}
        canPost={canPost}
      />
    </>
  );
}
