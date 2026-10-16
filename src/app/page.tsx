import type { Metadata } from 'next';
import { unstable_cache } from 'next/cache';
import { db } from '@/db';
import { campaigns, donations, blogPosts } from '@/db/schema';
import { eq, or, desc, sql } from 'drizzle-orm';
import Link from 'next/link';
import Image from 'next/image';
import { HeroSection } from '@/components/homepage/HeroSection';
import { TrustBar } from '@/components/homepage/TrustBar';
import { HowItWorks } from '@/components/homepage/HowItWorks';
import { CategoryShowcase } from '@/components/homepage/CategoryShowcase';
import { WhereYourMoneyGoes } from '@/components/homepage/WhereYourMoneyGoes';
import { Newsletter } from '@/components/homepage/Newsletter';
import { CampaignCard } from '@/components/campaign/CampaignCard';

import { AnimateOnScroll } from '@/components/AnimateOnScroll';
import { HomepageFAQ } from '@/components/homepage/HomepageFAQ';
import { seoKeywords } from '@/lib/seo/keywords';

export const metadata: Metadata = {
  title: 'LastDonor - Reviewed Crowdfunding with 0% Platform Fees',
  description:
    'Support real people through reviewed medical, emergency, disaster relief, veteran, and family fundraising campaigns. LastDonor charges 0% platform fees on fundraisers and shows donors where funds go.',
  keywords: seoKeywords('core', 'campaigns', 'trust', 'medical', 'emergency', 'disaster', 'memorial', 'family'),
  openGraph: {
    title: 'LastDonor - Reviewed Crowdfunding with 0% Platform Fees',
    description:
      'Reviewed crowdfunding campaigns with 0% platform fees on fundraisers and visible tracking from donation to impact.',
    url: 'https://lastdonor.org',
    type: 'website',
    images: [
      {
        url: '/api/v1/og/page?title=LastDonor+Crowdfunding&subtitle=0%25+platform+fees.+Campaigns+reviewed.+Impact+updates.',
        width: 1200,
        height: 630,
        alt: 'LastDonor - Reviewed Crowdfunding with 0% Platform Fees',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@lastdonororg',
    title: 'LastDonor - Reviewed Crowdfunding with 0% Platform Fees',
    description: 'Reviewed campaigns. 0% platform fees. Visible donation tracking. Real human support.',
  },
};

export const dynamic = 'force-dynamic';

async function getHomepageData() {
  const [featuredCampaigns, activeCampaigns, stats, latestPosts, completedCount, supportedCount] =
    await Promise.all([
      // Featured campaign: most recently published active
      db
        .select({
          slug: campaigns.slug,
          title: campaigns.title,
          heroImageUrl: campaigns.heroImageUrl,
          subjectName: campaigns.subjectName,
          campaignOrganizer: sql<string | undefined>`${campaigns.campaignOrganizer}::text`,
          category: campaigns.category,
          raisedAmount: campaigns.raisedAmount,
          goalAmount: campaigns.goalAmount,
        })
        .from(campaigns)
        .where(
          or(
            eq(campaigns.status, 'active'),
            eq(campaigns.status, 'last_donor_zone'),
          ),
        )
        .orderBy(desc(campaigns.publishedAt))
        .limit(1),

      // Active campaigns for grid (top 6 by total donations)
      db
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
          goalAmount: campaigns.goalAmount,
          donorCount: campaigns.donorCount,
          verificationStatus: campaigns.verificationStatus,
        })
        .from(campaigns)
        .where(
          or(
            eq(campaigns.status, 'active'),
            eq(campaigns.status, 'last_donor_zone'),
          ),
        )
        .orderBy(desc(campaigns.raisedAmount))
        .limit(6),

      // Aggregate platform stats
      db
        .select({
          totalRaised: sql<number>`COALESCE(SUM(CASE WHEN ${donations.source} = 'real' AND ${donations.refunded} = false THEN ${donations.amount} ELSE 0 END), 0)`,
          totalDonors: sql<number>`COALESCE(COUNT(DISTINCT CASE WHEN ${donations.source} = 'real' THEN ${donations.donorEmail} END), 0)`,
        })
        .from(donations),

      // Latest published blog posts
      db
        .select({
          slug: blogPosts.slug,
          title: blogPosts.title,
          excerpt: blogPosts.excerpt,
          coverImageUrl: blogPosts.coverImageUrl,
          authorName: blogPosts.authorName,
          category: blogPosts.category,
          publishedAt: blogPosts.publishedAt,
        })
        .from(blogPosts)
        .where(eq(blogPosts.published, true))
        .orderBy(desc(blogPosts.publishedAt))
        .limit(3),

      // Completed campaign count
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(campaigns)
        .where(
          or(
            eq(campaigns.status, 'completed'),
            eq(campaigns.status, 'archived'),
          ),
        ),

      // Unique people supported
      db
        .select({
          count: sql<number>`COUNT(DISTINCT ${campaigns.subjectName})`,
        })
        .from(campaigns)
        .where(eq(campaigns.status, 'completed')),
    ]);

  return {
    featuredCampaign: featuredCampaigns[0] ?? null,
    activeCampaigns,
    totalRaised: Number(stats[0]?.totalRaised ?? 0),
    totalDonors: Number(stats[0]?.totalDonors ?? 0),
    campaignsCompleted: Number(completedCount[0]?.count ?? 0),
    peopleSupported: Number(supportedCount[0]?.count ?? 0),
    latestPosts,
  };
}

const getCachedHomepageData = unstable_cache(
  getHomepageData,
  ['homepage-data'],
  { revalidate: 300 },
);

export default async function Home() {
  const data = await getCachedHomepageData();

  const homepageSchema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': 'https://lastdonor.org/#webpage',
        url: 'https://lastdonor.org',
        name: 'LastDonor - Reviewed Crowdfunding with 0% Platform Fees',
        description:
          'Reviewed crowdfunding campaigns for medical, emergency, disaster relief, veteran, memorial, and family fundraising with 0% platform fees on fundraisers and visible campaign progress.',
        isPartOf: { '@id': 'https://lastdonor.org/#website' },
        about: { '@id': 'https://lastdonor.org/#organization' },
        primaryImageOfPage: {
          '@type': 'ImageObject',
          url: 'https://lastdonor.org/api/v1/og/page?title=LastDonor+Crowdfunding&subtitle=0%25+platform+fees.+Campaigns+reviewed.+Impact+updates.',
        },
        speakable: {
          '@type': 'SpeakableSpecification',
          cssSelector: ['#ai-answer', '#faq'],
        },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': 'https://lastdonor.org/#breadcrumb',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Home',
            item: 'https://lastdonor.org',
          },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homepageSchema) }}
      />
      <HeroSection />
      <TrustBar />

      {/* AI/SEO Answer Block: structured definitions for AI snippet extraction */}
      <section
        id="ai-answer"
        data-speakable="true"
        className="bg-background py-10 sm:py-12"
        aria-label="What is LastDonor?"
      >
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <h2 className="mb-4 font-display text-2xl font-bold text-foreground sm:text-3xl">
            What LastDonor Does
          </h2>
          <p className="text-base font-medium leading-relaxed text-foreground">
            LastDonor helps people support <strong>medical fundraising</strong>, <strong>emergency fundraising</strong>, and <strong>disaster relief fundraising</strong> campaigns that are reviewed before publication. We charge <strong>0% platform fees on fundraisers</strong> and provide <strong>visible donation tracking</strong>, so donors can follow the path from contribution to impact.
          </p>
          {/*
            Was five definition pairs. Three of them - "0% platform fee",
            "Reviewed campaigns" and "Donation tracking and impact" - restated
            the same three claims that HowItWorks and HomepageFAQ already
            make, which on a phone stacked into a fifth consecutive wall of
            the same argument (docs/51 counted four; this was the fifth).

            The two kept are the only ones saying something found nowhere else
            on the page. The SEO payload is untouched: every target term
            ("medical fundraising", "emergency fundraising", "disaster relief
            fundraising", "0% platform fees on fundraisers", "visible donation
            tracking") lives in the paragraph above, which is what the
            data-speakable block exists to serve. See docs/53.
          */}
          <dl className="mt-8 grid gap-5 text-sm leading-relaxed sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-foreground">How we operate</dt>
              <dd className="mt-1 text-muted-foreground">
                General fund donations, grants, sponsorships, and operating support help cover review, verification, donor support, hosting, payment operations, and impact updates.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">Real human support</dt>
              <dd className="mt-1 text-muted-foreground">
                A real person helps donors and campaign organizers with questions about medical, emergency, and disaster relief fundraising.
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Active Campaigns */}
      {data.activeCampaigns.length > 0 && (
        <section className="bg-surface-teal py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <AnimateOnScroll>
              {/*
                24px on a phone, matching GoFundMe's equivalent row heading.
                At 30px this ran to three lines above a list of compact
                cards and outweighed the content it introduced.
              */}
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl lg:text-4xl">
                Browse Reviewed Campaigns Raising Money Right Now
              </h2>
              <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
                Every campaign below has been reviewed by our editorial team.
              </p>
            </AnimateOnScroll>
            <div className="mt-8 grid gap-3 sm:mt-12 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {data.activeCampaigns.map((c) => (
                <CampaignCard
                  key={c.slug}
                  slug={c.slug}
                  title={c.title}
                  heroImageUrl={c.heroImageUrl}
                  subjectName={c.subjectName}
                  category={c.category}
                  location={c.location || c.subjectHometown || undefined}
                  raisedAmount={c.raisedAmount}
                  goalAmount={c.goalAmount}
                  donorCount={c.donorCount}
                />
              ))}
            </div>
            <AnimateOnScroll className="mt-8">
              <Link
                href="/campaigns"
                className="btn-press inline-flex rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-colors duration-200 hover:bg-primary/90"
              >
                Browse reviewed campaigns raising money now
              </Link>
            </AnimateOnScroll>
          </div>
        </section>
      )}

      {/*
        Two trust sections, not five. Measured 2026-10-15/16: "0% platform
        fees" was asserted in four separate sections, "reviewed before
        publication" in three and "visible impact tracking" in three, across
        4,036px of a 15,756px mobile page. HowItWorks states all three once,
        in order, and WhereYourMoneyGoes carries the money detail.

        Removed, with where each claim survives:
          ImpactCounter  - rendered "Real Numbers. Real People Helped. ...
                           Not projections. Not estimates." above $0, because
                           every campaign is unfunded (docs/33, docs/41). It
                           advertised the absence it was meant to dispel.
          Testimonials   - "Campaign details are reviewed" / "Progress stays
                           visible" / "does not take a platform cut" are
                           HowItWorks steps 01, 03 and 02.
          TrustBanner    - its three questions are in HomepageFAQ verbatim in
                           substance.

        The components stay in the repo and on /how-it-works and
        /transparency. See docs/51.
      */}
      <HowItWorks />
      <WhereYourMoneyGoes />
      <CategoryShowcase />

      {/* Blog Preview */}
      {data.latestPosts.length > 0 && (
        <section className="bg-surface-sage py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <AnimateOnScroll>
              <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Impact Stories: How LastDonor Donors Made a Difference
              </h2>
              <p className="mt-3 max-w-xl text-base text-muted-foreground">
                Updates, reviewed results, and the real stories behind the people you help.
                See exactly where your donation went and the impact it created.
              </p>
            </AnimateOnScroll>
            <div className="mt-8 grid gap-3 sm:mt-12 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {data.latestPosts.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="group overflow-hidden rounded-2xl border border-border bg-card card-hover-lift"
                >
                  {post.coverImageUrl && (
                    <div className="relative aspect-[16/10] overflow-hidden">
                      <Image
                        src={post.coverImageUrl}
                        alt={`Illustration for a ${post.category ?? 'fundraising'} article on LastDonor.org: ${post.excerpt ? post.excerpt.slice(0, 80) : post.title}`}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        sizes="(max-width: 768px) 100vw, 33vw"
                        loading="lazy"
                      />
                    </div>
                  )}
                  <div className="p-5">
                    {post.category && (
                      <span className="mb-2 inline-block text-xs font-medium capitalize text-primary">
                        {post.category}
                      </span>
                    )}
                    <h3 className="line-clamp-2 font-display text-lg font-semibold text-card-foreground">
                      {post.title}
                    </h3>
                    {post.excerpt && (
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {post.excerpt}
                      </p>
                    )}
                    <p className="mt-3 text-xs text-muted-foreground">
                      {post.authorName}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
            <AnimateOnScroll className="mt-8 text-center">
              <Link
                href="/blog"
                className="btn-press inline-flex rounded-full border border-border px-6 py-3 text-sm font-semibold text-foreground transition-colors duration-200 hover:bg-muted"
              >
                Read more stories
              </Link>
            </AnimateOnScroll>
          </div>
        </section>
      )}

      <HomepageFAQ />
      <Newsletter />
    </>
  );
}
