import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';

const faqs = [
  {
    question: 'What am I paying for when I donate?',
    answer:
      'You are making a donation to the campaign or general fund named at checkout. Campaign donations support the stated fundraiser. General fund donations support LastDonor operations such as campaign review, hosting, donor support, payment processing, and impact updates.',
  },
  {
    question: 'Does LastDonor sell physical goods or ship anything?',
    answer:
      'No. LastDonor accepts donations only. There are no physical goods, shipping charges, delivery dates, returns, or product warranties.',
  },
  {
    question: 'Who processes my payment?',
    answer:
      'Stripe processes card and wallet payments securely. LastDonor does not store full payment card numbers on its servers.',
  },
  {
    question: 'Does LastDonor charge a platform fee?',
    answer:
      'LastDonor charges 0% platform fees on fundraisers. Standard Stripe processing fees may apply. LastDonor funds its operations separately through general fund donations, grants, sponsorships, and operating support.',
  },
  {
    question: 'What is LastDonor\'s business model?',
    answer:
      'LastDonor is supported separately from campaign donations. General fund donations, grants, sponsorships, and operating support help pay for campaign review, verification work, donor support, hosting, payment operations, and impact updates.',
  },
  {
    question: 'Are donations tax deductible?',
    answer:
      'Do not assume a donation is tax deductible unless the donation flow, confirmation, or campaign page clearly says it is. LastDonor publishes tax status updates when they are available. Donors should consult a tax advisor for their own situation.',
  },
  {
    question: 'Can I donate anonymously?',
    answer:
      'Yes. If you choose anonymous, the campaign page displays Anonymous instead of your public donor name. LastDonor still keeps transaction records needed for support, fraud prevention, and compliance.',
  },
  {
    question: 'Can I cancel a monthly donation?',
    answer:
      'Yes. Monthly donations can be cancelled before the next billing date from your account when available or by contacting support@lastdonor.org.',
  },
  {
    question: 'Can I get a refund?',
    answer:
      'Donations are generally final after processing, but refund requests are reviewed for duplicate charges, unauthorized transactions, campaign removals, failed verification, and compliance issues.',
  },
  {
    question: 'What happens if a campaign is removed?',
    answer:
      'LastDonor may pause, suspend, or remove a campaign that cannot be verified or violates policy. Donors are notified when a campaign removal affects their donation, and refunds are processed where applicable.',
  },
  {
    question: 'How are campaign recipients verified?',
    answer:
      'Campaigns are reviewed before publication, and fund release requires additional verification. Depending on the campaign, review can include identity checks, supporting documents, bills, official letters, public records, photos, or organizer follow-up.',
  },
  {
    question: 'When do campaign recipients receive funds?',
    answer:
      'Funds are released only after required verification is complete and the campaign passes review. Eligible recipients receive funds through Stripe-connected payout rails or another approved method.',
  },
  {
    question: 'How do I report a problem?',
    answer:
      'Email support@lastdonor.org for payment or account issues, editorial@lastdonor.org to report inaccurate campaign information, or legal@lastdonor.org for legal concerns.',
  },
];

export const metadata: Metadata = {
  title: 'Donor FAQ',
  description:
    'Answers for LastDonor donors about payments, refunds, recurring donations, anonymous donations, tax status, campaign verification, and fund release.',
  alternates: { canonical: 'https://lastdonor.org/donor-faq' },
  openGraph: {
    title: 'Donor FAQ | LastDonor.org',
    description:
      'Payments, refunds, recurring donations, anonymous donations, tax status, campaign verification, and fund release.',
    images: [
      {
        url: '/api/v1/og/page?title=Donor+FAQ&subtitle=Payments%2C+refunds%2C+verification%2C+and+fund+release.',
        width: 1200,
        height: 630,
        alt: 'Donor FAQ at LastDonor.org',
      },
    ],
  },
};

export default function DonorFaqPage() {
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
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <Breadcrumbs />
        <h1 className="mt-6 font-display text-4xl font-bold text-foreground">
          Donor FAQ
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
          Plain answers about donating through LastDonor, including payment
          processing, refunds, recurring donations, campaign review, and fund
          release.
        </p>

        <dl className="mt-10 divide-y divide-border">
          {faqs.map((faq) => (
            <div key={faq.question} className="py-6">
              <dt className="font-display text-xl font-bold text-foreground">
                {faq.question}
              </dt>
              <dd className="mt-2 leading-relaxed text-muted-foreground">
                {faq.answer}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-10 rounded-xl border border-border bg-muted/30 p-6">
          <p className="font-semibold text-foreground">Need the policy details?</p>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link href="/refund-policy" className="rounded-md border border-border bg-background px-3 py-2 text-foreground hover:bg-muted">
              Refund Policy
            </Link>
            <Link href="/fund-release-policy" className="rounded-md border border-border bg-background px-3 py-2 text-foreground hover:bg-muted">
              Fund Release Policy
            </Link>
            <Link href="/privacy" className="rounded-md border border-border bg-background px-3 py-2 text-foreground hover:bg-muted">
              Privacy Policy
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
