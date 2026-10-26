import type { Metadata } from 'next';
import { db } from '@/db';
import { campaigns, users } from '@/db/schema';
import { eq, desc, sql, and, isNotNull, or } from 'drizzle-orm';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Money } from '@/components/ui/Money';
import { formatDate } from '@/lib/utils/dates';
import Link from 'next/link';
import { seoKeywords } from '@/lib/seo/keywords';

export const metadata: Metadata = {
  title: 'Last Donor Wall',
  description:
    'Every completed campaign has a final donor. The person who pushed it over the finish line. This wall is for them.',
  keywords: seoKeywords('donor', 'campaigns', 'trust'),
  alternates: { canonical: 'https://lastdonor.org/last-donor-wall' },
  openGraph: {
    title: 'Last Donor Wall | LastDonor.org',
    description:
      'The people who gave the final donation to complete a campaign. This wall is for them.',
    images: [
      {
        url: '/api/v1/og/page?title=The+Last+Donor+Wall&subtitle=The+people+who+gave+the+final+dollar+to+finish+a+campaign.',
        width: 1200,
        height: 630,
        alt: 'Last Donor Wall on LastDonor.org',
      },
    ],
  },
};

export const revalidate = 300;

export default async function LastDonorWallPage() {
  // Get completed campaigns that have a last donor (registered user or seed donor)
  const completedCampaigns = await db
    .select({
      campaignTitle: campaigns.title,
      campaignSlug: campaigns.slug,
      goalAmount: campaigns.goalAmount,
      // Selected because it is RENDERED: without it the figures below were
      // formatted as USD whatever currency the row is in (`docs/92`).
      currency: campaigns.currency,
      completedAt: campaigns.completedAt,
      lastDonorName: sql<string>`COALESCE(${users.name}, ${campaigns.lastDonorName})`.as('last_donor_name'),
    })
    .from(campaigns)
    .leftJoin(users, eq(campaigns.lastDonorId, users.id))
    .where(
      and(
        eq(campaigns.status, 'completed'),
        or(
          isNotNull(campaigns.lastDonorId),
          isNotNull(campaigns.lastDonorName),
        ),
      ),
    )
    .orderBy(desc(campaigns.completedAt))
    .limit(100);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': 'https://lastdonor.org/last-donor-wall#webpage',
        url: 'https://lastdonor.org/last-donor-wall',
        name: 'Last Donor Wall',
        description:
          'The people who made the final donation to push a campaign over the finish line.',
        isPartOf: { '@id': 'https://lastdonor.org/#website' },
        about: { '@id': 'https://lastdonor.org/#organization' },
      },
      {
        '@type': 'ItemList',
        '@id': 'https://lastdonor.org/last-donor-wall#list',
        name: 'Last Donor Wall',
        description:
          'The people who made the final donation to push a campaign over the finish line.',
        itemListElement: completedCampaigns.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: `${c.lastDonorName ?? 'Anonymous'} - ${c.campaignTitle}`,
        })),
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <Breadcrumbs />
        <h1 className="mt-6 font-display text-4xl font-bold text-foreground">
          Last Donor Wall
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Every campaign has a finish line. These are the people who got it
          there. The ones who gave the final donation and made it done.
        </p>

        {completedCampaigns.length > 0 ? (
          <div className="mt-10 space-y-4">
            {completedCampaigns.map((c) => (
              <div
                key={c.campaignSlug}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <Link
                    href={`/campaigns/${c.campaignSlug}`}
                    className="font-display text-lg font-semibold text-foreground hover:text-primary"
                  >
                    {c.campaignTitle}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    Goal: <Money minor={c.goalAmount} currency={c.currency} precision="exact" />
                    {c.completedAt && (
                      <> · Completed {formatDate(c.completedAt)}</>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-lg font-bold text-primary">
                    {c.lastDonorName ?? 'Anonymous'}
                  </p>
                  <p className="text-xs text-muted-foreground">Last Donor</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-16 text-center">
            <p className="text-lg text-muted-foreground">
              No completed campaigns yet. You could be the first Last Donor.
            </p>
            <Link
              href="/campaigns"
              className="mt-4 inline-flex rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground"
            >
              Browse Campaigns
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
