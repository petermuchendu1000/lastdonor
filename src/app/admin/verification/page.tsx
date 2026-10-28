import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import {
  campaigns,
  verificationDocuments,
  users,
} from '@/db/schema';
import { desc, sql, count, eq, inArray } from 'drizzle-orm';
import { VerificationQueue } from '@/components/admin/VerificationQueue';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Verification Queue - Admin - LastDonor.org',
  robots: { index: false },
};

export default async function AdminVerificationPage() {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    redirect('/admin');
  }

  /*
    Campaigns that have entered verification.

    `pending` was in this exclusion list until docs/88 F7. `mapDiditStatus`
    (`src/lib/didit.ts`) returns `pending` for EVERY non-terminal Didit
    state, including "In Review", which docs/81 documents as Didit's own
    MANUAL review queue. Excluding it hid exactly the campaigns most
    likely to need a human.

    `unverified` stays excluded: nothing has started, so there is nothing
    to review. `verified` is the legacy value no current path writes.
  */
  const excludedStatuses = sql`${campaigns.verificationStatus} NOT IN ('unverified','verified')`;

  const [queuedCampaigns, [stats]] = await Promise.all([
    db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        slug: campaigns.slug,
        status: campaigns.status,
      // `docs/131`: the public-link guard needs the publication date.
      publishedAt: campaigns.publishedAt,
        category: campaigns.category,
        verificationStatus: campaigns.verificationStatus,
        verificationNotes: campaigns.verificationNotes,
        verificationReviewedAt: campaigns.verificationReviewedAt,
        stripeVerificationId: campaigns.stripeVerificationId,
        // The row's own currency; without it these screens printed every
        // campaign's money as dollars (`docs/92`).
        currency: campaigns.currency,
        goalAmount: campaigns.goalAmount,
        raisedAmount: campaigns.raisedAmount,
        totalReleasedAmount: campaigns.totalReleasedAmount,
        creatorId: campaigns.creatorId,
        createdAt: campaigns.createdAt,
        updatedAt: campaigns.updatedAt,
        creatorName: users.name,
        creatorEmail: users.email,
      })
      .from(campaigns)
      .leftJoin(users, eq(campaigns.creatorId, users.id))
      .where(excludedStatuses)
      .orderBy(desc(campaigns.updatedAt))
      .limit(500),
    db
      .select({
        /*
          docs/88 F16: the true size of the queue, under the same
          predicate as the fetch above, so the footer can say how many
          of it the 500-row cap actually loaded.
        */
        totalInQueue: sql<number>`count(*)::int`,
        totalPending: sql<number>`count(*) FILTER (WHERE ${campaigns.verificationStatus} IN ('documents_uploaded','submitted_for_review'))::int`,
        totalIdentityVerified: sql<number>`count(*) FILTER (WHERE ${campaigns.verificationStatus} = 'identity_verified')::int`,
        totalFullyVerified: sql<number>`count(*) FILTER (WHERE ${campaigns.verificationStatus} = 'fully_verified')::int`,
        totalRejected: sql<number>`count(*) FILTER (WHERE ${campaigns.verificationStatus} = 'rejected')::int`,
      })
      .from(campaigns)
      .where(sql`${campaigns.verificationStatus} NOT IN ('unverified','verified')`),
  ]);

  const campaignIds = queuedCampaigns.map((c) => c.id);

  if (campaignIds.length === 0) {
    return (
      <>
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Verification Queue</h1>
          <p className="text-sm text-muted-foreground">No campaigns in verification queue</p>
        </div>
        <VerificationQueue initialItems={[]} stats={stats} />
      </>
    );
  }

  // Document counts per campaign
  const docCountsRaw = await db
    .select({
      campaignId: verificationDocuments.campaignId,
      docCount: count(),
    })
    .from(verificationDocuments)
    .where(inArray(verificationDocuments.campaignId, campaignIds))
    .groupBy(verificationDocuments.campaignId);

  const docCounts = Object.fromEntries(docCountsRaw.map((c) => [c.campaignId, c.docCount]));

  const serialized = queuedCampaigns.map((c) => ({
    ...c,
    documentCount: docCounts[c.id] || 0,
    stripeVerificationId: c.stripeVerificationId ?? null,
    totalReleasedAmount: c.totalReleasedAmount ?? 0,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    verificationReviewedAt: c.verificationReviewedAt?.toISOString() ?? null,
    publishedAt: c.publishedAt?.toISOString() ?? null,
  }));

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Verification Queue</h1>
        <p className="text-sm text-muted-foreground">
          {serialized.length} {serialized.length === 1 ? 'campaign' : 'campaigns'} in verification
        </p>
      </div>
      <VerificationQueue initialItems={serialized} stats={stats} />
    </>
  );
}
