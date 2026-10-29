import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, and, desc, isNotNull } from 'drizzle-orm';
import { CATEGORY_LABELS, CATEGORY_COLORS } from '@/lib/categories';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/Money';
import type { CampaignCategory } from '@/types';

export const revalidate = 300; // 5 minutes

export const metadata: Metadata = {
  title: 'Removed Campaigns',
  description:
    'Transparency report: campaigns that were reviewed and removed from the platform, with reasons. We take donor trust seriously.',
  alternates: { canonical: 'https://lastdonor.org/cancelled-campaigns' },
  robots: { index: false, follow: true },
  openGraph: {
    title: 'Removed Campaigns | LastDonor.org',
    description:
      'See why certain campaigns were removed. Our commitment to donor protection in action.',
  },
};

export default async function CancelledCampaignsPage() {
  const cancelledCampaigns = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      slug: campaigns.slug,
      category: campaigns.category,
      location: campaigns.location,
      subjectName: campaigns.subjectName,
      cancellationReason: campaigns.cancellationReason,
      cancelledAt: campaigns.cancelledAt,
      raisedAmount: campaigns.raisedAmount,
      goalAmount: campaigns.goalAmount,
      // Selected because it is RENDERED: without it the figures below were
      // formatted as USD whatever currency the row is in (`docs/92`).
      currency: campaigns.currency,
      donorCount: campaigns.donorCount,
    })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.status, 'cancelled'),
        isNotNull(campaigns.cancellationReason),
      ),
    )
    .orderBy(desc(campaigns.cancelledAt))
    .limit(50);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-display text-2xl font-bold text-foreground">Removed Campaigns</h1>
        <Link
          href="/campaigns"
          className="text-sm font-medium text-primary hover:text-primary/80"
        >
          Browse active campaigns
        </Link>
      </div>

      {/* Explanation */}
      <div className="mt-4 rounded-xl border border-border bg-card p-5">
        <div className="flex gap-3">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-foreground">Your donations are protected</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Every campaign on LastDonor.org goes through editorial review. Campaigns that don&apos;t meet our standards are removed and donors are notified. This page exists so you can see our commitment to transparency and accountability in action.
            </p>
          </div>
        </div>
      </div>

      {/* Campaigns list */}
      {cancelledCampaigns.length === 0 ? (
        <div className="mt-16 text-center">
          <p className="text-lg text-muted-foreground">
            No campaigns have been rejected at this time.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {cancelledCampaigns.map((campaign) => (
            <Link
              key={campaign.id}
              href={`/campaigns/${campaign.slug}`}
              className="block rounded-xl border border-border bg-card p-5 transition-colors hover:bg-muted/50"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-foreground">
                      {campaign.title}
                    </h2>
                    <Badge
                      variant="outline"
                      className="border-red-200 bg-red-50 text-xs text-red-700 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-400"
                    >
                      Removed
                    </Badge>
                    {campaign.category && (
                      <Badge
                        variant="outline"
                        className={`border-0 text-xs ${CATEGORY_COLORS[campaign.category as CampaignCategory] ?? ''}`}
                      >
                        {CATEGORY_LABELS[campaign.category as CampaignCategory] ?? campaign.category}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {campaign.subjectName}
                    {campaign.location && ` · ${campaign.location}`}
                    {campaign.cancelledAt && (
                      <> · Removed {new Date(campaign.cancelledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                    )}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p className="font-mono font-medium">
                    <Money minor={campaign.raisedAmount} currency={campaign.currency} precision="exact" /> raised
                  </p>
                  <p>{campaign.donorCount} {campaign.donorCount === 1 ? 'donor' : 'donors'}</p>
                </div>
              </div>

              {/* Reason */}
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-950/20">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Reason for removal</p>
                <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-200/90">
                  {campaign.cancellationReason}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Footer note */}
      <div className="mt-12 border-t border-border pt-6 text-center">
        <p className="text-sm text-muted-foreground">
          If you believe a campaign was removed in error, please contact{' '}
          <a href="mailto:editorial@lastdonor.org" className="text-primary underline hover:text-primary/80">
            editorial@lastdonor.org
          </a>
        </p>
      </div>
    </div>
  );
}
