import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { seoKeywords } from '@/lib/seo/keywords';
import {
  MagnifyingGlassIcon,
  CurrencyDollarIcon,
  EyeIcon,
} from '@heroicons/react/24/solid';

export const metadata: Metadata = {
  title: 'How LastDonor Works | Start, Review, Donate, Track Impact',
  description:
    'Learn how LastDonor reviews crowdfunding campaigns, helps donors support medical and emergency fundraisers, tracks progress, and publishes impact updates.',
  keywords: seoKeywords('core', 'start', 'trust', 'campaigns', 'medical', 'emergency'),
  alternates: { canonical: 'https://lastdonor.org/how-it-works' },
  openGraph: {
    title: 'How LastDonor.org Works',
    description:
      'Learn how reviewed campaigns, 0% platform fees, donation tracking, and impact updates work on LastDonor.',
    images: [
      {
        url: '/api/v1/og/page?title=How+It+Works&subtitle=We+find+the+stories.+You+fund+them.+We+show+you+where+it+went.',
        width: 1200,
        height: 630,
        alt: 'How LastDonor.org Works',
      },
    ],
  },
};

const STEPS = [
  {
    number: '01',
    title: 'A campaign is submitted or sourced',
    description:
      'Campaigns can begin through the Share Your Story form or through our editorial sourcing. The strongest submissions include a clear need, a specific fundraising goal, a location, a beneficiary, and supporting details donors can understand.',
    icon: MagnifyingGlassIcon,
  },
  {
    number: '02',
    title: 'A person reviews the fundraiser',
    description:
      'Before publication, a real person reviews the campaign for clarity, category fit, goal amount, beneficiary details, and supportable claims. Depending on the fundraiser, review may include bills, letters, photos, public records, or organizer follow-up.',
    icon: CurrencyDollarIcon,
  },
  {
    number: '03',
    title: 'Donors give and track impact',
    description:
      'Donors choose a reviewed medical fundraiser, emergency fundraiser, memorial fund, family campaign, or other cause and see campaign progress as it moves toward its goal. After completion, updates can show receipts, photos, notes, or other outcome details.',
    icon: EyeIcon,
  },
];

const faqs = [
  {
    question: 'How do I start a fundraiser online with LastDonor?',
    answer:
      'Use the Share Your Story form to create a fundraiser, set a goal, choose a category, add media, and submit the campaign for review before publication.',
  },
  {
    question: 'Can I raise money for medical bills or emergency expenses?',
    answer:
      'Yes. LastDonor supports reviewed medical fundraisers, hospital bill fundraisers, emergency fundraisers, family emergency campaigns, memorial funds, disaster relief fundraisers, and other specific needs.',
  },
  {
    question: 'Does LastDonor charge platform fees?',
    answer:
      'LastDonor charges 0% platform fees on fundraisers. Standard payment processing fees apply. Operations are funded separately through general fund donations, grants, sponsorships, and operating support.',
  },
  {
    question: 'What makes a fundraiser easier to review?',
    answer:
      'A specific beneficiary, clear location, realistic goal, supporting documents or public sources, and a plain-language story all help reviewers understand the fundraiser before it goes live.',
  },
  {
    question: 'How do donors know what happened after a campaign closes?',
    answer:
      'Campaign pages and impact stories can include updates, donor messages, receipts, photos, and outcome notes after a fundraiser reaches its goal.',
  },
];

export default function HowItWorksPage() {
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
          How LastDonor Works
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Start a fundraiser, review the campaign, donate with context, and
          follow impact after the goal is reached.
        </p>

        <div className="mt-12 space-y-12">
          {STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.number} className="flex gap-6">
                <div className="flex shrink-0 flex-col items-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                    <Icon className="h-7 w-7 text-primary" />
                  </div>
                  <span className="mt-2 font-mono text-sm font-bold text-primary">
                    {step.number}
                  </span>
                </div>
                <div>
                  <h2 className="font-display text-xl font-bold text-foreground">
                    {step.title}
                  </h2>
                  <p className="mt-2 leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <section className="mt-16" aria-labelledby="how-it-works-faq">
          <h2 id="how-it-works-faq" className="font-display text-2xl font-bold text-foreground">
            Fundraising FAQ
          </h2>
          <dl className="mt-6 divide-y divide-border">
            {faqs.map((faq) => (
              <div key={faq.question} className="py-5">
                <dt className="font-semibold text-foreground">{faq.question}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{faq.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="mt-16 rounded-xl bg-muted/30 p-8 text-center">
          <h2 className="font-display text-2xl font-bold text-foreground">
            Ready to support a reviewed fundraiser?
          </h2>
          <p className="mt-2 text-muted-foreground">
            Browse active campaigns or submit a story for review.
          </p>
          <Link
            href="/campaigns"
            className="mt-4 inline-flex rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent/90"
          >
            Browse Campaigns
          </Link>
        </div>
      </div>
    </>
  );
}
