/**
 * How each payment rail is named to a reader, and which rails can collect.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * `docs/152` put a processor name into five public policy sentences, because
 * naming a sub-processor on a policy page is a compliance disclosure rather
 * than a marketing claim. Each was written by hand:
 *
 *   - `/privacy` — the sharing list, and the security paragraph
 *   - `/refund-policy` — the payment-details bullet
 *   - `/terms` — the donations clause
 *   - `/fund-release-policy` — the processing bullet
 *
 * Then `docs/185` moved ONE line in the currency table and **all five became
 * false at once**: they credited PayHero with processing M-Pesa payments that
 * now go to Palpluss.
 *
 * ⚠️ **The existing guards could not all see it**, which is the part worth
 * knowing. `collection-rails.test.ts` and `refund-rails.test.ts` both spell an
 * M-Pesa rail as `/\bPayHero\b|\bM-?Pesa\b/i`, and that alternative is right
 * for the surfaces those rules were written for: a donor reading how their
 * refund arrives needs the word **M-Pesa**, not the name of a company they
 * have never heard of. But it means neither rule can tell one M-Pesa rail
 * from another, so *"M-Pesa payments by PayHero"* satisfies a rule asking
 * about Palpluss — and `/terms` and `/fund-release-policy` stayed green while
 * false. `no-dead-processor.test.ts` is the rule that can see it, and this
 * module is the one map all three read.
 *
 * ── ⛔ The sentences are LITERAL PROSE, and deriving them was tried and
 *       BACKED OUT ───────────────────────────────────────────────────────
 *
 * The obvious fix is to render those five sentences from the functions here,
 * so the flip could never make them stale. It was built, and the anti-vacuity
 * row of `collection-rails.test.ts` immediately reported *"no collection
 * claim found anywhere - the matcher is broken"*: that sweep reads page source
 * as TEXT, so moving the prose into `{cardProviderName()}` expressions took
 * the only claims in the corpus out of its sight. The rule went vacuous and
 * would have protected nothing.
 *
 * That is `docs/184` §3 in a different costume — there, a
 * `` `…/${rail}/status` `` template would have disarmed the guard written to
 * arm on that very change. **A derivation that hides the subject from the
 * instrument is not an improvement.** So the prose stays readable and
 * literal, five hand edits are accepted as the cost of the next flip, and the
 * BUILD FAILING until they are made is the actual protection.
 */

import type { CurrencyDefinition } from '@/lib/money/currencies';
import { SUPPORTED_CURRENCY_CODES, getCurrency } from '@/lib/money/currencies';

/**
 * How each gateway is named to a reader.
 *
 * ⛔ A `Record` over the gateway union, so a fourth gateway fails the build
 * until somebody decides what it is called in public — `docs/144`'s rule, and
 * the same reason `RAIL_WORDS` on the donate page is one. Two guards used to
 * carry their own copy of this map and `collection-rails.test.ts` indexed it
 * without checking the key existed, so the flip crashed it with
 * `Cannot read properties of undefined` instead of naming the gap.
 */
export const PAYMENT_PROVIDER_NAME: Record<CurrencyDefinition['gateway'], string> =
  Object.freeze({
    stripe: 'Stripe',
    payhero: 'PayHero',
    palpluss: 'Palpluss',
  });

/** Every gateway some collectable currency routes to. */
export function collectingGateways(): CurrencyDefinition['gateway'][] {
  return [
    ...new Set(SUPPORTED_CURRENCY_CODES.map((code) => getCurrency(code).gateway)),
  ].sort();
}

/**
 * Every gateway this codebase knows how to name that collects NOTHING.
 *
 * The set a public page must not credit with processing anything. Since
 * `docs/185` that is exactly `['payhero']` — a rail that works, is fully
 * built, has taken every shilling this platform holds, and is one line in the
 * currency table away from collecting again.
 */
export function deadGateways(): CurrencyDefinition['gateway'][] {
  const live = new Set(collectingGateways());
  return (Object.keys(PAYMENT_PROVIDER_NAME) as CurrencyDefinition['gateway'][])
    .filter((g) => !live.has(g))
    .sort();
}
