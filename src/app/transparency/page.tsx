import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/db';
import { campaigns, donations } from '@/db/schema';
import { sql } from 'drizzle-orm';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Money } from '@/components/ui/Money';
import { platformRaisedByCurrency } from '@/lib/platform-totals.server';
import { seoKeywords } from '@/lib/seo/keywords';

export const metadata: Metadata = {
  title: 'Transparency | Donation Tracking and Impact Updates',
  description:
    'Our numbers, in the open: what has been raised, which campaigns finished, and where the money went.',
  keywords: seoKeywords('trust', 'donor', 'core', 'campaigns'),
  alternates: { canonical: 'https://lastdonor.org/transparency' },
  openGraph: {
    title: 'Transparency | LastDonor.org',
    description:
      'Platform statistics, donation tracking, impact updates, and fund allocation policies.',
    images: [
      {
        url: '/api/v1/og/page?title=Transparency&subtitle=We+publish+our+numbers+because+we+think+you+deserve+to+see+them.',
        width: 1200,
        height: 630,
        alt: 'Transparency Report by LastDonor.org',
      },
    ],
  },
};

export const revalidate = 300;

async function getTransparencyData() {
  /*
    ⛔ `totalRaised` is GONE from this aggregate and is read per currency
    instead. It summed `donations.amount` across the whole table with no
    currency grouping and was printed as dollars: on 2026-10-26 this page
    published "$100.00 Raised So Far" while production held KES 100.00
    (~US$0.77). See `platform-totals.server.ts`.
  */
  const [stats] = await db
    .select({
      totalDonors: sql<number>`COALESCE(COUNT(DISTINCT CASE WHEN ${donations.source} = 'real' THEN ${donations.donorEmail} END), 0)`,
      totalDonations: sql<number>`COALESCE(COUNT(CASE WHEN ${donations.source} = 'real' AND ${donations.refunded} = false THEN 1 END), 0)`,
    })
    .from(donations);

  const raisedByCurrency = await platformRaisedByCurrency(db);

  const [campaignStats] = await db
    .select({
      completed: sql<number>`COUNT(CASE WHEN ${campaigns.status} IN ('completed', 'archived') THEN 1 END)`,
      active: sql<number>`COUNT(CASE WHEN ${campaigns.status} IN ('active', 'last_donor_zone') THEN 1 END)`,
    })
    .from(campaigns);

  return {
    raisedByCurrency,
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
        Donors should be able to understand platform activity, campaign progress,
        and fund allocation before they give. This page publishes LastDonor
        statistics and policies in one place.
      </p>

      {/* Platform Stats */}
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          /*
            One tile per currency actually collected, never one blended
            figure. With a single currency - the platform's whole history so
            far - this renders exactly one tile, as before. With none it
            renders none, because there is no currency to name a zero in.
          */
          ...data.raisedByCurrency.map((t) => ({
            label:
              data.raisedByCurrency.length > 1
                ? `Raised So Far (${t.currency})`
                : 'Raised So Far',
            value: <Money minor={t.totalMinor} currency={t.currency} precision="exact" />,
          })),
          { label: 'People Who Gave', value: data.totalDonors.toLocaleString('en-US') },
          { label: 'Campaigns Funded', value: data.completedCampaigns.toString() },
          { label: 'Campaigns Live Now', value: data.activeCampaigns.toString() },
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

      {/* Fee Disclosure */}
      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold text-foreground">
          Fee Disclosure
        </h2>
        <p className="mt-2 text-muted-foreground">
          LastDonor charges 0% platform fees on fundraisers, and no processing
          fee is deducted from a donation. The campaign is credited the whole
          gift.
        </p>
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
            <div>
              <p className="font-semibold text-foreground">Campaign Support</p>
              <p className="text-sm text-muted-foreground">
                Your donation supports the individual, family, organization, or project named in the fundraiser.
              </p>
            </div>
            <span className="font-mono text-2xl font-bold text-primary">Donation</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
            <div>
              <p className="font-semibold text-foreground">Payment Processing</p>
              <p className="text-sm text-muted-foreground">
                The payment company charges us a fee to move the money. It is not deducted from the donation.
              </p>
            </div>
            {/*
              ⛔ Was the single word "Stripe" (`docs/116` §5), as the VALUE of
              the fee row on the transparency page - on a platform where
              Stripe has never moved a cent and every donation arrived over
              M-Pesa (`docs/72`, `docs/92`). The row's value should answer the
              question the row asks, which is how much comes out of the gift.
            */}
            <span className="font-mono text-2xl font-bold text-brand-amber">0%</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
            <div>
              <p className="font-semibold text-foreground">Platform Fee</p>
              <p className="text-sm text-muted-foreground">
                LastDonor charges 0% platform fees on fundraisers.
              </p>
            </div>
            <span className="font-mono text-2xl font-bold text-muted-foreground">0%</span>
          </div>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold text-foreground">
          How LastDonor Is Funded
        </h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">
          The 0% platform-fee model works because LastDonor funds its own
          operations separately from campaign donations. General fund donations,
          grants, sponsorships, and operating support help pay for campaign
          review, verification work, donor support, hosting, payment operations,
          and impact updates. General fund support is separate from a donation
          to a specific fundraiser.
        </p>
        <Link
          href="/donate"
          className="mt-4 inline-flex rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
        >
          Support the general fund
        </Link>
      </section>

      {/* Policies */}
      <section className="mt-12 space-y-6">
        <h2 className="font-display text-2xl font-bold text-foreground">
          What We Promise
        </h2>
        <ul className="list-disc space-y-3 pl-6 text-muted-foreground">
          <li>
            Every donation is publicly recorded with the donor&apos;s name (or
            &quot;Anonymous&quot; if they choose), amount, date, and campaign.
          </li>
          <li>
            Every published campaign is reviewed before it goes live. If we
            cannot review the core details, we do not publish it.
          </li>
          <li>
            We publish a full breakdown after every completed campaign showing
            how the funds were used.
          </li>
          <li>
            Tax status updates and annual reports will be published when
            they are available.
          </li>
          <li>
            We never sell, share, or monetize donor data.
          </li>
          <li>
            If you ever have a question about where your money went, you can
            reach a real person who will actually answer it.
          </li>
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold text-foreground">
          Payment and Fund-Flow Policies
        </h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">
          Donors should understand what happens before they give. These pages
          explain refunds, campaign review, prohibited campaigns, fund release,
          recurring donation cancellation, and donor privacy.
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
