import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { campaigns, donations, campaignUpdates, campaignMessages, impactUpdates } from '@/db/schema';
import { publicCampaignSelect, publicMessageSelect } from '@/db/public-select';
import { eq, and, desc, or } from 'drizzle-orm';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { LaunchSuccessBanner } from '@/components/campaign/LaunchSuccessBanner';
import { Suspense } from 'react';
import { type DonorFeedItem } from '@/components/campaign/DonorFeed';
import { CampaignUpdates } from '@/components/campaign/CampaignUpdates';
import { ShareButtons } from '@/components/campaign/ShareButtons';
import { CATEGORY_LABELS } from '@/lib/categories';
import { CampaignCard } from '@/components/campaign/CampaignCard';
import { MediaGallery } from '@/components/campaign/MediaGallery';
import { ImpactUpdate } from '@/components/campaign/ImpactUpdate';
import { centsToDollars } from '@/lib/utils/currency';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { CampaignSidebarClient, CampaignCommunityClient } from './client';
import { SubscribeButton } from '@/components/campaign/SubscribeButton';
import type { ImpactTier, CampaignCategory } from '@/types';
import { categorySeoKeywords } from '@/lib/seo/keywords';

export const revalidate = 60;

export async function generateStaticParams() {
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

// Request-scoped memoization: getCampaign is called in both generateMetadata
// and the page component during each ISR render. cache() deduplicates to one DB call.
const getCampaignCached = cache(getCampaign);

async function getRecentDonors(campaignId: string): Promise<DonorFeedItem[]> {
  const rows = await db
    .select({
      id: donations.id,
      donorName: donations.donorName,
      donorLocation: donations.donorLocation,
      amount: donations.amount,
      message: donations.message,
      isAnonymous: donations.isAnonymous,
      createdAt: donations.createdAt,
    })
    .from(donations)
    .where(eq(donations.campaignId, campaignId))
    .orderBy(desc(donations.createdAt))
    .limit(10);

  return rows.map((r) => ({
    id: r.id,
    donorName: r.isAnonymous ? 'Anonymous' : r.donorName,
    donorLocation: r.isAnonymous ? null : r.donorLocation,
    amount: r.amount,
    message: r.message,
    isAnonymous: r.isAnonymous,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function getUpdates(campaignId: string) {
  return db
    .select({
      id: campaignUpdates.id,
      title: campaignUpdates.title,
      bodyHtml: campaignUpdates.bodyHtml,
      imageUrl: campaignUpdates.imageUrl,
      createdAt: campaignUpdates.createdAt,
    })
    .from(campaignUpdates)
    .where(eq(campaignUpdates.campaignId, campaignId))
    .orderBy(desc(campaignUpdates.createdAt))
    .limit(50);
}

async function getMessages(campaignId: string) {
  const rows = await db
    .select(publicMessageSelect)
    .from(campaignMessages)
    .where(
      and(
        eq(campaignMessages.campaignId, campaignId),
        eq(campaignMessages.hidden, false),
      ),
    )
    .orderBy(desc(campaignMessages.createdAt))
    .limit(20);

  return rows.map((m) => ({
    id: m.id,
    donorName: m.isAnonymous ? 'Anonymous' : m.donorName,
    donorLocation: m.isAnonymous ? null : m.donorLocation,
    message: m.message,
    isAnonymous: m.isAnonymous,
    createdAt: m.createdAt.toISOString(),
  }));
}

async function getImpactUpdate(campaignId: string) {
  const [row] = await db
    .select({
      title: impactUpdates.title,
      bodyHtml: impactUpdates.bodyHtml,
      photos: impactUpdates.photos,
      receiptUrls: impactUpdates.receiptUrls,
      status: impactUpdates.status,
      submittedAt: impactUpdates.submittedAt,
      reviewedAt: impactUpdates.reviewedAt,
    })
    .from(impactUpdates)
    .where(eq(impactUpdates.campaignId, campaignId))
    .limit(1);

  return row ?? null;
}

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
  const campaign = await getCampaignCached(slug);

  if (!campaign) {
    return { title: 'Campaign Not Found' };
  }

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
  const campaign = await getCampaignCached(slug);

  if (!campaign) {
    notFound();
  }

  const [recentDonors, updates, relatedRaw, initialMessages, impactUpdate] = await Promise.all([
    getRecentDonors(campaign.id),
    getUpdates(campaign.id),
    getRelatedCampaigns(campaign.category, campaign.id),
    getMessages(campaign.id),
    getImpactUpdate(campaign.id),
  ]);

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

  const formattedUpdates = updates.map((u) => ({
    id: u.id,
    title: u.title,
    bodyHtml: u.bodyHtml,
    imageUrl: u.imageUrl,
    createdAt: u.createdAt.toISOString(),
  }));

  // Format impact update for client component
  const formattedImpactUpdate = impactUpdate ? {
    title: impactUpdate.title,
    bodyHtml: impactUpdate.bodyHtml,
    photos: (impactUpdate.photos ?? []) as string[],
    receiptUrls: (impactUpdate.receiptUrls ?? []) as string[],
    status: impactUpdate.status,
    submittedAt: impactUpdate.submittedAt?.toISOString() ?? null,
    reviewedAt: impactUpdate.reviewedAt?.toISOString() ?? null,
  } : null;

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

            {/* Impact update - below the story for transparency */}
            {formattedImpactUpdate && (
              <ImpactUpdate impactUpdate={formattedImpactUpdate} />
            )}

            {/* Updates */}
            {formattedUpdates.length > 0 && (
              <CampaignUpdates updates={formattedUpdates} />
            )}

            {/* Community: donors + messages (below story, not in sidebar) */}
            {isDonatable && (
              <CampaignCommunityClient
                campaignSlug={campaign.slug}
                initialDonors={recentDonors}
                initialMessages={initialMessages}
              />
            )}

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
