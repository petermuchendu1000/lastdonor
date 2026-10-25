/**
 * Which verification reminder, if any, is due for one campaign.
 *
 * ── WHY THIS IS NOT THE EXISTING LADDER ─────────────────────────────────────
 *
 * `notifyVerificationReminder` has four urgency levels and, until this
 * module, zero callers (`docs/110`). Wiring it to a cron was approved. It
 * could not be wired as it stood, and the reason is worth keeping:
 *
 *   - Every one of its four levels opens with "Your campaign reached its goal
 *     N days ago". The chosen trigger fires on a LIVE, UNVERIFIED campaign,
 *     which has usually reached nothing.
 *   - Three of its four levels threaten to "send the money back to the people
 *     who gave it", and the last states it as settled fact.
 *
 * [VERIFIED 2026-10-25, by enumeration] **No such mechanism exists.** Every
 * refund path in the codebase is admin-initiated
 * (`admin/donations/[id]`, `admin/campaigns/[campaignId]/cancel`,
 * `admin/refund-batches/[id]`) or a gateway webhook reacting to a failed
 * charge. There is no deadline clock, no constant naming a verification
 * deadline, and `deadlineDays` exists only as a field an admin types into an
 * info request. So the threat has nothing behind it and the countdown it
 * counts down to does not exist.
 *
 * That corrects `docs/110` §7, which proposed reusing the funded ladder for
 * level 4. The funded case gets new copy here too, for the same reason.
 *
 * ── WHAT THE LEVELS ARE KEYED ON ────────────────────────────────────────────
 *
 * Consequence, not elapsed days. Each level corresponds to a different true
 * statement about what the organiser can and cannot do RIGHT NOW:
 *
 *   `first_money`      money has arrived and we cannot send it on
 *   `approaching_cap`  the campaign is near the limit it can raise unverified
 *   `at_cap`           the campaign is refusing donations
 *   `funded_and_stuck` the goal is met and the money cannot move
 *
 * A day count would be the easy trigger and it would say nothing. "It has
 * been 14 days" is not a reason to act; "this campaign stops taking money at
 * $500" is.
 *
 * ── WHY SILENCE AT ZERO DONATIONS ───────────────────────────────────────────
 *
 * `first_money` requires at least one real donation. A campaign that has
 * raised nothing is already told about the ID check at submission, in the
 * approval email and in the dashboard ladder; an email saying we cannot pay
 * out money that does not exist is noise, and noise is what gets the next one
 * ignored. REJECTED alternative: fire level 1 a fixed number of days after
 * publication - that is the day-count trigger this module exists to avoid,
 * and per `docs/72` most campaigns have never had a donation, so it would
 * have mailed nearly every organiser about nothing.
 *
 * This module is PURE. No database, no clock of its own, so every rule below
 * is directly testable.
 */

import type { campaignStatusEnum } from '@/db/schema';
import { isCapExempt } from '@/lib/campaign-raise-cap';
import { isSupportedCurrency, getCurrency } from '@/lib/money/currencies';

/** A value of the `campaign_status` enum, taken from the schema. */
type CampaignStatus = (typeof campaignStatusEnum)['enumValues'][number];

export type ReminderLevel =
  | 'first_money'
  | 'approaching_cap'
  | 'at_cap'
  | 'funded_and_stuck';

/**
 * Most consequential first. `dueReminder` returns the first match, so this
 * order decides which single email an organiser gets when more than one
 * statement is true at once.
 */
export const REMINDER_PRIORITY: readonly ReminderLevel[] = [
  'funded_and_stuck',
  'at_cap',
  'approaching_cap',
  'first_money',
];

/**
 * Statuses in which a campaign is actually collecting money, so a statement
 * about donations is true of it. A campaign in the review queue cannot take a
 * penny, so a cap warning would be meaningless.
 */
export const COLLECTING_STATUSES = [
  'active',
  'last_donor_zone',
  'completed',
] as const satisfies readonly CampaignStatus[];

/** Fraction of the cap at which "approaching" becomes true. */
export const APPROACHING_CAP_FRACTION = 0.7;

/**
 * Floor between any two reminders to the same campaign, whatever the level.
 *
 * Send-once-per-level already bounds the total at four emails for the whole
 * life of a campaign. This stops those four arriving within an hour of each
 * other when a campaign goes from its first donation to its cap in one
 * afternoon - which, at a US$500 cap, it can.
 */
export const REMINDER_MIN_GAP_HOURS = 24;

export interface ReminderFacts {
  /** `campaigns.status`. */
  status: string;
  /** `campaigns.verification_status`. */
  verificationStatus: string;
  /** `campaigns.currency`. */
  currency: string;
  /** Real, un-refunded donations in minor units - never `raised_amount`. */
  realRaisedMinor: number;
  /** `campaigns.goal_amount`, minor units of the same currency. */
  goalMinor: number;
  /** Levels already sent to this campaign, ever. */
  sentLevels: readonly string[];
  /** When a reminder of ANY level last went out, or null. */
  lastSentAt: Date | null;
  now: Date;
}

/**
 * The level that is both TRUE of this campaign and not yet sent, or null.
 *
 * Returning null is the common answer and the right default: every branch
 * that cannot establish a true statement falls through to it rather than
 * picking the nearest level.
 */
export function dueReminder(f: ReminderFacts): ReminderLevel | null {
  const candidate = trueLevel(f);
  if (!candidate) return null;

  // Send-once per level, for the life of the campaign.
  if (f.sentLevels.includes(candidate)) return null;

  if (f.lastSentAt) {
    const hours = (f.now.getTime() - f.lastSentAt.getTime()) / 3_600_000;
    if (hours < REMINDER_MIN_GAP_HOURS) return null;
  }

  return candidate;
}

/**
 * The most consequential level whose statement is true, ignoring whether it
 * has been sent. Exported for the tests, which assert the statements
 * separately from the send-once bookkeeping.
 */
export function trueLevel(f: ReminderFacts): ReminderLevel | null {
  if (!(COLLECTING_STATUSES as readonly string[]).includes(f.status)) return null;

  /*
    Nothing is blocked, so there is nothing to say. `verified` is a legacy
    value of the same enum and is treated as finished for the same reason.
  */
  if (f.verificationStatus === 'fully_verified' || f.verificationStatus === 'verified') {
    return null;
  }

  const funded = f.goalMinor > 0 && f.realRaisedMinor >= f.goalMinor;
  if (funded) return 'funded_and_stuck';

  /*
    ⚠️ The two tiers again (`docs/110`). `identity_verified` LIFTS the raise
    cap, so for such a campaign the three cap levels are all false - saying
    "this campaign stops taking donations at $500" to somebody whose cap is
    already gone would be a lie. Only the funded case above still applies,
    and it has already been checked, so fall through to silence.
  */
  if (isCapExempt(f.verificationStatus)) return null;

  const cap = capMinor(f.currency);
  // An unpriceable currency means no cap figure to quote, so no cap claim.
  if (cap === null) return null;

  if (f.realRaisedMinor >= cap) return 'at_cap';
  if (f.realRaisedMinor >= cap * APPROACHING_CAP_FRACTION) return 'approaching_cap';
  if (f.realRaisedMinor > 0) return 'first_money';
  return null;
}

/**
 * The pre-verification cap in minor units, or null when this currency has no
 * figure we can state.
 *
 * `getCurrency` throws on an unknown code (`docs/92`), which is correct for
 * money arithmetic and wrong in a cron sweeping every live campaign - one
 * row in a currency nothing can price must not end the run.
 */
export function capMinor(currency: string): number | null {
  if (!isSupportedCurrency(currency)) return null;
  const cap = getCurrency(currency).unverifiedCapMinor;
  return Number.isFinite(cap) && cap > 0 ? cap : null;
}
