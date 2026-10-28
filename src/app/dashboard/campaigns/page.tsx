import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { listMyCampaigns } from '@/lib/dashboard/my-campaigns.server';
import { Card, CardContent } from '@/components/ui/card';
import { CampaignsListClient } from '@/components/dashboard/CampaignsListClient';
import { CampaignStats } from '@/components/dashboard/CampaignStats';
import { PlusIcon } from '@/components/ui/icon';
import { SubmittedForReviewNotice } from '@/components/dashboard/SubmittedForReviewNotice';
import { JoinedTeamNotice } from '@/components/dashboard/JoinedTeamNotice';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Campaigns - Dashboard - LastDonor.org',
  robots: { index: false },
};

export default async function CampaignsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/dashboard/campaigns');

  /*
    ⛔ Campaigns this person CREATED **or helps with**.

    This was `where(eq(campaigns.creatorId, session.user.id))`, so a
    collaborator who had just accepted an invitation landed here - the accept
    flow redirects to this very page - and read "You haven't created any
    campaigns yet". [VERIFIED 2026-10-27, three ways at the same moment] the
    membership row was live and accepted, `GET /api/v1/user-campaigns/<id>`
    answered 200 for that session, and none of the twelve signed-in dashboard
    routes named the campaign. See `docs/117`.

    Still ONE query - `listMyCampaigns` folds membership into the same
    statement, because this route is inside the three-concurrent-query
    ceiling (`docs/87`) and a second read would have been a change to that
    budget rather than to this screen.
  */
  const myCampaigns = await listMyCampaigns(session.user.id);

  const serialized = myCampaigns.map((c) => ({
    ...c,
    heroImageUrl: c.heroImageUrl ?? '',
    createdAt: c.createdAt.toISOString(),
    publishedAt: c.publishedAt?.toISOString() ?? null,
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
      {/*
        The other way somebody arrives on this page: they accepted an
        invitation. `?joined=1` was set by the accept flow and read by
        NOTHING until `docs/117`.
      */}
      <JoinedTeamNotice />
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
