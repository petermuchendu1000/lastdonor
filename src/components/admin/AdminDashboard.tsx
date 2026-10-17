'use client';

import { Badge } from '@/components/ui/badge';
import { centsToDollars } from '@/lib/utils/currency';
import { formatRelativeTime } from '@/lib/utils/dates';
import { CATEGORY_LABELS } from '@/lib/categories';
import Link from 'next/link';
import type { CampaignCategory } from '@/types';

interface DashboardStats {
  today: { donationCount: number; donationTotal: number; newSubscribers: number };
  month: {
    donationCount: number;
    donationTotal: number;
    newSubscribers: number;
    campaignsLaunched: number;
    campaignsCompleted: number;
  };
  activeCampaigns: {
    id: string;
    title: string;
    slug: string;
    raisedAmount: number;
    goalAmount: number;
    donorCount: number;
  }[];
  pendingCampaigns: {
    id: string;
    title: string;
    slug: string;
    category: string;
    goalAmount: number;
    creatorName: string;
    createdAt: string;
  }[];
  recentDonations: {
    id: string;
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

export function AdminDashboard({ stats }: AdminDashboardProps) {
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
          detail={centsToDollars(stats.today.donationTotal)}
        />
        <StatTile
          value={stats.month.donationCount}
          label="This month"
          detail={centsToDollars(stats.month.donationTotal)}
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
                      {centsToDollars(c.goalAmount)}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                      {formatRelativeTime(c.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/campaigns/${c.id}/edit`}
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
          )}
        </section>

      {/* CDS Data Table - Active Campaigns */}
      <section>
        <h2 className="text-sm font-semibold">Active campaigns</h2>
        {stats.activeCampaigns.length === 0 ? (
          <EmptyState message="No active campaigns." />
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-border">
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
                      <td className="px-4 py-3 text-right font-mono">{centsToDollars(c.raisedAmount)}</td>
                      <td className="hidden px-4 py-3 text-right font-mono text-muted-foreground sm:table-cell">
                        {centsToDollars(c.goalAmount)}
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
        )}
      </section>

      {/* CDS Data Table - Recent Donations */}
      <section>
        <h2 className="text-sm font-semibold">Recent donations</h2>
        {stats.recentDonations.length === 0 ? (
          <EmptyState message="No recent donations." />
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-border">
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
                    <td className="px-4 py-3 text-right font-mono">{centsToDollars(d.amount)}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">{formatRelativeTime(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* CDS Stat Tile - layered container with productive type */
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
