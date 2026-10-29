import type { Metadata } from 'next';
import Link from 'next/link';
import { GeneralFundCta } from '@/components/GeneralFundCta';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, and, desc, asc, ilike, or, inArray } from 'drizzle-orm';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';
import { CompletedCampaignFilters } from './filters';
import { seoKeywords } from '@/lib/seo/keywords';
import { COMPLETED_STATUSES } from '@/lib/campaign-visibility';
import type { CampaignCategory } from '@/types';

/*
  NO `revalidate` HERE, DELIBERATELY.

  This page reads `searchParams`, which makes it dynamic in Next 15 - its
  output depends on the query string, so it cannot be prerendered or
  ISR-cached. It used to carry `export const revalidate = 300` and that line
  was INERT.

  Measured against production on 2026-10-24: this route answers
  `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`,
  while the five `revalidate` pages that do NOT read `searchParams` answer
  `s-maxage=300, stale-while-revalidate=...`. The correlation was exact
  across all ten.

  Same class as the sixteen inert `revalidate` exports docs/88 removed from
  the admin tree: a cache directive that reads as a promise and does nothing.
  `src/app/revalidate-honesty.ratchet.test.ts` fails the build if the two are
  combined again.
*/

export const metadata: Metadata = {
  title: 'Completed Campaigns',
  description:
    'Campaigns that reached their goal. See what the money paid for.',
  keywords: seoKeywords('campaigns', 'trust', 'medical', 'emergency', 'memorial', 'family'),
  alternates: { canonical: 'https://lastdonor.org/completed-campaigns' },
  openGraph: {
    title: 'Completed Campaigns | LastDonor.org',
    description:
      'Campaigns that reached their goals. Every dollar made a difference.',
    images: [
      {
        url: '/api/v1/og/page?title=Completed+Campaigns&subtitle=See+the+impact+your+donations+made.',
        width: 1200,
        height: 630,
        alt: 'Completed Campaigns on LastDonor.org',
      },
    ],
  },
};

const VALID_CATEGORIES: CampaignCategory[] = [
  'medical', 'memorial', 'emergency', 'charity', 'education', 'animal',
  'environment', 'business', 'community', 'competition', 'creative', 'event',
  'faith', 'family', 'sports', 'travel', 'volunteer', 'wishes',
  'military', 'veterans', 'first-responders', 'disaster', 'essential-needs',
];

const VALID_SORTS = ['newest', 'most_funded', 'least_funded'] as const;
type SortOption = (typeof VALID_SORTS)[number];

interface PageProps {
  searchParams: Promise<{
    category?: string;
    sort?: string;
    q?: string;
    location?: string;
  }>;
}

const PAGE_SIZE = 12;

const faqs = [
  {
    question: 'What is a completed campaign?',
    answer:
      /*
        ⛔ "or was archived after completion" was removed (docs/146). This page
        has never listed archived campaigns, so that clause described a set its
        own query excludes - and `archived` is also what a DELETED campaign
        holds, so the sentence promised outcomes for campaigns that completed
        nothing. The copy now describes exactly what the list contains.
      */
      'A completed campaign is a fundraiser that reached its goal. Completed campaign pages help donors review outcomes and impact updates.',
  },
  {
    question: 'Can I browse completed medical or emergency fundraisers?',
    answer:
      'Yes. Filter by what the money was for, or by where the person lives.',
  },
  {
    question: 'What is the Last Donor?',
    answer:
      'The Last Donor is the person whose donation completes a campaign goal. Completed campaigns may also appear on the Last Donor Wall.',
  },
];

export default async function CompletedCampaignsPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const categoryFilter = VALID_CATEGORIES.includes(params.category as CampaignCategory)
    ? (params.category as CampaignCategory)
    : null;

  const sort: SortOption = VALID_SORTS.includes(params.sort as SortOption)
    ? (params.sort as SortOption)
    : 'most_funded';

  const searchQuery = typeof params.q === 'string' ? params.q.trim().slice(0, 100) : '';
  const locationFilter = typeof params.location === 'string' ? params.location.trim().slice(0, 100) : '';

  // Build query conditions
  // ⛔ The SAME set the `/campaigns` tab counts (docs/146). Keep these two
  // reading one constant: the badge counted `completed + archived` and this
  // listed `completed`, so it advertised 1 over an empty page.
  const filterParts = [inArray(campaigns.status, [...COMPLETED_STATUSES])];

  if (categoryFilter) {
    filterParts.push(eq(campaigns.category, categoryFilter));
  }

  if (searchQuery) {
    const pattern = `%${searchQuery}%`;
    filterParts.push(
      or(
        ilike(campaigns.title, pattern),
        ilike(campaigns.subjectName, pattern),
        ilike(campaigns.location, pattern),
        ilike(campaigns.subjectHometown, pattern),
      )!,
    );
  }

  if (locationFilter) {
    const locPattern = `%${locationFilter}%`;
    filterParts.push(
      or(
        ilike(campaigns.location, locPattern),
        ilike(campaigns.subjectHometown, locPattern),
      )!,
    );
  }

  const conditions = and(...filterParts)!;

  const orderBy = (() => {
    switch (sort) {
      case 'most_funded':
        return desc(campaigns.raisedAmount);
      case 'least_funded':
        return asc(campaigns.raisedAmount);
      case 'newest':
        return desc(campaigns.completedAt);
      default:
        return desc(campaigns.raisedAmount);
    }
  })();

  const results = await db
    .select({
      id: campaigns.id,
      slug: campaigns.slug,
      title: campaigns.title,
      heroImageUrl: campaigns.heroImageUrl,
      subjectName: campaigns.subjectName,
      subjectHometown: campaigns.subjectHometown,
      campaignOrganizer: campaigns.campaignOrganizer,
      category: campaigns.category,
      raisedAmount: campaigns.raisedAmount,
      currency: campaigns.currency,
      goalAmount: campaigns.goalAmount,
      donorCount: campaigns.donorCount,
      location: campaigns.location,
      status: campaigns.status,
      completedAt: campaigns.completedAt,
    })
    .from(campaigns)
    .where(conditions)
    .orderBy(orderBy)
    .limit(PAGE_SIZE + 1);

  const hasMore = results.length > PAGE_SIZE;
  const displayedCampaigns = hasMore ? results.slice(0, PAGE_SIZE) : results;
  const nextCursor = hasMore ? String(PAGE_SIZE) : null;
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-display text-2xl font-bold text-foreground">Completed Campaigns</h1>
        <Link
          href="/campaigns"
          className="text-sm font-medium text-primary hover:text-primary/80"
        >
          Browse active campaigns
        </Link>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Campaigns that successfully reached their goals. See the impact your donations made.
      </p>

      <div className="mt-6">
        <CompletedCampaignFilters
          activeCategory={categoryFilter}
          activeSort={sort}
          searchQuery={searchQuery}
          activeLocation={locationFilter}
        />
      </div>

      <CampaignGrid
        key={`${categoryFilter ?? ''}-${sort}-${searchQuery}-${locationFilter}`}
        initialCampaigns={displayedCampaigns}
        initialCursor={nextCursor}
        initialHasMore={hasMore}
        categoryFilter={categoryFilter}
        sort={sort}
        searchQuery={searchQuery}
        locationFilter={locationFilter}
        extraParams={{ status: 'completed' }}
        emptyMessage={categoryFilter
          ? 'No completed campaigns in this category yet.'
          : 'No completed campaigns yet. Check back soon.'}
        emptyAction={
          <Link
            href="/campaigns"
            className="mt-4 inline-block text-sm font-medium text-primary hover:text-primary/80"
          >
            Browse active campaigns
          </Link>
        }
      />
      <GeneralFundCta className="mt-12" />

      <section className="mt-12 border-t border-border pt-10" aria-labelledby="completed-faq">
        <h2 id="completed-faq" className="font-display text-2xl font-bold text-foreground">
          Completed Campaign FAQ
        </h2>
        <dl className="mt-5 grid gap-5 md:grid-cols-3">
          {faqs.map((faq) => (
            <div key={faq.question}>
              <dt className="font-semibold text-foreground">{faq.question}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
      </div>
    </>
  );
}
