import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/db';
import { campaigns, donations } from '@/db/schema';
import { sql } from 'drizzle-orm';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { centsToDollars } from '@/lib/utils/currency';
import { seoKeywords } from '@/lib/seo/keywords';

export const metadata: Metadata = {
  title: 'Transparency | Our Numbers, Our Fees, Our Promises',
  description:
    'Our numbers in the open. See what donors have given, how many campaigns are live, and what the fees are.',
  keywords: seoKeywords('trust', 'donor', 'core', 'campaigns'),
  alternates: { canonical: 'https://lastdonor.org/transparency' },
  openGraph: {
    title: 'Transparency | LastDonor.org',
    description:
      'Our numbers, our fees, and the promises we make to donors.',
    images: [
      {
        url: '/api/v1/og/page?title=Transparency&subtitle=We+publish+our+numbers.+You+can+check+them+before+you+give.',
        width: 1200,
        height: 630,
        alt: 'Transparency Report by LastDonor.org',
      },
    ],
  },
};

export const revalidate = 300;

/*
  Stripe's published US rate, the same two figures the homepage ledger uses
  (docs/59). The example amounts below are worked out from them rather than
  typed, so the arithmetic on this page cannot drift from the rate.
*/
const STRIPE_PERCENT = 0.029;
const STRIPE_FIXED_CENTS = 30;
/** The example gift, the same $50 used on the homepage and in the donor FAQ. */
const EXAMPLE_CENTS = 5000;
const STRIPE_FEE_CENTS =
  Math.round(EXAMPLE_CENTS * STRIPE_PERCENT) + STRIPE_FIXED_CENTS;
const TO_CAMPAIGN_CENTS = EXAMPLE_CENTS - STRIPE_FEE_CENTS;

const FEE_ROWS = [
  {
    label: 'The campaign gets',
    note: 'This is what is left after the card fee.',
    amount: centsToDollars(TO_CAMPAIGN_CENTS),
    tone: 'text-primary',
  },
  {
    label: 'Stripe takes',
    note: 'Stripe runs the card payment. We never get any part of this.',
    amount: centsToDollars(STRIPE_FEE_CENTS),
    tone: 'text-brand-amber',
  },
  {
    label: 'We take',
    note: 'There is no platform fee. We take nothing out of your gift.',
    amount: centsToDollars(0),
    tone: 'text-muted-foreground',
  },
];

async function getTransparencyData() {
  const [stats] = await db
    .select({
      totalRaised: sql<number>`COALESCE(SUM(CASE WHEN ${donations.source} = 'real' AND ${donations.refunded} = false THEN ${donations.amount} ELSE 0 END), 0)`,
      /*
        Refunded donations are excluded here too. Without the filter this
        was the only one of the three figures that counted them, so a
        donor whose single gift was refunded still appeared under "People
        who gave" while their money appeared in neither of the other two.
        On a page whose whole purpose is honest numbers, the three have to
        agree on what counts.
      */
      totalDonors: sql<number>`COALESCE(COUNT(DISTINCT CASE WHEN ${donations.source} = 'real' AND ${donations.refunded} = false THEN ${donations.donorEmail} END), 0)`,
      totalDonations: sql<number>`COALESCE(COUNT(CASE WHEN ${donations.source} = 'real' AND ${donations.refunded} = false THEN 1 END), 0)`,
    })
    .from(donations);

  const [campaignStats] = await db
    .select({
      completed: sql<number>`COUNT(CASE WHEN ${campaigns.status} IN ('completed', 'archived') THEN 1 END)`,
      active: sql<number>`COUNT(CASE WHEN ${campaigns.status} IN ('active', 'last_donor_zone') THEN 1 END)`,
    })
    .from(campaigns);

  return {
    totalRaised: Number(stats?.totalRaised ?? 0),
    totalDonors: Number(stats?.totalDonors ?? 0),
    totalDonations: Number(stats?.totalDonations ?? 0),
    completedCampaigns: Number(campaignStats?.completed ?? 0),
    activeCampaigns: Number(campaignStats?.active ?? 0),
  };
}

export default async function TransparencyPage() {
  const data = await getTransparencyData();

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Breadcrumbs />
      <h1 className="mt-6 font-display text-4xl font-bold text-foreground">
        Transparency
      </h1>
      <p className="mt-3 text-lg text-muted-foreground">
        We publish our numbers so you can check them before you give. The
        figures below come from our own database. The money figures count real
        donations only, not sample data.
      </p>

      {/* Platform Stats */}
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Donated so far', value: centsToDollars(data.totalRaised) },
          { label: 'People who gave', value: data.totalDonors.toLocaleString('en-US') },
          { label: 'Campaigns closed', value: data.completedCampaigns.toString() },
          { label: 'Campaigns live now', value: data.activeCampaigns.toString() },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-border bg-card p-6 text-center"
          >
            <p className="font-mono text-2xl font-bold text-primary">
              {stat.value}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        What these count: money and donor counts leave out refunds.
        &quot;Campaigns closed&quot; means a campaign that reached its end or
        was taken down, not only ones that hit their goal. Numbers refresh
        every five minutes.
      </p>

      {/* Fee Disclosure */}
      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold text-foreground">
          What a donation costs
        </h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">
          We take 0%. Stripe charges 2.9% plus 30 cents on a US card.
          On a $50 donation that is $1.75, so the campaign gets $48.25.
        </p>
        <div className="mt-6 space-y-4">
          {FEE_ROWS.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4"
            >
              <div>
                <p className="font-semibold text-foreground">{row.label}</p>
                <p className="text-sm text-muted-foreground">{row.note}</p>
              </div>
              <span className={`font-mono text-2xl font-bold ${row.tone}`}>
                {row.amount}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Those three amounts are for a {centsToDollars(EXAMPLE_CENTS)}{' '}
          donation. On a bigger or smaller gift, the card fee is still 2.9% plus
          30 cents on a US card. A card from outside the US costs a little more.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold text-foreground">
          How we pay our own bills
        </h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">
          We take 0% of what a campaign raises. So we pay for our own work in
          other ways. Some people give to our general fund instead of to a
          campaign. We also look for grants and sponsors. That money pays for
          campaign review, donor support, hosting, and payment costs. Giving to
          the general fund is not the same as giving to a campaign.
        </p>
        <Link
          href="/donate"
          className="mt-4 inline-flex rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
        >
          Give to the general fund
        </Link>
      </section>

      {/* Policies */}
      <section className="mt-12 space-y-6">
        <h2 className="font-display text-2xl font-bold text-foreground">
          What we promise
        </h2>
        <ul className="list-disc space-y-3 pl-6 text-muted-foreground">
          <li>
            We show every donation on the campaign page. You see the amount,
            the date, and the name. A donor who picks anonymous shows as
            &quot;Anonymous&quot;.
          </li>
          <li>
            A person reads every campaign before it goes live. If we cannot
            check the main facts, we do not publish it.
          </li>
          <li>
            When a campaign ends, we publish what the money paid for.
          </li>
          <li>
            We will publish our tax status and our yearly reports when we have
            them.
          </li>
          <li>
            We never sell or share donor data.
          </li>
          <li>
            Ask us where your money went and a real person will answer. Email
            support@lastdonor.org.
          </li>
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold text-foreground">
          Where to read the rules
        </h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">
          These pages give the full detail. They cover refunds and campaign
          review. They also cover when a campaign gets the money, which
          campaigns we turn down, how to stop a monthly gift, and your privacy.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {[
            { label: 'Donor FAQ', href: '/donor-faq' },
            { label: 'Refund Policy', href: '/refund-policy' },
            { label: 'Campaign Verification Policy', href: '/campaign-verification-policy' },
            { label: 'Fund Release Policy', href: '/fund-release-policy' },
            { label: 'Campaign Rules', href: '/campaign-rules' },
            { label: 'Privacy Policy', href: '/privacy' },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
