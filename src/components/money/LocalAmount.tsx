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

import { useEffect, useState } from 'react';
import { ApproxMoney } from './ApproxMoney';
import { detectLocale, type DetectedLocale } from '@/lib/geo/detect-country';
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
};

export function LocalAmount({
  minor,
  fromCurrency,
  fallbackCurrency,
  snapshot,
  className,
  label,
}: LocalAmountProps) {
  const [detected, setDetected] = useState<DetectedLocale | null>(null);

  useEffect(() => {
    let timeZone: string | null = null;
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    } catch {
      // A browser that cannot report its zone is not an error worth showing.
      timeZone = null;
    }
    const languageTags = Array.isArray(navigator.languages)
      ? [...navigator.languages]
      : navigator.language
        ? [navigator.language]
        : [];

    setDetected(detectLocale({ timeZone, languageTags }));
  }, []);

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
    />
  );
}
