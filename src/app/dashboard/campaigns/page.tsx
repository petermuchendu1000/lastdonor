import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { Card, CardContent } from '@/components/ui/card';
import { CampaignsListClient } from '@/components/dashboard/CampaignsListClient';
import { SubmittedForReviewNotice } from '@/components/dashboard/SubmittedForReviewNotice';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Campaigns - Dashboard - LastDonor.org',
  robots: { index: false },
};

export default async function CampaignsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/dashboard/campaigns');

  const myCampaigns = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      slug: campaigns.slug,
      status: campaigns.status,
      category: campaigns.category,
      goalAmount: campaigns.goalAmount,
      raisedAmount: campaigns.raisedAmount,
      donorCount: campaigns.donorCount,
      verificationStatus: campaigns.verificationStatus,
      // Needed to name the raise cap in the organiser's own money.
      currency: campaigns.currency,
      createdAt: campaigns.createdAt,
    })
    .from(campaigns)
    .where(eq(campaigns.creatorId, session.user.id))
    .orderBy(desc(campaigns.createdAt));

  const serialized = myCampaigns.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">My Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your fundraising campaigns
          </p>
        </div>
        <Link
          href="/share-your-story"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          + Create Campaign
        </Link>
      </div>

      {/*
        The landing place after the wizard. Submitting used to redirect to
        `/campaigns/<slug>?launched=true`, which has 404'd for every organiser
        since the review gate landed (docs/78, docs/79) - the campaign is
        `under_review` and the public page does not serve that status. See the
        component header.
      */}
      <Suspense fallback={null}>
        <SubmittedForReviewNotice />
      </Suspense>

      {serialized.length === 0 ? (
        <Card className="mt-6">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              You haven&apos;t created any campaigns yet.{' '}
              <Link href="/share-your-story" className="text-brand-teal underline">
                Start one now
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : (
        <CampaignsListClient campaigns={serialized} />
      )}
    </>
  );
}
