import type { Metadata } from 'next';
import { readFxSnapshot } from '@/lib/money/fx-store.server';
import Link from 'next/link';
import { GeneralFundCta } from '@/components/GeneralFundCta';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, and, desc, asc, ilike, or } from 'drizzle-orm';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';
import { CompletedCampaignFilters } from './filters';
import { seoKeywords } from '@/lib/seo/keywords';
import { resolveCategory, type UnappliedParam } from '@/app/campaigns/browse-params';
import { FilterNotice } from '@/app/campaigns/filter-notice';
import { completedCampaignFilter } from '@/db/public-campaigns';

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

/*
  ⛔ THE 23 CATEGORIES ARE NOT RESTATED HERE. This file held its own copy -
  one of several - and resolved `?category=` with
  `VALID_CATEGORIES.includes(x) ? x : null`, which had three consequences
  (`docs/165`):

    1. An UNRECOGNISED value was indistinguishable from no filter, so
       `?category=garbage` served every completed campaign with nothing
       saying the filter had been dropped. That is what
       `browse-params.ts`'s own header forbids: *"never silently widen the
       result set"* (`docs/45`) - a rule decided for `/campaigns`, swept to
       `/blog` by `docs/164`, and never swept here.
    2. No ALIAS resolution, so `?category=disaster-relief` - the slug the
       product's own menu DISPLAYS - was dropped here and resolved by
       `/campaigns`. [VERIFIED live: 1 card there, 12 here.]
    3. A copy that drifts from the enum.

  `resolveCategory` answers all three, and it is the same function
  `/campaigns` uses, so the two browse surfaces cannot disagree again.
*/

/*
  ⚠️ The SORT list is deliberately NOT shared with `browse-params.ts`, which
  has a fourth option: `closing_soon`. A completed campaign has no deadline
  left to close, so offering it here would be a control that cannot mean
  anything. Three is the right number for this page.
*/
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

  /*
    A value we cannot apply is REPORTED, never dropped (`docs/45`). The two
    halves are separate on purpose: `category` NARROWS the list, so dropping
    it in silence makes every row read as a match; `sort` only reorders the
    same rows, so it can never explain an empty page - but an unrecognised
    sort still silently gave the visitor a different order than they asked
    for, which is its own small lie.
  */
  const unapplied: UnappliedParam[] = [];

  const rawCategory = typeof params.category === 'string' ? params.category.trim() : '';
  const categoryFilter = rawCategory ? resolveCategory(rawCategory) : null;
  if (rawCategory && !categoryFilter) {
    unapplied.push({ key: 'category', value: rawCategory.slice(0, 60) });
  }

  const rawSort = typeof params.sort === 'string' ? params.sort.trim() : '';
  const sort: SortOption = VALID_SORTS.includes(rawSort as SortOption)
    ? (rawSort as SortOption)
    : 'most_funded';
  if (rawSort && !VALID_SORTS.includes(rawSort as SortOption)) {
    unapplied.push({ key: 'sort', value: rawSort.slice(0, 60) });
  }

  const searchQuery = typeof params.q === 'string' ? params.q.trim().slice(0, 100) : '';
  const locationFilter = typeof params.location === 'string' ? params.location.trim().slice(0, 100) : '';

  // Build query conditions
  // ⛔ The SAME set the `/campaigns` tab counts (docs/146). Keep these two
  // reading one constant: the badge counted `completed + archived` and this
  // listed `completed`, so it advertised 1 over an empty page.
  const filterParts = [completedCampaignFilter()];

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


  /*
    The exchange-rate snapshot, read SEQUENTIALLY and never inside a
    `Promise.all`. `src/db/pool-fanout.ratchet.test.ts` caps an entry point at
    three CONCURRENT queries against a pool of five, and a fourth in parallel
    is how `/admin/settings` came to take 15 seconds and leave wedged
    backends (`docs/87`).

    `null` is a normal outcome, not an error: before the first
    `refresh-fx-rates` run, and in a build with no `DATABASE_URL`
    (`docs/119`), there is no snapshot and the cards render no approximate
    figure - never a wrong one.
  */
  const fxSnapshot = await readFxSnapshot();

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

      {/* A param we could not apply is reported, never dropped in silence. */}
      <FilterNotice
        unapplied={unapplied}
        /*
          `completedRequested` is for `/campaigns` telling a visitor that
          `?status=completed` is served by THIS page. Here it would point at
          itself, so it is always false.
        */
        completedRequested={false}
        filtersActive={Boolean(categoryFilter || searchQuery || locationFilter)}
      />

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
        fxSnapshot={fxSnapshot}
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
