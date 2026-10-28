'use client';

import { Badge } from '@/components/ui/badge';
import { reportingTimezoneLabel } from '@/lib/reporting-timezone';
import { Money } from '@/components/ui/Money';
import { formatMoney } from '@/lib/money/format';
import type { CurrencyTotal } from '@/lib/admin/donation-totals.server';
import { formatRelativeTime } from '@/lib/utils/dates';
import { CATEGORY_LABELS } from '@/lib/categories';
import Link from 'next/link';
import type { CampaignCategory } from '@/types';

interface DashboardStats {
  today: { donationCount: number; donationTotals: CurrencyTotal[]; newSubscribers: number };
  month: {
    donationCount: number;
    donationTotals: CurrencyTotal[];
    newSubscribers: number;
    campaignsLaunched: number;
    campaignsCompleted: number;
  };
  activeCampaigns: {
    id: string;
    title: string;
    /** The row's own currency; its amounts are in THAT currency's minor units. */
    currency: string;
    slug: string;
    raisedAmount: number;
    goalAmount: number;
    donorCount: number;
  }[];
  pendingCampaigns: {
    id: string;
    title: string;
    slug: string;
    /** The row's own currency; its amounts are in THAT currency's minor units. */
    currency: string;
    category: string;
    goalAmount: number;
    creatorName: string;
    createdAt: string;
  }[];
  recentDonations: {
    id: string;
    /** The row's own currency; its amounts are in THAT currency's minor units. */
    currency: string;
    donorName: string;
    amount: number;
    campaignTitle: string;
    campaignSlug: string;
    createdAt: string;
    isAnonymous: boolean;
  }[];
}

interface AdminDashboardProps {
  stats: DashboardStats;
  isAdmin: boolean;
}

/**
 * ⛔ `isAdmin` is READ here, and it was not until `docs/132`.
 *
 * The page computed it, passed it, and this component destructured only
 * `{ stats }` - one occurrence of the name in the whole file, the type
 * declaration. So an editor, whom `src/app/admin/layout.tsx:30` admits and
 * whose only Overview page this is, was shown donor NAMES against their gift
 * AMOUNTS and the platform's money totals. [VERIFIED in a browser against an
 * admin control.] Same shape as `docs/119`'s `hasCampaigns`, computed and
 * discarded as `_hasCampaigns`.
 *
 * ⚠️ Hiding the section here is only HALF the fix and cannot be the whole of
 * it: this file is `'use client'`, so anything in `stats` is serialized into
 * the RSC payload whether or not it is rendered. The page narrows the object
 * for a non-admin; this stops the empty table from implying "no donations".
 */
export function AdminDashboard({ stats, isAdmin }: AdminDashboardProps) {
  return (
    <div className="space-y-8">
      {/* CDS page header - productive heading-03 + body-01 subtitle */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Platform overview and recent activity.
        </p>
      </div>

      {/* CDS stat tiles - 4-column grid, $spacing-05 gap, layered containers */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile
          value={stats.today.donationCount}
          label="Today's donations"
          detail={currencyDetail(stats.today.donationTotals)}
        />
        <StatTile
          value={stats.month.donationCount}
          label="This month"
          detail={currencyDetail(stats.month.donationTotals)}
        />
        <StatTile
          value={stats.today.newSubscribers}
          label="New subscribers"
          detail={`${stats.month.newSubscribers} this month`}
        />
        <StatTile
          value={stats.activeCampaigns.length}
          label="Active campaigns"
          detail={`${stats.month.campaignsCompleted} completed`}
        />
      </div>

      {/*
        docs/88 F15. "Today" and "This month" are computed in one
        configured zone, not the reader's. Naming it is the difference
        between a figure that can be quoted and one that quietly means a
        different day to whoever is looking at it.
      */}
      <p className="-mt-2 text-xs text-muted-foreground">
        Periods are counted in {reportingTimezoneLabel()}.
      </p>

      {/*
        Pending review. Rendered unconditionally (docs/88 F6).

        This section used to be wrapped in `length > 0 &&`, so when the
        query was broken the admin saw no section at all - not "0 waiting",
        but no indication the review queue existed. An operator cannot
        notice the absence of something they have never seen.
      */}
      <section>
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">Pending review</h2>
            <Badge variant="secondary" className="tabular-nums text-xs">{stats.pendingCampaigns.length}</Badge>
          </div>
          {stats.pendingCampaigns.length === 0 && (
            <p className="mt-3 rounded-lg border border-border px-4 py-6 text-center text-sm text-muted-foreground">
              Nothing waiting. Campaigns appear here as soon as they are submitted.
            </p>
          )}
          {stats.pendingCampaigns.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-lg border border-border">
            {/* docs/88 F18: a table narrower than its content needs a scrollable
    wrapper, or `overflow-hidden` on the card clips the last columns
    with no way to reach them on a phone. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Campaign</th>
                    <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground sm:table-cell">Submitted by</th>
                    <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground md:table-cell">Category</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Goal</th>
                    <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground lg:table-cell">Submitted</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground"><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stats.pendingCampaigns.map((c) => (
                    <tr key={c.id} className="transition-colors duration-100 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{c.title}</td>
                      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{c.creatorName}</td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        <span className="text-xs text-muted-foreground">
                          {CATEGORY_LABELS[c.category as CampaignCategory] ?? c.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                        <Money minor={c.goalAmount} currency={c.currency} precision="exact" />
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                        {formatRelativeTime(c.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {/*
                          ⛔ The campaign page, NOT the editor.

                          This link went to `/admin/campaigns/<id>/edit`,
                          which was handed the campaign as `'active'` and
                          published it on save - with no audit row and no
                          email to the organiser. It was the dashboard's only
                          review affordance, so the fastest path from
                          "something is waiting" to "it is live" skipped the
                          approval route entirely. `docs/120`.
                        */}
                        <Link
                          href={`/admin/campaigns/${c.id}`}
                          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                        >
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </section>

      {/* CDS Data Table - Active Campaigns */}
      <section>
        <h2 className="text-sm font-semibold">Active campaigns</h2>
        {stats.activeCampaigns.length === 0 ? (
          <EmptyState message="No active campaigns." />
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-border">
            {/* docs/88 F18: a table narrower than its content needs a scrollable
    wrapper, or `overflow-hidden` on the card clips the last columns
    with no way to reach them on a phone. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Campaign</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Raised</th>
                    <th className="hidden px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground sm:table-cell">Goal</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Progress</th>
                    <th className="hidden px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground sm:table-cell">Donors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stats.activeCampaigns.map((c) => {
                    const pct = c.goalAmount > 0 ? Math.round((c.raisedAmount / c.goalAmount) * 100) : 0;
                    return (
                      <tr key={c.id} className="transition-colors duration-100 hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <Link
                            href={`/admin/campaigns/${c.id}/edit`}
                            className="font-medium text-foreground underline-offset-4 hover:underline"
                          >
                            {c.title}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right font-mono"><Money minor={c.raisedAmount} currency={c.currency} precision="exact" /></td>
                        <td className="hidden px-4 py-3 text-right font-mono text-muted-foreground sm:table-cell">
                          <Money minor={c.goalAmount} currency={c.currency} precision="exact" />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="ml-auto flex items-center justify-end gap-2">
                            <div className="hidden h-1 w-16 overflow-hidden rounded-full bg-border sm:block">
                              <div
                                className="h-full rounded-full bg-primary transition-all duration-300"
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground sm:table-cell">{c.donorCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* CDS Data Table - Recent Donations. Admin only (`docs/132`). */}
      {isAdmin && (
      <section>
        <h2 className="text-sm font-semibold">Recent donations</h2>
        {stats.recentDonations.length === 0 ? (
          <EmptyState message="No recent donations." />
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-border">
            {/* docs/88 F18: a table narrower than its content needs a scrollable
    wrapper, or `overflow-hidden` on the card clips the last columns
    with no way to reach them on a phone. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Donor</th>
                    <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground sm:table-cell">Campaign</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Amount</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stats.recentDonations.map((d) => (
                    <tr key={d.id} className="transition-colors duration-100 hover:bg-muted/30">
                      <td className="px-4 py-3 text-foreground">{d.isAnonymous ? 'Anonymous' : d.donorName}</td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <Link
                          href={`/campaigns/${d.campaignSlug}`}
                          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                          target="_blank"
                        >
                          {d.campaignTitle}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right font-mono"><Money minor={d.amount} currency={d.currency} precision="exact" /></td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">{formatRelativeTime(d.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
      )}
    </div>
  );
}

/* CDS Stat Tile - layered container with productive type */
/**
 * One tile, one line per currency.
 *
 * ⛔ These tiles used to show a single `centsToDollars(...)` over a
 * platform-wide `SUM(donations.amount)` - shillings added to dollars and
 * printed with a dollar sign (`docs/92`). A dash when nothing has been
 * raised, rather than a zero in a currency nobody has given in.
 */
function currencyDetail(totals: CurrencyTotal[]): string {
  if (totals.length === 0) return '-';
  return totals.map((t) => formatMoney(t.totalMinor, t.currency, 'exact')).join(' · ');
}

function StatTile({ value, label, detail }: { value: number; label: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-4">
      <p className="text-2xl font-semibold tabular-nums leading-none">{value}</p>
      <p className="mt-2 text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground/70">{detail}</p>
    </div>
  );
}

/* CDS Empty State - minimal, contextual, left-aligned */
function EmptyState({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
