import { z } from 'zod';

/** Strip HTML tags from text input. Mirrors `validators/donation.ts`. */
function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim();
}

/**
 * The body of `POST /api/v1/donations/payhero/initiate`.
 *
 * Deliberately close to `createIntentSchema` so a donor's context is the same
 * on both rails, with two differences:
 *
 *  - **`phone` instead of card details.** The number is what the PIN prompt
 *    goes to, so it is required. It is validated here only for shape; the
 *    route normalises it through `src/lib/phone.ts` against our own region,
 *    because a provider that infers the country will dial a local US number
 *    as a Kenyan one (`docs/84`).
 *
 *  - **No `isRecurring`.** An M-Pesa STK push is a single authorised debit,
 *    not a mandate. There is nothing behind it to charge again, so accepting
 *    the flag would mean accepting a promise the rail cannot keep.
 *
 * `amount` carries no bounds here. They are per currency
 * (`CURRENCIES[code].minDonationMinor`) and the campaign decides the
 * currency, so the route checks them with `checkDonationAmount` once it knows
 * which campaign is being funded. Putting a literal here would have
 * reintroduced exactly the USD-cents assumption migration 0005 removed.
 */
export const initiateMpesaSchema = z.object({
  campaignId: z.string().uuid('Campaign ID must be a valid UUID'),
  amount: z
    .number()
    .int('Amount must be a whole number')
    .positive('Enter an amount greater than zero'),
  /**
   * Anything a person typed. Length-bounded only: a real check needs
   * libphonenumber and the platform's region, which is the route's job.
   */
  phone: z
    .string()
    .trim()
    .min(7, 'Enter the M-Pesa number to charge')
    .max(20, 'That does not look like a phone number'),
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
  subscribedToUpdates: z.boolean().default(false),
});

export type InitiateMpesaInput = z.infer<typeof initiateMpesaSchema>;

/** The query of `GET /api/v1/donations/payhero/status`. */
export const payheroStatusQuerySchema = z.object({
  /**
   * OUR reference, never PayHero's.
   *
   * The poll route resolves this against a row this platform wrote, so a
   * caller can only ask about a payment that exists here. Handing PayHero's
   * own reference straight to their status endpoint would let anyone read any
   * transaction on a PayHero account shared with another company.
   */
  reference: z
    .string()
    .trim()
    .min(1, 'A payment reference is required')
    .max(80, 'That is not a payment reference'),
});
