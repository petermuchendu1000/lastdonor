'use client';

import Link from 'next/link';
import { ProgressBar } from '@/components/campaign/ProgressBar';
import { Money } from '@/components/ui/Money';
import { cn } from '@/lib/utils';

interface StickyMobileDonateBarProps {
  raisedAmount: number;
  goalAmount: number;
  /**
   * The campaign's own currency.
   *
   * ⛔ Required, not defaulted. This bar used `centsToDollarsWhole`, which
   * hardcodes USD, while every amount column is in the MINOR UNITS OF ITS
   * ROW'S CURRENCY (`docs/92`). On a KES campaign it printed "$31,600 to go"
   * directly beneath a badge correctly reading "Ksh 50,000.00".
   *
   * `docs/112` recorded this class of defect as latent because the only
   * non-USD campaign was archived and unservable. KES is the only rail that
   * actually collects money (`docs/92`), so it was never going to stay
   * latent.
   */
  currency: string;
  donateHref: string;
  className?: string;
}

export function StickyMobileDonateBar({
  raisedAmount,
  goalAmount,
  currency,
  donateHref,
  className,
}: StickyMobileDonateBarProps) {
  const percent = goalAmount > 0
    ? Math.min(Math.round((raisedAmount / goalAmount) * 100), 100)
    : 0;
  const remaining = goalAmount > raisedAmount ? goalAmount - raisedAmount : 0;
  const isUnfunded = raisedAmount === 0;

  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 px-4 py-3 shadow-[--shadow-elevation-3] backdrop-blur lg:hidden',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {/*
            The unfunded state, which this bar was missing.

            docs/47 established that a campaign with no money yet leads with
            what it is asking for, not with a figure that reads as a dead
            page, and the sidebar on this very page says "Be the first to
            donate". This bar still said "0% funded", which is the same
            sentence docs/47 removed, on the most prominent surface of the
            page: it is fixed to the bottom of every phone screen.

            An empty progress bar is dropped with it. Above zero the bar and
            the percentage both return unchanged. See docs/71.
          */}
          {isUnfunded ? (
            <p className="text-xs">
              <span className="font-semibold text-foreground">Be the first to donate</span>
              <span className="ml-1.5 font-sans tabular-nums text-muted-foreground">
                <Money minor={goalAmount} currency={currency} /> goal
              </span>
            </p>
          ) : (
            <>
              <ProgressBar
                raisedAmount={raisedAmount}
                goalAmount={goalAmount}
                compact
              />
              <p className="mt-1 flex items-center gap-1.5 text-xs tabular-nums">
                <span className="font-semibold text-foreground">{percent}%</span>
                <span className="text-muted-foreground">funded</span>
                {remaining > 0 && (
                  <>
                    <span aria-hidden="true" className="text-border">·</span>
                    <span className="font-semibold text-muted-foreground">
                      <Money minor={remaining} currency={currency} /> to go
                    </span>
                  </>
                )}
              </p>
            </>
          )}
        </div>
        <Link
          href={donateHref}
          className="btn-press shrink-0 rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-accent-foreground shadow-md transition-all hover:bg-accent/90"
        >
          Donate
        </Link>
      </div>
    </div>
  );
}
