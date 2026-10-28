import { notFound, redirect } from 'next/navigation';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { CampaignEditor } from '@/components/admin/CampaignEditor';
import type { Metadata } from 'next';
import type { ImpactTier } from '@/types';

export const metadata: Metadata = {
  title: 'Edit Campaign - Admin - LastDonor.org',
  robots: { index: false },
};

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  /*
    Admin-only, like `/admin/campaigns/new`: the form submits
    `PUT /api/v1/campaigns/[slug]`, which is `requireRole(['admin'])`.
    `src/app/admin/layout.tsx:30` admits `editor`, so the gate has to be here,
    and the links to this page are hidden from a non-admin in both
    `CampaignDetail` and `CampaignsList`. `docs/133`.
  */
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    redirect('/admin/campaigns');
  }

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);

  if (!campaign) notFound();

  const tiers = (campaign.impactTiers ?? []) as ImpactTier[];

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Edit Campaign</h1>
      <p className="mt-1 text-sm text-muted-foreground">{campaign.title}</p>
      <div className="mt-6">
        <CampaignEditor
          mode="edit"
          campaignId={campaign.id}
          defaultValues={{
            title: campaign.title,
            slug: campaign.slug,
            category: campaign.category,
            heroImageUrl: campaign.heroImageUrl,
            photoCredit: campaign.photoCredit ?? undefined,
            subjectName: campaign.subjectName,
            subjectHometown: campaign.subjectHometown ?? undefined,
            storyHtml: campaign.storyHtml,
            goalAmount: campaign.goalAmount,
            impactTiers: tiers,
          }}
          currentStatus={campaign.status}
        />
      </div>
    </div>
  );
}
