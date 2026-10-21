import { cn } from '@/lib/utils';
import { formatMoney, type MoneyPrecision } from '@/lib/money/format';

interface MoneyProps {
  /**
   * Amount in the MINOR units of `currency` — cents for USD and KES, but
   * whole units for a zero-decimal currency.
   *
   * Named `minor` rather than `cents` since 2026-10-21. "Cents" was accurate
   * while the ledger was USD-only, and becomes a 100x lie the moment a
   * zero-decimal currency is enabled (UGX, RWF, XOF and XAF are all in the
   * intended footprint). The rename is cheap now and would not be later.
   */
  minor: number;
  /**
   * ISO 4217 code. Defaults to USD because every amount rendered before
   * multi-currency was a dollar amount and every one of those call sites is
   * still correct.
   *
   * **Pass it explicitly for anything read off a campaign, donation or
   * withdrawal row.** Those carry their own currency now, and relying on the
   * default is how a shilling figure gets a dollar sign. `money-currency.ratchet.test.ts`
   * fails the build if a call site reads an amount from such a row without
   * also passing its currency.
   */
  currency?: string;
  /**
   * `whole` drops the minor units ($1,250) and is the default for every
   * donor-facing total, goal and preset. `exact` keeps them ($1,250.00) and is
   * for receipts and ledgers, where the trailing digits carry meaning.
   */
  precision?: MoneyPrecision;
  className?: string;
}

/**
 * The single place currency is rendered to donors.
 *
 * Three rules it exists to enforce. The first two were being broken when it
 * was introduced (see `docs/47-MONEY-TYPOGRAPHY-AND-ZERO-STATE-ADR.md`); the
 * third arrived with the KES rail (`docs/92`):
 *
 * 1. Money is set in the body sans, never the mono face. Mono reads as a code
 *    literal; a donation is not a code literal.
 * 2. `tabular-nums` is always on, so stacked figures align on the decimal and
 *    a live-updating total does not jitter as digits change width.
 * 3. An amount is rendered in its own currency, through the registry, so the
 *    symbol and the number of decimal places both come from the currency
 *    rather than from an assumption about dollars.
 */
export function Money({ minor, currency = 'USD', precision = 'whole', className }: MoneyProps) {
  return (
    <span className={cn('font-sans tabular-nums', className)}>
      {formatMoney(minor, currency, precision)}
    </span>
  );
}
