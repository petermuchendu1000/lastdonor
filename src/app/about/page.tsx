import type { Metadata } from 'next';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { CheckBadgeIcon } from '@heroicons/react/24/solid';
import { seoKeywords } from '@/lib/seo/keywords';

export const metadata: Metadata = {
  title: 'About LastDonor.org | Reviewed Crowdfunding with 0% Platform Fees',
  description:
    'LastDonor.org is a reviewed crowdfunding platform for medical, emergency, memorial, veteran, family, and disaster relief fundraisers. Campaigns are reviewed before publication, platform fees are 0%, and donors can follow campaign progress and impact updates.',
  keywords: seoKeywords('core', 'trust', 'campaigns', 'nonprofit', 'medical', 'emergency', 'memorial'),
  alternates: { canonical: 'https://lastdonor.org/about' },
  openGraph: {
    title: 'About LastDonor.org',
    description:
      'Reviewed crowdfunding for real needs with 0% platform fees on fundraisers and visible impact updates.',
    images: [
      {
        url: '/api/v1/og/page?title=About+LastDonor.org&subtitle=Reviewed+crowdfunding+with+0%25+platform+fees.',
        width: 1200,
        height: 630,
        alt: 'About LastDonor.org',
      },
    ],
  },
};

export default function AboutPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    '@id': 'https://lastdonor.org/about#webpage',
    url: 'https://lastdonor.org/about',
    name: 'About LastDonor.org',
    description:
      'LastDonor.org is a reviewed crowdfunding platform with 0% platform fees on fundraisers, campaign review before publication, and visible impact updates.',
    isPartOf: { '@id': 'https://lastdonor.org/#website' },
    about: { '@id': 'https://lastdonor.org/#organization' },
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['#ai-answer'],
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <Breadcrumbs />

        <div className="mt-6 max-w-3xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-teal/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-teal ring-1 ring-brand-teal/20">
            <CheckBadgeIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Reviewed crowdfunding
          </span>
          <h1 className="mt-4 font-display text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Reviewed crowdfunding built for visible impact.
          </h1>
          <p
            id="ai-answer"
            data-speakable="true"
            className="mt-4 text-lg leading-relaxed text-muted-foreground"
          >
            LastDonor helps people support medical, emergency, memorial, veteran,
            family, and disaster relief fundraisers that are reviewed before
            publication. Donors see campaign progress, fee details, and impact
            updates from donation to outcome.
          </p>
        </div>

        <section className="mt-12 space-y-6">
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">Why we exist</h2>
          <p className="leading-relaxed text-muted-foreground">
            People use fundraising sites when life is already hard: medical bills,
            funeral expenses, house fires, veteran support, first responder
            families, tuition gaps, pet surgery, and everyday emergencies.
            LastDonor.org was built to make those fundraisers easier to
            understand before anyone gives.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            We review campaigns before publication, show the fundraising goal,
            publish campaign progress, and close campaigns when the goal is met.
            When the last dollar comes in, the person who gave it earns the title
            of <strong className="text-foreground">Last Donor</strong>, and the
            campaign is done.
          </p>
        </section>

        <section className="mt-12" aria-label="Platform terminology">
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">Key terms</h2>
          <dl className="mt-6 space-y-5 text-sm leading-relaxed">
            <div>
              <dt className="font-semibold text-foreground">LastDonor.org</dt>
              <dd className="mt-1 text-muted-foreground">
                A reviewed crowdfunding platform that charges 0% platform fees
                on fundraisers, publishes campaigns after editorial review, and
                shows donors progress and impact updates. Campaigns close when
                the stated goal is reached.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">The Last Donor</dt>
              <dd className="mt-1 text-muted-foreground">
                The individual donor whose contribution brings a campaign to its
                final goal. The Last Donor is recognized on the campaign page as
                confirmation that the fundraiser is complete.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">Human-Reviewed Campaign</dt>
              <dd className="mt-1 text-muted-foreground">
                A fundraising campaign reviewed by a LastDonor.org editor before
                publication. Depending on the campaign, review can include
                documents, photos, official letters, bills, public records, or
                direct organizer follow-up.
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-12">
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">What donors can check</h2>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-border shadow-[--shadow-elevation-1]">
            <table className="w-full text-sm leading-relaxed">
              <thead>
                <tr className="bg-muted/60 text-left">
                  <th scope="col" className="px-4 py-3 font-semibold text-foreground">Question</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-primary">LastDonor answer</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-muted-foreground">Where to look</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="bg-card">
                  <td className="px-4 py-3 font-medium text-foreground">Does LastDonor take a platform fee?</td>
                  <td className="px-4 py-3 text-primary">0% platform fees on fundraisers</td>
                  <td className="px-4 py-3 text-muted-foreground">Fee disclosure on the transparency page</td>
                </tr>
                <tr className="bg-card/60">
                  <td className="px-4 py-3 font-medium text-foreground">Are campaigns reviewed first?</td>
                  <td className="px-4 py-3 text-primary">A person reviews the campaign before it goes live</td>
                  <td className="px-4 py-3 text-muted-foreground">Campaign page and editorial standards</td>
                </tr>
                <tr className="bg-card">
                  <td className="px-4 py-3 font-medium text-foreground">Can donors follow progress?</td>
                  <td className="px-4 py-3 text-primary">Campaign totals, donor count, updates, and completion status are visible</td>
                  <td className="px-4 py-3 text-muted-foreground">Campaign pages and impact updates</td>
                </tr>
                <tr className="bg-card/60">
                  <td className="px-4 py-3 font-medium text-foreground">What happens after completion?</td>
                  <td className="px-4 py-3 text-primary">Completed campaigns can include impact updates, photos, receipts, or outcome notes</td>
                  <td className="px-4 py-3 text-muted-foreground">Blog, campaign updates, and Last Donor Wall</td>
                </tr>
                <tr className="bg-card">
                  <td className="px-4 py-3 font-medium text-foreground">When does fundraising stop?</td>
                  <td className="px-4 py-3 text-primary">Campaigns close automatically when the goal is met</td>
                  <td className="px-4 py-3 text-muted-foreground">Campaign status and Last Donor Wall</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12 space-y-6">
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">How LastDonor is funded</h2>
          <p className="leading-relaxed text-muted-foreground">
            LastDonor charges 0% platform fees on fundraisers. We fund platform
            operations separately through general fund donations, grants,
            sponsorships, and operating support. That support helps pay for
            campaign review, verification work, donor support, hosting, payment
            operations, and impact updates. Standard Stripe processing fees are
            separate.
          </p>

          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">Who we help</h2>
          <p className="leading-relaxed text-muted-foreground">
            Military families. Veterans. First responders. Parents facing
            medical bills. Families picking up the pieces after a disaster.
            Students trying to cover tuition. People whose pets need surgery.
            Communities trying to rebuild. If the need is specific and
            reviewable, we can help it become a fundraiser donors can
            understand.
          </p>

          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">Our team</h2>
          <p className="leading-relaxed text-muted-foreground">
            We&apos;re a small team building a fundraising platform around
            review, plain-language campaign pages, visible progress, and donor
            updates. Our editorial process favors specific claims, clear amounts,
            and supportable campaign details.
          </p>

          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">Nonprofit status</h2>
          <p className="leading-relaxed text-muted-foreground">
            LastDonor.org operates as a nonprofit fundraising initiative while
            federal tax-exempt status and EIN details are being finalized. Until
            that status is confirmed, donors should not assume donations are
            deductible for tax purposes. We will publish tax status updates and annual
            reports when they are available. Live platform statistics are
            available on our{' '}
            <a href="/transparency" className="text-brand-teal underline underline-offset-2 hover:opacity-80">Transparency page</a>.
          </p>
        </section>
      </div>
    </>
  );
}
