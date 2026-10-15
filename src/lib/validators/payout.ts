import { z } from 'zod';

// ─── Payout currency invariant ───────────────────────────────────────────────

/**
 * The only currency the platform can pay out in.
 *
 * Every inbound charge is created with currency 'usd', so the `amount` columns
 * (donations.amount, campaigns.total_released_amount,
 * campaigns.total_withdrawn_amount, campaign_withdrawals.amount) are USD cents
 * throughout. There is no FX conversion anywhere in this codebase, so handing
 * those integers to transfers.create under another currency code silently
 * reinterprets them: 100000 as 'mxn' pays MX$1,000 (~US$55) rather than
 * US$1,000, and 'jpy' is zero-decimal so it is 100x out in the other
 * direction. Withdrawals in any other currency are refused, not converted.
 *
 * This lives here, rather than in `@/lib/stripe-connect`, because that module
 * imports the Stripe SDK and cannot be pulled into a client component or a
 * unit test that mocks it. `@/lib/stripe-connect` re-exports both of these.
 */
export const PLATFORM_PAYOUT_CURRENCY = 'usd';

/** True when a connected account's settlement currency matches the ledger. */
export function isSupportedPayoutCurrency(currency: string | null | undefined): boolean {
  return (currency ?? PLATFORM_PAYOUT_CURRENCY).toLowerCase() === PLATFORM_PAYOUT_CURRENCY;
}

/**
 * Validates the request to create a Stripe Connect Express account.
 * Country is optional; defaults to Stripe's inference from IP/locale.
 */
export const createConnectAccountSchema = z.object({
  country: z
    .string()
    .length(2, 'Country must be a 2-letter ISO code')
    .toUpperCase()
    .optional(),
});

/**
 * Validates a withdrawal request from a campaign creator.
 * Amount is in USD cents (see PLATFORM_PAYOUT_CURRENCY in @/lib/stripe-connect:
 * every inbound charge is in USD, so the ledger is USD cents end to end).
 *
 * `idempotencyKey` is REQUIRED and is the only thing standing between a
 * double-clicked Withdraw button and two real Stripe transfers. Clients must
 * mint it once per form-fill (not per click) and resend the same value on
 * retry. The message is written for the campaigner, because the route surfaces
 * the first validation message verbatim.
 */
export const withdrawalRequestSchema = z.object({
  amount: z
    .number()
    .int('Amount must be a whole number (cents)')
    .positive('Amount must be greater than zero'),
  idempotencyKey: z
    .string()
    .uuid('This withdrawal request is missing its safety key. Please refresh the page and try again.'),
});
