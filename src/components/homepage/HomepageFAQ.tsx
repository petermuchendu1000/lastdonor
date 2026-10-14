import { ChevronDownIcon } from '@heroicons/react/24/outline';

const faqs = [
  {
    question: 'Does LastDonor charge platform fees?',
    answer:
      'No. LastDonor charges 0% platform fees on fundraisers. Standard Stripe payment processing fees apply.',
  },
  {
    question: 'How does LastDonor stay funded with 0% platform fees?',
    answer:
      'LastDonor funds operations separately through general fund donations, grants, sponsorships, and operating support. That support helps cover campaign review, verification work, donor support, hosting, payment operations, and impact updates.',
  },
  {
    question: 'How does LastDonor review campaigns before publication?',
    answer:
      'Every campaign is reviewed by a real person before going live. Depending on the story, we may check supporting documents such as bills, official letters, photos, or other evidence that helps donors understand the need.',
  },
  {
    question: 'Where does my donation money go?',
    answer:
      'Your donation supports the campaign you choose. LastDonor takes no platform cut from it, and publishes campaign updates so donors can follow progress and impact.',
  },
  {
    question: 'What types of fundraisers can I support?',
    answer:
      'LastDonor supports reviewed campaigns for medical bills, emergencies, memorial funds, military and veteran families, first responders, education, disaster relief, community needs, and family crises.',
  },
  {
    question: 'What makes LastDonor different from other fundraising sites?',
    answer:
      'LastDonor charges 0% platform fees on fundraisers, reviews campaigns before publication, and gives donors updates that show campaign progress and impact.',
  },
  {
    question: 'Can I donate without creating an account?',
    answer:
      'Yes. You can donate as a guest without creating an account. No signup is required to browse campaigns or donate. You will receive an email receipt confirming your contribution.',
  },
];

export function HomepageFAQ() {
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
    <section id="faq" className="bg-background py-20 sm:py-24" aria-labelledby="faq-heading">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2
            id="faq-heading"
            className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
          >
            Common Questions
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            A few details donors and campaign organizers often want before they give or share a story.
          </p>
        </div>

        <dl className="mt-12 divide-y divide-border">
          {faqs.map((faq) => (
            <details key={faq.question} open className="group py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-left">
                <dt className="text-base font-semibold text-foreground">{faq.question}</dt>
                <ChevronDownIcon
                  className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <dd className="mt-3 text-sm leading-relaxed text-muted-foreground">{faq.answer}</dd>
            </details>
          ))}
        </dl>
      </div>
    </section>
  );
}
