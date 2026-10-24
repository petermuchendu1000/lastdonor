/**
 * The pre-verification fundraising cap.
 *
 * WHAT THIS IS FOR
 *
 * Money OUT of the platform has always been gated on verification:
 * `src/app/api/v1/user-campaigns/[id]/withdraw/route.ts` refuses a withdrawal
 * unless the campaign is `fully_verified`, re-read under a row lock, and
 * `createTransfer` in `src/lib/stripe-connect.ts` has exactly that one caller.
 *
 * Money IN was not gated at all. The three donation entry points filter on
 * campaign STATUS only - never on verification - so an unverified campaign
 * could take an unbounded amount and only discover at payout time that it
 * could not be paid. On 2026-10-24 production held 13 `active` campaigns, all
 * of them `unverified`.
 *
 * So this is the matching control on the way in: an unverified campaign may
 * raise up to a per-currency cap, and must be verified to go past it.
 *
 * THE FIGURE IS MEASURED OVER REAL DONATIONS ONLY
 *
 * Callers must pass `realRaisedMinor` summed from `donations` where
 * `source = 'real' AND refunded = false`, the same way the lump-sum release
 * computes its figure in
 * `src/app/api/v1/admin/campaigns/[campaignId]/verification/route.ts`.
 *
 * Do NOT pass `campaigns.raised_amount`. That column is BLENDED: the
 * simulation engine increments it for `source = 'seed'` rows which are
 * fabricated and carry no money. A cap read off it would let seed money lock
 * a campaign out of real donations - the same class of bug that made the
 * release path release seeded totals before it was fixed.
 *
 * THIS MODULE IS DELIBERATELY db-FREE
 *
 * No `db` import, no `server-only`, so the arithmetic is unit-testable and
 * mutation-testable on its own. The query that feeds it is a scalar subquery
 * inside each route's existing campaign SELECT, which adds no round trip and
 * no concurrency (the pool fan-out ratchet caps a request at 3 concurrent
 * queries).
 */

import { getCurrency, isSupportedCurrency } from '@/lib/money/currencies';
import { formatMoney } from '@/lib/money/format';

/**
 * Verification states that lift the cap.
 *
 * Exactly the two an admin approval can produce: `approve_t1` writes
 * `identity_verified` and `approve_t2` writes `fully_verified`
 * (`src/components/admin/VerificationQueue.tsx`). Both mean a person has
 * looked at the organiser's documents, which is the thing the cap is standing
 * in for.
 *
 * `verified` is also in the `verification_status` enum and is NOT listed here,
 * because no code path in this repository ever writes it - checked across
 * every `verificationStatus:` assignment on 2026-10-24. A test pins this list
 * so that if someone starts writing `verified`, they are forced to decide
 * whether it lifts the cap rather than silently inheriting an answer.
 */
export const CAP_EXEMPT_VERIFICATION_STATUSES = [
  'identity_verified',
  'fully_verified',
] as const;

export function isCapExempt(verificationStatus: string): boolean {
  return (CAP_EXEMPT_VERIFICATION_STATUSES as readonly string[]).includes(
    verificationStatus,
  );
}

export type RaiseCapInput = {
  /** `campaigns.verification_status`. */
  verificationStatus: string;
  /** SUM of real, un-refunded donations in minor units. NOT `raised_amount`. */
  realRaisedMinor: number;
  /** `campaigns.currency`. */
  currency: string;
};

export type RaiseCapDecision =
  | { allowed: true; remainingMinor: number }
  | {
      allowed: false;
      /** `CAP_REACHED` = no valid donation is possible. `CAP_EXCEEDED` = this one is too big. */
      code: 'CAP_REACHED' | 'CAP_EXCEEDED';
      message: string;
      remainingMinor: number;
    };

/**
 * Decide whether a campaign may accept `amountMinor` more.
 *
 * Rejects a donation that would CROSS the cap, not merely one offered after
 * the cap is already full. That distinction matters: `maxDonationMinor` is
 * 10,000,000 for USD against a 50,000 cap, so a single donation can exceed
 * the cap 200-fold, and a check written as `realRaised < cap` would wave it
 * through.
 */
export function checkRaiseCap(
  input: RaiseCapInput,
  amountMinor: number,
): RaiseCapDecision {
  if (isCapExempt(input.verificationStatus)) {
    return { allowed: true, remainingMinor: Number.POSITIVE_INFINITY };
  }

  // An unknown currency is not this function's error to report - the routes
  // refuse it earlier with their own message - but never cap on a guess.
  if (!isSupportedCurrency(input.currency)) {
    return { allowed: true, remainingMinor: Number.POSITIVE_INFINITY };
  }

  const def = getCurrency(input.currency);
  const cap = def.unverifiedCapMinor;

  // The rollback lever: a cap of Infinity disables the control for a currency.
  if (!Number.isFinite(cap)) {
    return { allowed: true, remainingMinor: Number.POSITIVE_INFINITY };
  }

  const remainingMinor = Math.max(0, cap - input.realRaisedMinor);

  /*
    Two distinct refusals, because they need different words.

    If what is left is smaller than the smallest donation this currency
    accepts, there is no amount the donor could type that would succeed.
    Telling them "you can still give up to KES 30" when the floor is KES 50
    offers them an amount the validator will then reject. So that case is
    CAP_REACHED - the campaign is closed to donations until it is verified -
    even though `remainingMinor` is not literally zero.
  */
  if (remainingMinor < def.minDonationMinor) {
    return {
      allowed: false,
      code: 'CAP_REACHED',
      remainingMinor,
      message:
        `This campaign has raised all it can for now. It can accept up to ` +
        `${formatMoney(cap, def.code, 'exact')} before the organiser's ID is checked. ` +
        `Nothing has been charged.`,
    };
  }

  if (amountMinor > remainingMinor) {
    return {
      allowed: false,
      code: 'CAP_EXCEEDED',
      remainingMinor,
      message:
        `This campaign can take ${formatMoney(remainingMinor, def.code, 'exact')} more for now. ` +
        `It can accept up to ${formatMoney(cap, def.code, 'exact')} before the organiser's ID ` +
        `is checked. Try a smaller amount. Nothing has been charged.`,
    };
  }

  return { allowed: true, remainingMinor };
}
