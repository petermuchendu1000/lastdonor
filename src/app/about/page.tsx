import type { Metadata } from 'next';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { CheckBadgeIcon } from '@heroicons/react/24/solid';
import { seoKeywords } from '@/lib/seo/keywords';

export const metadata: Metadata = {
  title: 'About LastDonor.org | Reviewed Campaigns, 0% Platform Fee',
  description:
    'LastDonor raises money for medical bills, funerals, disasters and family emergencies. A person reads every campaign. We take 0% of what you raise.',
  keywords: seoKeywords('core', 'trust', 'campaigns', 'nonprofit', 'medical', 'emergency', 'memorial'),
  alternates: { canonical: 'https://lastdonor.org/about' },
  openGraph: {
    title: 'About LastDonor.org',
    description:
      'A person reads every campaign before it goes live. We take 0% of what you raise.',
    images: [
      {
        url: '/api/v1/og/page?title=About+LastDonor.org&subtitle=A+person+reads+every+campaign.+We+take+0%25.',
        width: 1200,
        height: 630,
        alt: 'About LastDonor.org',
      },
    ],
  },
};

export default function AboutPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    '@id': 'https://lastdonor.org/about#webpage',
    url: 'https://lastdonor.org/about',
    name: 'About LastDonor.org',
    description:
      'LastDonor is a fundraising site. A person reads every campaign before it goes live. We take 0% of what you raise, and you can follow the total at any time.',
    isPartOf: { '@id': 'https://lastdonor.org/#website' },
    about: { '@id': 'https://lastdonor.org/#organization' },
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['#ai-answer'],
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <Breadcrumbs />

        <div className="mt-6 max-w-3xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-teal/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-teal ring-1 ring-brand-teal/20">
            <CheckBadgeIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Reviewed crowdfunding
          </span>
          <h1 className="mt-4 font-display text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            LastDonor takes 0% of what you raise.
          </h1>
          <p
            id="ai-answer"
            data-speakable="true"
            className="mt-4 text-lg leading-relaxed text-muted-foreground"
          >
            LastDonor is a place to raise money for a medical bill, a funeral,
            a disaster, or a family emergency. A person on our team reads every
            campaign before it goes live. You can see how much a campaign has
            raised at any time.
          </p>
        </div>

        <section className="mt-12 space-y-6">
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">Why we built this</h2>
          <p className="leading-relaxed text-muted-foreground">
            People come to a fundraising site on a bad day. A hospital bill. A
            funeral. A house fire. A pet that needs surgery. We built LastDonor
            so you can understand what you are giving to before you give.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            We read every campaign first. We show the goal and the running
            total. When a campaign reaches its goal, it closes. The person who
            gave the last dollar becomes the{' '}
            <strong className="text-foreground">Last Donor</strong>.
          </p>
        </section>

        <section className="mt-12" aria-label="Platform terminology">
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">What the words mean</h2>
          <dl className="mt-6 space-y-5 text-sm leading-relaxed">
            <div>
              <dt className="font-semibold text-foreground">LastDonor.org</dt>
              <dd className="mt-1 text-muted-foreground">
                A fundraising site. We take 0% of what you raise. A person
                reads every campaign before it goes live. A campaign closes
                when it reaches its goal.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">The Last Donor</dt>
              <dd className="mt-1 text-muted-foreground">
                The person whose gift takes a campaign to its goal. We name
                them on the Last Donor Wall.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">Reviewed campaign</dt>
              <dd className="mt-1 text-muted-foreground">
                A campaign that a person on our team read before it went live.
                We can ask for a bill, an official letter, a photo, or a public
                record.
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-12">
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">What you can check</h2>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-border shadow-[--shadow-elevation-1]">
            <table className="w-full text-sm leading-relaxed">
              <thead>
                <tr className="bg-muted/60 text-left">
                  <th scope="col" className="px-4 py-3 font-semibold text-foreground">Question</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-primary">Answer</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-muted-foreground">Where to look</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="bg-card">
                  <td className="px-4 py-3 font-medium text-foreground">Do you take a cut?</td>
                  <td className="px-4 py-3 text-primary">No. We take 0%.</td>
                  <td className="px-4 py-3 text-muted-foreground">Transparency page</td>
                </tr>
                <tr className="bg-card/60">
                  <td className="px-4 py-3 font-medium text-foreground">Does a person check the campaign?</td>
                  <td className="px-4 py-3 text-primary">Yes, before it goes live.</td>
                  <td className="px-4 py-3 text-muted-foreground">Editorial standards</td>
                </tr>
                <tr className="bg-card">
                  <td className="px-4 py-3 font-medium text-foreground">Can I follow the money?</td>
                  <td className="px-4 py-3 text-primary">Yes. The total, the number of donors, and updates are on the page.</td>
                  <td className="px-4 py-3 text-muted-foreground">Campaign page</td>
                </tr>
                <tr className="bg-card/60">
                  <td className="px-4 py-3 font-medium text-foreground">What happens after it ends?</td>
                  <td className="px-4 py-3 text-primary">The campaign can post photos, receipts, and a note on what the money paid for.</td>
                  <td className="px-4 py-3 text-muted-foreground">Campaign updates and the blog</td>
                </tr>
                <tr className="bg-card">
                  <td className="px-4 py-3 font-medium text-foreground">When does giving stop?</td>
                  <td className="px-4 py-3 text-primary">The campaign closes when it reaches its goal.</td>
                  <td className="px-4 py-3 text-muted-foreground">Last Donor Wall</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12 space-y-6">
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">How we pay our bills</h2>
          <p className="leading-relaxed text-muted-foreground">
            We take 0%. Stripe charges 2.9% plus 30 cents on a US card. 
            payment. On a $50 donation that is $1.75, so the campaign gets
            $48.25.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            You can give to LastDonor itself instead of to a campaign. We also
            look for grants and sponsors. That money pays for campaign review,
            hosting, and donor support.
          </p>

          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">Who we help</h2>
          <p className="leading-relaxed text-muted-foreground">
            Military families and veterans. First responders. Parents facing
            medical bills. Families rebuilding after a disaster. Students short
            on tuition. People whose pet needs surgery. If the need is clear
            and we can check it, we can help you ask.
          </p>

          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">Our team</h2>
          <p className="leading-relaxed text-muted-foreground">
            We are a small team. We build for clear campaign pages, visible
            progress, and updates for donors. When we read a campaign, we ask
            for a plain story, an amount you can explain, and a claim we can
            check.
          </p>

          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">Our tax status</h2>
          <p className="leading-relaxed text-muted-foreground">
            LastDonor runs as a nonprofit fundraising effort. Do not assume
            your gift is tax deductible. Ask a tax adviser about your own
            case. We will publish our tax status and our yearly reports when
            we have them. Live numbers are on our{' '}
            <a href="/transparency" className="text-brand-teal underline underline-offset-2 hover:opacity-80">Transparency page</a>.
          </p>
        </section>
      </div>
    </>
  );
}
