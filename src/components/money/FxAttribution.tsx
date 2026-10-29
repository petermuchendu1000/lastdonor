'use client';

/**
 * The exchange-rate provider's credit, rendered ONCE for a page, and only
 * when a figure on that page actually converted.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `ApproxMoney` renders the credit beside every figure, as a LINK, because the
 * provider's terms require attribution wherever a rate is used
 * (`fx-providers.ts` §TERMS: the free endpoint "requires attribution"). That
 * is right for a figure in running text and wrong for a figure inside a
 * campaign card, because `CampaignCard` wraps its whole body in one `<Link>`:
 * a credit rendered there is an `<a>` inside an `<a>`.
 *
 * Measured on production (v141, 2026-10-29) at `/campaigns` from
 * `Africa/Nairobi`, with `America/New_York` as the control:
 *
 *     Nairobi    8 nested <a> inside <a>, all 8 the provider credit
 *     New York   0                                      <- control
 *     card link accessible name   211 chars  vs  127
 *     tail: "...about Ksh 649,162at the 2026-10-29 rate - Exchange rates by
 *            ExchangeRate-API"
 *
 * So a screen-reader user heard the provider credit as part of every card's
 * link name, and the DOM really was nested: the server renders nothing for a
 * USD card (`fallbackCurrency={null}`), and React inserts the credit AFTER
 * detection resolves, so the HTML parser never gets the chance to normalise
 * it. Clicking still navigated, which is why nothing else noticed.
 *
 * ⛔ The fix is NOT to drop the credit. It is a licence term, and
 * `fx-display-only.ratchet.test.ts` asserts `ApproxMoney` renders it. The
 * figures inside cards pass `hideAttribution` and the page renders this once,
 * outside every anchor - so the obligation is met in one place per page
 * instead of twelve places inside links.
 *
 * ── ⚠️ WHY IT IS A CLIENT COMPONENT AND TAKES THE SOURCE CURRENCIES ─────────
 *
 * The first version of this took only the snapshot and rendered whenever one
 * existed. That is wrong, and wrong in the direction that matters: a reader in
 * the United States looking at dollar campaigns sees NO converted figure at
 * all (`LocalAmount` refuses to convert a currency into itself), so the page
 * would have carried a credit for a rate it never used - a claim about our own
 * conduct, on a page that exists to be trusted.
 *
 * So it answers the same question the figures answer, through the same hook,
 * and renders only if at least one of the currencies on the page would convert
 * into the reader's. `useDetectedLocale` is shared rather than copied, because
 * two components holding their own copy of one global is the `docs/99` §8
 * defect.
 */

import { convertMinor } from '@/lib/money/fx-convert';
import { FX_ATTRIBUTION, type FxSnapshot } from '@/lib/money/fx-providers';
import { cn } from '@/lib/utils';
import { useDetectedLocale } from './use-detected-locale';

export function FxAttribution({
  snapshot,
  fromCurrencies,
  className,
}: {
  snapshot: FxSnapshot | null;
  /** The currencies of the figures on this page, in any order, duplicates fine. */
  fromCurrencies: readonly string[];
  className?: string;
}) {
  const detected = useDetectedLocale();

  if (!snapshot || !detected) return null;

  /*
    One probe amount, per distinct source currency. `convertMinor` is the same
    function the figures use, so this cannot disagree with them: it returns
    null for a stale snapshot, an unknown currency or a missing rate, and
    `amountMinor` itself does not change any of those answers.
  */
  const converts = [...new Set(fromCurrencies)].some(
    (from) =>
      from !== detected.currency &&
      convertMinor(snapshot, {
        amountMinor: 100,
        fromCurrency: from,
        toCurrency: detected.currency,
      }) !== null,
  );
  if (!converts) return null;

  return (
    <p className={cn('mt-3 text-xs text-muted-foreground', className)}>
      <a
        href={FX_ATTRIBUTION.href}
        rel="noopener noreferrer nofollow"
        target="_blank"
        className="underline decoration-dotted hover:text-foreground"
      >
        {FX_ATTRIBUTION.label}
      </a>
    </p>
  );
}
