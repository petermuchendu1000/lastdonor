'use client';

import Link from 'next/link';
import { ProgressBar } from '@/components/campaign/ProgressBar';
import { SidebarShareButton } from '@/components/campaign/SidebarShareButton';
import { Money } from '@/components/ui/Money';

import { cn } from '@/lib/utils';
import {
  LockClosedIcon,
  HeartIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/solid';

interface SidebarDonationSummaryProps {
  raisedAmount: number;
  goalAmount: number;
  /**
   * The campaign's own currency.
   *
   * ⛔ Required, never defaulted. `<Money>` itself defaults to USD, so a call
   * site that LOOKS correct renders a dollar sign on a shilling campaign -
   * which is exactly what this file did. Every amount column is in the minor
   * units of its row's currency (`docs/92`).
   */
  currency: string;
  donorCount: number;
  donateHref: string;
  shareUrl: string;
  shareTitle: string;
  /** Lets a signed-in sharer get an attributed `/s/<token>` link. */
  campaignSlug?: string;
  className?: string;
}

export function SidebarDonationSummary({
  raisedAmount,
  goalAmount,
  currency,
  donorCount,
  donateHref,
  shareUrl,
  shareTitle,
  campaignSlug,
  className,
}: SidebarDonationSummaryProps) {
  const percent = goalAmount > 0
    ? Math.min(Math.round((raisedAmount / goalAmount) * 100), 100)
    : 0;
  // A campaign with no money yet is the common case on this platform, because
  // seeded donations are gated off (docs/33, docs/41). It gets its own
  // treatment rather than rendering a row of zeroes — see docs/47.
  const isUnfunded = raisedAmount === 0;

  return (
    <div
      className={cn(
        'space-y-5 rounded-2xl border border-border bg-card p-6',
        className,
      )}
    >
      {isUnfunded ? (
        <div>
          <p className="font-display text-xl font-bold leading-snug text-card-foreground">
            Be the first to donate
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            This campaign is reviewed and ready. Your gift is the one that gets
            it moving, and it shows up on this page straight away.
          </p>
        </div>
      ) : (
        <div>
          <div className="flex items-baseline gap-2">
            <Money
              minor={raisedAmount}
              currency={currency}
              className="text-3xl font-bold text-card-foreground"
            />
            <span className="text-sm text-muted-foreground">raised</span>
          </div>
          <p className="mt-0.5 font-sans text-xs tabular-nums text-muted-foreground">
            <span className="font-semibold text-foreground">{percent}%</span>
            {' of '}
            <Money minor={goalAmount} currency={currency} />
            {' goal'}
          </p>
        </div>
      )}

      {isUnfunded ? (
        /*
          Goal first, then the bar. An empty bar sitting above the figure it
          measures reads as a loading skeleton rather than as progress.
        */
        <div className="space-y-2">
          <p className="font-sans text-sm tabular-nums text-muted-foreground">
            <span className="font-semibold text-foreground">
              <Money minor={goalAmount} currency={currency} />
            </span>
            {' goal'}
          </p>
          <ProgressBar raisedAmount={raisedAmount} goalAmount={goalAmount} />
        </div>
      ) : (
        <div className="space-y-2">
          <ProgressBar raisedAmount={raisedAmount} goalAmount={goalAmount} />
          <p className="text-sm text-muted-foreground">
            {donorCount.toLocaleString()} {donorCount === 1 ? 'donor' : 'donors'}
          </p>
        </div>
      )}

      <div className="space-y-2.5">
        <Link
          href={donateHref}
          className="btn-press block w-full rounded-full bg-accent py-3.5 text-center text-base font-bold text-accent-foreground shadow-md transition-all hover:bg-accent/90"
        >
          Donate now
        </Link>

        {/*
          Share sits directly under Donate as a co-equal action. A campaign
          reaches its second ring of contacts through shares, not through
          search — see docs/30 §1, where an attributed share loop is identified
          as the competitor's growth engine rather than a feature.
        */}
        <SidebarShareButton
          url={shareUrl}
          title={shareTitle}
          campaignSlug={campaignSlug}
        />
      </div>

      {isUnfunded && (
        <p className="text-center text-xs text-muted-foreground">
          Not ready to give? Sharing this page costs nothing and reaches people
          who can.
        </p>
      )}

      <ul className="grid grid-cols-3 gap-2 text-[10.5px] font-medium text-muted-foreground">
        <li className="flex flex-col items-center gap-1 text-center">
          <LockClosedIcon className="h-4 w-4" aria-hidden="true" />
          {/*
            ⛔ Was "Stripe secured" (`docs/116` §5): a security claim naming a
            processor that cannot take a payment here (`docs/72`), on a
            platform whose every donation arrived over M-Pesa (`docs/92`).
            Names the property, not a vendor - see `Footer.tsx` for the trace.
          */}
          <span>Card-safe checkout</span>
        </li>
        <li className="flex flex-col items-center gap-1 text-center">
          <HeartIcon className="h-4 w-4" aria-hidden="true" />
          <span>0% platform fees</span>
        </li>
        <li className="flex flex-col items-center gap-1 text-center">
          <ShieldCheckIcon className="h-4 w-4" aria-hidden="true" />
          <span>Reviewed</span>
        </li>
      </ul>
    </div>
  );
}
