import type { Metadata } from 'next';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { seoKeywords } from '@/lib/seo/keywords';

export const metadata: Metadata = {
  title: 'Editorial Standards | How We Check a Campaign',
  description:
    'How LastDonor checks a campaign before it goes live. What sources we accept, what we will never do, and how we fix a mistake.',
  keywords: seoKeywords('trust', 'campaigns', 'start', 'core'),
  alternates: { canonical: 'https://lastdonor.org/editorial-standards' },
  openGraph: {
    title: 'Editorial Standards | LastDonor.org',
    description:
      'How we check a campaign before it goes live, and how we fix a mistake.',
    images: [
      {
        url: '/api/v1/og/page?title=Editorial+Standards&subtitle=A+person+reads+every+campaign+before+it+goes+live.',
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
      question: 'What does LastDonor check before a campaign goes live?',
      answer:
        'A person reads it first. We check who the money is for. We check that the need is real and the goal makes sense. We check the campaign is in the right category. We look for details that help you understand the story.',
    },
    {
      question: 'What documents help us check a campaign?',
      answer:
        'A bill. An official letter. A photo. A vet or school document. Anything that shows the need is real.',
    },
    {
      question: 'Can a campaign change after it goes live?',
      answer:
        'Yes. A campaign can post an update. An update can report progress, add news, correct a mistake, or show what the money did.',
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
          A person reads every campaign before it goes live. We check who the
          money is for, what the goal is, and what proof there is. This page
          says how we do it.
        </p>

        <div className="mt-10 space-y-8 text-foreground">
        <section>
          <h2 className="font-display text-2xl font-bold">
            Sources We Accept
          </h2>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            Every campaign needs at least one source we can check for
            ourselves. We will not publish it without one. Sources can include:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6 text-muted-foreground">
            <li>Official military and defense publications (DVIDS, Stars &amp; Stripes, Defense.gov)</li>
            <li>Official police and fire service reports (ODMP, USFA, LODD databases)</li>
            <li>Government disaster declarations (FEMA, NWS)</li>
            <li>News organizations that have editors</li>
            <li>Confirmation from a hospital or a clinic</li>
            <li>Court records, or an existing fundraiser page for extra context</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold">
            How We Check Each Campaign
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-6 text-muted-foreground">
            <li>
              <strong>We find the story</strong> - We read news feeds and
              official reports. People send us stories too. We go looking for
              people who really need help.
            </li>
            <li>
              <strong>We check the sources</strong> - At least one source has
              to be one we can check for ourselves. We look for more than one
              source when we can.
            </li>
            <li>
              <strong>We confirm the need</strong> - We check that the person
              or family really needs the money. We check that the amount asked
              for makes sense and is not too high.
            </li>
            <li>
              <strong>A person reviews it</strong> - Someone on our editorial
              team reads the campaign. They check that it is true, complete
              and fair. Not a computer. A person.
            </li>
            <li>
              <strong>It goes live with its sources</strong> - Every campaign
              we publish lists where the story came from. You can check it
              yourself.
            </li>
          </ol>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold">
            What We Will Never Do
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 text-muted-foreground">
            <li>We will never make up a story to raise more money. We will never make one sound worse than it is.</li>
            <li>
              We will never try to guilt you into giving. We will never use
              shocking headlines to get clicks.
            </li>
            <li>
              We will never run a campaign for a celebrity or a politician. We
              only run campaigns for people who really need the money.
            </li>
            <li>
              We will never publish a photo of a person you could recognize
              without saying where it came from. Campaign images are
              illustrations unless the photo comes from an official public
              domain source.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold">
            When We Get Something Wrong
          </h2>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            If we find a mistake in a campaign, here is what happens:
          </p>
          <ol className="mt-3 list-decimal space-y-2 pl-6 text-muted-foreground">
            <li>
              We fix it right away. We note the change on the campaign page so
              everyone can see what we changed.
            </li>
            <li>
              Some mistakes are serious, like the wrong person or the wrong
              event. Then we pause the campaign. We email every donor who
              gave. We publish a correction that says what went wrong.
            </li>
            <li>
              If a campaign turns out to be untrue, we stop it. We tell the
              donors. We publish a clear explanation.
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
              If you think anything on this site is wrong, email us at{' '}
              <a
                href="mailto:editorial@lastdonor.org"
                className="text-primary underline underline-offset-4"
              >
                editorial@lastdonor.org
              </a>
              . We take every report seriously. We look into it quickly.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
