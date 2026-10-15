/**
 * Email preference toggles — P1, fixed 2026-10-15.
 *
 * `z.object` strips unknown keys, so a key missing from `userPreferencesSchema`
 * can never be written by `PUT /api/v1/users/settings`:
 *
 *  - `emailNotifications` was READ by `src/lib/notifications.ts` (the sole gate
 *    on ~20 emails) but was NOT in the schema, so no user could ever turn
 *    notification email off. It is now accepted.
 *  - `emailNewCampaigns` was written by the account UI and read nowhere, and
 *    nothing in `src/` sends a new-campaign alert. It was removed rather than
 *    left as a consent record the platform does not act on.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { userPreferencesSchema } from './user';

describe('emailNotifications (the toggle that could not be set)', () => {
  it('survives parsing instead of being stripped', () => {
    const result = userPreferencesSchema.safeParse({ emailNotifications: false });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({ emailNotifications: false });
  });

  it('accepts true as well as false', () => {
    const result = userPreferencesSchema.safeParse({ emailNotifications: true });
    expect(result.success && result.data.emailNotifications).toBe(true);
  });

  it('rejects a non-boolean', () => {
    expect(userPreferencesSchema.safeParse({ emailNotifications: 'off' }).success).toBe(false);
  });

  it('is optional, so a partial update does not have to send it', () => {
    const result = userPreferencesSchema.safeParse({ showBadgesPublicly: false });
    expect(result.success).toBe(true);
    expect(result.success && 'emailNotifications' in result.data).toBe(false);
  });
});

describe('emailNewCampaigns (removed)', () => {
  it('is no longer stored, so the UI cannot record consent nothing acts on', () => {
    const result = userPreferencesSchema.safeParse({ emailNewCampaigns: true });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({});
  });
});

describe('the keys that are actually read somewhere', () => {
  it.each([
    'emailNotifications',
    'emailDonationReceipts',
    'emailCampaignUpdates',
    'emailNewsletter',
    'showProfilePublicly',
    'showDonationsPublicly',
    'showBadgesPublicly',
  ])('round-trips %s', (key) => {
    const result = userPreferencesSchema.safeParse({ [key]: false });
    expect(result.success && result.data).toEqual({ [key]: false });
  });
});
