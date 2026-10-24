import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import { db } from '@/db';
import { CampaignUnavailableError, lookupCampaign } from '@/lib/campaign-lookup';
import { campaigns } from '@/db/schema';
import { publicCampaignSelect } from '@/db/public-select';
import { eq, and, or } from 'drizzle-orm';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { LaunchSuccessBanner } from '@/components/campaign/LaunchSuccessBanner';
import { PendingVerificationBadge } from '@/components/campaigns/TrustBadge';
import { ApproxMoney } from '@/components/money/ApproxMoney';
import { readFxSnapshot } from '@/lib/money/fx-store.server';
import { Suspense } from 'react';
import { ShareButtons } from '@/components/campaign/ShareButtons';
import { CATEGORY_LABELS } from '@/lib/categories';
import { CampaignCard } from '@/components/campaign/CampaignCard';
import { MediaGallery } from '@/components/campaign/MediaGallery';
import { centsToDollars } from '@/lib/utils/currency';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { CampaignSidebarClient } from './client';
import { CampaignActivity, CampaignActivitySkeleton } from './CampaignActivity';
import { SubscribeButton } from '@/components/campaign/SubscribeButton';
import type { ImpactTier, CampaignCategory } from '@/types';
import { categorySeoKeywords } from '@/lib/seo/keywords';

export const revalidate = 60;

export async function generateStaticParams() {
  // Fail soft: the build must not require a reachable database. Returning []
  // pre-renders nothing and lets `revalidate = 60` render each page on first
  // request instead, which is the same end state one request later. Without
  // this, `next build` dies on "Failed to collect page data" whenever the DB
  // is unreachable, which makes the Docker image un-buildable without
  // production credentials. See docs/35 §"build is hermetic".
  try {
    const rows = await db
      .select({ slug: campaigns.slug })
      .from(campaigns)
      .where(
        or(
          eq(campaigns.status, 'active'),
          eq(campaigns.status, 'last_donor_zone'),
          eq(campaigns.status, 'completed'),
        ),
      );
    return rows.map((r) => ({ slug: r.slug }));
  } catch (err) {
    console.warn(
      '[build] generateStaticParams(campaigns): database unreachable, ' +
        'pre-rendering no campaign pages; they will render on demand.',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function getCampaign(slug: string) {
  const [campaign] = await db
    .select(publicCampaignSelect)
    .from(campaigns)
    .where(
      and(
        eq(campaigns.slug, slug),
        or(
          eq(campaigns.status, 'active'),
          eq(campaigns.status, 'last_donor_zone'),
          eq(campaigns.status, 'completed'),
          eq(campaigns.status, 'paused'),
          eq(campaigns.status, 'suspended'),
          eq(campaigns.status, 'cancelled'),
        ),
      ),
    )
    .limit(1);

  return campaign ?? null;
}

// Request-scoped memoization: the lookup is run by both generateMetadata and
// the page component during each ISR render. cache() deduplicates to one DB call.
//
// `lookupCampaign` classifies the outcome instead of returning a nullable row,
// because "the query answered and matched nothing" and "the query never
// answered" have to end in different HTTP statuses. Before this, a lookup that
// exhausted the 15s query bound (src/db/query-timeout.ts) rejected inside
// generateMetadata, which resolves before the HTML shell is flushed, so neither
// app/error.tsx nor app/global-error.tsx existed yet and Next served its own
// plain-text "500: Internal Server Error" with no header, footer or navigation.
// See docs/43.
const getCampaignLookup = cache((slug: string) =>
  lookupCampaign(() => getCampaign(slug)),
);





async function getRelatedCampaigns(category: CampaignCategory, _currentId: string) {
  return db
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
    })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.category, category),
        or(
          eq(campaigns.status, 'active'),
          eq(campaigns.status, 'last_donor_zone'),
        ),
      ),
    )
    .limit(4); // Fetch 4, filter out current below
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const lookup = await getCampaignLookup(slug);

  // Never throw from here. generateMetadata resolves before the shell is
  // flushed, so a rejection aborts the document before any error boundary
  // exists and Next answers with its own unstyled 500. The page component
  // below decides the status code; metadata only has to stay renderable.
  if (lookup.status === 'unavailable') {
    return {
      title: 'Campaign temporarily unavailable | LastDonor.org',
      robots: { index: false, follow: false },
    };
  }

  if (lookup.status === 'missing') {
    return { title: 'Campaign Not Found', robots: { index: false, follow: true } };
  }

  const campaign = lookup.campaign;

  const percent = campaign.goalAmount > 0
    ? Math.round((campaign.raisedAmount / campaign.goalAmount) * 100)
    : 0;
  const categoryLabel = CATEGORY_LABELS[campaign.category] ?? 'Fundraiser';
  const isIndexable = ['active', 'last_donor_zone', 'completed'].includes(campaign.status);
  const description = `${campaign.title}. Reviewed ${categoryLabel.toLowerCase()} fundraiser for ${campaign.subjectName}. ${percent}% funded - ${centsToDollars(campaign.raisedAmount)} of ${centsToDollars(campaign.goalAmount)} raised.`;

  return {
    title: `${campaign.title} | LastDonor.org`,
    description,
    keywords: [
      campaign.title,
      campaign.subjectName,
      categoryLabel,
      ...(campaign.subjectHometown ? [campaign.subjectHometown] : []),
      ...categorySeoKeywords(campaign.category),
    ],
    alternates: {
      canonical: `https://lastdonor.org/campaigns/${slug}`,
    },
    robots: {
      index: isIndexable,
      follow: true,
    },
    openGraph: {
      title: campaign.title,
      description,
      type: 'article',
      images: [
        {
          url: `/api/v1/og/campaign/${slug}`,
          width: 1200,
          height: 630,
          alt: campaign.title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: campaign.title,
      description: `${percent}% funded. ${centsToDollars(campaign.raisedAmount)} raised.`,
    },
  };
}

export default async function CampaignDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const lookup = await getCampaignLookup(slug);

  if (lookup.status === 'unavailable') {
    // The database did not answer, so it is unknown whether this campaign
    // exists. Do NOT call notFound(): a 404 asserts to donors and to crawlers
    // that the appeal is gone, which would turn a pool wedge (docs/37) into
    // de-indexed live campaigns. Throwing instead lands on app/error.tsx, which
    // keeps the header, footer and navigation and offers "Try Again".
    //
    // noStore() keeps this degraded render out of the ISR entry and out of the
    // CDN: a render marked dynamic reports revalidate 0, which Next turns into
    // `private, no-cache, no-store, max-age=0, must-revalidate`
    // (verified 2026-10-15 against the installed next@15.5.14,
    // node_modules/next/dist/server/lib/cache-control.js:14). It cannot fire
    // during `next build`, where withBuildPhaseFailSoft turns a failed query
    // into zero rows and the tighter lookup budget is not applied.
    noStore();
    console.error(
      `[campaign] slug lookup for "${slug}" did not answer; serving 5xx, not 404.`,
      lookup.cause,
    );
    throw new CampaignUnavailableError(slug, lookup.cause);
  }

  if (lookup.status === 'missing') {
    /*
      The query answered and matched nothing. This is the only evidence that
      justifies a 404, and it is reached without waiting on any timeout.

      RESOLVED 2026-10-18. This answers a real 404 now. What follows is
      the history, because the obvious retry is the one that fails.

      It used to answer HTTP 200 with a "Campaign Not Found" body.
      ISR was blamed for it and was innocent. The cause was
      `loading.tsx`: it puts an implicit `<Suspense>` boundary around
      every route beneath its segment, React streams the shell as soon
      as it suspends, and the 200 status line is on the wire before
      this function finishes. `notFound()` could still swap the body -
      which is why the body was always right - but not the status.

      Proven with probe routes in real production builds: a page whose
      literal first statement is `notFound()`, `force-dynamic`, nothing
      awaited, no caching at all, still answered 200. Remove
      `src/app/loading.tsx`, rebuild, and every one of those becomes a
      404 - including the `revalidate = 60` case.

      The fix was to scope each `loading.tsx` into a route group so none
      sits above a route that calls `notFound()`. This route lost its
      skeleton outright; to get one back, put an explicit `<Suspense>`
      INSIDE this page, below this lookup, so the status is settled
      before anything streams.

      `src/app/soft-404.ratchet.test.ts` fails the build if a
      `loading.tsx` reappears above this route.

      Still do not reach for `noStore()` here. It was tried on
      2026-10-17 and 500'd all three routes, for an unrelated reason:
      opting out of the cache during on-demand ISR generation is a
      dynamic-server bail-out, not a cache hint. See docs/80.
    */
    notFound();
  }

  const campaign = lookup.campaign;

  /*
    The exchange-rate snapshot, read SEQUENTIALLY and never inside a
    Promise.all. `src/db/pool-fanout.ratchet.test.ts` caps an entry point at
    three CONCURRENT queries against a pool of five, and this page already
    issues its own; a fourth in parallel is how /admin/settings came to take
    15 seconds and leave wedged backends (docs/87).

    `null` is a normal outcome, not an error - before the first cron run there
    is no snapshot, and `ApproxMoney` renders nothing for it.
  */
  const fxSnapshot = await readFxSnapshot();

  /*
    ONE query here, not five.

    This was `Promise.all` over five single-query helpers, on a pool of
    `max: 5` (`src/db/index.ts`) shared by every request on the machine -
    four more than CLAUDE.md's cap of three, and the exact wide-fan-out
    condition docs/87 ties to seven production wedges. The AST ratchet
    was green throughout because it only counted a resolved helper when
    it contributed MORE than one query, so five one-query helpers summed
    to zero. Fixed in `pool-fanout.ratchet.test.ts` in the same commit,
    which is how this was found.

    The other four moved into `<CampaignActivity>`, below a `<Suspense>`
    boundary, where they run in staged batches of two. Related campaigns
    stays here because it renders outside that boundary, and a second
    sibling boundary would just restore the concurrency this removes.
  */
  const relatedRaw = await getRelatedCampaigns(campaign.category, campaign.id);

  const relatedCampaigns = relatedRaw
    .filter((c) => c.id !== campaign.id)
    .slice(0, 3);

  const percent = campaign.goalAmount > 0
    ? Math.min(Math.round((campaign.raisedAmount / campaign.goalAmount) * 100), 100)
    : 0;
  const impactTiers = (campaign.impactTiers ?? []) as ImpactTier[];
  const sanitizedStory = sanitizeHtml(campaign.storyHtml);
  const canonicalUrl = `https://lastdonor.org/campaigns/${slug}`;
  const isDonatable = campaign.status === 'active' || campaign.status === 'last_donor_zone';
  const categoryLabel = CATEGORY_LABELS[campaign.category] ?? 'Fundraiser';
  const campaignKeywords = categorySeoKeywords(campaign.category);
  const campaignImages = [
    campaign.heroImageUrl,
    ...((campaign.galleryImages ?? []) as string[]),
  ].filter((image): image is string => typeof image === 'string' && image.length > 0);
  const campaignDescription =
    `Reviewed ${categoryLabel.toLowerCase()} fundraiser for ${campaign.subjectName}. ${percent}% funded with ${centsToDollars(campaign.raisedAmount)} raised toward ${centsToDollars(campaign.goalAmount)}.`;

  // JSON-LD structured data
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${canonicalUrl}#article`,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': canonicalUrl,
    },
    url: canonicalUrl,
    headline: campaign.title,
    image: campaignImages.length > 0
      ? campaignImages
      : [`https://lastdonor.org/api/v1/og/campaign/${slug}`],
    articleSection: categoryLabel,
    keywords: campaignKeywords,
    about: [
      {
        '@type': 'Thing',
        name: `${categoryLabel} fundraising`,
      },
      {
        '@type': 'Thing',
        name: 'reviewed crowdfunding',
      },
      {
        '@type': 'Thing',
        name: '0% platform fees',
      },
    ],
    author: {
      '@type': 'Organization',
      '@id': 'https://lastdonor.org/#organization',
      name: 'LastDonor.org',
    },
    publisher: {
      '@type': 'Organization',
      '@id': 'https://lastdonor.org/#organization',
      name: 'LastDonor.org',
      url: 'https://lastdonor.org',
    },
    datePublished: campaign.publishedAt?.toISOString() ?? campaign.createdAt.toISOString(),
    dateModified: campaign.updatedAt.toISOString(),
    description: campaignDescription,
    isAccessibleForFree: true,
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['article h1', '.prose'],
    },
  };

  const donateJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'DonateAction',
    '@id': `${canonicalUrl}#donate`,
    name: `Donate to ${campaign.title}`,
    url: canonicalUrl,
    target: {
      '@type': 'EntryPoint',
      urlTemplate: canonicalUrl,
      actionPlatform: [
        'https://schema.org/DesktopWebPlatform',
        'https://schema.org/MobileWebPlatform',
      ],
    },
    recipient: {
      '@type': 'Organization',
      '@id': 'https://lastdonor.org/#organization',
      name: 'LastDonor.org',
    },
    object: {
      '@type': 'Thing',
      name: campaign.title,
      description: campaignDescription,
    },
    description:
      `Donate to help ${campaign.subjectName}. LastDonor charges 0% platform fees; standard Stripe processing fees apply.`,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(donateJsonLd) }}
      />

      <article className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Breadcrumbs */}
        <Breadcrumbs />

        {/* Post-launch success banner (shown once after campaign creation) */}
        <Suspense>
          <LaunchSuccessBanner
            campaignSlug={campaign.slug}
            campaignTitle={campaign.title}
            canonicalUrl={canonicalUrl}
            verificationStatus={campaign.verificationStatus}
          />
        </Suspense>

        {/* Main content grid */}
        <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_340px]">
          {/* Left column - image + story + details */}
          <div className="space-y-6">
            <MediaGallery
              heroImageUrl={campaign.heroImageUrl}
              galleryImages={(campaign.galleryImages as string[]) ?? []}
              youtubeUrl={campaign.youtubeUrl ?? null}
              title={campaign.title}
              category={campaign.category}
              photoCredit={campaign.photoCredit}
            />

            {campaign.status === 'paused' && (
              <div className="rounded-lg border border-border bg-card px-4 py-3">
                <p className="text-sm font-medium text-foreground">This campaign is paused</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{campaign.pausedReason ?? 'Donations are not being accepted right now. The campaign may resume soon.'}</p>
              </div>
            )}
            {campaign.status === 'suspended' && (
              <div className="rounded-lg border border-border bg-card px-4 py-3">
                <p className="text-sm font-medium text-foreground">This campaign is under review</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{campaign.suspendedReason ?? 'Our team is reviewing a few details. Any existing donations are safe and secure.'}</p>
              </div>
            )}

            <div>
              <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
                {campaign.title}
              </h1>

              {/*
                The pre-verification cap, stated to the donor BEFORE the story
                and before the donate box, because it changes what giving here
                means: there is a ceiling on what this campaign can raise, and
                nothing can be paid out to the organiser, until a person has
                checked their ID. Renders nothing once the campaign is
                verified. See `src/lib/campaign-raise-cap.ts`.
              */}
              <PendingVerificationBadge
                verificationStatus={campaign.verificationStatus}
                currency={campaign.currency}
                className="mt-3"
              />

              {/*
                An approximate USD equivalent of the goal, for a campaign
                denominated in something else.

                Only in that direction, deliberately. USD is the reference a
                diaspora donor reading a KES appeal can interpret; the reverse
                would mean guessing which currency a reader of a USD campaign
                thinks in, and this codebase has no viewer-locale detection.
                When one exists, this is where it goes.

                Display only. The figure is never stored, never summed, and
                never used to decide anything - see the boundary note in
                `src/lib/money/fx-convert.ts`.
              */}
              {campaign.currency !== 'USD' && (
                <p className="mt-2">
                  <span className="text-sm text-muted-foreground">Goal is </span>
                  <ApproxMoney
                    minor={campaign.goalAmount}
                    fromCurrency={campaign.currency}
                    toCurrency="USD"
                    snapshot={fxSnapshot}
                  />
                </p>
              )}
              <p className="mt-2 text-sm text-muted-foreground">
                {campaign.subjectName}
                {campaign.subjectHometown && ` · ${campaign.subjectHometown}`}
                {' · '}
                {CATEGORY_LABELS[campaign.category]}
              </p>
            </div>

            {/* Cancellation notice */}
            {campaign.status === 'cancelled' && (
              <div className="rounded-lg border border-border bg-card p-5">
                <p className="text-sm font-semibold text-foreground">This campaign has been removed</p>
                {campaign.cancellationReason && (
                  <p className="mt-1.5 text-sm text-muted-foreground">{campaign.cancellationReason}</p>
                )}
                {campaign.cancellationNotes && (
                  <p className="mt-1.5 text-sm text-muted-foreground">{campaign.cancellationNotes}</p>
                )}
                {campaign.cancelledAt && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Removed on {new Date(campaign.cancelledAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </p>
                )}
              </div>
            )}

            {/* Campaign story */}
            <div
              className="prose prose-neutral max-w-none dark:prose-invert prose-headings:font-display prose-a:text-primary"
              dangerouslySetInnerHTML={{ __html: sanitizedStory }}
            />

            {/*
              Impact update, updates and community, streamed.

              The boundary is HERE rather than in a `loading.tsx`, and
              that placement is the whole point: a `loading.tsx` wraps
              the route above the page, so the shell flushes with a 200
              before `notFound()` can run, which is what made every
              unknown slug a soft 404 (docs/80). Below the lookup, the
              status is already settled, so the skeleton costs nothing.

              The visitor gets the hero, totals, story and donate button
              immediately - strictly more than the deleted `loading.tsx`
              gave, which blanked the whole page.
            */}
            <Suspense fallback={<CampaignActivitySkeleton />}>
              <CampaignActivity
                campaignId={campaign.id}
                campaignSlug={campaign.slug}
                isDonatable={isDonatable}
              />
            </Suspense>

            {/* Share + Subscribe */}
            <div className="flex flex-wrap items-center gap-3">
              <ShareButtons url={canonicalUrl} title={campaign.title} />
              <SubscribeButton campaignSlug={campaign.slug} />
            </div>

            {/* Report inaccuracy */}
            <div className="border-t border-border pt-4">
              <a
                href={`mailto:editorial@lastdonor.org?subject=Report: ${encodeURIComponent(campaign.title)}`}
                className="text-sm text-muted-foreground underline hover:text-foreground"
              >
                Report an inaccuracy
              </a>
            </div>
          </div>

          {/* Right column - conversion sidebar */}
          <div className="space-y-6 lg:sticky lg:top-20 lg:self-start">
            {isDonatable ? (
              <CampaignSidebarClient
                campaignSlug={campaign.slug}
                raisedAmount={campaign.raisedAmount}
                goalAmount={campaign.goalAmount}
                donorCount={campaign.donorCount}
                impactTiers={impactTiers}
                shareUrl={canonicalUrl}
                shareTitle={campaign.title}
              />
            ) : campaign.status === 'completed' ? (
              <div className="rounded-xl border border-border bg-card p-6 text-center">
                <p className="text-sm font-semibold text-foreground">Campaign Complete</p>
                <p className="mt-1 text-sm text-muted-foreground">This campaign reached its goal. Thank you to all {campaign.donorCount} {campaign.donorCount === 1 ? 'donor' : 'donors'}.</p>
                <p className="mt-3 font-mono text-lg font-bold text-foreground">{centsToDollars(campaign.raisedAmount)} raised</p>
              </div>
            ) : campaign.status === 'paused' ? (
              <div className="rounded-xl border border-border bg-card p-6">
                <p className="text-sm font-semibold text-foreground">Campaign Paused</p>
                <p className="mt-1 text-sm text-muted-foreground">{campaign.pausedReason ?? 'This campaign is not accepting donations right now. Check back soon.'}</p>
                <p className="mt-3 text-sm text-muted-foreground">{centsToDollars(campaign.raisedAmount)} raised from {campaign.donorCount} {campaign.donorCount === 1 ? 'donor' : 'donors'}</p>
                <Link href="/campaigns" className="mt-4 block text-center text-sm text-muted-foreground underline hover:text-foreground">
                  Browse other campaigns
                </Link>
              </div>
            ) : campaign.status === 'suspended' ? (
              <div className="rounded-xl border border-border bg-card p-6">
                <p className="text-sm font-semibold text-foreground">Under Review</p>
                <p className="mt-1 text-sm text-muted-foreground">{campaign.suspendedReason ?? 'Our team is reviewing a few details. Any existing donations are safe and secure.'}</p>
                <Link href="/campaigns" className="mt-4 block text-center text-sm text-muted-foreground underline hover:text-foreground">
                  Browse other campaigns
                </Link>
              </div>
            ) : campaign.status === 'cancelled' ? (
              <div className="rounded-xl border border-border bg-card p-6">
                <p className="text-sm font-semibold text-foreground">Campaign Removed</p>
                <p className="mt-1 text-sm text-muted-foreground">This campaign did not meet our standards and has been removed.</p>
                {(campaign.raisedAmount > 0) && (
                  <p className="mt-2 text-xs text-muted-foreground">Donors have been notified and refunds processed where applicable.</p>
                )}
                <Link href="/campaigns" className="mt-4 block text-center text-sm text-muted-foreground underline hover:text-foreground">
                  Browse active campaigns
                </Link>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card p-6 text-center">
                <p className="text-muted-foreground">Donations are not available for this campaign.</p>
              </div>
            )}
          </div>
        </div>

        {/* Related campaigns */}
        {relatedCampaigns.length > 0 && (
          <section className="mt-16 border-t border-border pt-10">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Similar Campaigns
            </h2>
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {relatedCampaigns.map((rc) => (
                <CampaignCard
                  key={rc.id}
                  slug={rc.slug}
                  title={rc.title}
                  heroImageUrl={rc.heroImageUrl}
                  subjectName={rc.subjectName}
                  category={rc.category}
                  location={rc.location || rc.subjectHometown}
                  raisedAmount={rc.raisedAmount}
                  goalAmount={rc.goalAmount}
                  donorCount={rc.donorCount}
                />
              ))}
            </div>
          </section>
        )}
      </article>
    </>
  );
}
