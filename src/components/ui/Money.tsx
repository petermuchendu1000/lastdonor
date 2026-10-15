import { cn } from '@/lib/utils';
import { centsToDollars, centsToDollarsWhole } from '@/lib/utils/currency';

interface MoneyProps {
  /** Amount in cents. */
  cents: number;
  /**
   * `whole` drops the cents ($1,250) and is the default for every donor-facing
   * total, goal and preset. `exact` keeps them ($1,250.00) and is for receipts
   * and ledgers, where the trailing digits carry meaning.
   */
  precision?: 'whole' | 'exact';
  className?: string;
}

/**
 * The single place currency is rendered to donors.
 *
 * Two rules it exists to enforce, both of which were being broken (see
 * `docs/47-MONEY-TYPOGRAPHY-AND-ZERO-STATE-ADR.md`):
 *
 * 1. Money is set in the body sans, never the mono face. Mono reads as a code
 *    literal; a donation is not a code literal.
 * 2. `tabular-nums` is always on, so stacked figures align on the decimal and a
 *    live-updating total does not jitter as digits change width.
 */
export function Money({ cents, precision = 'whole', className }: MoneyProps) {
  const text = precision === 'whole'
    ? centsToDollarsWhole(cents)
    : centsToDollars(cents);

  return (
    <span className={cn('font-sans tabular-nums', className)}>{text}</span>
  );
}
