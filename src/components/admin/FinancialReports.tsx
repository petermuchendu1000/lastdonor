'use client';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { centsToDollars } from '@/lib/utils/currency';
import Link from 'next/link';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from 'recharts';

interface MonthlyPoint {
  month: string;
  total: number;
  count: number;
  avgDonation: number;
}

interface Totals {
  total: number;
  count: number;
  avgDonation: number;
}

interface CampaignRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  raisedAmount: number;
  goalAmount: number;
  donorCount: number;
  category: string;
}

interface CategoryRow {
  category: string;
  total: number;
  count: number;
  campaigns: number;
}

interface FinancialReportsProps {
  monthlyRevenue: MonthlyPoint[];
  ytd: Totals;
  mtd: Totals;
  allTime: Totals;
  topCampaigns: CampaignRow[];
  categoryRevenue: CategoryRow[];
  refunds: { total: number; count: number };
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline',
  active: 'default',
  last_donor_zone: 'destructive',
  completed: 'secondary',
  archived: 'secondary',
};

function formatCategoryName(cat: string): string {
  return cat.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

export function FinancialReports({
  monthlyRevenue,
  ytd,
  mtd,
  allTime,
  topCampaigns,
  categoryRevenue,
  refunds,
}: FinancialReportsProps) {
  return (
    <div className="space-y-8">
      {/* Export toolbar */}
      <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
        <a href="/api/v1/admin/export/csv?type=donations" className={buttonVariants({ variant: 'outline', size: 'sm' })}>Export Donations</a>
        <a href="/api/v1/admin/export/csv?type=monthly" className={buttonVariants({ variant: 'outline', size: 'sm' })}>Export Monthly</a>
        <a href="/api/v1/admin/export/csv?type=campaigns" className={buttonVariants({ variant: 'outline', size: 'sm' })}>Export Campaigns</a>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border px-4 py-3">
          <p className="text-2xl font-semibold tabular-nums">{centsToDollars(allTime.total)}</p>
          <p className="text-xs text-muted-foreground">All-time · {allTime.count} donations</p>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <p className="text-2xl font-semibold tabular-nums">{centsToDollars(ytd.total)}</p>
          <p className="text-xs text-muted-foreground">YTD · avg {centsToDollars(ytd.avgDonation)}</p>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <p className="text-2xl font-semibold tabular-nums">{centsToDollars(mtd.total)}</p>
          <p className="text-xs text-muted-foreground">This month · {mtd.count} donations</p>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <p className="text-2xl font-semibold tabular-nums">{centsToDollars(refunds.total)}</p>
          <p className="text-xs text-muted-foreground">Refunds · {refunds.count} refunded</p>
        </div>
      </div>

      {/* Monthly Revenue Chart */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground">
          Monthly Revenue (12 months)
        </h2>
        <div className="mt-3 rounded-lg border p-4">
            {monthlyRevenue.length === 0 ? (
              <p className="flex h-64 items-center justify-center text-muted-foreground">
                No revenue data yet.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={monthlyRevenue.map((m) => ({
                  month: m.month.slice(2),
                  revenue: m.total / 100,
                  donations: m.count,
                  avg: m.avgDonation / 100,
                }))}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                    tickFormatter={(v: number) => `$${v}`}
                  />
                  <Tooltip
                    formatter={(value, name) => {
                      // Chart series are in dollars (divided at the mapping above), so scale back to cents for the one renderer.
                      if (name === 'revenue') return [centsToDollars(Math.round(Number(value) * 100)), 'Revenue'];
                      if (name === 'avg') return [centsToDollars(Math.round(Number(value) * 100)), 'Avg Donation'];
                      return [value, name];
                    }}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--card)',
                      color: 'var(--foreground)',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(var(--chart-1))"
                    strokeWidth={2}
                    fill="url(#revenueGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

      {/* Revenue by Category */}
      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground">
            Revenue by Category
          </h2>
          <div className="mt-3 rounded-lg border p-4">
              {categoryRevenue.length === 0 ? (
                <p className="flex h-64 items-center justify-center text-muted-foreground">
                  No category data yet.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={categoryRevenue.map((c) => ({
                    name: formatCategoryName(c.category),
                    revenue: c.total / 100,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      className="fill-muted-foreground"
                      angle={-30}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      className="fill-muted-foreground"
                      tickFormatter={(v: number) => `$${v}`}
                    />
                    <Tooltip
                      formatter={(value) => [centsToDollars(Math.round(Number(value) * 100)), 'Revenue']}
                      contentStyle={{
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        backgroundColor: 'var(--card)',
                        color: 'var(--foreground)',
                      }}
                    />
                    <Bar dataKey="revenue" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

        {/* Category breakdown table */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground">
            Category Breakdown
          </h2>
          <div className="mt-3 overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Category</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Revenue</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Donations</th>
                    <th className="hidden px-4 py-2 text-right text-xs font-medium text-muted-foreground sm:table-cell">Campaigns</th>
                    <th className="hidden px-4 py-2 text-right text-xs font-medium text-muted-foreground sm:table-cell">Avg</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {categoryRevenue.map((c) => (
                    <tr key={c.category} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-medium">{formatCategoryName(c.category)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{centsToDollars(c.total)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{c.count}</td>
                      <td className="hidden px-4 py-2.5 text-right tabular-nums sm:table-cell">{c.campaigns}</td>
                      <td className="hidden px-4 py-2.5 text-right font-mono tabular-nums sm:table-cell">
                        {c.count > 0 ? centsToDollars(Math.round(c.total / c.count)) : '$0.00'}
                      </td>
                    </tr>
                  ))}
                  {categoryRevenue.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">No data available.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-muted-foreground">
          Monthly Breakdown
        </h2>
        <div className="mt-3 overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Month</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Revenue</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Donations</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Avg</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[...monthlyRevenue].reverse().map((m) => (
                  <tr key={m.month} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium">{m.month}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{centsToDollars(m.total)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{m.count}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{centsToDollars(m.avgDonation)}</td>
                  </tr>
                ))}
                {monthlyRevenue.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">No revenue data yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-muted-foreground">
          Top Campaigns by Revenue
        </h2>
        <div className="mt-3 overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Campaign</th>
                  <th className="hidden px-4 py-2 text-left text-xs font-medium text-muted-foreground sm:table-cell">Category</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Raised</th>
                  <th className="hidden px-4 py-2 text-right text-xs font-medium text-muted-foreground md:table-cell">Goal</th>
                  <th className="hidden px-4 py-2 text-right text-xs font-medium text-muted-foreground md:table-cell">Progress</th>
                  <th className="hidden px-4 py-2 text-right text-xs font-medium text-muted-foreground lg:table-cell">Donors</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {topCampaigns.map((c) => {
                  const pct = c.goalAmount > 0 ? Math.round((c.raisedAmount / c.goalAmount) * 100) : 0;
                  return (
                    <tr key={c.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5">
                        <Link href={`/admin/campaigns/${c.id}/edit`} className="font-medium underline-offset-4 hover:underline">
                          {c.title}
                        </Link>
                      </td>
                      <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">{formatCategoryName(c.category)}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant={STATUS_VARIANT[c.status] ?? 'secondary'}>{c.status.replace(/_/g, ' ')}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{centsToDollars(c.raisedAmount)}</td>
                      <td className="hidden px-4 py-2.5 text-right font-mono tabular-nums md:table-cell">{centsToDollars(c.goalAmount)}</td>
                      <td className="hidden px-4 py-2.5 text-right md:table-cell">
                        <Badge variant={pct >= 90 ? 'destructive' : 'secondary'}>{pct}%</Badge>
                      </td>
                      <td className="hidden px-4 py-2.5 text-right tabular-nums lg:table-cell">{c.donorCount}</td>
                    </tr>
                  );
                })}
                {topCampaigns.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No campaigns yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
