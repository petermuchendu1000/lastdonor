'use client';

/**
 * An amount shown in the VISITOR'S own currency, detected in the browser.
 *
 * ── WHY THIS IS A CLIENT COMPONENT ──────────────────────────────────────────
 *
 * There is no server-side country signal this component can rely on. Amended
 * 2026-10-24 (docs/105): Cloudflare now proxies the apex and `www`, so those
 * requests DO carry `CF-IPCountry` - but `origin.lastdonor.org` and
 * `lastdonor.fly.dev` stay grey-cloud on purpose and carry nothing, and a
 * header that depends on which hostname the visitor arrived by is not a
 * signal. Fly adds no country header either. See the note at the top of
 * `src/lib/geo/detect-country.ts`.
 *
 * The browser does know: `Intl.DateTimeFormat().resolvedOptions().timeZone`
 * reflects where the device says it is, and `navigator.languages` may state a
 * region. Both are only available on the client.
 *
 * ── WHY IT RENDERS THE FALLBACK FIRST ───────────────────────────────────────
 *
 * Detection happens in an effect, AFTER mount. The first client render must
 * match the server's or React reports a hydration mismatch, so this renders
 * exactly what the server rendered - the `fallbackCurrency` figure - and
 * swaps to the detected currency once it knows. No flash of nothing, no
 * mismatch.
 *
 * Display only. See the boundary note in `src/lib/money/fx-convert.ts`.
 */

import { ApproxMoney } from './ApproxMoney';
import { useDetectedLocale } from './use-detected-locale';
import type { FxSnapshot } from '@/lib/money/fx-providers';

type LocalAmountProps = {
  /** Amount in the SOURCE currency's minor units. */
  minor: number;
  /** The campaign's own currency. */
  fromCurrency: string;
  /**
   * Rendered on the server and until detection resolves. Pass the currency
   * most readers can interpret - USD - or null to render nothing until the
   * browser answers.
   */
  fallbackCurrency: string | null;
  snapshot: FxSnapshot | null;
  className?: string;
  /** Printed before the figure, and omitted whenever the figure is. */
  label?: string;
  /**
   * Suppress the provider credit on THIS figure.
   *
   * ⛔ Not a styling choice, and not a way to tidy the page: the credit is a
   * LICENCE TERM (`FX_ATTRIBUTION`, `fx-providers.ts` §TERMS). Set it only
   * where the figure sits inside an `<a>` - `ApproxMoney` renders the credit
   * as a link, and a link inside a link is invalid HTML whose accessible name
   * swallows the credit - AND the page renders `<FxAttribution>` once
   * somewhere outside every anchor. `card-local-currency.test.ts` checks that
   * pairing, because unpaired this is a silent licence breach.
   */
  hideAttribution?: boolean;
};

export function LocalAmount({
  minor,
  fromCurrency,
  fallbackCurrency,
  snapshot,
  className,
  label,
  hideAttribution,
}: LocalAmountProps) {
  /*
    Shared with `FxAttribution`, which has to render exactly when a figure
    here does. It used to be an effect inline in this component; copying it
    into the second consumer is the `docs/99` §8 defect (two components, one
    global, two copies).
  */
  const detected = useDetectedLocale();

  /*
    Converting a currency into itself tells the reader nothing, so a visitor
    in Kenya reading a KES appeal sees no approximation at all - which is
    correct, the figure above it is already in their money.
  */
  const target =
    detected && detected.currency !== fromCurrency
      ? detected.currency
      : detected
        ? null
        : fallbackCurrency;

  if (!target) return null;

  return (
    <ApproxMoney
      minor={minor}
      fromCurrency={fromCurrency}
      toCurrency={target}
      snapshot={snapshot}
      className={className}
      label={label}
      hideAttribution={hideAttribution}
    />
  );
}
