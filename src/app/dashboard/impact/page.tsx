import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { Money } from '@/components/ui/Money';
import { Card, CardContent } from '@/components/ui/card';
import { appBaseUrl } from '@/lib/unsubscribe-tokens';
import { shareUrl } from '@/lib/share-links';
import {
  getAttributedDonors,
  getImpactByCampaign,
  getImpactSummary,
  getOwnGivingByCampaign,
} from '@/lib/share-impact';
import { ImpactLinkRow } from '@/components/dashboard/ImpactLinkRow';

export const metadata: Metadata = {
  title: 'Your Impact - Dashboard - LastDonor.org',
  robots: { index: false },
};

/**
 * "Your impact" - what this person's share links brought in.
 *
 * Modelled on GoFundMe's surface of the same name (help-centre article
 * 24972788571803, edited 2026-10-07): overall totals, a per-campaign
 * breakdown, and the names and amounts of the donors you inspired, with
 * anonymity preserved. `docs/58` records what we matched and what we added.
 */
export default async function ImpactPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/dashboard/impact');

  const userId = session.user.id;
  const [summary, byCampaign, donors, ownGiving] = await Promise.all([
    getImpactSummary(userId),
    getImpactByCampaign(userId),
    getAttributedDonors(userId),
    getOwnGivingByCampaign(userId),
  ]);

  const origin = appBaseUrl();
  const hasLinks = byCampaign.length > 0;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
          Your impact
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          When someone donates through a link you shared, it shows up here.
        </p>
      </header>

      {/*
        Four tiles, not three. GoFundMe's dashboard reports donors and
        amounts; we also report link visits, because a sharer deciding what
        to do next needs to tell two very different failures apart - a link
        nobody opened is a distribution problem, a link opened fifty times
        with no donation is a campaign problem. A donor count alone cannot
        distinguish them. See docs/58.
      */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Raised through you">
          <Money cents={summary.amountBroughtCents} className="text-2xl font-bold text-foreground" />
        </StatTile>
        <StatTile label={summary.donorsBrought === 1 ? 'Donor you brought' : 'Donors you brought'}>
          <span className="font-sans text-2xl font-bold tabular-nums text-foreground">
            {summary.donorsBrought.toLocaleString('en-US')}
          </span>
        </StatTile>
        <StatTile label="Link visits">
          <span className="font-sans text-2xl font-bold tabular-nums text-foreground">
            {summary.clicks.toLocaleString('en-US')}
          </span>
        </StatTile>
        <StatTile label={summary.campaignsShared === 1 ? 'Campaign shared' : 'Campaigns shared'}>
          <span className="font-sans text-2xl font-bold tabular-nums text-foreground">
            {summary.campaignsShared.toLocaleString('en-US')}
          </span>
        </StatTile>
      </section>

      {!hasLinks ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-display text-lg font-semibold text-card-foreground">
              You have not shared a campaign yet
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Share any campaign while signed in and the link becomes yours.
              Every donation that arrives through it is counted here.
            </p>
            <Link
              href="/campaigns"
              className="btn-press mt-5 inline-flex rounded-full bg-accent px-6 py-3 text-sm font-bold text-accent-foreground"
            >
              Find a campaign to share
            </Link>
          </CardContent>
        </Card>
      ) : (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold text-foreground">
            Your links
          </h2>
          <ul className="space-y-3">
            {byCampaign.map((row) => (
              <ImpactLinkRow
                key={row.token}
                campaignTitle={row.campaignTitle}
                campaignSlug={row.campaignSlug}
                url={shareUrl(row.token, origin)}
                clicks={row.clicks}
                donorsBrought={row.donorsBrought}
                amountBroughtCents={row.amountBroughtCents}
                ownGivingCents={ownGiving.get(row.campaignId) ?? 0}
              />
            ))}
          </ul>
        </section>
      )}

      {/*
        The names and the money. This is the part that makes the number mean
        something, and GoFundMe's article calls it out specifically: "the
        names and amounts of those you've inspired to donate". Anonymity is
        resolved in SQL (see share-impact.ts) so a real name cannot leak
        through a rendering mistake here.
      */}
      {donors.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold text-foreground">
            People you brought in
          </h2>
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {donors.map((d, i) => (
                <div
                  key={`${d.campaignSlug}-${d.createdAt.toISOString()}-${i}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-card-foreground">
                      {d.donorName}
                    </p>
                    <Link
                      href={`/campaigns/${d.campaignSlug}`}
                      className="truncate text-xs text-muted-foreground hover:text-foreground"
                    >
                      {d.campaignTitle}
                    </Link>
                  </div>
                  <Money
                    cents={d.amountCents}
                    className="shrink-0 text-sm font-semibold text-foreground"
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

function StatTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1">{children}</p>
      </CardContent>
    </Card>
  );
}
