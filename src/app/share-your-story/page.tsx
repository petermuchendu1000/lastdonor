import type { Metadata } from 'next';
import { ChevronDownIcon } from '@/components/ui/icon';
import { ShareYourStoryForm } from './ShareYourStoryForm';
import { seoKeywords } from '@/lib/seo/keywords';

export const metadata: Metadata = {
  title: 'Start a Fundraiser | Create a Reviewed Campaign',
  description:
    'Raise money for medical bills, a funeral, a disaster, school fees, or a family in crisis. Submit your story for review before publication.',
  keywords: seoKeywords('start', 'campaigns', 'medical', 'emergency', 'memorial', 'family', 'nonprofit'),
  alternates: { canonical: 'https://lastdonor.org/share-your-story' },
  openGraph: {
    title: 'Start a Fundraiser | LastDonor.org',
    description:
      'Start a fundraiser. A person checks it before it goes live.',
    images: [
      {
        url: '/api/v1/og/page?title=Start+a+Fundraiser&subtitle=Share+your+story.+We+review+it.+Your+community+funds+it.',
        width: 1200,
        height: 630,
        alt: 'Start a fundraiser on LastDonor.org',
      },
    ],
  },
};

const faqs = [
  {
    question: 'What kind of fundraiser can I start on LastDonor?',
    answer:
      'Almost any real need. Medical bills. A funeral. A fire or flood. School fees. Vet bills. Help for a veteran or a first responder family.',
  },
  {
    question: 'What information helps a fundraiser get reviewed?',
    answer:
      'Name the person the money is for. Say where they live. Ask for an amount you can explain. Add a clear photo, the full story, and a document if you have one.',
  },
  {
    question: 'Can I raise money for myself or someone else?',
    answer:
      'Yes. You can create a personal fundraiser for yourself or start a fundraiser for a family member, friend, colleague, organization, or community member.',
  },
  {
    question: 'Does LastDonor charge a setup fee?',
    answer:
      'No. We take 0%. Stripe charges 2.9% plus 30 cents on a US card. On a $50 donation that is $1.75, so the campaign gets $48.25. We pay our own bills from separate donations and grants.',
  },
];

export default function ShareYourStoryPage() {
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
      <ShareYourStoryForm />
      {/*
        Collapsed, and the same `<details>` shape docs/61 settled on for the
        homepage.

        All four answers used to render expanded, which put 170 words and
        roughly 500px of reference text under an unfinished form, on every
        one of the six wizard screens. The `FAQPage` JSON-LD above is what
        earns the rich result - a closed `<details>` keeps its answer in the
        DOM either way - so collapsing changes what a person scrolls past,
        not what a crawler reads.

        None is open by default, unlike the homepage. There the FAQ is the
        section a reader arrived at; here it sits below a task in progress,
        and an answer expanded by default is one more thing between the
        visitor and the Continue button. See docs/75.
      */}
      <section className="mx-auto max-w-3xl px-6 py-12 lg:px-8" aria-labelledby="start-fundraiser-faq">
        <h2 id="start-fundraiser-faq" className="font-display text-2xl font-bold text-foreground">
          Questions about starting a fundraiser
        </h2>
        <div className="mt-5 divide-y divide-border">
          {faqs.map((faq) => (
            <details key={faq.question} className="group py-4">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-left">
                <h3 className="text-base font-semibold text-foreground">{faq.question}</h3>
                <ChevronDownIcon
                  className="mt-0.5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
