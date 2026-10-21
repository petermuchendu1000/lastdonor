import { z } from 'zod';
import { getCurrency, isSupportedCurrency } from '@/lib/money/currencies';
import { formatMoney } from '@/lib/money/format';

/**
 * Strip HTML tags from text input.
 */
function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim();
}

// ─── Per-currency amount bounds ─────────────────────────────────────────────

/**
 * Check a donation amount against its own currency's bounds.
 *
 * The bounds used to be two literals on `createIntentSchema` below (500 and
 * 10,000,000) and a `CHECK (amount >= 500)` in the database. Both were USD
 * cents. They now live in `CURRENCIES[code]`, because 500 KES minor units is
 * about US$0.04 — so one shared floor is either nonsense for KES or
 * prohibitive for USD, and the database CHECK could not tell which currency a
 * row was in anyway (migration 0005 relaxed it to `amount > 0`).
 *
 * @returns `null` when the amount is acceptable, otherwise a message written
 *          for the donor, with the figure rendered in their own currency.
 */
export function checkDonationAmount(
  amountMinor: number,
  currency: string,
): string | null {
  if (!isSupportedCurrency(currency)) {
    return 'This campaign is in a currency we cannot take payments in yet.';
  }
  if (!Number.isInteger(amountMinor)) {
    return 'Enter a whole amount.';
  }

  const def = getCurrency(currency);
  if (amountMinor < def.minDonationMinor) {
    return `The smallest donation is ${formatMoney(def.minDonationMinor, def.code, 'exact')}.`;
  }
  if (amountMinor > def.maxDonationMinor) {
    return `The largest donation is ${formatMoney(def.maxDonationMinor, def.code, 'exact')}.`;
  }
  return null;
}

/**
 * The USD/Stripe checkout validator.
 *
 * Its bounds are deliberately left as USD literals rather than made
 * currency-aware: this schema serves `create-checkout` and `create-intent`,
 * both of which create a Stripe charge, and Stripe is the USD rail. The
 * currency-correctness guard for those routes is at a different level — they
 * refuse a campaign whose currency is not collected by Stripe at all, so a KES
 * campaign can never reach these bounds. Non-USD amounts are validated by
 * `checkDonationAmount` on their own rail.
 */
export const createIntentSchema = z.object({
  campaignId: z.string().uuid('Campaign ID must be a valid UUID'),
  amount: z
    .number()
    .int('Amount must be a whole number (cents)')
    .min(500, 'Minimum donation is $5.00')
    .max(10_000_000, 'Maximum donation is $100,000'),
  donorName: z.string().trim().max(100, 'Name must be under 100 characters').optional(),
  donorEmail: z.string().trim().toLowerCase().email('Enter a valid email address'),
  donorLocation: z.string().trim().max(100, 'Location must be under 100 characters').optional(),
  message: z
    .string()
    .max(500, 'Message must be 500 characters or fewer')
    .transform(stripHtml)
    .pipe(z.string().max(500, 'Message must be 500 characters or fewer'))
    .optional(),
  isAnonymous: z.boolean().default(false),
  isRecurring: z.boolean().default(false),
  subscribedToUpdates: z.boolean().default(false),
  idempotencyKey: z.string().uuid('Idempotency key must be a valid UUID').optional(),
});

export type CreateIntentInput = z.infer<typeof createIntentSchema>;
