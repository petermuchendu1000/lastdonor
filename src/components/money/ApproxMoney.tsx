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
 *
 * ⚠️ Which is why a LABEL for this figure belongs INSIDE it, as the `label`
 * prop, and never beside it in the caller's markup. `/campaigns/[slug]` wrote
 * `<span>Goal is </span><LocalAmount .../>`, and since a USD campaign viewed
 * from the United States converts into itself - which tells the reader
 * nothing, so it renders nothing - the public campaign page showed a dangling
 * "Goal is" followed by empty space. Every production campaign is USD.
 *
 * Same family as `docs/104`: a thing that renders nothing by design is
 * invisible until somebody looks at it in a browser, and anything left
 * outside it does not disappear with it.
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
  /**
   * Text to print before the figure, which disappears WITH it.
   *
   * See the header: a label rendered by the caller survives a component that
   * renders nothing, and leaves a sentence with no end.
   */
  label?: string;
};

export function ApproxMoney({
  minor,
  fromCurrency,
  toCurrency,
  snapshot,
  className,
  hideAttribution,
  label,
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
      {label && <span>{label} </span>}
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
