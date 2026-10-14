import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { DonationForm } from '@/components/campaign/DonationForm';
import { GENERAL_FUND_CAMPAIGN_ID } from '@/lib/constants';
import type { Metadata } from 'next';
import { seoKeywords } from '@/lib/seo/keywords';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Donate to the General Fund',
  description:
    'Support LastDonor.org directly. General fund donations help cover campaign review, payment processing, platform hosting, donor support, and impact updates.',
  keywords: seoKeywords('donor', 'trust', 'core'),
  alternates: { canonical: 'https://lastdonor.org/donate' },
  openGraph: {
    title: 'Donate to the General Fund | LastDonor.org',
    description:
      'General fund donations keep the lights on so we can respond fast when someone needs help.',
    images: [
      {
        url: '/api/v1/og/page?title=Donate+to+the+General+Fund&subtitle=Support+LastDonor.org+directly.',
        width: 1200,
        height: 630,
        alt: 'Donate to the General Fund at LastDonor.org',
      },
    ],
  },
};

export default function DonatePage() {
  const faqs = [
    {
      question: 'What does the LastDonor general fund support?',
      answer:
        'General fund donations help pay for campaign review, verification work, payment operations, hosting, donor support, and the work required to publish campaign updates.',
    },
    {
      question: 'Can I donate directly to a specific fundraiser instead?',
      answer:
        'Yes. Browse active fundraisers to support a specific medical, emergency, memorial, family, veteran, disaster relief, education, animal, or community campaign.',
    },
    {
      question: 'Does LastDonor charge a platform fee on donations?',
      answer:
        'LastDonor charges 0% platform fees on fundraisers. Standard payment processing fees apply. LastDonor funds operations separately through general fund donations, grants, sponsorships, and operating support.',
    },
    {
      question: 'Can I cancel a monthly general fund donation?',
      answer:
        'Yes. Monthly donations can be cancelled before the next billing date from your account when available or by contacting support@lastdonor.org.',
    },
    {
      question: 'Are general fund donations refundable?',
      answer:
        'Donations are generally final after processing, but LastDonor reviews refund requests for duplicate charges, unauthorized transactions, technical errors, and compliance issues.',
    },
    {
      question: 'Is anything shipped after I donate?',
      answer:
        'No. LastDonor accepts donations only. There are no physical goods, shipping charges, delivery dates, returns, or product warranties.',
    },
  ];

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
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <Breadcrumbs />
        <h1 className="mt-6 font-display text-3xl font-bold text-foreground">
          Support the General Fund
        </h1>
        <p className="mt-3 text-muted-foreground">
          General fund donations help LastDonor review fundraisers, keep
          campaign pages online, process payments, support donors, and publish
          impact updates. If you want to support a specific person or family,
          you can browse active campaigns instead.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          LastDonor charges 0% platform fees on fundraisers. The general fund is
          how donors, grantmakers, sponsors, and operating supporters help cover
          the platform work behind those fundraisers.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Donations are processed in U.S. dollars by Stripe. LastDonor does not
          sell or ship physical goods. See the{' '}
          <Link href="/refund-policy" className="text-primary underline underline-offset-4">
            Refund Policy
          </Link>{' '}
          and{' '}
          <Link href="/donor-faq" className="text-primary underline underline-offset-4">
            Donor FAQ
          </Link>{' '}
          before giving.
        </p>

        <div className="mt-8 rounded-xl border border-border bg-card p-6">
          <DonationForm campaignId={GENERAL_FUND_CAMPAIGN_ID} campaignTitle="General Fund" />
        </div>

        <section className="mt-10" aria-labelledby="general-fund-faq">
          <h2 id="general-fund-faq" className="font-display text-2xl font-bold text-foreground">
            General Fund FAQ
          </h2>
          <dl className="mt-5 divide-y divide-border">
            {faqs.map((faq) => (
              <div key={faq.question} className="py-4">
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
