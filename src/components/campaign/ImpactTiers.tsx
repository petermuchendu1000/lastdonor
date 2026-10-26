'use client';

import { ArrowRightIcon } from '@heroicons/react/24/solid';
import { cn } from '@/lib/utils';
import { Money } from '@/components/ui/Money';
import { formatMoney } from '@/lib/money/format';
import type { ImpactTier } from '@/types';

interface ImpactTiersProps {
  tiers: ImpactTier[];
  /**
   * The campaign's own currency.
   *
   * ⛔ Required, not defaulted - the same call the `StickyMobileDonateBar`
   * test makes. The tier amounts are in the minor units of THIS currency
   * (`docs/92`), and `CampaignSidebarClient` already had it in scope and
   * simply did not pass it: the visible figure fell through to `<Money>`'s
   * USD default while the accessible name was built by `centsToDollarsWhole`,
   * so a shilling tier announced itself as dollars twice over, by two
   * different routes that could also disagree with each other.
   */
  currency: string;
  onSelectAmount?: (amountCents: number) => void;
  className?: string;
}

export function ImpactTiers({ tiers, currency, onSelectAmount, className }: ImpactTiersProps) {
  if (tiers.length === 0) return null;

  return (
    <div className={cn('space-y-3', className)}>
      <h3 className="font-display text-lg font-semibold text-card-foreground">
        Choose your impact
      </h3>

      <div className="grid gap-2">
        {tiers.map((tier) => (
          <button
            key={`${tier.amount}-${tier.label}`}
            type="button"
            onClick={() => onSelectAmount?.(tier.amount)}
            aria-label={`Donate ${formatMoney(tier.amount, currency)}: ${tier.label}`}
            className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted"
          >
            <div className="flex min-w-0 items-baseline gap-3">
              <Money
                minor={tier.amount}
                currency={currency}
                className="text-lg font-bold text-foreground"
              />
              <span className="truncate text-sm text-muted-foreground">
                {tier.label}
              </span>
            </div>
            <ArrowRightIcon
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
