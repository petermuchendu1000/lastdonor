import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { DonationForm } from '@/components/campaign/DonationForm';
import { GENERAL_FUND_CAMPAIGN_ID } from '@/lib/constants';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { and, eq, or } from 'drizzle-orm';
import type { Metadata } from 'next';
import { seoKeywords } from '@/lib/seo/keywords';
import Link from 'next/link';

/**
 * ISR, same cadence as /campaigns. The only query here is the general fund
 * existence check below, and a stale answer for five minutes is cheaper than
 * a database round trip on every hit of a navbar link. Counted in the ISR
 * page tally in docs/26 section 5.
 */
export const revalidate = 300;

/**
 * Does the general fund campaign actually exist, and will the donation API
 * accept it?
 *
 * `GENERAL_FUND_CAMPAIGN_ID` is a hardcoded uuid whose own comment says it
 * "must match the actual row in the campaigns table". On 2026-10-15 it did
 * not: no campaigns row carried that id, so the orange navbar CTA rendered a
 * complete donation form whose every submit got a 404 from
 * POST /api/v1/donations/create-checkout ("Campaign not found or not
 * accepting donations"). See docs/42.
 *
 * The predicate is deliberately identical to the one create-checkout uses
 * (`id` + status in active / last_donor_zone). If this returns true and the
 * API still refuses, the two have drifted apart and that is a bug in one of
 * them, not a state the donor can be shown.
 */
async function generalFundIsDonatable(): Promise<boolean> {
  try {
    const [row] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, GENERAL_FUND_CAMPAIGN_ID),
          or(
            eq(campaigns.status, 'active'),
            eq(campaigns.status, 'last_donor_zone'),
          ),
        ),
      )
      .limit(1);

    return Boolean(row);
  } catch {
    // A database fault is not evidence that the fund is missing, but it is
    // also not evidence that a donation would work. Fail closed: the
    // explanatory state points at campaigns that definitely can take money.
    return false;
  }
}

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

export default async function DonatePage() {
  const fundAcceptsDonations = await generalFundIsDonatable();

  const faqs = [
    {
      question: 'What does the LastDonor general fund support?',
      answer:
        'Giving to the general fund pays our staff to check campaigns, answer donors, and keep the site running.',
    },
    {
      question: 'Can I donate directly to a specific fundraiser instead?',
      answer:
        'Yes. Pick someone to help. Every campaign has been checked by a person before going live.',
    },
    {
      question: 'Does LastDonor charge a platform fee on donations?',
      answer:
        'We take 0%. The company that moves the money charges a fee to do it, and we receive no part of that fee. We pay our own bills from separate donations and grants.',
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

        {fundAcceptsDonations ? (
          <div className="mt-8 rounded-xl border border-border bg-card p-6">
            <DonationForm campaignId={GENERAL_FUND_CAMPAIGN_ID} campaignTitle="General Fund" />
          </div>
        ) : (
          /* No donation form is shown when there is nothing behind it. A form
             that 404s on every submit is worse than no form. */
          <div className="mt-8 rounded-xl border border-border bg-card p-6" role="status">
            <h2 className="font-display text-xl font-bold text-card-foreground">
              The general fund is not accepting donations right now
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              We are not able to take general fund donations at the moment, so
              we are not going to show you a payment form that cannot complete.
              Nothing is wrong with your card or your account.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Individual fundraisers are unaffected and can still receive
              donations. If you came here to support the platform itself,
              email support@lastdonor.org and we will tell you when the fund reopens.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/campaigns"
                className="btn-press inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                Browse active fundraisers
              </Link>
              <Link
                href="/donor-faq"
                className="btn-press inline-flex items-center justify-center rounded-full border border-border px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
              >
                Donor FAQ
              </Link>
            </div>
          </div>
        )}

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
