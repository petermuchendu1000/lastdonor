import { ChevronDownIcon } from '@heroicons/react/24/outline';

/*
  Plain English, on purpose.

  Measured 2026-10-19, the homepage scored 51 on Flesch Reading Ease
  and the site averaged 40 - "difficult". The target for an audience
  that includes ESL and EFL readers is 60+ and a reading grade at or
  under 8.

  Three rules were applied to every answer here, and should be applied
  to any answer added later:

    1. One idea per sentence, and short sentences. A reader who loses
       the thread of a 40-word sentence about money does not ask; they
       leave.
    2. The common word, not the formal one: "pay for" not "cover",
       "check" not "verify", "money" not "funds".
    3. Where there is a number, show the arithmetic. "Standard
       processing fees apply" is not an answer to "how much of my $50
       arrives" - it is a way of not answering it.

  ⛔ CORRECTED 2026-10-26, `docs/116` §5. This answer quoted Stripe's
  2.9% + $0.30 and told the donor "the campaign receives $48.25" of a $50
  gift. Stripe cannot take a payment on this platform at all (`docs/72`),
  that rate has never been charged to anybody here, and nothing anywhere
  deducts a processing fee from a campaign - `payment-service.ts:236`
  credits the FULL amount and `withdraw/route.ts:341` subtracts no fee.
  See `WhereYourMoneyGoes.tsx` for the full trace.

  ⛔ Rule 3 above still holds, and this is the arithmetic: $50 in, $50 to
  the campaign. Do NOT answer it with a vendor's published rate -
  `src/app/fee-claims.test.ts` fails the build on one.
*/
const faqs = [
  {
    question: 'Does LastDonor take a cut of my donation?',
    answer:
      'No. We take 0%, and nothing is taken out to move the money. On a $50 donation the campaign is credited $50. The company that processes the payment charges us a fee, and we pay it ourselves.',
  },
  {
    question: 'If you take 0%, how do you pay your bills?',
    answer:
      'People donate to LastDonor itself, separately from campaigns. We also look for grants and sponsors. That money pays for checking campaigns, helping donors, and running the website.',
  },
  {
    question: 'Who checks a campaign before it goes live?',
    answer:
      'A person on our team reads every campaign first. We often ask for proof, such as a bill, an official letter, or a photo. Nothing goes live until that check is done.',
  },
  {
    question: 'Where does my money go?',
    answer:
      'All of it goes to the campaign you picked. We take nothing, and nothing is deducted to move the money. The campaign then posts updates so you can see what your money paid for.',
  },
  {
    question: 'What kinds of campaigns can I support?',
    answer:
      'Medical bills. Funerals. Fires, floods and storms. Families in a crisis. Veterans and their families. Police, firefighters and paramedics. Schools and students.',
  },
  {
    question: 'How is LastDonor different from other fundraising sites?',
    answer:
      'Three things. We take 0% of what you raise. A person checks every campaign before it goes live. And campaigns post updates showing where the money went.',
  },
  {
    question: 'Do I need an account to donate?',
    answer:
      'No. You can donate as a guest. We email you a receipt.',
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

        {/*
          Collapsed by default, except the first.

          Every item used to carry a hardcoded `open`, which rendered all
          seven answers expanded: 244 visible words and 1,598px of scroll on
          a 390px phone, the second-tallest section on the page. It bought
          nothing. The `FAQPage` JSON-LD above is what search engines read
          for rich results, and a closed `<details>` keeps its answer in the
          DOM regardless - collapsing changes what a person scrolls past,
          not what a crawler sees.

          The first stays open so the pattern is legible; a column of seven
          identical closed rows does not read as expandable to everyone.
          See docs/61.
        */}
        <div className="mt-10 divide-y divide-border sm:mt-12">
          {faqs.map((faq, i) => (
            <details key={faq.question} open={i === 0} className="group py-4 sm:py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-left">
                <h3 className="text-base font-semibold text-foreground">{faq.question}</h3>
                <ChevronDownIcon
                  className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
