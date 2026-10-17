'use client';

import { useState, useMemo, useCallback, Fragment } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/Money';
import { centsToDollars } from '@/lib/utils/currency';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  CurrencyDollarIcon,
  ClockIcon,
  CheckCircleIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';
import { ListCount } from '@/components/admin/ListCount';

// --- Types ---

interface AuditEntry {
  id: string;
  eventType: string;
  actorId: string | null;
  details: Record<string, unknown> | null;
  severity: string;
  timestamp: string;
}

interface CampaignItem {
  id: string;
  title: string;
  slug: string;
  status: string;
  verificationStatus: string;
  goalAmount: number;
  raisedAmount: number;
  totalReleasedAmount: number;
  totalWithdrawnAmount: number;
  withdrawalCount: number;
  creatorId: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
  updatedAt: string;
  auditTrail: AuditEntry[];
}

interface Stats {
  /** True `count(*)` under the page's own predicate, before its 500-row cap (docs/88 F16). */
  totalMatching: number;
  totalFullyVerified: number;
  totalReleased: number;
  totalWithdrawn: number;
  totalPendingVerification: number;
}

interface PayoutsDashboardProps {
  initialCampaigns: CampaignItem[];
  stats: Stats;
}

// --- Constants ---

const PAGE_SIZE = 25;

const FILTER_OPTIONS = [
  { value: '', label: 'All Campaigns' },
  { value: 'fully_verified', label: 'Fully Verified' },
  { value: 'identity_verified', label: 'Identity Verified' },
  { value: 'has_withdrawals', label: 'Has Withdrawals' },
  { value: 'pending_withdrawal', label: 'Funds Available' },
];

const VERIFICATION_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  identity_verified: { label: 'Identity Verified', className: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300' },
  fully_verified: { label: 'Fully Verified', className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
};

const AUDIT_EVENT_LABELS: Record<string, string> = {
  'verification.approved': 'Verification approved',
  'verification.rejected': 'Verification rejected',
  'fund_release.approved': 'Funds released',
  'withdrawal.requested': 'Withdrawal requested',
  'withdrawal.completed': 'Withdrawal completed',
  'campaign.updated': 'Campaign updated',
};

// --- Component ---

export function PayoutsDashboard({ initialCampaigns, stats }: PayoutsDashboardProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const campaigns = initialCampaigns;

  const filtered = useMemo(() => {
    let items = campaigns;

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q) ||
          c.creatorName?.toLowerCase().includes(q) ||
          c.creatorEmail?.toLowerCase().includes(q),
      );
    }

    if (statusFilter) {
      items = items.filter((c) => {
        switch (statusFilter) {
          case 'fully_verified':
            return c.verificationStatus === 'fully_verified';
          case 'identity_verified':
            return c.verificationStatus === 'identity_verified';
          case 'has_withdrawals':
            return c.totalWithdrawnAmount > 0;
          case 'pending_withdrawal':
            return c.totalReleasedAmount > c.totalWithdrawnAmount;
          default:
            return true;
        }
      });
    }

    return items;
  }, [campaigns, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const handleFilter = useCallback((value: string) => {
    setStatusFilter(value);
    setPage(1);
  }, []);

  const totals = useMemo(() => {
    let totalRaised = 0;
    let totalReleased = 0;
    let totalWithdrawn = 0;
    for (const c of campaigns) {
      totalRaised += c.raisedAmount;
      totalReleased += c.totalReleasedAmount;
      totalWithdrawn += c.totalWithdrawnAmount;
    }
    return { totalRaised, totalReleased, totalWithdrawn };
  }, [campaigns]);

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          label="Total Raised"
          value={centsToDollars(totals.totalRaised)}
          className="bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300"
        />
        <StatTile
          label="Total Released"
          value={centsToDollars(totals.totalReleased)}
          className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300"
        />
        <StatTile
          label="Total Withdrawn"
          value={centsToDollars(totals.totalWithdrawn)}
          className="bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
        />
        <StatTile
          label="Pending Verification"
          value={String(stats.totalPendingVerification)}
          className="bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300"
        />
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search campaigns or creators..."
            aria-label="Search campaigns or creators"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="relative">
          <FunnelIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <select
            value={statusFilter}
            aria-label="Filter by status"
            onChange={(e) => handleFilter(e.target.value)}
            className="pl-9 pr-8 py-2 text-sm border rounded-lg bg-background appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        {/* docs/88 F18: a table narrower than its content needs a scrollable
    wrapper, or `overflow-hidden` on the card clips the last columns
    with no way to reach them on a phone. */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left font-medium px-4 py-3 w-8" />
                <th className="text-left font-medium px-4 py-3">Campaign</th>
                <th className="text-right font-medium px-4 py-3 hidden sm:table-cell">Raised</th>
                <th className="text-right font-medium px-4 py-3 hidden md:table-cell">Released</th>
                <th className="text-right font-medium px-4 py-3 hidden md:table-cell">Withdrawn</th>
                <th className="text-left font-medium px-4 py-3 hidden lg:table-cell">Status</th>
                <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Updated</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((campaign) => {
                const isExpanded = expandedId === campaign.id;
                const verifConfig = VERIFICATION_STATUS_CONFIG[campaign.verificationStatus] || {
                  label: campaign.verificationStatus,
                  className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
                };
                const available = campaign.totalReleasedAmount - campaign.totalWithdrawnAmount;

                return (
                  <Fragment key={campaign.id}>
                    <tr
                      className={cn(
                        'border-b cursor-pointer transition-colors hover:bg-muted/30',
                        isExpanded && 'bg-muted/20',
                      )}
                      onClick={() => setExpandedId(isExpanded ? null : campaign.id)}
                      role="button"
                      aria-expanded={isExpanded}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setExpandedId(isExpanded ? null : campaign.id);
                        }
                      }}
                    >
                      <td className="px-4 py-3">
                        {isExpanded ? (
                          <ChevronDownIcon className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronRightIcon className="size-4 text-muted-foreground" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{campaign.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {campaign.creatorName || 'Unknown'} &middot; {campaign.creatorEmail}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right hidden sm:table-cell">
                        <span className="font-mono font-medium">
                          {<Money cents={campaign.raisedAmount} precision="exact" />}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">
                        <span className="font-mono font-medium text-green-700 dark:text-green-400">
                          {<Money cents={campaign.totalReleasedAmount} precision="exact" />}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">
                        <span className="font-mono font-medium text-blue-700 dark:text-blue-400">
                          {<Money cents={campaign.totalWithdrawnAmount} precision="exact" />}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <Badge className={cn('text-xs', verifConfig.className)}>
                          {verifConfig.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">
                        {new Date(campaign.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr>
                        <td colSpan={7} className="p-0">
                          <div className="border-b bg-muted/10 p-4 sm:p-6 space-y-6">
                            <section>
                              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                <CurrencyDollarIcon className="size-4 text-teal-600 dark:text-teal-400" />
                                Financial Summary
                              </h3>
                              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
                                <div>
                                  <dt className="text-muted-foreground text-xs">Goal</dt>
                                  <dd className="font-mono font-medium">
                                    {<Money cents={campaign.goalAmount} precision="exact" />}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground text-xs">Raised</dt>
                                  <dd className="font-mono font-medium">
                                    {<Money cents={campaign.raisedAmount} precision="exact" />}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground text-xs">Released</dt>
                                  <dd className="font-mono font-medium text-green-700 dark:text-green-400">
                                    {<Money cents={campaign.totalReleasedAmount} precision="exact" />}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground text-xs">Withdrawn</dt>
                                  <dd className="font-mono font-medium text-blue-700 dark:text-blue-400">
                                    {<Money cents={campaign.totalWithdrawnAmount} precision="exact" />}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground text-xs">Available</dt>
                                  <dd className="font-mono font-medium">
                                    {<Money cents={available} precision="exact" />}
                                  </dd>
                                </div>
                              </div>
                            </section>

                            <section className="border-t pt-4">
                              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                <CheckCircleIcon className="size-4 text-green-600 dark:text-green-400" />
                                Payout Status
                              </h3>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                                <div>
                                  <dt className="text-muted-foreground text-xs">Verification</dt>
                                  <dd>
                                    <Badge className={cn('text-xs', verifConfig.className)}>
                                      {verifConfig.label}
                                    </Badge>
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground text-xs">Payout</dt>
                                  <dd>
                                    {campaign.totalReleasedAmount > 0 ? (
                                      <Badge className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                                        Lump-sum Released
                                      </Badge>
                                    ) : campaign.verificationStatus === 'fully_verified' ? (
                                      <Badge className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                                        Awaiting Release
                                      </Badge>
                                    ) : (
                                      <Badge className="text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                        Pending Verification
                                      </Badge>
                                    )}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground text-xs">Withdrawals</dt>
                                  <dd className="flex items-center gap-1.5">
                                    <ArrowDownTrayIcon className="size-3.5 text-muted-foreground" />
                                    {campaign.withdrawalCount} withdrawal{campaign.withdrawalCount !== 1 ? 's' : ''}
                                  </dd>
                                </div>
                              </div>
                            </section>

                            {campaign.auditTrail.length > 0 && (
                              <section className="border-t pt-4">
                                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                  <ClockIcon className="size-4 text-muted-foreground" />
                                  Audit Trail
                                </h3>
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                  {campaign.auditTrail.map((entry) => (
                                    <div key={entry.id} className="flex items-start gap-3 text-xs">
                                      <span className="text-muted-foreground whitespace-nowrap font-mono">
                                        {new Date(entry.timestamp).toLocaleDateString('en-US', {
                                          month: 'short',
                                          day: 'numeric',
                                        })}{' '}
                                        {new Date(entry.timestamp).toLocaleTimeString('en-US', {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </span>
                                      <span
                                        className={cn(
                                          'font-medium',
                                          entry.severity === 'warning'
                                            ? 'text-amber-600 dark:text-amber-400'
                                            : entry.severity === 'error'
                                              ? 'text-red-600 dark:text-red-400'
                                              : 'text-foreground',
                                        )}
                                      >
                                        {AUDIT_EVENT_LABELS[entry.eventType] || entry.eventType}
                                      </span>
                                      {entry.details && typeof entry.details === 'object' && 'note' in entry.details && (
                                        <span className="text-muted-foreground truncate max-w-xs">
                                          {String((entry.details as { note?: string }).note || '')}
                                        </span>
                                      )}
                                      {entry.details && typeof entry.details === 'object' && 'reason' in entry.details && (
                                        <span className="text-muted-foreground truncate max-w-xs">
                                          {String((entry.details as { reason?: string }).reason || '')}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </section>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground">
                    {search || statusFilter
                      ? 'No campaigns match your filters'
                      : 'No campaigns with released or releasable funds'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Count and pagination (docs/88 F16) */}
      {(filtered.length > 0 || stats.totalMatching > campaigns.length) && (
        <div className="flex items-start justify-between gap-4 text-sm">
          <ListCount
            from={filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}
            to={Math.min(page * PAGE_SIZE, filtered.length)}
            shown={filtered.length}
            loaded={campaigns.length}
            total={stats.totalMatching}
            noun="campaigns"
          />
          {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i + 1;
              } else if (page <= 4) {
                pageNum = i + 1;
              } else if (page >= totalPages - 3) {
                pageNum = totalPages - 6 + i;
              } else {
                pageNum = page - 3 + i;
              }
              return (
                <Button
                  key={pageNum}
                  size="sm"
                  variant={pageNum === page ? 'default' : 'outline'}
                  onClick={() => setPage(pageNum)}
                >
                  {pageNum}
                </Button>
              );
            })}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---

function StatTile({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg p-3', className)}>
      <div className="text-2xl font-bold font-mono">{value}</div>
      <div className="text-xs font-medium opacity-80">{label}</div>
    </div>
  );
}
