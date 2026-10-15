import { z } from 'zod';

/**
 * Shared password schema for registration and password reset.
 * Requirements: 10+ chars, uppercase, lowercase, digit, max 128 chars.
 * Max 128 prevents bcrypt DoS (bcrypt truncates at 72 bytes but we
 * cap at 128 to avoid wasting memory on hashing enormous payloads).
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be under 128 characters')
  .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Must contain at least one digit');

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: passwordSchema,
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be under 100 characters'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const resetPasswordSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address'),
    token: z.string().min(1, 'Reset token is required'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

/** Server-side schema for the reset-password API (no confirmPassword). */
export const resetPasswordApiSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  token: z.string().min(1, 'Reset token is required'),
  password: passwordSchema,
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be under 100 characters').optional(),
  location: z.string().trim().max(100, 'Location must be under 100 characters').optional(),
  avatarUrl: z.string().url('Enter a valid URL').refine(
    (url) => /^https?:\/\//i.test(url),
    'Only http and https URLs are allowed'
  ).optional(),
});

/**
 * Preferences a user may set. `z.object` strips unknown keys, so a key missing
 * from this schema can never be written by `PUT /api/v1/users/settings` — the
 * toggle silently does nothing.
 *
 * Audit notes, 2026-10-15:
 *  - `emailNotifications` was READ by `src/lib/notifications.ts` (the sole gate
 *    on ~20 transactional emails) but was absent here, so no user could ever
 *    turn notification email off. Added.
 *  - `emailNewCampaigns` was written by the UI and read nowhere, and nothing in
 *    `src/` sends a new-campaign alert. Removed rather than left as a toggle
 *    that records consent it cannot act on. Restore it together with the send
 *    site, not before.
 */
export const userPreferencesSchema = z.object({
  /** Global gate on notification email (`src/lib/notifications.ts:wantsEmail`). */
  emailNotifications: z.boolean().optional(),
  emailDonationReceipts: z.boolean().optional(),
  emailCampaignUpdates: z.boolean().optional(),
  emailNewsletter: z.boolean().optional(),
  showProfilePublicly: z.boolean().optional(),
  showDonationsPublicly: z.boolean().optional(),
  showBadgesPublicly: z.boolean().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
