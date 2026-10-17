'use client';

import { centsToDollars } from '@/lib/utils/currency';
import { Badge } from '@/components/ui/badge';
import { ChartBarIcon } from '@heroicons/react/24/outline';

/* ---------- types ---------- */

interface CampaignGroup {
  active: number;
  completed: number;
  archived: number;
  total: number;
}

interface DonationGroup {
  count: number;
  total: number;
}

interface Category {
  category: string;
  simulated: number;
  real: number;
  seedDonations: number;
  realDonations: number;
}

interface Props {
  campaigns: { simulated: CampaignGroup; real: CampaignGroup };
  donations: { seed: DonationGroup; real: DonationGroup };
  ratio: number;
  fundPool: { pending: number; allocated: number; disbursed: number };
  categories: Category[];
}

function formatCents(cents: number): string {
  // docs/88 F4: delegate, so there is one currency renderer.
  return centsToDollars(cents);
}

/* ---------- component ---------- */

export function SimulationAnalytics({ campaigns, donations, ratio, fundPool, categories }: Props) {
  const totalCampaigns = campaigns.simulated.total + campaigns.real.total;
  const simPct = totalCampaigns > 0 ? (campaigns.simulated.total / totalCampaigns) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Ratio Headline */}
      <div className="flex items-center justify-between rounded-lg border px-4 py-3">
        <div>
          <p className="text-xs text-muted-foreground">Real-to-Total Donation Ratio</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{ratio.toFixed(1)}%</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Simulated Campaign Share</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{simPct.toFixed(1)}%</p>
        </div>
      </div>

      {/* Campaign Counts */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border">
          <div className="border-b bg-muted/40 px-4 py-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Simulated Campaigns</h3>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-semibold tabular-nums">{campaigns.simulated.active}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums">{campaigns.simulated.completed}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums">{campaigns.simulated.archived}</p>
                <p className="text-xs text-muted-foreground">Archived</p>
              </div>
            </div>
            <p className="mt-3 text-center text-sm text-muted-foreground">
              Total: {campaigns.simulated.total}
            </p>
          </div>
        </div>
        <div className="rounded-lg border">
          <div className="border-b bg-muted/40 px-4 py-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Real Campaigns</h3>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-semibold tabular-nums">{campaigns.real.active}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums">{campaigns.real.completed}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums">{campaigns.real.archived}</p>
                <p className="text-xs text-muted-foreground">Archived</p>
              </div>
            </div>
            <p className="mt-3 text-center text-sm text-muted-foreground">
              Total: {campaigns.real.total}
            </p>
          </div>
        </div>
      </div>

      {/* Donation Totals */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border">
          <div className="border-b bg-muted/40 px-4 py-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              Seed Donations
              <Badge variant="secondary">Simulated</Badge>
            </h3>
          </div>
          <div className="p-4">
            <p className="text-2xl font-semibold tabular-nums">{formatCents(donations.seed.total)}</p>
            <p className="text-xs text-muted-foreground">{donations.seed.count} donations</p>
          </div>
        </div>
        <div className="rounded-lg border">
          <div className="border-b bg-muted/40 px-4 py-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              Real Donations
              <Badge>Real</Badge>
            </h3>
          </div>
          <div className="p-4">
            <p className="text-2xl font-semibold tabular-nums">{formatCents(donations.real.total)}</p>
            <p className="text-xs text-muted-foreground">{donations.real.count} donations</p>
          </div>
        </div>
      </div>

      {/* Fund Pool */}
      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Fund Pool Summary</h3>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xl font-semibold tabular-nums">{formatCents(fundPool.pending)}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
            <div>
              <p className="text-xl font-semibold tabular-nums">{formatCents(fundPool.allocated)}</p>
              <p className="text-xs text-muted-foreground">Allocated</p>
            </div>
            <div>
              <p className="text-xl font-semibold tabular-nums">{formatCents(fundPool.disbursed)}</p>
              <p className="text-xs text-muted-foreground">Disbursed</p>
            </div>
          </div>
        </div>
      </div>

      {/* Per-Category Breakdown */}
      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Per-Category Breakdown</h3>
        </div>
        <div className="p-4">
          {categories.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <ChartBarIcon className="size-8" />
              <p>No category data available.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Category</th>
                    <th className="pb-2 pr-4 font-medium text-right">Simulated</th>
                    <th className="pb-2 pr-4 font-medium text-right">Real</th>
                    <th className="pb-2 pr-4 font-medium text-right">Seed Donations</th>
                    <th className="pb-2 font-medium text-right">Real Donations</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {categories.map((cat) => (
                    <tr key={cat.category}>
                      <td className="py-3 pr-4 font-medium capitalize">{cat.category}</td>
                      <td className="py-3 pr-4 text-right">{cat.simulated}</td>
                      <td className="py-3 pr-4 text-right">{cat.real}</td>
                      <td className="py-3 pr-4 text-right">{formatCents(cat.seedDonations)}</td>
                      <td className="py-3 text-right">{formatCents(cat.realDonations)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
