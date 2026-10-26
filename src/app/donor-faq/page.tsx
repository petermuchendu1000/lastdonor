import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';

const faqs = [
  {
    question: 'What am I paying for when I donate?',
    answer:
      'You are giving money to the campaign you chose at checkout. If you chose the general fund instead, your money pays for running LastDonor itself.',
  },
  {
    question: 'Will you send me anything?',
    answer:
      'No. A donation is a gift, not a purchase. There is nothing to ship, return, or exchange.',
  },
  {
    question: 'Who takes my card details?',
    answer:
      'Not us. Your card details go straight to the company that processes the payment. We never see or keep your full card number.',
  },
  {
    question: 'How much of my donation reaches the campaign?',
    answer:
      'We take 0%. The company that moves the money charges a fee to do it, and we receive no part of that fee.',
  },
  {
    question: 'If you take nothing, how do you survive?',
    answer:
      'Some people donate to LastDonor itself instead of to a campaign. We also look for grants and sponsors. That money pays our staff and our bills.',
  },
  {
    question: 'Can I claim this on my taxes?',
    answer:
      'Assume no. Only claim it if the donation page or your receipt says you can. Tax rules differ by country and by person, so ask a tax adviser about your own case.',
  },
  {
    question: 'Can I give without my name showing?',
    answer:
      'Yes. Tick the anonymous box and the campaign page shows "Anonymous". We still keep a private record so we can help you if something goes wrong.',
  },
  {
    question: 'Can I stop a monthly donation?',
    answer:
      'Yes, any time before the next payment date. Stop it in your account, or email support@lastdonor.org and we will do it.',
  },
  {
    question: 'Can I get my money back?',
    answer:
      'Usually a donation is final once it goes through. We do refund you in four cases. The charge was not yours. You were charged twice. We took the campaign down. Or the law requires it. Email support@lastdonor.org within 30 days.',
  },
  {
    question: 'What if you take a campaign down after I gave?',
    answer:
      'We email you. If the money has not reached the campaign yet, we refund you.',
  },
  {
    question: 'How do you check who is behind a campaign?',
    answer:
      'A person on our team reads every campaign before it goes live. Before any money is paid out, we check the campaign again. We can ask for ID, a bill, an official letter, or a photo.',
  },
  {
    question: 'When does the campaign actually get the money?',
    answer:
      'After those checks are done. We send it to their bank account.',
  },
  {
    question: 'Something is wrong. Who do I tell?',
    answer:
      'Email support@lastdonor.org about a payment or your account. Email editorial@lastdonor.org if a campaign looks untrue. Email legal@lastdonor.org about a legal problem.',
  },
];

export const metadata: Metadata = {
  title: 'Donor FAQ',
  description:
    'Plain answers about paying, refunds, giving anonymously, and when campaigns get the money.',
  alternates: { canonical: 'https://lastdonor.org/donor-faq' },
  openGraph: {
    title: 'Donor FAQ | LastDonor.org',
    description:
      'Paying, refunds, giving anonymously, and when campaigns get the money.',
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
