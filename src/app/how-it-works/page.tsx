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
      'Anyone can start a campaign using the Share Your Story form. Our team also finds people in need and offers to help. The best campaigns say plainly who needs help, where they are, and how much money is needed.',
    icon: MagnifyingGlassIcon,
  },
  {
    number: '02',
    title: 'A person reviews the fundraiser',
    description:
      'A person on our team reads the campaign before anyone can see it. We check who the money is for, that the amount makes sense, and that the story is true. We often ask for a bill, a letter, or a photo as proof.',
    icon: CurrencyDollarIcon,
  },
  {
    number: '03',
    title: 'Donors give and track impact',
    description:
      'You pick a campaign and give. You can see how much it has raised at any time. When the money is spent, the campaign posts photos and receipts showing what it paid for.',
    icon: EyeIcon,
  },
];

const faqs = [
  {
    question: 'How do I start a fundraiser online with LastDonor?',
    answer:
      'Fill in the Share Your Story form. Say how much you need and why, and add photos. Then send it to us. A person reads it before it goes live.',
  },
  {
    question: 'Can I raise money for medical bills or an emergency?',
    answer:
      'Yes. Medical bills are one of the most common reasons people use LastDonor. You can also raise money for a funeral, a fire or flood, or a family emergency.',
  },
  {
    question: 'What does LastDonor charge?',
    answer:
      'Nothing. We take 0% of what you raise. Stripe handles the card payment and charges 2.9% plus 30 cents per donation. On a $50 donation that is $1.75, so you receive $48.25. We pay our own bills from separate donations and grants.',
  },
  {
    question: 'What makes a fundraiser easier to review?',
    answer:
      'Name the person the money is for. Say where they live. Ask for an amount you can explain. Add a bill or letter if you have one. Write the story the way you would tell a friend.',
  },
  {
    question: 'How do donors know what happened after a campaign closes?',
    answer:
      'The campaign posts an update on its page. It can include photos, receipts, and a note about what the money paid for. You get an email when it does.',
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
