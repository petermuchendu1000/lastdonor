import type { Metadata } from 'next';
import { ShareYourStoryForm } from './ShareYourStoryForm';
import { seoKeywords } from '@/lib/seo/keywords';

export const metadata: Metadata = {
  title: 'Start a Fundraiser | Create a Reviewed Campaign',
  description:
    'Start a fundraiser for medical bills, emergencies, memorial costs, disaster relief, family needs, pets, tuition, veterans, or community projects. Submit your story for review before publication.',
  keywords: seoKeywords('start', 'campaigns', 'medical', 'emergency', 'memorial', 'family', 'nonprofit'),
  alternates: { canonical: 'https://lastdonor.org/share-your-story' },
  openGraph: {
    title: 'Start a Fundraiser | LastDonor.org',
    description:
      'Create a reviewed fundraiser for a medical, emergency, memorial, family, animal, education, veteran, or community need.',
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
      'You can start a fundraiser for medical bills, surgery, emergency expenses, funeral costs, memorial support, disaster relief, family needs, vet bills, tuition, veteran support, first responder families, small businesses, events, or community projects.',
  },
  {
    question: 'What information helps a fundraiser get reviewed?',
    answer:
      'A clear beneficiary, location, campaign category, realistic fundraising goal, cover photo, detailed story, and supporting documents all help reviewers understand the need before publication.',
  },
  {
    question: 'Can I raise money for myself or someone else?',
    answer:
      'Yes. You can create a personal fundraiser for yourself or start a fundraiser for a family member, friend, colleague, organization, or community member.',
  },
  {
    question: 'Does LastDonor charge a setup fee?',
    answer:
      'No. LastDonor charges 0% platform fees on fundraisers. Standard payment processing fees apply. Operations are funded separately through general fund donations, grants, sponsorships, and operating support.',
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
      <section className="mx-auto max-w-4xl px-6 py-12 lg:px-8" aria-labelledby="start-fundraiser-faq">
        <h2 id="start-fundraiser-faq" className="font-display text-2xl font-bold text-foreground">
          Start a Fundraiser FAQ
        </h2>
        <dl className="mt-5 grid gap-5 md:grid-cols-2">
          {faqs.map((faq) => (
            <div key={faq.question}>
              <dt className="font-semibold text-foreground">{faq.question}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
