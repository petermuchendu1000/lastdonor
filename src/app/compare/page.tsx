import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { seoKeywords } from '@/lib/seo/keywords';

const faqs = [
  {
    question: 'Is LastDonor a GoFundMe alternative?',
    answer:
      'Yes. LastDonor is an alternative fundraising platform for people who want reviewed campaigns, 0% platform fees from LastDonor, and visible campaign progress.',
  },
  {
    question: 'Does LastDonor charge a platform fee?',
    answer:
      'No. We take 0%. The company that moves the money charges a fee to do it, and we receive no part of that fee. We pay our own bills from separate donations and grants.',
  },
  {
    question: 'Does LastDonor guarantee fundraising results?',
    answer:
      'No. How much a campaign raises depends on the story, who sees it, and how widely it is shared. No site can promise a result.',
  },
  {
    question: 'How should I compare fundraising platforms?',
    answer:
      'Compare what each site charges, who checks campaigns, and how clearly they tell you where your money goes.',
  },
];

export const metadata: Metadata = {
  title: 'GoFundMe Alternative | Compare Fundraising Platforms',
  description:
    'How LastDonor compares with the big fundraising sites on fees, checks, and how clearly each one explains where money goes.',
  keywords: [
    'GoFundMe alternative',
    'GoFundMe vs LastDonor',
    'fundraising platform comparison',
    'crowdfunding comparison',
    'zero platform fee fundraising',
    'reviewed crowdfunding',
    ...seoKeywords('core', 'start', 'trust', 'campaigns'),
  ],
  alternates: { canonical: 'https://lastdonor.org/compare' },
  openGraph: {
    title: 'GoFundMe Alternative | LastDonor.org',
    description:
      'A factual comparison checklist for choosing a fundraising platform with 0% platform fees, reviewed campaigns, and visible progress updates.',
    url: 'https://lastdonor.org/compare',
    type: 'website',
    images: [
      {
        url: '/api/v1/og/page?title=Compare+Fundraising+Platforms&subtitle=Fees.+Review.+Updates.+Transparency.',
        width: 1200,
        height: 630,
        alt: 'Compare fundraising platforms with LastDonor.org',
      },
    ],
  },
};

export default function ComparePage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': 'https://lastdonor.org/compare#webpage',
        url: 'https://lastdonor.org/compare',
        name: 'GoFundMe Alternative: Compare Fundraising Platforms',
        description:
          'A factual comparison page for choosing between LastDonor and large fundraising platforms.',
        isPartOf: { '@id': 'https://lastdonor.org/#website' },
        about: { '@id': 'https://lastdonor.org/#organization' },
      },
      {
        '@type': 'FAQPage',
        '@id': 'https://lastdonor.org/compare#faq',
        mainEntity: faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: faq.answer,
          },
        })),
      },
    ],
  };

  return (
    <main className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <Breadcrumbs />
        <div className="mt-8 max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            Fundraising platform comparison
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            GoFundMe alternative for reviewed fundraising with 0% platform fees.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            LastDonor is built for donors and organizers who want clear fee
            disclosure, campaign review before publication, and visible progress
            updates. This page avoids unverifiable success claims and focuses on
            criteria you can check before choosing any fundraising platform.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            ['LastDonor platform fee', '0%'],
            ['Deducted from a donation', 'Nothing'],
            ['Campaign review', 'Before publication'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-card p-5">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-2 font-display text-2xl font-bold text-foreground">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-muted/30">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
          <h2 className="font-display text-3xl font-bold tracking-tight text-foreground">
            Compare the things that actually affect trust
          </h2>
          <div className="mt-8 relative overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-muted/60">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold text-foreground">Decision factor</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-foreground">What to check on any platform</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-primary">LastDonor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="px-4 py-4 font-medium text-foreground">Platform fees</td>
                  <td className="px-4 py-4 text-muted-foreground">Whether the platform takes a percentage or asks donors for platform tips.</td>
                  <td className="px-4 py-4 text-foreground">0% platform fees on fundraisers from LastDonor.</td>
                </tr>
                <tr>
                  <td className="px-4 py-4 font-medium text-foreground">Payment processing</td>
                  <td className="px-4 py-4 text-muted-foreground">The payment processing fee and who keeps it.</td>
                  <td className="px-4 py-4 text-foreground">The payment company charges a fee. We get none of it.</td>
                </tr>
                <tr>
                  <td className="px-4 py-4 font-medium text-foreground">Campaign review</td>
                  <td className="px-4 py-4 text-muted-foreground">Whether campaign details are reviewed before or only after reports.</td>
                  <td className="px-4 py-4 text-foreground">Campaigns are reviewed before publication.</td>
                </tr>
                <tr>
                  <td className="px-4 py-4 font-medium text-foreground">Donor updates</td>
                  <td className="px-4 py-4 text-muted-foreground">How donors can follow progress, updates, and completion status.</td>
                  <td className="px-4 py-4 text-foreground">Campaign progress, donor counts, updates, and completion status are visible.</td>
                </tr>
                <tr>
                  <td className="px-4 py-4 font-medium text-foreground">Support</td>
                  <td className="px-4 py-4 text-muted-foreground">Whether organizers and donors can contact a real support channel.</td>
                  <td className="px-4 py-4 text-foreground">Support, editorial, privacy, and legal contact channels are published.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_320px] lg:px-8">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight text-foreground">
            When LastDonor is a good fit
          </h2>
          <ul className="mt-6 space-y-3 text-muted-foreground">
            <li>You want a reviewed medical, emergency, memorial, family, veteran, or disaster relief fundraiser.</li>
            <li>You want 0% platform fees on fundraisers from LastDonor, with nothing deducted from a donation to process it.</li>
            <li>You want campaign pages that show progress and updates instead of only a donation button.</li>
            <li>You want donor-facing language that is careful about tax status, refunds, and fee disclosure.</li>
          </ul>
        </div>
        <aside className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-display text-xl font-bold text-foreground">
            Start with a reviewed campaign
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Share the story, category, goal, location, photos, and supporting
            context. The campaign is reviewed before it appears publicly.
          </p>
          <Link
            href="/share-your-story"
            className="mt-5 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Start a fundraiser
          </Link>
        </aside>
      </section>

      <section id="faq" className="mx-auto max-w-5xl px-4 pb-16 sm:px-6 lg:px-8">
        <h2 className="font-display text-3xl font-bold tracking-tight text-foreground">
          Fundraising platform comparison FAQ
        </h2>
        <dl className="mt-6 grid gap-5 md:grid-cols-2">
          {faqs.map((faq) => (
            <div key={faq.question}>
              <dt className="font-semibold text-foreground">{faq.question}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
