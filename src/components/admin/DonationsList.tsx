'use client';

import { useState, useMemo, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/Money';
import { formatMoney } from '@/lib/money/format';
import type { CurrencyTotal } from '@/lib/admin/donation-totals.server';
import { formatDate } from '@/lib/utils/dates';
import { ListCount } from '@/components/admin/ListCount';
import { toast } from 'sonner';
import {
  MagnifyingGlassIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline';

/* ─── Types ─── */

interface DonationRow {
  id: string;
  /** The donation's own currency (`docs/92`). */
  currency: string;
  amount: number;
  donorName: string;
  donorEmail: string;
  message: string | null;
  isAnonymous: boolean;
  source: string;
  refunded: boolean;
  createdAt: string;
  campaignId: string;
  campaignTitle: string;
  campaignSlug: string;
}

interface DonationsListProps {
  /**
   * What has been donated, PER CURRENCY.
   *
   * ⛔ Was a single `stats.totalAmount` - `SUM(donations.amount)` over the
   * whole table with no currency grouping - printed through `centsToDollars`.
   * Shillings added to dollars under a dollar sign (`docs/92`).
   */
  totalsByCurrency: CurrencyTotal[];
  initialDonations: DonationRow[];
  stats: {

    totalCount: number;
    realCount: number;
    seedCount: number;
    refundedCount: number;
  };
  campaignOptions: { id: string; title: string }[];
}

/* ─── Constants ─── */

const PAGE_SIZE = 25;
type SortField = 'donorName' | 'amount' | 'source' | 'createdAt';
type SortDir = 'asc' | 'desc';

const STAT_KEYS = ['all', 'real', 'seed', 'refunded'] as const;

/* ─── Component ─── */

export function DonationsList({ initialDonations, stats, totalsByCurrency, campaignOptions }: DonationsListProps) {
  const [donations, setDonations] = useState(initialDonations);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [campaignFilter, setCampaignFilter] = useState<string>('all');
  const [refundedFilter, setRefundedFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [refundTarget, setRefundTarget] = useState<DonationRow | null>(null);
  const [refunding, setRefunding] = useState(false);

  /* ── Filtering ── */
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return donations.filter((d) => {
      if (q && !d.donorName.toLowerCase().includes(q) && !d.donorEmail.toLowerCase().includes(q) && !d.campaignTitle.toLowerCase().includes(q)) return false;
      if (sourceFilter !== 'all' && d.source !== sourceFilter) return false;
      if (campaignFilter !== 'all' && d.campaignId !== campaignFilter) return false;
      if (refundedFilter === 'refunded' && !d.refunded) return false;
      if (refundedFilter === 'active' && d.refunded) return false;
      return true;
    });
  }, [donations, search, sourceFilter, campaignFilter, refundedFilter]);

  /* ── Sorting ── */
  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'donorName': cmp = (a.isAnonymous ? 'Anonymous' : a.donorName).localeCompare(b.isAnonymous ? 'Anonymous' : b.donorName); break;
        case 'amount': cmp = a.amount - b.amount; break;
        case 'source': cmp = a.source.localeCompare(b.source); break;
        case 'createdAt': cmp = a.createdAt.localeCompare(b.createdAt); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortField, sortDir]);

  /* ── Pagination ── */
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }

  /* ── Sort toggle ── */
  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'amount' ? 'desc' : 'asc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return null;
    return sortDir === 'asc'
      ? <ChevronUpIcon className="ml-1 inline h-3 w-3" />
      : <ChevronDownIcon className="ml-1 inline h-3 w-3" />;
  }

  /* ── Refund action ── */
  const handleRefund = useCallback(async () => {
    if (!refundTarget || refundTarget.refunded) return;
    setRefunding(true);
    try {
      const res = await fetch(`/api/v1/admin/donations/${refundTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refunded: true }),
      });
      if (res.ok) {
        setDonations((prev) =>
          prev.map((d) => (d.id === refundTarget.id ? { ...d, refunded: true } : d)),
        );
        toast.success(`Refund processed for ${formatMoney(refundTarget.amount, refundTarget.currency, 'exact')}`);
        setRefundTarget(null);
      } else {
        const body = await res.json().catch(() => null);
        toast.error(body?.error?.message || 'Refund failed');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setRefunding(false);
    }
  }, [refundTarget]);

  const hasActiveFilters = search !== '' || sourceFilter !== 'all' || campaignFilter !== 'all' || refundedFilter !== 'all';

  function clearFilters() {
    setSearch('');
    setSourceFilter('all');
    setCampaignFilter('all');
    setRefundedFilter('all');
    setPage(1);
  }

  return (
    <div className="space-y-4">

      {/* ── Status tiles ── */}
      <div className="flex flex-wrap gap-2">
        {STAT_KEYS.map((key) => {
          const isActive =
            (key === 'all' && refundedFilter === 'all' && sourceFilter === 'all') ||
            (key === 'real' && sourceFilter === 'real') ||
            (key === 'seed' && sourceFilter === 'seed') ||
            (key === 'refunded' && refundedFilter === 'refunded');

          const value = key === 'all'
            ? (totalsByCurrency.length === 0
                ? '-'
                : totalsByCurrency.map((t) => formatMoney(t.totalMinor, t.currency, 'exact')).join(' · '))
            : key === 'real'
              ? stats.realCount
              : key === 'seed'
                ? stats.seedCount
                : stats.refundedCount;

          const label = key === 'all' ? 'Total raised' : key === 'real' ? 'Real' : key === 'seed' ? 'Seed' : 'Refunded';

          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (key === 'refunded') {
                  updateFilter(setRefundedFilter)(refundedFilter === 'refunded' ? 'all' : 'refunded');
                  setSourceFilter('all');
                } else if (key === 'real' || key === 'seed') {
                  updateFilter(setSourceFilter)(sourceFilter === key ? 'all' : key);
                  setRefundedFilter('all');
                } else {
                  setSourceFilter('all');
                  updateFilter(setRefundedFilter)('all');
                }
              }}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors duration-100 ${
                isActive
                  ? 'border-primary/40 bg-primary/5 text-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
              }`}
            >
              <span className="block text-lg font-semibold tabular-nums leading-none">{value}</span>
              <span className="mt-0.5 block text-xs">{label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
        <div className="relative min-w-[200px] flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search donor, email, campaign…"
            value={search}
            onChange={(e) => updateFilter(setSearch)(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search donations"
          />
        </div>

        {campaignOptions.length > 0 && (
          <Select value={campaignFilter} onValueChange={updateFilter(setCampaignFilter)}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="Campaign" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {campaignOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={refundedFilter} onValueChange={updateFilter(setRefundedFilter)}>
          <SelectTrigger className="h-8 w-[120px] text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
            Clear filters
          </Button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* ── Data table ── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <CurrencyDollarIcon className="mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No donations match your filters</p>
          {hasActiveFilters && (
            <Button variant="link" size="sm" className="mt-1 text-xs" onClick={clearFilters}>
              Clear all filters
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-3 py-2 text-left">
                  <button type="button" onClick={() => toggleSort('donorName')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Donor<SortIcon field="donorName" />
                  </button>
                </th>
                <th className="hidden px-3 py-2 text-left sm:table-cell">
                  <span className="font-semibold text-muted-foreground">Campaign</span>
                </th>
                <th className="px-3 py-2 text-right">
                  <button type="button" onClick={() => toggleSort('amount')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Amount<SortIcon field="amount" />
                  </button>
                </th>
                <th className="hidden px-3 py-2 text-left md:table-cell">
                  <button type="button" onClick={() => toggleSort('source')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Source<SortIcon field="source" />
                  </button>
                </th>
                <th className="px-3 py-2 text-left">
                  <span className="font-semibold text-muted-foreground">Status</span>
                </th>
                <th className="hidden px-3 py-2 text-left lg:table-cell">
                  <button type="button" onClick={() => toggleSort('createdAt')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Date<SortIcon field="createdAt" />
                  </button>
                </th>
                <th className="px-3 py-2 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginated.map((d) => (
                <tr key={d.id} className="transition-colors duration-100 hover:bg-muted/30">
                  <td className="px-3 py-3">
                    <p className="truncate text-sm font-medium text-foreground">
                      {d.isAnonymous ? 'Anonymous' : d.donorName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{d.donorEmail}</p>
                  </td>
                  <td className="hidden max-w-[200px] truncate px-3 py-3 text-muted-foreground sm:table-cell">
                    {d.campaignTitle}
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">
                    <Money minor={d.amount} currency={d.currency} precision="exact" />
                  </td>
                  <td className="hidden px-3 py-3 md:table-cell">
                    <Badge variant={d.source === 'real' ? 'default' : 'outline'} className="text-xs">
                      {d.source}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    {d.refunded ? (
                      <Badge variant="destructive" className="text-xs">Refunded</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">Active</Badge>
                    )}
                  </td>
                  <td className="hidden px-3 py-3 lg:table-cell">
                    <span className="text-xs text-muted-foreground">{formatDate(d.createdAt)}</span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    {!d.refunded && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => setRefundTarget(d)}
                      >
                        Refund
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        Count and pagination (docs/88 F16). The fetch is capped at 200
        while the stat tiles above come from a `count(*)` over the whole
        table, so the two disagree the moment there are more than 200
        donations. See ListCount for why both numbers are printed.
      */}
      {(sorted.length > 0 || stats.totalCount > donations.length) && (
        <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
          <ListCount
            from={sorted.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}
            to={Math.min(safePage * PAGE_SIZE, sorted.length)}
            shown={sorted.length}
            loaded={donations.length}
            total={stats.totalCount}
            noun="donations"
          />
          {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => p - 1)}
              aria-label="Previous page"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <span className="px-2 text-xs tabular-nums text-muted-foreground">
              {safePage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
          </div>
          )}
        </div>
      )}

      {/* ── Refund confirmation dialog ── */}
      <Dialog open={!!refundTarget} onOpenChange={(open) => { if (!open) setRefundTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Refund</DialogTitle>
            <DialogDescription>
              This will refund the {refundTarget ? formatMoney(refundTarget.amount, refundTarget.currency, 'exact') : ''} donation by {refundTarget?.donorName ?? ''} via Stripe and adjust the campaign totals. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundTarget(null)} disabled={refunding}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRefund}
              disabled={refunding}
            >
              {refunding ? 'Processing…' : 'Refund'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
