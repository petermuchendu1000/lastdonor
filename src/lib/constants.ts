/**
 * Well-known campaign IDs used across the platform.
 *
 * The general fund campaign is seeded in the database.
 * This ID must match the actual row in the campaigns table.
 */
export const GENERAL_FUND_CAMPAIGN_ID = 'd7fcb01f-468a-49e1-848f-bee7377a35ea';

/**
 * Address written over `donations.donor_email` and `donations.donor_name` when
 * a user deletes their account (`api/v1/users/me` DELETE).
 *
 * It is a tombstone, not a mailbox: nobody receives mail here, it cannot
 * consent to anything, and every deleted user's donations collapse onto this
 * one value. Any code that resolves an audience MUST exclude it
 * (`bulk-email-recipients.ts`), or one synthetic address is treated as a real
 * recipient and bulk mail is sent to a guaranteed hard bounce.
 */
export const DELETED_DONOR_PLACEHOLDER = 'deleted@lastdonor.org';

/** Display name paired with DELETED_DONOR_PLACEHOLDER. */
export const DELETED_DONOR_NAME = 'Deleted User';
