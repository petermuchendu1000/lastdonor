'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Money } from '@/components/ui/Money';
import { CampaignHeroImage } from '@/components/campaign/CampaignHeroImage';
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
  /** `docs/131`: a campaign has a public page only once a person approved it. */
  publishedAt: string | null;
  category: string;
  goalAmount: number;
  raisedAmount: number;
  donorCount: number;
  heroImageUrl: string;
  verificationStatus: string;
  currency: string;
  createdAt: string;
  /**
   * What this person is to the campaign.
   *
   * ⛔ A `collaborator` row hides the organiser-only controls below. That is
   * not cosmetic: `change_payout_account` and `upload_identity` are in
   * `NEVER_DELEGATED` (`src/lib/collaborators/capabilities.ts`), the routes
   * behind them answer 403 to a helper, and showing a control that cannot
   * work is a worse failure than not showing it. See `docs/117`.
   */
  role: 'creator' | 'collaborator';
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
                    ── A CAMPAIGN IS A PHOTOGRAPH, NOT A TEXT BLOCK ───────────
                    This list rendered every campaign as grey text in a box.
                    On a FUNDRAISING platform that is the loudest amateur
                    signal there is: the organiser's own appeal, the thing
                    they chose a picture for, looked like a database row.
                    Every reference design leads a campaign row with its
                    image, and the public `CampaignCard` already does.

                    112px thumbnail, square, left. Same `CampaignHeroImage`
                    the public card uses, so broken and missing images fall
                    back the same way rather than through new code.
                  */}
                  <div className="flex gap-3">
                    <Link
                      href={`/dashboard/campaigns/${c.id}`}
                      className="relative aspect-square w-20 shrink-0 overflow-hidden rounded-lg sm:w-24"
                      tabIndex={-1}
                      aria-hidden
                    >
                      <CampaignHeroImage
                        src={c.heroImageUrl}
                        alt=""
                        category={c.category}
                        fill
                        /* The box is 80-96px wide; asking for more downloads
                           pixels it cannot show. */
                        sizes="96px"
                        className="object-cover"
                      />
                    </Link>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/dashboard/campaigns/${c.id}`}
                          className="min-w-0 font-semibold leading-snug text-foreground hover:text-brand-teal hover:underline"
                        >
                          {c.title}
                        </Link>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {/*
                            Says WHY this campaign is on their list at all. A
                            helper who sees somebody else's fundraiser among
                            "My Campaigns" with no explanation has been given
                            a puzzle, not a feature.
                          */}
                          {c.role === 'collaborator' && (
                            <Badge variant="outline" className="shrink-0">
                              Helping
                            </Badge>
                          )}
                          <Badge
                            variant={STATUS_VARIANT[c.status] ?? 'secondary'}
                            className="shrink-0"
                          >
                            {campaignStatusLabel(c.status)}
                          </Badge>
                        </div>
                      </div>

                      <p className="mt-1.5 font-display text-lg leading-none font-bold tabular-nums text-foreground">
                        <Money minor={c.raisedAmount} currency={c.currency} />
                        {/*
                          ⚠️ `font-sans` explicitly. The figure is
                          `font-display` (DM Serif Display) and this span
                          inherits it, so "of" rendered in a serif beside sans
                          numerals and read as a typo.
                        */}
                        <span className="ml-1.5 font-sans text-sm font-normal text-muted-foreground">
                          of <Money minor={c.goalAmount} currency={c.currency} />
                        </span>
                      </p>

                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-brand-teal transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        {/*
                          The percentage in words. A bar alone makes the reader
                          estimate; every reference states the number beside
                          it.
                        */}
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                          {pct}%
                        </span>
                      </div>

                      <p className="mt-1.5 text-xs text-muted-foreground">
                        <span className="capitalize">{c.category}</span>
                        {' · '}
                        {c.donorCount} donors
                      </p>

                      {/*
                        COMPACT on a list. The consequence sentence is
                        identical on every row, so ten campaigns means ten
                        copies of one fact - read as wallpaper rather than as a
                        warning. It renders in full on the screens that show
                        one campaign.
                      */}
                      {/*
                        ⛔ CREATOR ONLY. Every step of the organiser journey
                        is about getting PAID - checking an ID, choosing where
                        the money goes - and none of it is a collaborator's to
                        do or even to be nagged about (`docs/110`). Telling a
                        helper "we cannot pay out until your ID is checked"
                        would be false twice over: it is not their ID, and
                        they can never withdraw.
                      */}
                      {c.role === 'creator' && (
                        <NextStepRow
                          compact
                          facts={{
                            campaignId: c.id,
                            status: c.status,
                            verificationStatus: c.verificationStatus,
                            currency: c.currency,
                          }}
                        />
                      )}
                    </div>
                  </div>

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
                      worked and nobody could reach it, because its only link
                      was gated on a condition two later decisions made
                      unsatisfiable. The screen itself decides what to show.
                    */}
                    {/* ⛔ `change_payout_account` is NEVER_DELEGATED. */}
                    {c.role === 'creator' && (
                      <Link
                        href={`/dashboard/campaigns/${c.id}/payout-destination`}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        Where the money goes
                      </Link>
                    )}
                    {/*
                      ⛔ Only when there IS a public page. This used to render
                      for every status, so an organiser whose campaign was
                      still `under_review` clicked "View" on their own
                      dashboard and got a 404 (docs/109).
                    */}
                    {hasPublicPage({ status: c.status, publishedAt: c.publishedAt }) && (
                      <Link
                        href={`/campaigns/${c.slug}`}
                        className="ml-auto rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        View
                      </Link>
                    )}
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
