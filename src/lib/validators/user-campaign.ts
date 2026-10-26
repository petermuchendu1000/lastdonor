import { z } from 'zod';

import { DEFAULT_CURRENCY, SUPPORTED_CURRENCY_CODES } from '@/lib/money/currencies';
import { formatMoney } from '@/lib/money/format';
import { validateImageUrl, validateYouTubeUrl } from './url-allowlist';

export const CATEGORIES = [
  'medical',
  'disaster',
  'military',
  'veterans',
  'memorial',
  'first-responders',
  'community',
  'essential-needs',
  'emergency',
  'charity',
  'education',
  'animal',
  'environment',
  'business',
  'competition',
  'creative',
  'event',
  'faith',
  'family',
  'sports',
  'travel',
  'volunteer',
  'wishes',
] as const;

export const BENEFICIARY_RELATIONS = [
  'self',
  'family',
  'friend',
  'colleague',
  'community_member',
  'organization',
  'other',
] as const;

/** One of `BENEFICIARY_RELATIONS`. Exported so consent rules can name it. */
export type BeneficiaryRelation = (typeof BENEFICIARY_RELATIONS)[number];

// ─── Campaign Creation Schema ────────────────────────────────────────────────

/**
 * Campaign creation schema -- strict requirements grounded in:
 *   - GoFundMe best practices: 100-word minimum story (~600 chars)
 *   - Platform brand promise: "Every campaign has a name, a face, and a number"
 *   - Content strategy: structured story with situation + impact + fund usage
 *   - Security STRIDE model TM-02: approval workflow for impersonation mitigation
 *   - Business ops: "Every disbursement documented"
 *
 * After full verification, the entire raised amount is released as a lump sum.
 */
const createUserCampaignBase = z.object({
  // ── Step 1: Who Needs Help ─────────────────────────────────────────────
  subjectName: z.string().trim()
    .min(2, 'Name must be at least 2 characters')
    .max(200, 'Name must be under 200 characters'),
  subjectHometown: z.string().trim()
    .min(2, 'Location must be at least 2 characters')
    .max(200, 'Location must be under 200 characters'),
  beneficiaryRelation: z.enum(BENEFICIARY_RELATIONS),
  category: z.enum(CATEGORIES),
  // If not fundraising for self, the named person must be aware
  beneficiaryConsent: z.boolean(),

  // ── Step 2: Tell Their Story ───────────────────────────────────────────
  // Title: GoFundMe caps at 60, but we allow 120 for expressive titles.
  // 20-char minimum prevents low-effort titles like "Help!" (5 chars).
  title: z.string().trim()
    .min(20, 'Title must be at least 20 characters')
    .max(120, 'Title must be under 120 characters'),
  // Story: 200-char floor is low-friction for initial submission.
  // Campaigns with longer stories raise significantly more, so the UI
  // encourages more detail without blocking submission.
  story: z.string().trim()
    .min(200, 'Story must be at least 200 characters')
    .max(10000, 'Story must be under 10,000 characters'),

  // ── Step 3: Goal & Fund Usage ──────────────────────────────────────────
  /**
   * The currency this campaign raises in, fixed at creation.
   *
   * ⛔ Added 2026-10-26, `docs/116` §3. NOTHING in this codebase could set
   * it: all four `insert(campaigns)` sites omitted the column, so every
   * campaign ever created took the `'USD'` default - on a platform whose only
   * working rail is M-Pesa and whose only real donations have been in
   * shillings (`docs/92`).
   *
   * Restricted to currencies the platform can COLLECT, not merely knows
   * (`docs/103`), because `donations` carries a composite FK onto
   * `campaigns (id, currency)` and a campaign nothing can settle is
   * unfundable.
   */
  currency: z
    .enum(SUPPORTED_CURRENCY_CODES as unknown as [string, ...string[]])
    .default(DEFAULT_CURRENCY),
  /**
   * Minor units of `currency` - NOT cents (`docs/92`).
   *
   * ⚠️ The bounds are a SANITY range, not a policy, which is why they are
   * not in `CURRENCIES` beside the admin route's: a whole number above the
   * gateway's own floor and below a billion. Only the MESSAGE was wrong, and
   * it is now rendered in the campaign's own currency by the refinement
   * below.
   */
  goalAmount: z.number().int('Goal must be a whole number'),
  // Fund usage plan is optional at creation time. Organizers are prompted
  // to add one once their campaign starts receiving funding.
  fundUsagePlan: z.string().trim()
    .max(3000, 'Fund usage plan must be under 3,000 characters')
    .optional(),

  // ── Step 4: Campaign Photo ─────────────────────────────────────────────
  // Brand: "Every campaign has a name, a face, and a number."
  // Required -- campaigns without photos have near-zero credibility.
  heroImageUrl: z.string().url('Please enter a valid image URL')
    .refine((url) => validateImageUrl(url, true), 'Image URL must use HTTPS and not point to internal networks'),
  galleryImages: z.array(z.string().url().refine((url) => validateImageUrl(url, true), 'Image URL must use HTTPS')).max(4, 'You can add up to 4 additional images').optional(),
  photoCredit: z.string().trim().max(200, 'Photo credit must be under 200 characters').optional(),
  youtubeUrl: z.string().url('Please enter a valid YouTube URL')
    .refine(
      (url) => validateYouTubeUrl(url),
      'URL must be a YouTube link using HTTPS',
    )
    .optional(),

  // ── Step 5: Review & Submit ────────────────────────────────────────────
  // Consent is implicit when the user submits the campaign for review.
  // The fields are kept for backwards compatibility but always sent as true.
  agreedToTerms: z.literal(true, { errorMap: () => ({ message: 'You must agree to the Terms of Service' }) }),
  confirmedTruthful: z.literal(true, { errorMap: () => ({ message: 'You must confirm the information is truthful' }) }),
});

/**
 * The wizard's sanity range, in minor units of whatever currency.
 *
 * ⚠️ These are the SAME INTEGERS the schema already enforced, deliberately.
 * The obvious improvement - a floor of `minDonationMinor`, since a goal below
 * one donation cannot be reached by one - would reject a US$1 to US$4.99 goal
 * that is accepted today, and changing what an organiser may ask for is a
 * product call, not a currency fix. Recorded in `docs/116` §3.3, not taken.
 */
const MIN_WIZARD_GOAL_MINOR = 100;
const MAX_WIZARD_GOAL_MINOR = 100_000_000_000;

export const createUserCampaignSchema = createUserCampaignBase.superRefine((data, ctx) => {
  if (data.goalAmount < MIN_WIZARD_GOAL_MINOR) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['goalAmount'],
      message: `Minimum goal is ${formatMoney(MIN_WIZARD_GOAL_MINOR, data.currency, 'whole')}`,
    });
  } else if (data.goalAmount > MAX_WIZARD_GOAL_MINOR) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['goalAmount'],
      message: `Maximum goal is ${formatMoney(MAX_WIZARD_GOAL_MINOR, data.currency, 'whole')}`,
    });
  }
});

export const updateUserCampaignSchema = z.object({
  title: z.string().trim().min(20, 'Title must be at least 20 characters').max(120, 'Title must be under 120 characters').optional(),
  story: z.string().trim().min(200, 'Story must be at least 200 characters').max(10000, 'Story must be under 10,000 characters').optional(),
  fundUsagePlan: z.string().trim().min(100, 'Fund usage plan must be at least 100 characters').max(3000, 'Fund usage plan must be under 3,000 characters').optional(),
  heroImageUrl: z.string().url('Enter a valid image URL')
    .refine((url) => validateImageUrl(url, true), 'Image URL must use HTTPS and not point to internal networks')
    .optional(),
  galleryImages: z.array(z.string().url('Each image must be a valid URL').refine((url) => validateImageUrl(url, true), 'Image URL must use HTTPS')).max(4, 'You can add up to 4 additional images').optional().nullable(),
  photoCredit: z.string().trim().max(200, 'Photo credit must be under 200 characters').optional(),
  youtubeUrl: z.string().url('Enter a valid YouTube URL')
    .refine(
      (url) => validateYouTubeUrl(url),
      'URL must be a YouTube link using HTTPS',
    )
    .optional().nullable(),
  category: z.enum(CATEGORIES).optional(),
  subjectHometown: z.string().trim().min(2, 'Location must be at least 2 characters').max(200, 'Location must be under 200 characters').optional(),
});

export type CreateUserCampaignInput = z.infer<typeof createUserCampaignSchema>;
export type UpdateUserCampaignInput = z.infer<typeof updateUserCampaignSchema>;
