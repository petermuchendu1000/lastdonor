'use client';

import { useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Money } from '@/components/ui/Money';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { cn } from '@/lib/utils';
import { usePollingList } from '@/hooks/usePollingList';

export interface DonorFeedItem {
  id: string;
  donorName: string;
  donorLocation: string | null;
  amount: number;
  /**
   * The currency the donation was made in.
   *
   * ⛔ Required, not defaulted. This feed rendered a bare
   * `<Money minor={donor.amount} />`, which falls through to `<Money>`'s USD
   * default, so a KES 2,500.00 gift appeared on the public campaign page as
   * **$2,500** - the row's own `donations.currency` column exists for exactly
   * this and was simply never read (`docs/92`). Same shape as the bare
   * `<Money>` the `CampaignCard` test records, and as `ImpactTiers`, which
   * had the currency in scope at its call site and did not pass it.
   */
  currency: string;
  message: string | null;
  isAnonymous: boolean;
  createdAt: string;
}

interface DonorFeedProps {
  campaignSlug: string;
  initialDonors: DonorFeedItem[];
  className?: string;
}

const POLL_INTERVAL_MS = 15_000;
const getDonorId = (d: DonorFeedItem) => d.id;

export function DonorFeed({
  campaignSlug,
  initialDonors,
  className,
}: DonorFeedProps) {
  const buildUrl = useCallback(
    ({ cursor }: { cursor?: number; after?: string }) => {
      const params = new URLSearchParams({ limit: '10' });
      if (cursor != null) params.set('cursor', String(cursor));
      return `/api/v1/campaigns/${encodeURIComponent(campaignSlug)}/donors?${params}`;
    },
    [campaignSlug],
  );

  const { items: donors } = usePollingList(initialDonors, {
    buildUrl,
    pollIntervalMs: POLL_INTERVAL_MS,
    getId: getDonorId,
    maxItems: 50,
  });

  return (
    <div className={cn('space-y-4', className)}>
      <h3 className="font-display text-lg font-semibold text-card-foreground">
        Recent Donors
      </h3>

      <div
        aria-live="polite"
        aria-atomic="false"
        className="space-y-3"
      >
        <AnimatePresence initial={false}>
          {donors.map((donor) => {
            const displayName = donor.isAnonymous ? 'Anonymous' : donor.donorName;
            return (
              <motion.div
                key={donor.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                  {donor.isAnonymous
                    ? '?'
                    : donor.donorName.charAt(0).toUpperCase()}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-card-foreground">
                      {displayName}
                    </span>
                    <Money
                      minor={donor.amount}
                      currency={donor.currency}
                      className="shrink-0 text-sm font-semibold text-foreground"
                    />
                  </div>

                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    {!donor.isAnonymous && donor.donorLocation && (
                      <span>{donor.donorLocation}</span>
                    )}
                    <RelativeTime date={donor.createdAt} />
                  </div>

                  {donor.message && (
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground italic">
                      &ldquo;{donor.message}&rdquo;
                    </p>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {donors.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Be the first to donate!
          </p>
        )}
      </div>
    </div>
  );
}
