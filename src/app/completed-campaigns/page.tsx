import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, and, desc, asc, ilike, or } from 'drizzle-orm';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';
import { CompletedCampaignFilters } from './filters';
import { seoKeywords } from '@/lib/seo/keywords';
import type { CampaignCategory } from '@/types';

export const revalidate = 300; // ISR: refresh every 5 minutes

export const metadata: Metadata = {
  title: 'Completed Campaigns | LastDonor.org',
  description:
    'Campaigns that reached their goal. They are closed now, but you can still read each story.',
  keywords: seoKeywords('campaigns', 'trust', 'medical', 'emergency', 'memorial', 'family'),
  alternates: { canonical: 'https://lastdonor.org/completed-campaigns' },
  openGraph: {
    title: 'Completed Campaigns | LastDonor.org',
    description:
      'Campaigns that reached their goal and closed. You can still read each story.',
    images: [
      {
        url: '/api/v1/og/page?title=Completed+Campaigns&subtitle=Campaigns+that+reached+their+goal.',
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
    question: 'What does completed mean?',
    answer:
      'It means the campaign reached its goal and closed. The page stays up, so you can still read the story and any updates.',
  },
  {
    question: 'Can I look for medical or emergency campaigns?',
    answer:
      'Yes. Use the filters to pick what the money was for. You can also filter by where the person lives.',
  },
  {
    question: 'What is the Last Donor?',
    answer:
      'The Last Donor is the person whose gift takes a campaign to its goal. Their name can show on the Last Donor Wall.',
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
  const filterParts = [eq(campaigns.status, 'completed')];

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
          Campaigns still open
        </Link>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        These campaigns reached their goal. They are closed, so you cannot give
        to them now. You can still read each story.
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
          ? 'No campaign of this kind has reached its goal yet.'
          : 'No campaign has reached its goal yet. This page fills up as campaigns finish.'}
        emptyAction={
          <Link
            href="/campaigns"
            className="mt-4 inline-block text-sm font-medium text-primary hover:text-primary/80"
          >
            See campaigns still open
          </Link>
        }
      />
      <section className="mt-12 border-t border-border pt-10" aria-labelledby="completed-faq">
        <h2 id="completed-faq" className="font-display text-2xl font-bold text-foreground">
          Common questions
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
