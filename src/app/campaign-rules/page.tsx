import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';

export const metadata: Metadata = {
  title: 'Campaign Rules and Prohibited Uses',
  description:
    'What LastDonor allows and does not allow, what every campaign must tell us, and what we do when a campaign breaks the rules.',
  alternates: { canonical: 'https://lastdonor.org/campaign-rules' },
  openGraph: {
    title: 'Campaign Rules | LastDonor.org',
    description:
      'What we allow, what we do not, and what happens when a campaign breaks the rules.',
    images: [
      {
        url: '/api/v1/og/page?title=Campaign+Rules&subtitle=What+fundraisers+LastDonor+can+and+cannot+support.',
        width: 1200,
        height: 630,
        alt: 'Campaign Rules at LastDonor.org',
      },
    ],
  },
};

const prohibitedUses = [
  'Anything against the law. Fraud, deception, pretending to be someone else, or misleading claims.',
  'Anything involving sanctioned countries, sanctioned people, or blocked parties.',
  'Weapons, explosives, ammunition, controlled substances, or drug paraphernalia.',
  'Gambling, betting, or lotteries. Raffles, sweepstakes, or games of chance.',
  'Adult content, sexual services, escort services, or sexually exploitative material.',
  'Hate, harassment, violence, extremist activity, or support for violent organizations.',
  'Personal investment, lending, or debt collection. Cryptocurrency, securities, or get-rich-quick schemes.',
  'Political contributions, lobbying, or campaign finance activity, unless the law and our payment partners clearly allow it.',
  'Medical claims that promise cures, promise unapproved treatments, or promise results that cannot be backed up.',
  'Fundraisers that cannot name a real beneficiary, a real organizer, a clear purpose, or how the money will be used.',
  'Money to avoid law enforcement, get around a court order, pay a fine for breaking the law, or hide how the money is spent.',
  'Any campaign that we, Stripe, our banking partners, or the card networks cannot support.',
];

export default function CampaignRulesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Breadcrumbs />
      <h1 className="mt-6 font-display text-4xl font-bold text-foreground">
        Campaign Rules: What We Allow and What We Do Not
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: April 27, 2026
      </p>
      <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
        LastDonor is for real, specific needs that we can check. A person reads
        every campaign before it goes live, and we do not publish them all. Your
        campaign must be true, legal, and clear about how the money will be
        used. It must also fit the rules our payment and banking partners set.
      </p>

      <div className="mt-10 space-y-9 text-muted-foreground">
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            What Every Campaign Must Tell Us
          </h2>
          <p className="mt-3 leading-relaxed">Your campaign needs all of this.</p>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>Exactly who the money is for, and exactly what it is for.</li>
            <li>A clear goal, in U.S. dollars.</li>
            <li>How you are connected to the person or group you are raising money for.</li>
            <li>A plain explanation of how the money will be spent.</li>
            <li>Documents or sources to back up any facts the campaign states.</li>
            <li>Contact details that work, so we can reach you.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            What We Do Not Allow
          </h2>
          <p className="mt-3 leading-relaxed">
            We cannot run a fundraiser for any of these.
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            {prohibitedUses.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Keep Your Campaign True
          </h2>
          <p className="mt-3 leading-relaxed">
            Keep your campaign accurate. Tell us as soon as any fact changes. If
            the page stops matching the facts, we can act. We may tidy the
            wording without changing the meaning. We may ask you for more
            information. We may pause donations, publish a correction, or take
            the campaign down.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            What We Can Do If You Break These Rules
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>Refuse a campaign before it goes live.</li>
            <li>Pause or suspend a live campaign while we check it.</li>
            <li>Remove campaign content or donor messages that break our policies.</li>
            <li>Hold, delay, or refuse to release the money.</li>
            <li>Refund donors when a campaign cannot go ahead.</li>
            <li>Close accounts, or report activity to payment partners, banks, or authorities when we are required to.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Related Policies
          </h2>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link href="/campaign-verification-policy" className="rounded-md border border-border px-3 py-2 text-foreground hover:bg-muted">
              Campaign Verification Policy
            </Link>
            <Link href="/fund-release-policy" className="rounded-md border border-border px-3 py-2 text-foreground hover:bg-muted">
              Fund Release Policy
            </Link>
            <Link href="/refund-policy" className="rounded-md border border-border px-3 py-2 text-foreground hover:bg-muted">
              Refund Policy
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
