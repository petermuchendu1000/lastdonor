import { z } from 'zod';

import {
  DEFAULT_CURRENCY,
  getCurrency,
  SUPPORTED_CURRENCY_CODES,
} from '@/lib/money/currencies';
import { formatMoney } from '@/lib/money/format';

const CATEGORIES = [
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

/**
 * ⛔ THE GOAL AND TIER BOUNDS ARE PER CURRENCY, so they cannot be `.min()`
 * on the field - a field validator cannot see a sibling. They are enforced in
 * the `superRefine` below, and the field carries only the shape.
 *
 * Added 2026-10-26, `docs/116` §3. This schema used to say
 * `.min(100_000, 'Minimum goal is $1,000')`, and NOTHING in the codebase could
 * set a campaign's currency at all, so every insert took the column default
 * and the dollar sign was accidentally true. The defect was the pair: a
 * platform whose only working rail is M-Pesa could not create a KES campaign,
 * and the moment it could, the range and its message would both have been in
 * the wrong currency.
 */
const createCampaignBase = z.object({
  title: z.string().trim().min(5, 'Title must be at least 5 characters').max(200, 'Title must be under 200 characters'),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens')
    .min(3, 'Slug must be at least 3 characters')
    .max(100, 'Slug must be under 100 characters'),
  category: z.enum(CATEGORIES),
  heroImageUrl: z.string().url('Enter a valid image URL'),
  photoCredit: z.string().trim().max(200, 'Photo credit must be under 200 characters').optional(),
  subjectName: z.string().trim().min(1, 'Subject name is required').max(200, 'Subject name must be under 200 characters'),
  subjectHometown: z.string().trim().max(200, 'Hometown must be under 200 characters').optional(),
  storyHtml: z.string().min(50, 'Story must be at least 50 characters'),
  /**
   * The currency this campaign raises in, fixed at creation.
   *
   * ⚠️ Restricted to currencies the platform can COLLECT, not merely knows
   * (`docs/103`): `campaigns (id, currency)` is the target of a composite FK
   * from `donations`, so a campaign in a currency no gateway settles would be
   * unfundable and unmovable. Defaults to `DEFAULT_CURRENCY`, which is what
   * the column default already gave every existing row.
   */
  currency: z
    .enum(SUPPORTED_CURRENCY_CODES as unknown as [string, ...string[]])
    .default(DEFAULT_CURRENCY),
  /** Minor units of `currency`. Bounds applied in the `superRefine` below. */
  goalAmount: z.number().int('Goal must be a whole number'),
  impactTiers: z
    .array(
      z.object({
        amount: z.number().int(),
        label: z.string().trim().min(3, 'Tier label must be at least 3 characters').max(200, 'Tier label must be under 200 characters'),
      }),
    )
    .max(10, 'Maximum 10 impact tiers')
    .default([]),
  status: z.enum(['draft', 'active']).default('draft'),
});

/**
 * Money bounds, read from the chosen currency and reported in it.
 *
 * Shared by create and update so a partial edit cannot slip a goal past the
 * floor. On an update `currency` may be absent, in which case the bounds fall
 * back to `DEFAULT_CURRENCY` - and the update ROUTE never writes `currency`
 * anyway (its `updateValues` is an explicit allowlist), which is what keeps a
 * campaign's currency immutable as the composite FK intends (`docs/92`).
 */
function checkMoneyBounds(
  data: { currency?: string; goalAmount?: number; impactTiers?: { amount: number }[] },
  ctx: z.RefinementCtx,
): void {
  const code = data.currency ?? DEFAULT_CURRENCY;
  const def = getCurrency(code);

  if (data.goalAmount !== undefined) {
    if (data.goalAmount < def.minGoalMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['goalAmount'],
        message: `Minimum goal is ${formatMoney(def.minGoalMinor, code, 'whole')}`,
      });
    } else if (data.goalAmount > def.maxGoalMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['goalAmount'],
        message: `Maximum goal is ${formatMoney(def.maxGoalMinor, code, 'whole')}`,
      });
    }
  }

  data.impactTiers?.forEach((tier, i) => {
    // The old floor was 500 - US$5.00, and exactly `USD.minDonationMinor`. A
    // tier below what the gateway will accept cannot be given.
    if (tier.amount < def.minDonationMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['impactTiers', i, 'amount'],
        message: `Tier amount must be at least ${formatMoney(def.minDonationMinor, code, 'whole')}`,
      });
    }
  });
}

export const createCampaignSchema = createCampaignBase.superRefine(checkMoneyBounds);

export const updateCampaignSchema = createCampaignBase.partial().superRefine(checkMoneyBounds);

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
