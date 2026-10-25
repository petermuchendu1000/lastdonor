import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { campaigns, verificationDocuments, infoRequests } from '@/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { CampaignVerificationDashboard } from '@/components/verification/CampaignVerificationDashboard';
import { JourneyChecklist } from '@/components/dashboard/JourneyChecklist';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Campaign Verification - LastDonor.org',
  robots: { index: false },
};

interface Props {
  params: Promise<{ id: string }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CampaignVerificationPage({ params }: Props) {
  const { id: idOrSlug } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/dashboard');

  // Look up by UUID or slug
  const campaignCondition = UUID_REGEX.test(idOrSlug)
    ? eq(campaigns.id, idOrSlug)
    : eq(campaigns.slug, idOrSlug);

  // Load campaign (must be owned by current user)
  const [campaign] = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      slug: campaigns.slug,
      status: campaigns.status,
      verificationStatus: campaigns.verificationStatus,
      verificationNotes: campaigns.verificationNotes,
      verificationReviewedAt: campaigns.verificationReviewedAt,
      goalAmount: campaigns.goalAmount,
      raisedAmount: campaigns.raisedAmount,
      /*
        ⚠️ Kept for history only (docs/81: Didit replaced Stripe Identity).
        The screen used to decide "verification in progress" from
        `stripeVerificationId`, which the Didit path NEVER writes - so the
        state was permanently false and the status poll never armed. The
        live columns are the two below. See docs/110.
      */
      stripeVerificationId: campaigns.stripeVerificationId,
      stripeVerificationUrl: campaigns.stripeVerificationUrl,
      diditSessionId: campaigns.diditSessionId,
      diditSessionUrl: campaigns.diditSessionUrl,
      currency: campaigns.currency,
      creatorId: campaigns.creatorId,
    })
    .from(campaigns)
    .where(and(campaignCondition, eq(campaigns.creatorId, session.user.id)))
    .limit(1);

  if (!campaign) {
    redirect('/dashboard');
  }

  const campaignId = campaign.id;

  // Load verification documents
  const documents = await db
    .select({
      id: verificationDocuments.id,
      documentType: verificationDocuments.documentType,
      fileName: verificationDocuments.fileName,
      fileSize: verificationDocuments.fileSize,
      mimeType: verificationDocuments.mimeType,
      description: verificationDocuments.description,
      fileUrl: verificationDocuments.fileUrl,
      status: verificationDocuments.status,
      reviewerNotes: verificationDocuments.reviewerNotes,
      reviewedAt: verificationDocuments.reviewedAt,
      createdAt: verificationDocuments.createdAt,
    })
    .from(verificationDocuments)
    .where(eq(verificationDocuments.campaignId, campaignId))
    .orderBy(desc(verificationDocuments.createdAt));

  // Load info requests (all statuses so user can see response history)
  const openInfoRequests = await db
    .select({
      id: infoRequests.id,
      message: infoRequests.details,
      deadline: infoRequests.deadline,
      status: infoRequests.status,
      createdAt: infoRequests.createdAt,
    })
    .from(infoRequests)
    .where(eq(infoRequests.campaignId, campaignId))
    .orderBy(desc(infoRequests.createdAt));

  // Serialize dates
  const serializedCampaign = {
    ...campaign,
    verificationReviewedAt: campaign.verificationReviewedAt?.toISOString() ?? null,
  };

  const serializedDocuments = documents.map((d) => ({
    ...d,
    reviewedAt: d.reviewedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  }));

  const serializedInfoRequests = openInfoRequests.map((r) => ({
    ...r,
    deadline: r.deadline?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <>
      {/*
        The same ladder as every other organiser screen, so somebody who
        arrives here from an email knows where this sits in the path and
        what it unblocks. See docs/110.
      */}
      <JourneyChecklist
        className="mb-6"
        heading="Where this fits"
        facts={{
          campaignId: campaign.id,
          status: campaign.status,
          verificationStatus: campaign.verificationStatus,
          currency: campaign.currency,
        }}
      />
      <CampaignVerificationDashboard
        campaign={serializedCampaign}
        documents={serializedDocuments}
        infoRequests={serializedInfoRequests}
      />
    </>
  );
}
