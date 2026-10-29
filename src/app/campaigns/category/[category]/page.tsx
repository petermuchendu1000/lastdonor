import type { Metadata } from 'next';
import { readFxSnapshot } from '@/lib/money/fx-store.server';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { listedCampaignFilter } from '@/db/public-campaigns';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { CampaignCard } from '@/components/campaign/CampaignCard';
import { CategoryHeroSection } from '@/components/campaign/CategoryHeroSection';
import { getCategoryContent, ALL_CATEGORY_SLUGS } from '@/lib/category-content';
import { categorySeoKeywords } from '@/lib/seo/keywords';
import type { CampaignCategory } from '@/types';
import Link from 'next/link';

export const revalidate = 300;

interface PageProps {
  params: Promise<{ category: string }>;
}

export function generateStaticParams() {
  return ALL_CATEGORY_SLUGS.map((category) => ({ category }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category } = await params;
  const content = getCategoryContent(category);
  if (!content) return { title: 'Not Found' };

  return {
    title: content.seoTitle,
    description: content.metaDescription,
    keywords: categorySeoKeywords(content.slug),
    alternates: {
      canonical: `https://lastdonor.org/campaigns/category/${content.slug}`,
    },
    openGraph: {
      title: `${content.seoTitle} | LastDonor.org`,
      description: content.metaDescription,
      images: [
        {
          url: `/api/v1/og/page?title=${encodeURIComponent(content.heading)}&subtitle=${encodeURIComponent(content.ogSubtitle)}`,
          width: 1200,
          height: 630,
          alt: content.heading,
        },
      ],
    },
  };
}

const PAGE_SIZE = 12;

export default async function CategoryPage({ params }: PageProps) {
  const { category } = await params;
  const content = getCategoryContent(category);
  // Answers a real 404 since 2026-10-18, verified against
  // `next build && next start`: an unknown category went 200 -> 404
  // while `/campaigns/category/medical` stayed 200. The cause was
  // `src/app/campaigns/loading.tsx` wrapping this route in an implicit
  // Suspense boundary, flushing the status before this line; it now
  // lives at `campaigns/(index)/loading.tsx`. This route is the one
  // that proved the mechanism, because its miss is a pure static lookup
  // with no database in it. See docs/80.
  if (!content) notFound();

  const categorySlug = content.slug as CampaignCategory;

  const results = await db
    .select({
      slug: campaigns.slug,
      title: campaigns.title,
      heroImageUrl: campaigns.heroImageUrl,
      subjectName: campaigns.subjectName,
      campaignOrganizer: campaigns.campaignOrganizer,
      category: campaigns.category,
      location: campaigns.location,
      subjectHometown: campaigns.subjectHometown,
      raisedAmount: campaigns.raisedAmount,
      currency: campaigns.currency,
      goalAmount: campaigns.goalAmount,
      donorCount: campaigns.donorCount,
    })
    .from(campaigns)
    .where(
      // ⛔ A LISTING (docs/147): the general fund is not an appeal, and it
      // carries a category like any other row.
      and(eq(campaigns.category, categorySlug), listedCampaignFilter()),
    )
    .orderBy(desc(campaigns.raisedAmount))
    .limit(PAGE_SIZE);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: content.heading,
    description: content.jsonLdDescription,
    url: `https://lastdonor.org/campaigns/category/${content.slug}`,
    isPartOf: {
      '@type': 'WebSite',
      name: 'LastDonor.org',
      url: 'https://lastdonor.org',
    },
  };
  const categoryLabel = content.label.toLowerCase();
  const faqs = [
    {
      question: `Can I start a ${categoryLabel} fundraiser on LastDonor?`,
      answer: `Yes. You can submit a ${categoryLabel} fundraiser through Share Your Story. Campaigns are reviewed before publication so donors can understand the need, goal, and supporting context.`,
    },
    {
      question: `Are ${categoryLabel} fundraisers reviewed before publication?`,
      answer: `Yes. ${content.label} fundraisers are reviewed before they appear on LastDonor campaign pages.`,
    },
    {
      question: `What details help a ${categoryLabel} fundraiser earn donor trust?`,
      answer: 'Say plainly who needs help and where. Ask for an amount you can explain. Add a clear photo and a document if you have one. Post updates as things change.',
    },
  ];
  const faqJsonLd = {
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <CategoryHeroSection content={content} />

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs />

        <h2 className="mt-6 mb-6 font-display text-xl font-bold text-foreground sm:text-2xl">
          Browse {content.label.toLowerCase()} fundraisers
        </h2>

        {results.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((campaign) => (
            <CampaignCard
              key={campaign.slug}
              slug={campaign.slug}
              title={campaign.title}
              heroImageUrl={campaign.heroImageUrl}
              subjectName={campaign.subjectName}
              currency={campaign.currency}
              category={campaign.category}
              location={campaign.location || campaign.subjectHometown}
              raisedAmount={campaign.raisedAmount}
              goalAmount={campaign.goalAmount}
              donorCount={campaign.donorCount}
              fxSnapshot={fxSnapshot}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-lg text-muted-foreground">
            No active {content.label.toLowerCase()} campaigns right now.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Check back soon or{' '}
            <Link href="/share-your-story" className="text-primary underline hover:text-primary/80">
              start one yourself
            </Link>.
          </p>
        </div>
      )}

      {results.length >= PAGE_SIZE && (
        <div className="mt-8 text-center">
          <Link
            href={`/campaigns?category=${content.slug}`}
            className="text-sm font-medium text-primary hover:text-primary/80"
          >
            View all {content.label.toLowerCase()} campaigns
          </Link>
        </div>
      )}

      <section className="mt-12 border-t border-border pt-10" aria-labelledby="category-faq">
        <h2 id="category-faq" className="font-display text-2xl font-bold text-foreground">
          {content.label} Fundraiser FAQ
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
