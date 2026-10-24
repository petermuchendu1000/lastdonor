/**
 * An approximate amount in another currency.
 *
 * ── THIS IS AN INDICATION, AND IT SAYS SO ───────────────────────────────────
 *
 * Every converted figure on this site renders through here, and it always
 * carries three things:
 *
 *   1. the word "about", so it never reads as the amount charged,
 *   2. the date the rate was published, because a money figure a reader
 *      cannot date is worse than no figure,
 *   3. the provider attribution, which is a REQUIREMENT of the open
 *      endpoint's terms (https://www.exchangerate-api.com/docs/free, read
 *      2026-10-24), not a courtesy.
 *
 * `src/lib/money/fx-display-only.ratchet.test.ts` asserts the attribution is
 * present, because an attribution that can be dropped without a test failing
 * will eventually be dropped.
 *
 * Renders NOTHING when the snapshot is missing, stale, or does not cover the
 * pair. See `convertMinor` - staleness is a refusal, not a warning.
 */

import { formatMoney } from '@/lib/money/format';
import { convertMinor } from '@/lib/money/fx-convert';
import { FX_ATTRIBUTION, type FxSnapshot } from '@/lib/money/fx-providers';
import { cn } from '@/lib/utils';

type ApproxMoneyProps = {
  /** Amount in the SOURCE currency's minor units. */
  minor: number;
  fromCurrency: string;
  toCurrency: string;
  /** `null` when no usable snapshot is stored - the component renders nothing. */
  snapshot: FxSnapshot | null;
  className?: string;
  /** Hide the "rates by..." line when several of these sit together. */
  hideAttribution?: boolean;
};

export function ApproxMoney({
  minor,
  fromCurrency,
  toCurrency,
  snapshot,
  className,
  hideAttribution,
}: ApproxMoneyProps) {
  if (!snapshot) return null;

  const converted = convertMinor(snapshot, {
    amountMinor: minor,
    fromCurrency,
    toCurrency,
  });
  if (converted === null) return null;

  const rateDate = new Date(snapshot.asOf);
  const rateDay = Number.isNaN(rateDate.getTime())
    ? null
    : rateDate.toISOString().slice(0, 10);

  return (
    <span className={cn('text-sm text-muted-foreground', className)}>
      <span className="tabular-nums">
        about {formatMoney(converted, toCurrency, 'whole')}
      </span>
      {rateDay && <span className="ml-1 text-xs">at the {rateDay} rate</span>}
      {!hideAttribution && (
        <>
          {' · '}
          <a
            href={FX_ATTRIBUTION.href}
            rel="noopener noreferrer nofollow"
            target="_blank"
            className="text-xs underline decoration-dotted hover:text-foreground"
          >
            {FX_ATTRIBUTION.label}
          </a>
        </>
      )}
    </span>
  );
}
