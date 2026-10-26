import { notFound } from 'next/navigation';
import { db } from '@/db';
import { campaigns, donations, campaignUpdates, institutionVouches, trustedInstitutions } from '@/db/schema';
import { eq, desc, sql, and, gte } from 'drizzle-orm';
import { CampaignDetail } from '@/components/admin/CampaignDetail';
import { CampaignVouches } from '@/components/admin/CampaignVouches';
import { VOUCH_WINDOW_DAYS } from '@/lib/trust-network/decide';
import { countCampaignDocuments, listCampaignVouches } from '@/lib/trust-network/vouch';
import type { Metadata } from 'next';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = {
  title: 'Campaign Detail - Admin - LastDonor.org',
  robots: { index: false },
};

export default async function AdminCampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);

  if (!campaign) notFound();

  // Recent donations for this campaign
  const recentDonations = await db
    .select({
      id: donations.id,
      donorName: donations.donorName,
      donorEmail: donations.donorEmail,
      donorLocation: donations.donorLocation,
      amount: donations.amount,
      currency: donations.currency,
      message: donations.message,
      isAnonymous: donations.isAnonymous,
      phaseAtTime: donations.phaseAtTime,
      source: donations.source,
      refunded: donations.refunded,
      createdAt: donations.createdAt,
    })
    .from(donations)
    .where(eq(donations.campaignId, id))
    .orderBy(desc(donations.createdAt))
    .limit(30);

  // Campaign updates
  const updates = await db
    .select({
      id: campaignUpdates.id,
      title: campaignUpdates.title,
      bodyHtml: campaignUpdates.bodyHtml,
      imageUrl: campaignUpdates.imageUrl,
      createdAt: campaignUpdates.createdAt,
    })
    .from(campaignUpdates)
    .where(eq(campaignUpdates.campaignId, id))
    .orderBy(desc(campaignUpdates.createdAt));

  // Donation phase breakdown
  const phaseBreakdown = await db
    .select({
      phase: donations.phaseAtTime,
      count: sql<number>`count(*)::int`,
      total: sql<number>`sum(${donations.amount})::int`,
    })
    .from(donations)
    .where(eq(donations.campaignId, id))
    .groupBy(donations.phaseAtTime);

  /*
    Trust-network reads, sequential like everything else on this page. docs/87
    caps an entry point at THREE concurrent queries; nothing here runs in a
    `Promise.all`, so the page uses one connection at a time.

    docs/83's lesson is why this block exists at all: the Didit verification
    flow worked and was unreachable for days because its only link was behind
    a condition nothing could satisfy. A vouch panel that only appeared for
    campaigns in some particular state would repeat that, so this renders on
    every campaign, in every state, and says what it can do.
  */
  const vouches = await listCampaignVouches(id);
  const documents = await countCampaignDocuments(id);
  const vouchWindowStart = new Date(Date.now() - VOUCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const institutions = await db
    .select({
      id: trustedInstitutions.id,
      name: trustedInstitutions.name,
      country: trustedInstitutions.country,
      monthlyVouchLimit: trustedInstitutions.monthlyVouchLimit,
      vouchesInWindow: db
        .$count(
          institutionVouches,
          and(
            eq(institutionVouches.institutionId, trustedInstitutions.id),
            gte(institutionVouches.createdAt, vouchWindowStart),
          ),
        )
        .as('vouches_in_window'),
    })
    .from(trustedInstitutions)
    .where(eq(trustedInstitutions.status, 'active'))
    .orderBy(trustedInstitutions.name)
    .limit(200);

  return (
    <>
    <CampaignDetail
      campaign={{
        ...campaign,
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString(),
        publishedAt: campaign.publishedAt?.toISOString() ?? null,
        completedAt: campaign.completedAt?.toISOString() ?? null,
        pausedAt: campaign.pausedAt?.toISOString() ?? null,
        suspendedAt: campaign.suspendedAt?.toISOString() ?? null,
        cancelledAt: campaign.cancelledAt?.toISOString() ?? null,
      }}
      donations={recentDonations.map((d) => ({
        ...d,
        createdAt: d.createdAt.toISOString(),
      }))}
      updates={updates.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
      }))}
      phaseBreakdown={phaseBreakdown.map((p) => ({
        phase: p.phase,
        count: p.count,
        total: p.total ?? 0,
      }))}
    />
    <div className="mt-6">
      <CampaignVouches
        campaignId={id}
        verificationStatus={campaign.verificationStatus}
        verificationSource={campaign.verificationSource}
        vouches={vouches.map((v) => ({
          ...v,
          createdAt: v.createdAt.toISOString(),
          revokedAt: v.revokedAt?.toISOString() ?? null,
        }))}
        documents={documents}
        institutions={institutions.map((i) => ({
          ...i,
          vouchesInWindow: Number(i.vouchesInWindow),
        }))}
        windowDays={VOUCH_WINDOW_DAYS}
      />
    </div>
    </>
  );
}
