import { z } from 'zod';

import { COUNTRY_CURRENCY } from '@/lib/geo/country-currency.generated';
import { isSupportedCurrency } from '@/lib/money/currencies';

/**
 * Input shapes for trusted institutions and their vouches (`docs/108`).
 *
 * ── TWO THINGS HERE ARE NOT COSMETIC ────────────────────────────────────────
 *
 * `country` is checked against the generated ISO 3166-1 table (`docs/103`)
 * rather than a `/^[A-Z]{2}$/` regex. The code is shown to donors beside the
 * organisation's name, and `XX` passes a regex while naming no country at
 * all. The database CHECK keeps the regex as a floor; this is the real test.
 *
 * `website` goes through the URL allowlist shape used elsewhere: it is
 * rendered as a link on an admin screen, so `javascript:` must not survive
 * validation. Only `http:` and `https:` are accepted.
 */

export const INSTITUTION_KINDS = [
  'nonprofit',
  'faith',
  'hospital',
  'university',
  'school',
  'government',
  'employer',
  'funeral_home',
  'other',
] as const;

/**
 * Human labels for the kinds, used by the admin form and shown to donors.
 *
 * ⚠️ This list and `institution_kind` in `schema.ts` must agree, and nothing
 * in the type system makes them. `funeral_home` was added to the database
 * enum for `docs/113` and this list was not updated, so the admin form could
 * not offer it at all - a value the database accepted and no screen could
 * produce. `trust-network.kinds.test.ts` now derives the check from the enum
 * rather than retyping it (the `docs/110` §4 shape).
 */
export const INSTITUTION_KIND_LABELS: Record<(typeof INSTITUTION_KINDS)[number], string> = {
  nonprofit: 'Registered nonprofit or charity',
  faith: 'Church, mosque, temple or other place of worship',
  hospital: 'Hospital or clinic',
  university: 'University or college',
  school: 'School',
  government: 'Government office',
  employer: 'Employer',
  funeral_home: 'Funeral home or mortuary',
  other: 'Other organisation',
};

const COUNTRY_CODES = new Set(Object.keys(COUNTRY_CURRENCY));

const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => COUNTRY_CODES.has(v), 'Must be a real ISO 3166-1 country code');

const httpUrlSchema = z
  .string()
  .trim()
  .url('Must be a valid URL')
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Must be an http or https address');

export const createInstitutionSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(200, 'Name must be under 200 characters'),
  kind: z.enum(INSTITUTION_KINDS),
  country: countrySchema,
  website: httpUrlSchema.optional(),
  /**
   * The organisation's own registration number, as they state it.
   *
   * ⚠️ A CLAIM. Nothing in the platform checks it, and no screen may render
   * it as though something had - see the column comment in `schema.ts`.
   */
  registrationId: z.string().trim().max(100).optional(),
  /**
   * How the admin confirmed the organisation is real.
   *
   * Required, and at least 20 characters, because this is the trust root: an
   * institution with no account of how it was checked is an institution
   * nobody checked. Read by the next admin, never by a donor.
   */
  verificationNotes: z
    .string()
    .trim()
    .min(20, 'Say how you confirmed this organisation is real (at least 20 characters)')
    .max(2000, 'Notes must be under 2,000 characters'),
  monthlyVouchLimit: z
    .number()
    .int('Must be a whole number')
    .min(0, 'Cannot be negative')
    .max(1000, 'Cannot be more than 1,000')
    .optional(),
});

export const updateInstitutionSchema = z
  .object({
    status: z.enum(['active', 'suspended']).optional(),
    suspendedReason: z.string().trim().max(500).optional(),
    monthlyVouchLimit: z.number().int().min(0).max(1000).optional(),
    website: httpUrlSchema.optional(),
    /** Set when someone has actually checked the registration number. */
    registrationVerified: z.boolean().optional(),
    verificationNotes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change')
  .refine(
    (v) => v.status !== 'suspended' || (v.suspendedReason && v.suspendedReason.length >= 5),
    { message: 'Say why it is suspended', path: ['suspendedReason'] },
  );

export const recordVouchSchema = z.object({
  institutionId: z.string().uuid('Choose an organisation'),
  representativeName: z
    .string()
    .trim()
    .min(2, 'Who at the organisation told you this?')
    .max(200),
  representativeRole: z
    .string()
    .trim()
    .min(2, 'What is their role there?')
    .max(200),
  representativeEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email('Must be a valid email address')
    .max(320),
  relationship: z
    .string()
    .trim()
    .min(10, 'How does the organisation know this family? (at least 10 characters)')
    .max(1000),
  statement: z
    .string()
    .trim()
    .min(20, 'What are they vouching for? (at least 20 characters)')
    .max(4000),
});

export const revokeVouchSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'Say why this vouch is being revoked')
    .max(1000),
});

export type CreateInstitutionInput = z.infer<typeof createInstitutionSchema>;
export type UpdateInstitutionInput = z.infer<typeof updateInstitutionSchema>;
export type RecordVouchInput = z.infer<typeof recordVouchSchema>;

/**
 * ⛔ WHERE AN INSTITUTION IS PAID (`docs/113` §11, screen A1).
 *
 * Separate from `createInstitutionSchema` because recording a payee is a
 * separate admin decision from trusting a voucher - `docs/108` kept payment
 * out of `trusted_institutions` precisely so a third party's word could never
 * move money, and that separation is preserved in the input shapes too.
 */
export const PAYOUT_RAILS = ['mpesa_paybill'] as const;

export const PAYOUT_RAIL_LABELS: Record<(typeof PAYOUT_RAILS)[number], string> = {
  mpesa_paybill: 'M-Pesa paybill',
};

/**
 * What the rail's destination has to look like.
 *
 * ⚠️ A Kenyan paybill is 5-7 digits. The check is deliberately narrow: this
 * is the field that sends a grieving family's money somewhere, and an
 * M-Pesa payment to a wrong-but-valid shortcode is not reversible by us.
 * A typo that is still 6 digits gets through - nothing can catch that, which
 * is why `confirmationNotes` must say how a human checked it.
 */
const RAIL_IDENTIFIER_SHAPE: Record<(typeof PAYOUT_RAILS)[number], RegExp> = {
  mpesa_paybill: /^\d{5,7}$/,
};

export const createPayoutAccountSchema = z
  .object({
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .refine(
        (v) => isSupportedCurrency(v),
        'The platform cannot collect in that currency, so it cannot pay out in it either',
      ),
    rail: z.enum(PAYOUT_RAILS),
    accountIdentifier: z.string().trim().min(1, 'Required'),
    accountReferenceLabel: z
      .string()
      .trim()
      .min(3, 'Say what this institution calls the number, in their words')
      .max(60),
    /*
      Required, and 10 characters is a floor rather than a target. The row it
      guards is the one that can pay a stranger; an account with no record of
      how it was checked is a rumour with a shortcode. Mirrors the database
      CHECK so the message is readable instead of a 500.
    */
    confirmationNotes: z
      .string()
      .trim()
      .min(10, 'Say how you confirmed this account belongs to the institution'),
  })
  .refine((v) => RAIL_IDENTIFIER_SHAPE[v.rail].test(v.accountIdentifier), {
    path: ['accountIdentifier'],
    message: 'An M-Pesa paybill is 5 to 7 digits',
  });

export type CreatePayoutAccountInput = z.infer<typeof createPayoutAccountSchema>;
