'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Money } from '@/components/ui/Money';
import { formatDate } from '@/lib/utils/dates';
import { hasPublicPage } from '@/lib/campaign-visibility';
import { NextStepRow } from '@/components/dashboard/NextStepRow';
import { campaignStatusLabel } from '@/lib/campaign-labels';
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
  currency: string;
  createdAt: string;
}

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
              {campaignStatusLabel(status)} ({count})
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
                  {/*
                    ── MOBILE FIRST, AND IT WAS NOT ─────────────────────────
                    This was `flex justify-between` with a `shrink-0` action
                    column. On a 390px phone that column refused to shrink,
                    so the title starved into a three-line ribbon and the
                    meta row stacked one item per line: two buttons took half
                    the screen. Reported from a real screenshot.

                    Now a single stack. Actions sit at the BOTTOM on their
                    own full-width wrapping row, where a long label costs the
                    title nothing.
                  */}
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`/dashboard/campaigns/${c.id}`}
                        className="min-w-0 font-medium text-brand-teal hover:underline"
                      >
                        {c.title}
                      </Link>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(c.createdAt)}
                      </span>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      <Badge variant={STATUS_VARIANT[c.status] ?? 'secondary'}>
                        {campaignStatusLabel(c.status)}
                      </Badge>
                      <span className="capitalize">{c.category}</span>
                      <span aria-hidden>&middot;</span>
                      <span>{c.donorCount} donors</span>
                      {/*
                        ⛔ The campaign's OWN currency. This read
                        `centsToDollars(...)`, which hardcodes USD, so a KES
                        campaign showed "$18,400.00 / $50,000.00" on the
                        organiser's own dashboard (`docs/92`: every amount is
                        in the minor units of its row's currency).
                      */}
                    </div>

                    {/*
                      Its own line, not another item in the wrapping meta row.
                      As a trailing item it pushed a "&middot;" onto the end of
                      the line above whenever it wrapped, leaving a separator
                      dangling with nothing after it.
                    */}
                    <p className="mt-1 text-sm text-muted-foreground">
                      <Money minor={c.raisedAmount} currency={c.currency} /> /{' '}
                      <Money minor={c.goalAmount} currency={c.currency} />
                    </p>

                    {/*
                      The one thing waiting on this organiser.

                      This list had NOTHING: `VerificationRow` rendered on
                      /dashboard only, and this is the list the wizard lands
                      on after submission (docs/109). See docs/110.
                    */}
                    <NextStepRow
                      facts={{
                        campaignId: c.id,
                        status: c.status,
                        verificationStatus: c.verificationStatus,
                        currency: c.currency,
                      }}
                    />

                    <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-brand-teal transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Link
                        href={`/dashboard/campaigns/${c.id}`}
                        className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Manage
                      </Link>
                      {/*
                        `docs/113` §11 screens B1-B4. On EVERY row, in every
                        state, for the `docs/83` reason: the verification flow
                        worked and nobody could reach it, because its only
                        link was gated on a condition two later decisions made
                        unsatisfiable. The screen itself decides what to show.
                      */}
                      <Link
                        href={`/dashboard/campaigns/${c.id}/payout-destination`}
                        className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Where the money goes
                      </Link>
                      {/*
                        ⛔ Only when there IS a public page. This used to
                        render for every status, so an organiser whose
                        campaign was still `under_review` clicked "View" on
                        their own dashboard and got a 404 - the same page the
                        wizard used to redirect to (docs/109).
                      */}
                      {hasPublicPage(c.status) && (
                        <Link
                          href={`/campaigns/${c.slug}`}
                          className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                          View
                        </Link>
                      )}
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
