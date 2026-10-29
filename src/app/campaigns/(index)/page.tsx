import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheckIcon } from '@heroicons/react/24/solid';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, and, inArray, or, desc, asc, sql, ilike, gte } from 'drizzle-orm';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';
import { CategoryHeroSection } from '@/components/campaign/CategoryHeroSection';
import { CampaignFilters } from '../filters';
import { FilterNotice } from '../filter-notice';
import { Pagination } from '@/components/campaign/Pagination';
import { GeneralFundCta } from '@/components/GeneralFundCta';
import { paginationModel, parsePageParam } from '@/lib/pagination';
import { campaignsPageHref, resolveBrowseParams } from '../browse-params';
import { campaignSearchCondition } from '@/lib/campaign-search';
import { COMPLETED_STATUSES } from '@/lib/campaign-visibility';
import { listedCampaignFilter } from '@/db/public-campaigns';
import { getCategoryContent } from '@/lib/category-content';
import { seoKeywords } from '@/lib/seo/keywords';

/*
  ⛔ `generateMetadata`, not a static `metadata` object, and the reason is the
  canonical.

  This route used to export a static object whose `alternates.canonical` was
  the literal `https://lastdonor.org/campaigns`. Every URL under it therefore
  declared itself to BE page one - so once pagination exists, page two would
  assert it is the same document as page one, which is simply false: it holds
  different campaigns. [VERIFIED live before the change: `/campaigns?page=2`
  answered `index, follow` with `canonical: https://lastdonor.org/campaigns`.]

  ⚠️ The title differs per page too. Two indexable URLs sharing one title is a
  duplicate-title report in Search Console, and the suffix is the cheapest
  thing that makes each page's title true.

  ⚠️ FILTERED URLs keep canonicalising to `/campaigns`, exactly as before. That
  was the behaviour of the static object and changing it is a separate
  decision about whether a filtered listing deserves its own indexed URL.
*/
const BASE_TITLE = 'Browse Reviewed Medical & Emergency Crowdfunding Campaigns';

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const page = parsePageParam(params.page);
  // `campaignsPageHref` drops the param entirely for page 1, so page one of
  // every sequence stays the bare URL.
  const canonical = `https://lastdonor.org${campaignsPageHref(params, page)}`;

  return {
    ...metadata,
    title: page > 1 ? `${BASE_TITLE} (Page ${page})` : BASE_TITLE,
    alternates: { canonical },
  };
}

const metadata: Metadata = {
  title: BASE_TITLE,
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
    /**
     * 1-based page number. Absent means page 1.
     *
     * ⛔ Deliberately not in `BROWSE_PARAM_KEYS` - see `PAGE_PARAM` in
     * `browse-params.ts`. A filter change must reset to page 1.
     */
    page?: string;
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

  /*
    Build query conditions.

    ⛔ `listedCampaignFilter()`, not the raw status pair: this is a LISTING, so
    the platform's own general fund is excluded. It holds a listed status
    because that is the only way `payhero/initiate` will take a donation for
    it, and it is not an appeal for a named person. See `docs/147`.
  */
  const filterParts = [listedCampaignFilter()];

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

  /*
    The offset is derived from the REQUESTED page alone, so it is known before
    any query runs - which is what lets the rows query carry it.

    ⚠️ This is the load-bearing consequence of not clamping: a clamped page
    depends on the total, the total comes from a query in the same
    `Promise.all`, and a clamp would therefore need either a second round trip
    or a fourth concurrent query. `paginationModel` is built AFTER the rows
    arrive, and `pagination.offset` is asserted equal to this value.
  */
  const requestedPage = parsePageParam(params.page);
  const offset = (requestedPage - 1) * PAGE_SIZE;

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
      /*
        `asc(campaigns.id)` is not decoration: without a total order, two rows
        with equal `raisedAmount` can swap between the page-1 and page-2
        queries, so a campaign is shown twice or skipped entirely. It was
        already here, and offset pagination is what makes it load-bearing.
      */
      .orderBy(primaryOrder, asc(campaigns.id))
      .offset(offset)
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
        /*
          ⛔ The SAME predicate the rows query uses, for the reason `docs/146`
          established: the predicate that COUNTS a group must be the predicate
          that LISTS it. The tab said "Active 14" over a list of 14; with the
          general fund holding a listed status, the raw pair would have said
          15. Interpolating a condition into a `sql` template is the shape the
          `completed` line beside it already uses.
        */
        active: sql<number>`count(*) FILTER (WHERE ${listedCampaignFilter()})::int`,
        // ⛔ The SAME set `/completed-campaigns` lists. This counted
        // `IN ('completed','archived')` and linked to a page listing only
        // `completed`, so the tab read "Completed 1" over an empty page.
        // See docs/146.
        completed: sql<number>`count(*) FILTER (WHERE ${inArray(campaigns.status, [...COMPLETED_STATUSES])})::int`,
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
  /*
    ⛔ `offset + PAGE_SIZE`, never the bare `PAGE_SIZE` this used to be.

    `CampaignGrid` passes this to the listing API as `cursor`, which
    `parsePagination` reads as an absolute OFFSET (`api-helpers.ts:47-49`).
    While the page could only ever be page one, a constant `12` was correct by
    coincidence. On page 2 it would ask the API for rows 12-24 - the rows
    already on screen - and `CampaignGrid`'s id dedupe (`:78-80`) would drop
    every one of them, so "Load More" would spin and append nothing.
  */
  const nextCursor = hasMore ? String(offset + PAGE_SIZE) : null;

  const pagination = paginationModel({
    total: matchedCount,
    pageSize: PAGE_SIZE,
    requestedPage,
  });
  const pageHref = (n: number) => campaignsPageHref(params, n);
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
          /*
            ⛔ Past the end gets its OWN message, checked before the filter
            one. The stock empty state reads "No active campaigns at the
            moment. Check back soon." - which on `?page=99` of a two-page
            listing blames the platform for the visitor's own URL, the exact
            defect `docs/45` was written about.
          */
          emptyMessage={
            pagination.beyondEnd
              ? `There is no page ${pagination.page}. This listing has ${pagination.totalPages} ${pagination.totalPages === 1 ? 'page' : 'pages'}.`
              : filtersActive
                ? 'No campaigns match these filters.'
                : undefined
          }
          emptyAction={
            pagination.beyondEnd ? (
              <Link
                href={pageHref(1)}
                className="mt-4 inline-block rounded-full border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Go to the first page
              </Link>
            ) : filtersActive ? (
              <Link
                href="/campaigns"
                className="mt-4 inline-block rounded-full border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Clear filters
              </Link>
            ) : undefined
          }
        />

        {/*
          Crawlable pagination. The "Load More" button inside `CampaignGrid`
          stays: the instruction was to ADD a crawlable path, and removing a
          working control is not part of that. The two compose once the cursor
          above is offset-aware - Load More extends the current page, these
          links jump between pages.
        */}
        <Pagination model={pagination} hrefForPage={pageHref} />

        {/*
          AFTER the listing and its pagination, deliberately. `docs/71`
          measured 486px of chrome before the first card on this route and
          cut it; a general-fund band above the grid would spend that budget
          again on something the visitor did not come for.
        */}
        <GeneralFundCta className="mt-12" />

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
