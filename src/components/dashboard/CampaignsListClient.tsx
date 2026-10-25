'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { centsToDollars } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/dates';
import { hasPublicPage } from '@/lib/campaign-visibility';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';

interface Campaign {
  id: string;
  title: string;
  slug: string;
  status: string;
  category: string;
  goalAmount: number;
  raisedAmount: number;
  donorCount: number;
  verificationStatus: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  last_donor_zone: 'Last Donor Zone',
  completed: 'Completed',
  archived: 'Archived',
  paused: 'Paused',
  under_review: 'Under Review',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  last_donor_zone: 'default',
  completed: 'secondary',
  draft: 'outline',
  paused: 'secondary',
  archived: 'secondary',
  under_review: 'outline',
  suspended: 'destructive',
  cancelled: 'destructive',
};

export function CampaignsListClient({ campaigns }: { campaigns: Campaign[] }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const statuses = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of campaigns) {
      counts[c.status] = (counts[c.status] || 0) + 1;
    }
    return counts;
  }, [campaigns]);

  const filtered = useMemo(() => {
    let result = campaigns;
    if (statusFilter !== 'all') {
      result = result.filter((c) => c.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => c.title.toLowerCase().includes(q));
    }
    return result;
  }, [campaigns, statusFilter, search]);

  return (
    <div className="mt-6">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search campaigns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary sm:w-64"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setStatusFilter('all')}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${statusFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
          >
            All ({campaigns.length})
          </button>
          {Object.entries(statuses).map(([status, count]) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${statusFilter === status ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
            >
              {STATUS_LABELS[status] ?? status} ({count})
            </button>
          ))}
        </div>
      </div>

      {/* Campaign Cards */}
      <div className="mt-4 space-y-3">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">No campaigns match your filters.</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((c) => {
            const pct = c.goalAmount > 0 ? Math.min(100, Math.round((c.raisedAmount / c.goalAmount) * 100)) : 0;
            return (
              <Card key={c.id}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/dashboard/campaigns/${c.id}`}
                        className="font-medium text-brand-teal hover:underline"
                      >
                        {c.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <Badge variant={STATUS_VARIANT[c.status] ?? 'secondary'}>
                          {STATUS_LABELS[c.status] ?? c.status}
                        </Badge>
                        <span className="capitalize">{c.category}</span>
                        <span>&middot;</span>
                        <span>{c.donorCount} donors</span>
                        <span>&middot;</span>
                        <span>{centsToDollars(c.raisedAmount)} / {centsToDollars(c.goalAmount)}</span>
                      </div>
                      <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-brand-teal transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-xs text-muted-foreground">{formatDate(c.createdAt)}</span>
                      <div className="flex gap-1">
                        <Link
                          href={`/dashboard/campaigns/${c.id}`}
                          className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                          Manage
                        </Link>
                        {/*
                          ⛔ Only when there IS a public page. This used to
                          render for every status, so an organiser whose
                          campaign was still `under_review` clicked "View" on
                          their own dashboard and got a 404 - the same page
                          the wizard used to redirect to (docs/109).
                        */}
                        {hasPublicPage(c.status) && (
                          <Link
                            href={`/campaigns/${c.slug}`}
                            className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                          >
                            View
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
