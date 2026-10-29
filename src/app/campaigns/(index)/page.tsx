import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheckIcon } from '@heroicons/react/24/solid';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, and, or, desc, asc, sql, ilike, gte } from 'drizzle-orm';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';
import { CategoryHeroSection } from '@/components/campaign/CategoryHeroSection';
import { CampaignFilters } from '../filters';
import { FilterNotice } from '../filter-notice';
import { resolveBrowseParams } from '../browse-params';
import { campaignSearchCondition } from '@/lib/campaign-search';
import { getCategoryContent } from '@/lib/category-content';
import { seoKeywords } from '@/lib/seo/keywords';

export const metadata: Metadata = {
  title: 'Browse Reviewed Medical & Emergency Crowdfunding Campaigns',
  description:
    'Real people who need help with medical bills, a disaster, or a family emergency. A person has checked every campaign. Every campaign is reviewed before publication. 0% platform fees.',
  keywords: seoKeywords('campaigns', 'medical', 'emergency', 'disaster', 'memorial', 'family', 'nonprofit', 'trust'),
  alternates: { canonical: 'https://lastdonor.org/campaigns' },
  openGraph: {
    title: 'Browse Reviewed Medical & Emergency Crowdfunding Campaigns | LastDonor',
    description:
      'Find reviewed medical fundraising, emergency relief, and disaster relief campaigns with visible progress and 0% platform fees.',
    url: 'https://lastdonor.org/campaigns',
    images: [
      {
        url: '/api/v1/og/page?title=Reviewed+Campaigns&subtitle=Browse+fundraisers+reviewed+before+publication.',
        width: 1200,
        height: 630,
        alt: 'Reviewed Crowdfunding Campaigns on LastDonor',
      },
    ],
  },
};

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

/**
 * Param validation, the alias table and the "not applied" rules live in
 * `./browse-params` because `/search` forwards the same params here.
 */
interface PageProps {
  searchParams: Promise<{
    category?: string;
    sort?: string;
    q?: string;
    location?: string;
    close_to_target?: string;
    status?: string;
  }>;
}

const PAGE_SIZE = 12;

const faqs = [
  {
    question: 'What fundraisers can I browse on LastDonor?',
    answer:
      'Medical bills, funerals, disasters and families in crisis. A person has checked every one.',
  },
  {
    question: 'Are campaigns reviewed before they appear here?',
    answer:
      'Yes. Campaigns listed on this page are reviewed before publication so donors can understand the need, the fundraising goal, and the available supporting context.',
  },
  {
    question: 'Can I search by cause or location?',
    answer:
      'Yes. Filter by what the money is for, or by where the person lives. You can also search by word, such as \'house fire\'.',
  },
  {
    question: 'What does close to target mean?',
    answer:
      'Close-to-target fundraisers are campaigns that are near their goal. They can be useful for donors who want to help complete a campaign and become the Last Donor.',
  },
];

export default async function CampaignsPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const {
    category: categoryFilter,
    sort,
    searchQuery,
    location: locationFilter,
    closeToTarget,
    filtersActive,
    unapplied,
    completedRequested,
  } = resolveBrowseParams(params);

  const categoryContent = categoryFilter ? getCategoryContent(categoryFilter) : null;

  // Build query conditions
  const statusFilter = or(
    eq(campaigns.status, 'active'),
    eq(campaigns.status, 'last_donor_zone'),
  )!;

  const filterParts = [statusFilter];

  if (categoryFilter) {
    filterParts.push(eq(campaigns.category, categoryFilter));
  }

  // One shared predicate (title, name, location, hometown, story prose,
  // category) so this page and the API cannot drift. See docs/45.
  const keywordCondition = campaignSearchCondition(searchQuery);
  if (keywordCondition) {
    filterParts.push(keywordCondition);
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

  if (closeToTarget) {
    filterParts.push(
      gte(
        sql`(${campaigns.raisedAmount}::float / NULLIF(${campaigns.goalAmount}, 0))`,
        0.9,
      ),
    );
  }

  const conditions = and(...filterParts)!;

  // Build order - always include a tiebreaker (id) so offset pagination is deterministic
  const primaryOrder = (() => {
    switch (sort) {
      case 'most_funded':
        return desc(campaigns.raisedAmount);
      case 'least_funded':
        return asc(campaigns.raisedAmount);
      case 'closing_soon':
        return desc(sql`(${campaigns.raisedAmount}::float / NULLIF(${campaigns.goalAmount}, 0))`);
      case 'newest':
      default:
        return desc(campaigns.publishedAt);
    }
  })();

  // Fetch campaigns + counts in parallel. The unfiltered counts drive the
  // status tabs; `matchedCountRow` is what the header above the list reports,
  // because printing the unfiltered total above a filtered list contradicted
  // the list itself (docs/45).
  const [results, tabCounts, matchedCountRow] = await Promise.all([
    db
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
        publishedAt: campaigns.publishedAt,
      })
      .from(campaigns)
      .where(conditions)
      .orderBy(primaryOrder, asc(campaigns.id))
      .limit(PAGE_SIZE + 1),
    /*
      docs/87 amendment 5. The tab counts were three separate scans of
      `campaigns` running beside the listing query, four connections for
      one page view on the busiest public route. They are FILTER
      aggregates over one scan now; the filtered count keeps its own
      query because its predicate is built from the request.
    */
    db
      .select({
        active: sql<number>`count(*) FILTER (WHERE ${campaigns.status} IN ('active','last_donor_zone'))::int`,
        completed: sql<number>`count(*) FILTER (WHERE ${campaigns.status} IN ('completed','archived'))::int`,
      })
      .from(campaigns),
    filtersActive
      ? db.select({ count: sql<number>`COUNT(*)` }).from(campaigns).where(conditions)
      : Promise.resolve(null),
  ]);

  const activeCount = Number(tabCounts[0]?.active ?? 0);
  const completedCount = Number(tabCounts[0]?.completed ?? 0);
  const matchedCount = filtersActive ? Number(matchedCountRow?.[0]?.count ?? 0) : activeCount;

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
      {categoryContent && <CategoryHeroSection content={categoryContent} />}

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* A param we could not apply is reported, never dropped in silence. */}
        <FilterNotice
          unapplied={unapplied}
          completedRequested={completedRequested}
          filtersActive={filtersActive}
        />

        {categoryContent ? (
          <h2 className="mb-6 font-display text-xl font-bold text-foreground sm:text-2xl">
            Browse {categoryContent.label.toLowerCase()} fundraisers
          </h2>
        ) : (
          <>
            {/* Header: emotional headline + social-proof count + trust anchor.
                Psychology: Anchoring (concrete number), Authority (reviewed), Zero-Knowledge Proof. */}
            <header className="mb-6">
              <h1 className="font-display text-[1.6rem] font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
                Reviewed Fundraisers Raising Money Right Now
              </h1>
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <ShieldCheckIcon className="h-4 w-4 text-brand-teal" aria-hidden="true" />
                {filtersActive ? (
                  <span>
                    <span className="font-semibold text-foreground tabular-nums">{matchedCount.toLocaleString('en-US')}</span>
                    {' '}of{' '}
                    <span className="font-semibold text-foreground tabular-nums">{activeCount.toLocaleString('en-US')}</span>
                    {' '}active {activeCount === 1 ? 'campaign' : 'campaigns'} match these filters
                  </span>
                ) : (
                  <span>
                    <span className="font-semibold text-foreground tabular-nums">{activeCount.toLocaleString('en-US')}</span>{' '}active {activeCount === 1 ? 'campaign' : 'campaigns'}
                  </span>
                )}
                {/*
                  Hidden below `sm`. This paragraph is `flex flex-wrap`, so
                  on a phone "Each one reviewed before going live" wraps to
                  its own line and the separator was left dangling at the
                  end of the line above it, as a middot with nothing after
                  it. A separator only separates when both sides share a
                  line. See docs/71.
                */}
                <span aria-hidden="true" className="hidden text-border sm:inline">·</span>
                <span>Each one reviewed before going live</span>
              </p>
            </header>

            {/*
              The tab strip only earns its 66px when there is a second tab
              worth taking. With no completed campaigns it rendered
              "Active 12 | Completed 0", where the second tab links to an
              empty page and the first repeats the count stated one line
              above it.

              Part of getting the first card nearer the top: measured
              2026-10-16, a visitor saw 486px of chrome before any campaign
              on a 844px screen, 58% of the fold, against GoFundMe's 238px
              (28%). See docs/71.
            */}
            {/*
              A `nav`, not a `tablist`, and that is a correction.

              This was `role="tablist"` with `role="tab"` on both children,
              and none of the tabs pattern was present: there is no
              `tabpanel` in this document, no `aria-controls`, no roving
              tabindex and no arrow-key handling. Worse, the two children
              were the wrong kind of thing for the role:

                - "Active" was a `role="tab"` on a plain `<span>`, so it
                  announced as a tab and could not be focused at all.
                - "Completed" was `role="tab"` on a `<Link>`. An ARIA role
                  REPLACES native semantics, so the anchor stopped being
                  announced as a link - while still navigating to a
                  different page on activation. A screen-reader user was
                  told "tab, Completed", expected a panel to swap in place,
                  and lost their position in the document instead.

              What it actually is: the current page's label plus a link to
              another page. `aria-current="page"` is the attribute for
              that, and the segmented-control look is unchanged.

              Not caught by axe because this block only renders when a
              completed campaign exists, and the review gate (docs/79) left
              that count at zero - so the markup was unreachable on the
              live site and in every probe. Found while fixing the same
              class of mistake in `HowItWorks` (docs/99).
            */}
            {completedCount > 0 && (
            <nav
              aria-label="Campaign status"
              className="mb-6 inline-flex rounded-full border border-border bg-muted/50 p-1 text-sm font-semibold"
            >
              <span
                aria-current="page"
                className="rounded-full bg-background px-4 py-1.5 text-foreground shadow-[--shadow-elevation-1]"
              >
                Active
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  {activeCount.toLocaleString('en-US')}
                </span>
              </span>
              <Link
                href="/completed-campaigns"
                className="rounded-full px-4 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                Completed
                <span className="ml-1.5 tabular-nums">
                  {completedCount.toLocaleString('en-US')}
                </span>
              </Link>
            </nav>
            )}
          </>
        )}

        {/* Filters & sort. Rendered in BOTH branches: when a category resolved,
            this bar was omitted entirely, which left a filtered URL with no
            visible way back out (docs/45). */}
        <CampaignFilters
          activeCategory={categoryFilter}
          activeSort={sort}
          activeCloseToTarget={closeToTarget}
          searchQuery={searchQuery}
          activeLocation={locationFilter}
        />

        {/* Campaign grid with client-side "Load More" */}
        <CampaignGrid
          key={`${categoryFilter ?? ''}-${sort}-${searchQuery}-${locationFilter}-${closeToTarget}`}
          initialCampaigns={displayedCampaigns}
          initialCursor={nextCursor}
          initialHasMore={hasMore}
          categoryFilter={categoryFilter}
          sort={sort}
          searchQuery={searchQuery}
          locationFilter={locationFilter}
          closeToTarget={closeToTarget}
          emptyMessage={filtersActive ? 'No campaigns match these filters.' : undefined}
          emptyAction={
            filtersActive ? (
              <Link
                href="/campaigns"
                className="mt-4 inline-block rounded-full border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Clear filters
              </Link>
            ) : undefined
          }
        />

        <section className="mt-12 border-t border-border pt-10" aria-labelledby="campaigns-faq">
          <h2 id="campaigns-faq" className="font-display text-2xl font-bold text-foreground">
            Fundraiser Search FAQ
          </h2>
          <dl className="mt-5 grid gap-5 md:grid-cols-2">
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
