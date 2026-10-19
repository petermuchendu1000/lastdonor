import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { seoKeywords } from '@/lib/seo/keywords';

const faqs = [
  {
    question: 'Is LastDonor a GoFundMe alternative?',
    answer:
      'Yes. We take 0% of what a campaign raises. A person reads every campaign before it goes live. You can see how much it has raised at any time.',
  },
  {
    question: 'Does LastDonor charge a platform fee?',
    answer:
      'No. We take 0%. Stripe charges 2.9% plus 30 cents on a US card. On a $50 donation that is $1.75, so the campaign gets $48.25. We pay our own bills from separate donations and grants.',
  },
  {
    question: 'Does LastDonor guarantee fundraising results?',
    answer:
      'No. How much a campaign raises depends on the story. It also depends on who sees it and how widely it is shared. No site can promise a result.',
  },
  {
    question: 'How should I compare fundraising platforms?',
    answer:
      'Ask three questions. What does the site charge? Who reads a campaign before it goes live? And what can you see after you give?',
  },
];

export const metadata: Metadata = {
  title: 'GoFundMe Alternative | Compare Fundraising Platforms',
  description:
    'See how LastDonor compares with the big fundraising sites. Three things to check: the fees, the campaign checks, and where your money goes.',
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
      'A checklist for choosing a fundraising site: what it charges, who checks the campaigns, and what you can see after you give.',
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
          'A page to help you choose between LastDonor and the large fundraising sites.',
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
            A GoFundMe alternative. We take 0%, and a person checks every
            campaign.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Choosing where to fundraise comes down to a few facts you can check.
            What does the site charge? Who reads a campaign before it goes live?
            What can donors see afterwards? Here are our answers, so you can ask
            any other site the same thing.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            ['What LastDonor takes', '0%'],
            ['What Stripe charges', '2.9% + 30c, US card'],
            ['A person checks it', 'Before it goes live'],
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
            What to check on any fundraising site
          </h2>
          <div className="mt-8 overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-muted/60">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold text-foreground">What to compare</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-foreground">What to ask</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-primary">LastDonor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="px-4 py-4 font-medium text-foreground">Fees</td>
                  <td className="px-4 py-4 text-muted-foreground">Does the site take a cut? Does it ask donors for a tip on top?</td>
                  <td className="px-4 py-4 text-foreground">We take 0% of what a campaign raises.</td>
                </tr>
                <tr>
                  <td className="px-4 py-4 font-medium text-foreground">Card fees</td>
                  <td className="px-4 py-4 text-muted-foreground">What does the card payment cost, and who keeps that money?</td>
                  <td className="px-4 py-4 text-foreground">Stripe charges 2.9% plus 30 cents on a US card. On a $50 donation that is $1.75, so the campaign gets $48.25. We get none of it.</td>
                </tr>
                <tr>
                  <td className="px-4 py-4 font-medium text-foreground">Checks</td>
                  <td className="px-4 py-4 text-muted-foreground">Does a person read a campaign before it goes live, or only after a complaint?</td>
                  <td className="px-4 py-4 text-foreground">A person reads every campaign before it goes live.</td>
                </tr>
                <tr>
                  <td className="px-4 py-4 font-medium text-foreground">Updates</td>
                  <td className="px-4 py-4 text-muted-foreground">Can you follow a campaign after you give?</td>
                  <td className="px-4 py-4 text-foreground">You can see the money raised, how many people gave, and every update.</td>
                </tr>
                <tr>
                  <td className="px-4 py-4 font-medium text-foreground">Support</td>
                  <td className="px-4 py-4 text-muted-foreground">Is there a real person you can email?</td>
                  <td className="px-4 py-4 text-foreground">Yes. We publish an address for support, editorial, privacy, and legal.</td>
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
            <li>You need money for a medical bill, a funeral, or a family emergency.</li>
            <li>You want to keep as much as you can. We take 0%, and only the Stripe fee comes off.</li>
            <li>You want a page that shows progress and updates, not just a donate button.</li>
            <li>You want plain answers about tax, refunds, and fees before you give.</li>
          </ul>
        </div>
        <aside className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-display text-xl font-bold text-foreground">
            Start a campaign
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Tell us the story. Say who the money is for, how much you need, and
            where you live. Add photos if you have them. A person reads it
            before it goes live.
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
          Questions about choosing a platform
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
