import type { Metadata } from 'next';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { seoKeywords } from '@/lib/seo/keywords';

export const metadata: Metadata = {
  title: 'Editorial Standards | Campaign Review Process',
  description:
    'How LastDonor reviews fundraisers before publication, checks campaign details, evaluates supporting documents, and keeps donor-facing updates clear.',
  keywords: seoKeywords('trust', 'campaigns', 'start', 'core'),
  alternates: { canonical: 'https://lastdonor.org/editorial-standards' },
  openGraph: {
    title: 'Editorial Standards | LastDonor.org',
    description:
      'How campaign review works before a fundraiser goes live on LastDonor.',
    images: [
      {
        url: '/api/v1/og/page?title=Editorial+Standards&subtitle=Every+campaign+is+reviewed+before+publication.',
        width: 1200,
        height: 630,
        alt: 'Editorial Standards at LastDonor.org',
      },
    ],
  },
};

export default function EditorialStandardsPage() {
  const faqs = [
    {
      question: 'What does LastDonor review before a fundraiser goes live?',
      answer:
        'A reviewer checks whether the campaign has a clear beneficiary, specific need, reasonable goal, appropriate category, and supporting details that help donors understand the fundraiser.',
    },
    {
      question: 'What documents help with campaign verification?',
      answer:
        'A bill. An official letter. A photo. A vet or school document. Anything that shows the need is real.',
    },
    {
      question: 'Can campaign details change after publication?',
      answer:
        'Yes. Campaign updates can clarify progress, add new information, correct errors, or show impact after a fundraiser receives donations.',
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
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <Breadcrumbs />
        <h1 className="mt-6 font-display text-4xl font-bold text-foreground">
          Editorial Standards
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">
          LastDonor reviews fundraisers before publication so donors can read a
          clear story, understand the goal, and see what supporting details are
          available before they give.
        </p>

        <div className="mt-10 space-y-8 text-foreground">
        <section>
          <h2 className="font-display text-2xl font-bold">
            Source Requirements
          </h2>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            Every campaign needs at least one credible, independently
            reviewable source before we will publish it. Acceptable sources can include:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6 text-muted-foreground">
            <li>Official military and defense publications (DVIDS, Stars &amp; Stripes, Defense.gov)</li>
            <li>Law enforcement and fire service official reports (ODMP, USFA, LODD databases)</li>
            <li>Government disaster declarations (FEMA, NWS)</li>
            <li>Established news organizations with editorial oversight</li>
            <li>Hospital or medical facility confirmations</li>
            <li>Court records or existing fundraiser pages as supplementary context</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold">
            How We Verify Each Campaign
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-6 text-muted-foreground">
            <li>
              <strong>We find the story</strong> - Through news feeds,
              official reports, and community submissions. We go looking for
              people who actually need help.
            </li>
            <li>
              <strong>We check the sources</strong> - At least one primary
              source has to be independently verifiable. We cross-reference
              with multiple sources whenever we can.
            </li>
            <li>
              <strong>We confirm the need</strong> - We verify that the
              person or family has a real financial need, and that a specific
              dollar amount is justified and not inflated.
            </li>
            <li>
              <strong>A person reviews it</strong> - A member of our
              editorial team reads the campaign for accuracy, tone, and
              completeness. Not an algorithm. A person.
            </li>
            <li>
              <strong>It goes live with citations</strong> - Every published
              campaign includes source citations so you can verify the story
              yourself if you want to.
            </li>
          </ol>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold">
            What We Will Never Do
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 text-muted-foreground">
            <li>We will never fabricate or embellish a story to get more donations.</li>
            <li>
              We will never use guilt-based language, manipulative appeals, or
              sensationalized headlines.
            </li>
            <li>
              We will never run campaigns for celebrities, politicians, or
              anyone who is not in genuine financial need.
            </li>
            <li>
              We will never publish photos of identifiable people without
              proper sourcing. Campaign images are editorial illustrations
              unless sourced from official public domain outlets.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold">
            When We Get Something Wrong
          </h2>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            If we discover an error in a campaign, here is what happens:
          </p>
          <ol className="mt-3 list-decimal space-y-2 pl-6 text-muted-foreground">
            <li>
              We fix it immediately and note the correction on the campaign
              page so everyone can see what changed.
            </li>
            <li>
              If the error is serious (wrong person, incorrect incident), we
              pause the campaign, contact every donor who gave, and publish a
              transparent correction.
            </li>
            <li>
              If a campaign turns out to be based on false information, we
              suspend it, notify donors, and publish a clear explanation.
            </li>
          </ol>
        </section>

          <section aria-labelledby="editorial-faq">
            <h2 id="editorial-faq" className="font-display text-2xl font-bold">
              Campaign Review FAQ
            </h2>
            <dl className="mt-3 divide-y divide-border">
              {faqs.map((faq) => (
                <div key={faq.question} className="py-4">
                  <dt className="font-semibold text-foreground">{faq.question}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{faq.answer}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold">
              See Something Off? Tell Us.
            </h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              If you think any information on our platform is wrong, email us at{' '}
              <a
                href="mailto:editorial@lastdonor.org"
                className="text-primary underline underline-offset-4"
              >
                editorial@lastdonor.org
              </a>
              . We take reports seriously and review them promptly.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
