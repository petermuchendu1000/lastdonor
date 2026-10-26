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
                    ── HIERARCHY, NOT A PILE ──────────────────────────────────
                    Every fact used to render at the same weight and the same
                    muted grey: title, status, category, donors, money and a
                    repeated paragraph, all competing. A reader scanning for
                    "how much has this raised" had to read the whole card.

                    Now there are three tiers: the TITLE and the MONEY are the
                    two things somebody came for, the status is a chip beside
                    the title, and everything else is quiet metadata on one
                    line. Actions sit at the bottom on their own row - a
                    `shrink-0` column beside the title is what let two buttons
                    take half a 390px screen.
                  */}
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`/dashboard/campaigns/${c.id}`}
                        className="min-w-0 font-semibold leading-snug text-foreground hover:text-brand-teal hover:underline"
                      >
                        {c.title}
                      </Link>
                      <Badge
                        variant={STATUS_VARIANT[c.status] ?? 'secondary'}
                        className="shrink-0"
                      >
                        {campaignStatusLabel(c.status)}
                      </Badge>
                    </div>

                    {/*
                      The figure, at the size of a figure. `raised_amount` is
                      blended with seed money (`docs/101`), so it is the
                      campaign's headline total and not a payable one - but it
                      is what the organiser is looking for.
                    */}
                    <p className="mt-2 font-display text-lg font-bold tabular-nums text-foreground">
                      <Money minor={c.raisedAmount} currency={c.currency} />
                      {/*
                        ⚠️ `font-sans` explicitly. The figure is `font-display`
                        (DM Serif Display) and this span inherits it, so the
                        word "of" rendered in a serif beside sans numerals and
                        read as a typo. `Money` sets its own face; the word
                        between does not.
                      */}
                      <span className="ml-1.5 font-sans text-sm font-normal text-muted-foreground">
                        of <Money minor={c.goalAmount} currency={c.currency} />
                      </span>
                    </p>

                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-brand-teal transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <p className="mt-1.5 text-xs text-muted-foreground">
                      <span className="capitalize">{c.category}</span>
                      {' · '}
                      {c.donorCount} donors
                      {' · '}
                      {formatDate(c.createdAt)}
                    </p>

                    {/*
                      COMPACT on a list. The consequence sentence is identical
                      on every row, so at ten campaigns it is ten copies of one
                      fact - read as wallpaper rather than as a warning. It
                      renders in full on the screens that show one campaign.
                    */}
                    <NextStepRow
                      compact
                      facts={{
                        campaignId: c.id,
                        status: c.status,
                        verificationStatus: c.verificationStatus,
                        currency: c.currency,
                      }}
                    />

                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                      <Link
                        href={`/dashboard/campaigns/${c.id}`}
                        className="rounded-lg bg-foreground/5 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-foreground/10"
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
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
                          className="ml-auto rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
