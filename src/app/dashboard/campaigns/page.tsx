import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { Card, CardContent } from '@/components/ui/card';
import { CampaignsListClient } from '@/components/dashboard/CampaignsListClient';
import { CampaignStats } from '@/components/dashboard/CampaignStats';
import { PlusIcon } from '@/components/ui/icon';
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
      // A fundraising platform's campaigns ARE photographs. Rendering them as
      // grey text blocks is the single loudest amateur signal on this screen.
      heroImageUrl: campaigns.heroImageUrl,
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
      {/*
        ── ONE ROW, AND THE SUBTITLE IS GONE ──────────────────────────────────
        "Manage your fundraising campaigns" under a heading that says "My
        Campaigns" is a label explaining a label. It cost a line of the fold
        and told a reader nothing they had not just read.

        The button also wrapped to two lines at 390px ("+ Create" / "Campaign")
        because a 4-word label sat beside a 2-word heading in a
        `justify-between`. It is "New" on a phone and "New campaign" from `sm`
        up, so the row stays one line at every width.
      */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-xl font-bold text-foreground sm:text-2xl">
          My Campaigns
        </h1>
        <Link
          href="/share-your-story"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-elevated sm:px-4"
        >
          <PlusIcon size="sm" aria-hidden />
          <span className="sm:hidden">New</span>
          <span className="hidden sm:inline">New campaign</span>
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

      {/*
        The figures, above the list. Somebody with four campaigns had to add
        them up in their head to answer "how much have I raised".

        ⛔ Per currency, never summed (`docs/92`). Reads from the rows already
        in hand, so it costs no query - the pool is `max: 5` and `docs/87`
        caps an entry point at three.
      */}
      {serialized.length > 0 && (
        <div className="mt-5">
          <CampaignStats campaigns={serialized} />
        </div>
      )}

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
