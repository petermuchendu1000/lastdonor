import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';

export const metadata: Metadata = {
  title: 'Campaign Rules and Prohibited Uses',
  description:
    'Campaign eligibility rules for LastDonor, including prohibited fundraisers, documentation expectations, donor transparency, and enforcement actions.',
  alternates: { canonical: 'https://lastdonor.org/campaign-rules' },
  openGraph: {
    title: 'Campaign Rules | LastDonor.org',
    description:
      'Campaign eligibility rules, prohibited fundraisers, documentation expectations, donor transparency, and enforcement actions.',
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
  'Illegal activity, fraud, deception, impersonation, or misleading claims.',
  'Campaigns involving sanctioned countries, sanctioned persons, or blocked parties.',
  'Weapons, explosives, ammunition, controlled substances, or drug paraphernalia.',
  'Gambling, betting, lotteries, raffles, sweepstakes, or games of chance.',
  'Adult content, sexual services, escort services, or sexually exploitative material.',
  'Hate, harassment, violence, extremist activity, or support for violent organizations.',
  'Personal investment, lending, debt collection, cryptocurrency, securities, or get-rich-quick schemes.',
  'Political contributions, lobbying, or campaign finance activity when not clearly permitted by law and payment partner rules.',
  'Medical claims that promise cures, unapproved treatments, or outcomes that cannot be supported.',
  'Fundraisers that cannot identify a real beneficiary, organizer, purpose, or use of funds.',
  'Requests to avoid law enforcement, evade court orders, pay fines for illegal conduct, or conceal fund use.',
  'Any campaign that LastDonor, Stripe, banking partners, or card networks cannot support.',
];

export default function CampaignRulesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Breadcrumbs />
      <h1 className="mt-6 font-display text-4xl font-bold text-foreground">
        Campaign Rules and Prohibited Uses
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: April 27, 2026
      </p>
      <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
        LastDonor supports specific, reviewable fundraisers for real needs. We
        do not publish every submission. Campaigns must be truthful, lawful,
        transparent, and compatible with payment processor and banking rules.
      </p>

      <div className="mt-10 space-y-9 text-muted-foreground">
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Required Campaign Information
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>A specific fundraiser purpose and beneficiary.</li>
            <li>A clear fundraising goal, in the currency the campaign collects in.</li>
            <li>The organizer relationship to the beneficiary.</li>
            <li>A plain-language explanation of how funds will be used.</li>
            <li>Supporting documents or sources when the campaign makes factual claims.</li>
            <li>Accurate contact information for organizer follow-up and support.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Prohibited Campaigns
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            {prohibitedUses.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Campaign Accuracy
          </h2>
          <p className="mt-3 leading-relaxed">
            Organizers must keep campaign information accurate and notify
            LastDonor if facts change. LastDonor may edit non-material wording
            for clarity, request more information, pause donations, publish a
            correction, or remove a campaign when the visible page no longer
            matches the underlying facts.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Enforcement
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>Reject a submitted campaign before publication.</li>
            <li>Pause or suspend a live campaign while information is reviewed.</li>
            <li>Remove campaign content or donor messages that violate policy.</li>
            <li>Hold, deny, or delay fund release.</li>
            <li>Refund donors when a campaign cannot proceed.</li>
            <li>Close accounts or report activity to payment partners, banks, or authorities when required.</li>
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
