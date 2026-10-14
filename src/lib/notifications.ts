/**
 * Notification service - creates in-app notifications and sends emails.
 *
 * Designed to be called from admin API handlers AFTER the primary action
 * succeeds. Errors in notification delivery never block the admin action.
 *
 * Each notifyXxx function:
 *  1. Inserts an in-app notification row per recipient
 *  2. Sends an email (respecting user preferences)
 *  3. Marks emailSent = true on the notification row
 */

import { db } from '@/db';
import { notifications, donations, users, donorCampaignSubscriptions } from '@/db/schema';
import { eq, and, inArray, count } from 'drizzle-orm';
import { resend } from '@/lib/resend';
import { retryWithBackoff } from '@/lib/utils/retry';
import {
  donationRefundedEmail,
  donationRefundReversedEmail,
  campaignCompletedEmail,
  campaignArchivedEmail,
  campaignStatusChangedEmail,
  roleChangedEmail,
  accountDeletedEmail,
  campaignSubmittedEmail,
  campaignPausedDonorEmail,
  campaignResumedDonorEmail,
  campaignSuspendedDonorEmail,
  infoRequestCampaignerEmail,
  welcomeCampaignerEmail,
  bulkRefundCompletedEmail,
  donationReceivedEmail,
  firstDonationCelebrationEmail,
  campaignCompletedCreatorEmail,
  verificationReminderEmail,
  verificationDocumentsAdminEmail,
  verificationApprovedCreatorEmail,
  verificationRejectedCreatorEmail,
  withdrawalCompletedEmail,
  withdrawalFailedEmail,
} from '@/lib/email-templates';
import {
  adaptiveDonationReceiptEmail,
  abandonedDonationRecoveryEmail,
  adaptiveRefundEmail,
  creatorMotivationEmail,
  verificationEscalationEmail,
  donorReengagementEmail,
  highValueDonorThankYouEmail,
  postDonationImpactEmail,
  creatorThankYouUpdateEmail,
  campaignUpdateDigestEmail,
  getDonorAmountTier,
  type DonorContext,
  type CreatorContext,
  type AbandonedDonationContext,
  type CreatorEmailType,
  type VerificationStage,
  type ReengagementStage,
} from '@/lib/email-adaptive';
import type { NotificationType } from '@/types';

const FROM_ADDRESS = 'LastDonor.org <noreply@lastdonor.org>';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Check if a user has opted out of notification emails. */
async function wantsEmail(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const prefs = row?.preferences as Record<string, unknown> | null;
  // Default to true - only skip if explicitly false
  return prefs?.emailNotifications !== false;
}

/** Insert notification row and optionally send email. Returns silently on error. */
export async function createAndEmail(p: {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  email?: { to: string; subject: string; html: string };
}) {
  try {
    const [notif] = await db
      .insert(notifications)
      .values({
        userId: p.userId,
        type: p.type,
        title: p.title,
        message: p.message,
        link: p.link ?? null,
      })
      .returning({ id: notifications.id });

    if (p.email) {
      const canEmail = await wantsEmail(p.userId);
      if (canEmail) {
        const emailData = p.email;
        const { error: sendError } = await retryWithBackoff(
          () => resend.emails.send({
            from: FROM_ADDRESS,
            to: emailData.to,
            subject: emailData.subject,
            html: emailData.html,
          }),
          // isFailure: the Resend SDK resolves with {data:null,error} instead of
          // throwing, so without this the retry made exactly one attempt (docs/29 P0-4).
          { maxRetries: 2, baseDelayMs: 500, isFailure: (result) => Boolean(result?.error) },
        );
        if (sendError) {
          console.error(`[notifications] Resend API error for ${p.userId} (${p.type}):`, sendError);
        } else {
          await db
            .update(notifications)
            .set({ emailSent: true })
            .where(eq(notifications.id, notif.id));
        }
      }
    }
  } catch (err) {
    console.error(`[notifications] Failed to notify ${p.userId} (${p.type}):`, err);
  }
}

/** Send an email to an address without creating an in-app notification. */
async function sendEmailOnly(p: { to: string; subject: string; html: string }) {
  try {
    const { error: sendError } = await retryWithBackoff(
      () => resend.emails.send({ from: FROM_ADDRESS, to: p.to, subject: p.subject, html: p.html }),
      // See note above: Resend resolves with an error value rather than throwing.
      { maxRetries: 2, baseDelayMs: 500, isFailure: (result) => Boolean(result?.error) },
    );
    if (sendError) {
      console.error(`[notifications] Resend API error for ${p.to}:`, sendError);
    }
  } catch (err) {
    console.error(`[notifications] Failed to send email to ${p.to}:`, err);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Notify a donor that their donation has been refunded (or refund reversed).
 */
export async function notifyDonationRefund(p: {
  donationId: string;
  donorEmail: string;
  donorName: string;
  amount: number;
  campaignTitle: string;
  campaignSlug: string;
  refunded: boolean;
}) {
  // Find registered user by email (might be a guest donation)
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, p.donorEmail))
    .limit(1);

  const emailContent = p.refunded
    ? donationRefundedEmail(p)
    : donationRefundReversedEmail(p);

  const type: NotificationType = p.refunded ? 'donation_refunded' : 'donation_refund_reversed';
  const title = p.refunded
    ? `Donation of $${(p.amount / 100).toFixed(2)} refunded`
    : `Refund reversed for $${(p.amount / 100).toFixed(2)} donation`;
  const message = p.refunded
    ? `Your donation to "${p.campaignTitle}" has been refunded.`
    : `The refund on your donation to "${p.campaignTitle}" has been reversed.`;

  if (user) {
    // Registered user: in-app notification + email
    await createAndEmail({
      userId: user.id,
      type,
      title,
      message,
      link: `/campaigns/${p.campaignSlug}`,
      email: { to: p.donorEmail, ...emailContent },
    });
  } else {
    // Guest donor: email only (no in-app notification possible)
    await sendEmailOnly({ to: p.donorEmail, ...emailContent });
  }
}

/**
 * Notify all real donors of a campaign when the campaign status changes.
 * Selects the appropriate template based on newStatus.
 */
export async function notifyCampaignStatusChange(p: {
  campaignId: string;
  campaignTitle: string;
  campaignSlug: string;
  previousStatus: string;
  newStatus: string;
  goalAmount: number;
}) {
  // Only notify on significant status changes - not draft toggling
  const NOTIFY_STATUSES = ['completed', 'archived'];
  // For completed/archived, we send specific templates. For other transitions that
  // donors would care about (e.g., back to active from LDZ), use the generic template.
  const shouldNotifyDonors = NOTIFY_STATUSES.includes(p.newStatus) ||
    (p.previousStatus === 'last_donor_zone' && p.newStatus === 'active');

  if (!shouldNotifyDonors) return;

  // Fetch all unique donors (both registered and guest) for this campaign
  const campaignDonors = await db
    .select({
      donorEmail: donations.donorEmail,
      donorName: donations.donorName,
      userId: donations.userId,
    })
    .from(donations)
    .where(
      and(
        eq(donations.campaignId, p.campaignId),
        eq(donations.source, 'real'),
        eq(donations.refunded, false),
      ),
    );

  // Deduplicate by email
  const seen = new Set<string>();
  const uniqueDonors: typeof campaignDonors = [];
  for (const d of campaignDonors) {
    if (!seen.has(d.donorEmail)) {
      seen.add(d.donorEmail);
      uniqueDonors.push(d);
    }
  }

  let type: NotificationType;
  let titleText: string;
  let messageText: string;

  if (p.newStatus === 'completed') {
    type = 'campaign_completed';
    titleText = `"${p.campaignTitle}" reached its goal!`;
    messageText = `The campaign "${p.campaignTitle}" has been completed. Thank you for your support!`;
  } else if (p.newStatus === 'archived') {
    type = 'campaign_archived';
    titleText = `Campaign "${p.campaignTitle}" concluded`;
    messageText = `The campaign "${p.campaignTitle}" has been concluded. Your contributions have been recorded.`;
  } else {
    type = 'campaign_status_changed';
    titleText = `"${p.campaignTitle}" status updated`;
    messageText = `The campaign "${p.campaignTitle}" is now active again.`;
  }

  for (const donor of uniqueDonors) {
    let emailContent: { subject: string; html: string };

    if (p.newStatus === 'completed') {
      emailContent = campaignCompletedEmail({
        donorName: donor.donorName,
        campaignTitle: p.campaignTitle,
        campaignSlug: p.campaignSlug,
        goalAmount: p.goalAmount,
      });
    } else if (p.newStatus === 'archived') {
      emailContent = campaignArchivedEmail({
        donorName: donor.donorName,
        campaignTitle: p.campaignTitle,
      });
    } else {
      emailContent = campaignStatusChangedEmail({
        donorName: donor.donorName,
        campaignTitle: p.campaignTitle,
        campaignSlug: p.campaignSlug,
        newStatus: p.newStatus,
      });
    }

    if (donor.userId) {
      await createAndEmail({
        userId: donor.userId,
        type,
        title: titleText,
        message: messageText,
        link: `/campaigns/${p.campaignSlug}`,
        email: { to: donor.donorEmail, ...emailContent },
      });
    } else {
      await sendEmailOnly({ to: donor.donorEmail, ...emailContent });
    }
  }
}

/**
 * Notify a user that their account role has been changed.
 */
export async function notifyRoleChange(p: {
  userId: string;
  userEmail: string;
  userName: string;
  previousRole: string;
  newRole: string;
}) {
  const emailContent = roleChangedEmail({
    userName: p.userName || 'User',
    previousRole: p.previousRole,
    newRole: p.newRole,
  });

  await createAndEmail({
    userId: p.userId,
    type: 'role_changed',
    title: `Your role changed to ${p.newRole}`,
    message: `Your account role has been updated from ${p.previousRole} to ${p.newRole}.`,
    link: p.newRole === 'editor' || p.newRole === 'admin' ? '/admin' : '/dashboard',
    email: { to: p.userEmail, ...emailContent },
  });
}

/**
 * Send account deletion email. Called BEFORE the user is deleted/anonymized.
 * No in-app notification (the account is being removed).
 */
export async function notifyAccountDeletion(p: {
  userEmail: string;
  userName: string;
}) {
  const emailContent = accountDeletedEmail({ userName: p.userName || 'User' });
  await sendEmailOnly({ to: p.userEmail, ...emailContent });
}

/**
 * Notify all admins that a user has published a new campaign.
 */
export async function notifyAdminsCampaignSubmitted(p: {
  campaignId: string;
  campaignTitle: string;
  creatorName: string;
  category: string;
  goalAmount: number;
}) {
  const admins = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.role, 'admin'));

  const emailContent = campaignSubmittedEmail(p);

  for (const admin of admins) {
    await createAndEmail({
      userId: admin.id,
      type: 'campaign_submitted',
      title: `New campaign: "${p.campaignTitle}"`,
      message: `${p.creatorName} published a new campaign. Category: ${p.category}, Goal: $${(p.goalAmount / 100).toFixed(2)}.`,
      link: `/admin/campaigns/${p.campaignId}/edit`,
      email: { to: admin.email, ...emailContent },
    });
  }
}

// ─── Phase 2: Governance & Transparency notifications ───────────────────────

/**
 * Fetch subscribers for a campaign. Returns subscribed donors (both registered and guest).
 */
async function getSubscribedDonors(campaignId: string) {
  return db
    .select({
      donorEmail: donorCampaignSubscriptions.donorEmail,
      userId: donorCampaignSubscriptions.userId,
    })
    .from(donorCampaignSubscriptions)
    .where(
      and(
        eq(donorCampaignSubscriptions.campaignId, campaignId),
        eq(donorCampaignSubscriptions.subscribed, true),
      ),
    );
}

/** Helper: resolve a donor name from the user record or donation record. */
async function _resolveDonorName(email: string): Promise<string> {
  const map = await resolveDonorNames([email]);
  return map.get(email) ?? 'Donor';
}

/** Batch-resolve donor names from user records or donation records. */
async function resolveDonorNames(emails: string[]): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  if (emails.length === 0) return nameMap;
  const unique = [...new Set(emails)];

  try {
    // 1. Batch lookup from users table
    const userRows = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(inArray(users.email, unique));
    for (const row of userRows) {
      if (row.name && row.email) nameMap.set(row.email, row.name);
    }

    // 2. For emails not found in users, fallback to donations table
    const missing = unique.filter((e) => !nameMap.has(e));
    if (missing.length > 0) {
      const donationRows = await db
        .select({ donorEmail: donations.donorEmail, donorName: donations.donorName })
        .from(donations)
        .where(inArray(donations.donorEmail, missing));
      for (const row of donationRows) {
        if (row.donorName && row.donorEmail && !nameMap.has(row.donorEmail)) {
          nameMap.set(row.donorEmail, row.donorName);
        }
      }
    }
  } catch {
    // Non-blocking: fall through with whatever we have
  }

  return nameMap;
}

/**
 * Notify subscribed donors when a campaign is paused.
 */
export async function notifyCampaignPaused(p: {
  campaignId: string;
  campaignTitle: string;
  campaignSlug: string;
  reason: string;
  notifyDonors: boolean;
}) {
  if (!p.notifyDonors) return;

  const subscribers = await getSubscribedDonors(p.campaignId);
  const nameMap = await resolveDonorNames(subscribers.map((s) => s.donorEmail));

  for (const sub of subscribers) {
    const name = nameMap.get(sub.donorEmail) ?? 'Donor';
    const emailContent = campaignPausedDonorEmail({
      donorName: name,
      campaignTitle: p.campaignTitle,
      campaignSlug: p.campaignSlug,
      reason: p.reason,
    });

    if (sub.userId) {
      await createAndEmail({
        userId: sub.userId,
        type: 'campaign_paused',
        title: `"${p.campaignTitle}" has been paused`,
        message: `The campaign has been temporarily paused. Reason: ${p.reason}`,
        link: `/campaigns/${p.campaignSlug}`,
        email: { to: sub.donorEmail, ...emailContent },
      });
    } else {
      await sendEmailOnly({ to: sub.donorEmail, ...emailContent });
    }
  }
}

/**
 * Notify subscribed donors when a campaign resumes.
 */
export async function notifyCampaignResumed(p: {
  campaignId: string;
  campaignTitle: string;
  campaignSlug: string;
}) {
  const subscribers = await getSubscribedDonors(p.campaignId);
  const nameMap = await resolveDonorNames(subscribers.map((s) => s.donorEmail));

  for (const sub of subscribers) {
    const name = nameMap.get(sub.donorEmail) ?? 'Donor';
    const emailContent = campaignResumedDonorEmail({
      donorName: name,
      campaignTitle: p.campaignTitle,
      campaignSlug: p.campaignSlug,
    });

    if (sub.userId) {
      await createAndEmail({
        userId: sub.userId,
        type: 'campaign_resumed',
        title: `"${p.campaignTitle}" has resumed`,
        message: `The campaign has resumed and is accepting donations again.`,
        link: `/campaigns/${p.campaignSlug}`,
        email: { to: sub.donorEmail, ...emailContent },
      });
    } else {
      await sendEmailOnly({ to: sub.donorEmail, ...emailContent });
    }
  }
}

/**
 * Notify subscribed donors when a campaign is suspended.
 */
export async function notifyCampaignSuspended(p: {
  campaignId: string;
  campaignTitle: string;
  campaignSlug: string;
}) {
  const subscribers = await getSubscribedDonors(p.campaignId);
  const nameMap = await resolveDonorNames(subscribers.map((s) => s.donorEmail));

  for (const sub of subscribers) {
    const name = nameMap.get(sub.donorEmail) ?? 'Donor';
    const emailContent = campaignSuspendedDonorEmail({
      donorName: name,
      campaignTitle: p.campaignTitle,
      campaignSlug: p.campaignSlug,
    });

    if (sub.userId) {
      await createAndEmail({
        userId: sub.userId,
        type: 'campaign_suspended',
        title: `"${p.campaignTitle}" is under review`,
        message: `The campaign is currently being reviewed by our team. Your funds are secure.`,
        link: `/campaigns/${p.campaignSlug}`,
        email: { to: sub.donorEmail, ...emailContent },
      });
    } else {
      await sendEmailOnly({ to: sub.donorEmail, ...emailContent });
    }
  }
}

/**
 * Notify the campaigner about an info request.
 */
export async function notifyInfoRequest(p: {
  campaignerId: string;
  campaignerEmail: string;
  campaignerName: string;
  campaignId: string;
  campaignTitle: string;
  requestType: string;
  details: string;
  deadline: string;
}) {
  const emailContent = infoRequestCampaignerEmail({
    campaignerName: p.campaignerName || 'Campaigner',
    campaignTitle: p.campaignTitle,
    requestType: p.requestType,
    details: p.details,
    deadline: p.deadline,
    campaignId: p.campaignId,
  });

  await createAndEmail({
    userId: p.campaignerId,
    type: 'info_request',
    title: `Next step for "${p.campaignTitle}"`,
    message: `We need a bit more information about your campaign. Due by: ${p.deadline}.`,
    link: `/dashboard/campaigns/${p.campaignId}/verification`,
    email: { to: p.campaignerEmail, ...emailContent },
  });
}

/**
 * Send the welcome email to a new campaigner when their campaign goes live.
 * Focus: sharing and getting first donation - zero document requests.
 */
export async function notifyWelcomeCampaigner(p: {
  campaignerId: string;
  campaignerEmail: string;
  campaignerName: string;
  campaignTitle: string;
  campaignSlug: string;
}) {
  const emailContent = welcomeCampaignerEmail({
    campaignerName: p.campaignerName || 'Campaigner',
    campaignTitle: p.campaignTitle,
    campaignSlug: p.campaignSlug,
  });

  await createAndEmail({
    userId: p.campaignerId,
    type: 'campaign_submitted',
    title: `Your campaign "${p.campaignTitle}" is live!`,
    message: `Your campaign is now live and accepting donations. Share it to get your first donation!`,
    link: `/campaigns/${p.campaignSlug}`,
    email: { to: p.campaignerEmail, ...emailContent },
  });
}

/**
 * Notify admins when a bulk refund batch completes.
 */
export async function notifyBulkRefundCompleted(p: {
  campaignId: string;
  campaignTitle: string;
  totalDonors: number;
  totalAmount: number;
  failedCount: number;
}) {
  const admins = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.role, 'admin'));

  for (const admin of admins) {
    const emailContent = bulkRefundCompletedEmail({
      adminName: admin.name || 'Admin',
      campaignTitle: p.campaignTitle,
      totalDonors: p.totalDonors,
      totalAmount: p.totalAmount,
      failedCount: p.failedCount,
    });

    await createAndEmail({
      userId: admin.id,
      type: 'bulk_refund_processed',
      title: `Refund batch complete - "${p.campaignTitle}"`,
      message: `${p.totalDonors} donors refunded. Total: $${(p.totalAmount / 100).toFixed(2)}. ${p.failedCount} failed.`,
      link: `/admin/campaigns/${p.campaignId}`,
      email: { to: admin.email, ...emailContent },
    });
  }
}

// ─── Donation notifications ─────────────────────────────────────────────────

/**
 * Notify all admins when a donation is received.
 */
export async function notifyAdminsDonationReceived(p: {
  campaignId: string;
  campaignSlug: string;
  campaignTitle: string;
  donorName: string;
  amount: number;
  isAnonymous: boolean;
  message?: string | null;
  excludeUserId?: string;
}) {
  const admins = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.role, 'admin'));

  const donor = p.isAnonymous ? 'Anonymous' : p.donorName;
  const emailContent = donationReceivedEmail(p);

  for (const admin of admins) {
    // Skip if this admin is also the campaign creator (they get a separate, personalized notification)
    if (p.excludeUserId && admin.id === p.excludeUserId) continue;

    await createAndEmail({
      userId: admin.id,
      type: 'campaign_donation_received',
      title: `New donation: $${(p.amount / 100).toFixed(2)} to "${p.campaignTitle}"`,
      message: `${donor} donated $${(p.amount / 100).toFixed(2)} to "${p.campaignTitle}".${p.message ? ` Message: "${p.message}"` : ''}`,
      link: `/campaigns/${p.campaignSlug}`,
      email: { to: admin.email, ...emailContent },
    });
  }
}

/**
 * Notify the campaign creator when their campaign receives a donation.
 */
export async function notifyCreatorDonationReceived(p: {
  creatorId: string;
  campaignId: string;
  campaignTitle: string;
  campaignSlug: string;
  donorName: string;
  amount: number;
  isAnonymous: boolean;
  message?: string | null;
}) {
  const [creator] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, p.creatorId))
    .limit(1);

  if (!creator) return;

  const donor = p.isAnonymous ? 'Anonymous' : p.donorName;

  await createAndEmail({
    userId: p.creatorId,
    type: 'campaign_donation_received',
    title: `New donation: $${(p.amount / 100).toFixed(2)}`,
    message: `${donor} donated $${(p.amount / 100).toFixed(2)} to your campaign "${p.campaignTitle}".${p.message ? ` They said: "${p.message}"` : ''}`,
    link: `/campaigns/${p.campaignSlug}`,
    email: {
      to: creator.email,
      subject: `You received a $${(p.amount / 100).toFixed(2)} donation!`,
      html: donationReceivedEmail(p).html,
    },
  });
}

// ─── New: Instant-live & post-completion notifications ──────────────────────

/**
 * Notify the campaign creator when they receive their FIRST donation.
 * Celebrates this achievement and requests banking details setup.
 */
export async function notifyCreatorFirstDonation(p: {
  creatorId: string;
  creatorEmail: string;
  creatorName: string;
  campaignTitle: string;
  campaignSlug: string;
  donorName: string;
  amount: number;
  isAnonymous: boolean;
}) {
  const donor = p.isAnonymous ? 'An anonymous supporter' : p.donorName;
  const emailContent = firstDonationCelebrationEmail({
    campaignerName: p.creatorName || 'Campaigner',
    campaignTitle: p.campaignTitle,
    campaignSlug: p.campaignSlug,
    donorName: donor,
    amount: p.amount,
  });

  await createAndEmail({
    userId: p.creatorId,
    type: 'campaign_donation_received',
    title: `First donation received! $${(p.amount / 100).toFixed(2)}`,
    message: `${donor} just made the first donation to your campaign "${p.campaignTitle}". You'll receive funds once your campaign completes and verification is done.`,
    link: `/campaigns/${p.campaignSlug}`,
    email: { to: p.creatorEmail, ...emailContent },
  });
}

/**
 * Notify the campaign creator that their campaign has been fully funded.
 * Requests verification documents with per-category requirements.
 * This is the START of the fund release process.
 */
export async function notifyCreatorCampaignCompleted(p: {
  creatorId: string;
  creatorEmail: string;
  creatorName: string;
  campaignTitle: string;
  campaignSlug: string;
  goalAmount: number;
  donorCount: number;
  documentRequirementsHtml: string;
}) {
  const emailContent = campaignCompletedCreatorEmail({
    campaignerName: p.creatorName || 'Campaigner',
    campaignTitle: p.campaignTitle,
    campaignSlug: p.campaignSlug,
    goalAmount: p.goalAmount,
    donorCount: p.donorCount,
    documentRequirementsHtml: p.documentRequirementsHtml,
  });

  await createAndEmail({
    userId: p.creatorId,
    type: 'campaign_completed',
    title: `Your campaign "${p.campaignTitle}" is fully funded!`,
    message: `Congratulations! Your campaign has reached its goal. Complete verification to start receiving funds.`,
    link: `/dashboard/campaigns/${p.campaignSlug}/impact-update`,
    email: { to: p.creatorEmail, ...emailContent },
  });
}

/**
 * Send a verification reminder to the campaign creator.
 * Used in the escalating reminder system post-completion.
 */
export async function notifyVerificationReminder(p: {
  creatorId: string;
  creatorEmail: string;
  creatorName: string;
  campaignTitle: string;
  campaignSlug: string;
  daysSinceCompletion: number;
  deadlineDays: number;
  urgencyLevel: 'gentle' | 'firm' | 'warning' | 'final';
}) {
  const emailContent = verificationReminderEmail({
    campaignerName: p.creatorName || 'Campaigner',
    campaignTitle: p.campaignTitle,
    campaignSlug: p.campaignSlug,
    daysSinceCompletion: p.daysSinceCompletion,
    deadlineDays: p.deadlineDays,
    urgencyLevel: p.urgencyLevel,
  });

  // Use 'info_request' type for reminders - fits the existing notification category
  await createAndEmail({
    userId: p.creatorId,
    type: 'info_request',
    title: p.urgencyLevel === 'final'
      ? `Last Reminder: Verify identity for "${p.campaignTitle}"`
      : `Reminder: Complete verification for "${p.campaignTitle}"`,
    message: `Your campaign was fully funded ${p.daysSinceCompletion} days ago. Complete verification to receive your funds. ${p.deadlineDays} days remaining.`,
    link: `/dashboard/campaigns/${p.campaignSlug}/verification`,
    email: { to: p.creatorEmail, ...emailContent },
  });
}

/**
 * Notify all admins when a creator submits verification documents for review.
 * Fires once per submission (not per document) to avoid notification flooding.
 */
export async function notifyAdminsVerificationSubmitted(p: {
  campaignId: string;
  campaignTitle: string;
  creatorName: string;
  documentCount: number;
}) {
  const admins = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.role, 'admin'));

  const emailContent = verificationDocumentsAdminEmail(p);

  for (const admin of admins) {
    await createAndEmail({
      userId: admin.id,
      type: 'verification_documents_submitted',
      title: `[Verification] "${p.campaignTitle}" ready for review`,
      message: `${p.creatorName} submitted ${p.documentCount} verification document${p.documentCount === 1 ? '' : 's'}. Review required.`,
      link: `/admin/verification`,
      email: { to: admin.email, ...emailContent },
    });
  }
}

/**
 * Notify the campaign creator when their verification is approved (T1 or T2).
 */
export async function notifyCreatorVerificationApproved(p: {
  creatorId: string;
  creatorEmail: string;
  creatorName: string;
  campaignId: string;
  campaignTitle: string;
  tier: 1 | 2;
}) {
  const emailContent = verificationApprovedCreatorEmail({
    creatorName: p.creatorName || 'Campaigner',
    campaignTitle: p.campaignTitle,
    campaignId: p.campaignId,
    tier: p.tier,
  });

  const isFull = p.tier === 2;
  await createAndEmail({
    userId: p.creatorId,
    type: 'verification_approved',
    title: isFull
      ? `Your campaign is fully verified: "${p.campaignTitle}"`
      : `Identity verified for "${p.campaignTitle}"`,
    message: isFull
      ? `Congratulations! Your campaign has been fully verified and your raised funds are now available for withdrawal.`
      : `Your identity has been verified. Upload supporting documents to complete full verification.`,
    link: `/dashboard/campaigns/${p.campaignId}/verification`,
    email: { to: p.creatorEmail, ...emailContent },
  });
}

/**
 * Notify the campaign creator when their verification is rejected by an admin.
 */
export async function notifyCreatorVerificationRejected(p: {
  creatorId: string;
  creatorEmail: string;
  creatorName: string;
  campaignId: string;
  campaignTitle: string;
  reason: string;
}) {
  const emailContent = verificationRejectedCreatorEmail({
    creatorName: p.creatorName || 'Campaigner',
    campaignTitle: p.campaignTitle,
    campaignId: p.campaignId,
    reason: p.reason,
  });

  await createAndEmail({
    userId: p.creatorId,
    type: 'verification_rejected',
    title: `Verification update for "${p.campaignTitle}"`,
    message: `We were unable to complete your verification at this time. You can update your documents and resubmit from your verification dashboard.`,
    link: `/dashboard/campaigns/${p.campaignId}/verification`,
    email: { to: p.creatorEmail, ...emailContent },
  });
}

// ─── Withdrawal Notifications ───────────────────────────────────────────────

/**
 * Notify the campaign creator that their withdrawal has been completed.
 */
export async function notifyWithdrawalCompleted(p: {
  creatorId: string;
  creatorEmail: string;
  creatorName: string;
  campaignTitle: string;
  amount: number;
  transferId: string;
}) {
  const emailContent = withdrawalCompletedEmail({
    campaignerName: p.creatorName || 'Campaigner',
    campaignTitle: p.campaignTitle,
    amount: p.amount,
    transferId: p.transferId,
  });

  await createAndEmail({
    userId: p.creatorId,
    type: 'withdrawal_completed',
    title: `Withdrawal of $${(p.amount / 100).toFixed(2)} completed`,
    message: `Your withdrawal from "${p.campaignTitle}" has been successfully processed.`,
    link: '/dashboard/payout-settings',
    email: { to: p.creatorEmail, ...emailContent },
  });
}

/**
 * Notify the campaign creator that their withdrawal has failed.
 */
export async function notifyWithdrawalFailed(p: {
  creatorId: string;
  creatorEmail: string;
  creatorName: string;
  campaignTitle: string;
  amount: number;
  reason: string;
}) {
  const emailContent = withdrawalFailedEmail({
    campaignerName: p.creatorName || 'Campaigner',
    campaignTitle: p.campaignTitle,
    amount: p.amount,
    reason: p.reason,
  });

  await createAndEmail({
    userId: p.creatorId,
    type: 'withdrawal_failed',
    title: `Withdrawal of $${(p.amount / 100).toFixed(2)} failed`,
    message: `Your withdrawal from "${p.campaignTitle}" could not be completed. ${p.reason}`,
    link: '/dashboard/payout-settings',
    email: { to: p.creatorEmail, ...emailContent },
  });
}

// ─── Adaptive Behavioral Email Notifications ────────────────────────────────

/**
 * Build a DonorContext from the database for a given donor.
 * Used by adaptive template selectors to personalize messaging.
 */
export async function buildDonorContext(p: {
  donorEmail: string;
  donorName: string;
  campaignId: string;
}): Promise<DonorContext> {
  const [user] = await db
    .select({
      id: users.id,
      totalDonated: users.totalDonated,
      campaignsSupported: users.campaignsSupported,
    })
    .from(users)
    .where(eq(users.email, p.donorEmail))
    .limit(1);

  // Count donations from this email to this specific campaign
  const [campaignDonation] = await db
    .select({ count: donations.id })
    .from(donations)
    .where(
      and(
        eq(donations.donorEmail, p.donorEmail),
        eq(donations.campaignId, p.campaignId),
        eq(donations.refunded, false),
      ),
    )
    .limit(1);

  // Count total donations from this email across all campaigns
  const [totalDonationsResult] = await db
    .select({ total: count() })
    .from(donations)
    .where(
      and(
        eq(donations.donorEmail, p.donorEmail),
        eq(donations.source, 'real'),
        eq(donations.refunded, false),
      ),
    );

  return {
    donorName: p.donorName,
    donorEmail: p.donorEmail,
    totalDonationCount: totalDonationsResult?.total ?? 0,
    totalDonatedCents: user?.totalDonated ?? 0,
    campaignsSupported: user?.campaignsSupported ?? 0,
    hasGivenToThisCampaign: !!campaignDonation,
    userId: user?.id ?? null,
  };
}

/**
 * Send an adaptive donation receipt that varies based on donor history,
 * amount tier, and campaign phase.
 */
export async function notifyAdaptiveDonationReceipt(p: {
  donorEmail: string;
  donorName: string;
  amount: number;
  campaignId: string;
  campaignTitle: string;
  campaignSlug: string;
  campaignPhase: 'first_believers' | 'the_push' | 'closing_in' | 'last_donor_zone';
  campaignProgressPercent: number;
  donorCount: number;
  isAnonymous: boolean;
}) {
  const donorContext = await buildDonorContext({
    donorEmail: p.donorEmail,
    donorName: p.isAnonymous ? 'Generous Donor' : p.donorName,
    campaignId: p.campaignId,
  });

  const emailContent = adaptiveDonationReceiptEmail({
    campaignTitle: p.campaignTitle,
    campaignSlug: p.campaignSlug,
    amount: p.amount,
    donorContext,
    campaignPhase: p.campaignPhase,
    campaignProgressPercent: p.campaignProgressPercent,
    donorCount: p.donorCount,
  });

  // Also send a high-value thank you for major/large donations
  const tier = getDonorAmountTier(p.amount);
  if (tier === 'major' || tier === 'large') {
    const hvEmail = highValueDonorThankYouEmail({
      donorName: donorContext.donorName,
      amount: p.amount,
      campaignTitle: p.campaignTitle,
      campaignSlug: p.campaignSlug,
      campaignCategory: '',
      campaignProgressPercent: p.campaignProgressPercent,
      donorContext,
    });

    // High-value thank you is sent separately (delayed 1 hour in production,
    // but here we send immediately as the scheduler handles timing)
    if (donorContext.userId) {
      await createAndEmail({
        userId: donorContext.userId,
        type: 'campaign_donation_received',
        title: `Personal thank you for your ${tier === 'major' ? 'extraordinary' : 'generous'} donation`,
        message: `Your donation of $${(p.amount / 100).toFixed(2)} to "${p.campaignTitle}" stands out. Thank you.`,
        link: `/campaigns/${p.campaignSlug}`,
        email: { to: p.donorEmail, ...hvEmail },
      });
    } else {
      await sendEmailOnly({ to: p.donorEmail, ...hvEmail });
    }
  }

  // Send the receipt
  if (donorContext.userId) {
    await createAndEmail({
      userId: donorContext.userId,
      type: 'campaign_donation_received',
      title: `Donation receipt: $${(p.amount / 100).toFixed(2)} to "${p.campaignTitle}"`,
      message: `Thank you for your donation. Your receipt is in your email.`,
      link: `/campaigns/${p.campaignSlug}`,
      email: { to: p.donorEmail, ...emailContent },
    });
  } else {
    await sendEmailOnly({ to: p.donorEmail, ...emailContent });
  }
}

/**
 * Send an abandoned donation recovery email.
 * Called by a scheduled job that detects incomplete payment intents.
 */
export async function notifyAbandonedDonation(p: AbandonedDonationContext) {
  // Find registered user
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, p.donorEmail))
    .limit(1);

  const emailContent = abandonedDonationRecoveryEmail(p);

  if (user) {
    await createAndEmail({
      userId: user.id,
      type: 'abandoned_donation',
      title: p.sequenceStep === 1
        ? `You started a donation to "${p.campaignTitle}"`
        : p.sequenceStep === 2
          ? `"${p.campaignTitle}" is ${p.progressPercent}% funded`
          : `Last note about "${p.campaignTitle}"`,
      message: `You started a donation but didn't finish. The campaign is still live if you'd like to help.`,
      link: `/campaigns/${p.campaignSlug}`,
      email: { to: p.donorEmail, ...emailContent },
    });
  } else {
    await sendEmailOnly({ to: p.donorEmail, ...emailContent });
  }
}

/**
 * Send an adaptive refund email based on donor history and refund context.
 */
export async function notifyAdaptiveRefund(p: {
  donorEmail: string;
  donorName: string;
  amount: number;
  campaignId: string;
  campaignTitle: string;
  campaignSlug: string;
  refundReason: 'campaign_cancelled' | 'donor_requested' | 'admin_initiated' | 'dispute';
  similarCampaigns?: Array<{ title: string; slug: string; raised: number; goal: number }>;
}) {
  const donorContext = await buildDonorContext({
    donorEmail: p.donorEmail,
    donorName: p.donorName,
    campaignId: p.campaignId,
  });

  const emailContent = adaptiveRefundEmail({
    donorContext,
    amount: p.amount,
    campaignTitle: p.campaignTitle,
    campaignSlug: p.campaignSlug,
    refundReason: p.refundReason,
    similarCampaigns: p.similarCampaigns,
  });

  if (donorContext.userId) {
    await createAndEmail({
      userId: donorContext.userId,
      type: 'donation_refunded',
      title: `Refund of $${(p.amount / 100).toFixed(2)} processed`,
      message: `Your donation to "${p.campaignTitle}" has been refunded.`,
      link: `/campaigns/${p.campaignSlug}`,
      email: { to: p.donorEmail, ...emailContent },
    });
  } else {
    await sendEmailOnly({ to: p.donorEmail, ...emailContent });
  }
}

/**
 * Send a creator motivation/inactivity email.
 * Called by a scheduled job that monitors creator engagement.
 */
export async function notifyCreatorMotivation(p: {
  context: CreatorContext;
  emailType: CreatorEmailType;
  donorMilestone?: number;
}) {
  const emailContent = creatorMotivationEmail({
    context: p.context,
    emailType: p.emailType,
    donorMilestone: p.donorMilestone,
  });

  const isInactivity = ['engagement_drop', 'stalled_campaign'].includes(p.emailType);

  await createAndEmail({
    userId: p.context.creatorId,
    type: isInactivity ? 'creator_inactivity' : 'campaign_milestone',
    title: emailContent.subject,
    message: isInactivity
      ? `Your campaign "${p.context.campaignTitle}" could use an update. Your donors would love to hear from you.`
      : `Your campaign "${p.context.campaignTitle}" is making great progress!`,
    link: `/dashboard/campaigns/${p.context.campaignSlug}`,
    email: { to: p.context.creatorEmail, ...emailContent },
  });
}

/**
 * Send a verification escalation email with stage-appropriate messaging.
 */
export async function notifyVerificationEscalation(p: {
  creatorId: string;
  creatorEmail: string;
  creatorName: string;
  campaignTitle: string;
  campaignSlug: string;
  campaignId: string;
  stage: VerificationStage;
  donorCount: number;
  goalAmount: number;
  daysRemaining: number;
}) {
  const emailContent = verificationEscalationEmail({
    creatorName: p.creatorName || 'Campaigner',
    campaignTitle: p.campaignTitle,
    campaignSlug: p.campaignSlug,
    campaignId: p.campaignId,
    stage: p.stage,
    donorCount: p.donorCount,
    goalAmount: p.goalAmount,
    daysRemaining: p.daysRemaining,
  });

  await createAndEmail({
    userId: p.creatorId,
    type: 'info_request',
    title: emailContent.subject,
    message: `Verification for "${p.campaignTitle}": ${p.daysRemaining} days remaining.`,
    link: `/dashboard/campaigns/${p.campaignId}/verification`,
    email: { to: p.creatorEmail, ...emailContent },
  });
}

/**
 * Send a donor re-engagement email to a dormant donor.
 * Called by a scheduled job that detects donor inactivity.
 */
export async function notifyDonorReengagement(p: {
  userId: string;
  donorEmail: string;
  donorName: string;
  stage: ReengagementStage;
  lastDonationDate: string;
  totalDonatedCents: number;
  campaignsSupported: number;
  featuredCampaigns: Array<{ title: string; slug: string; progressPercent: number; category: string }>;
}) {
  const emailContent = donorReengagementEmail({
    donorName: p.donorName || 'Friend',
    donorEmail: p.donorEmail,
    stage: p.stage,
    lastDonationDate: p.lastDonationDate,
    totalDonatedCents: p.totalDonatedCents,
    campaignsSupported: p.campaignsSupported,
    featuredCampaigns: p.featuredCampaigns,
  });

  await createAndEmail({
    userId: p.userId,
    type: 'donor_reengagement',
    title: emailContent.subject,
    message: p.stage === 'farewell'
      ? `Thank you for your past donations. We hope to see you again.`
      : `New campaigns are live on LastDonor. Take a look when you have a moment.`,
    link: '/campaigns',
    email: { to: p.donorEmail, ...emailContent },
  });
}

/**
 * Send a post-donation impact email (7-day follow-up).
 * Shows the donor what their donation is accomplishing.
 */
export async function notifyPostDonationImpact(p: {
  donorEmail: string;
  donorName: string;
  campaignTitle: string;
  campaignSlug: string;
  donationDate: string;
  donationAmount: number;
  currentProgressPercent: number;
  currentDonorCount: number;
  latestUpdate?: string | null;
}) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, p.donorEmail))
    .limit(1);

  const emailContent = postDonationImpactEmail({
    donorName: p.donorName,
    campaignTitle: p.campaignTitle,
    campaignSlug: p.campaignSlug,
    donationDate: p.donationDate,
    donationAmount: p.donationAmount,
    currentProgressPercent: p.currentProgressPercent,
    currentDonorCount: p.currentDonorCount,
    latestUpdate: p.latestUpdate,
  });

  if (user) {
    await createAndEmail({
      userId: user.id,
      type: 'campaign_milestone',
      title: `Your donation to "${p.campaignTitle}" is making progress`,
      message: `The campaign is now ${p.currentProgressPercent}% funded with ${p.currentDonorCount} donors.`,
      link: `/campaigns/${p.campaignSlug}`,
      email: { to: p.donorEmail, ...emailContent },
    });
  } else {
    await sendEmailOnly({ to: p.donorEmail, ...emailContent });
  }
}

/**
 * Send a campaign update digest to a subscribed donor.
 */
export async function notifyCampaignUpdateDigest(p: {
  campaignId: string;
  campaignTitle: string;
  campaignSlug: string;
  updateTitle: string;
  updateExcerpt: string;
  progressPercent: number;
  raisedCents: number;
  goalCents: number;
}) {
  const subscribers = await getSubscribedDonors(p.campaignId);
  const nameMap = await resolveDonorNames(subscribers.map((s) => s.donorEmail));

  for (const sub of subscribers) {
    const name = nameMap.get(sub.donorEmail) ?? 'Donor';
    const emailContent = campaignUpdateDigestEmail({
      donorName: name,
      donorEmail: sub.donorEmail,
      campaignTitle: p.campaignTitle,
      campaignSlug: p.campaignSlug,
      updateTitle: p.updateTitle,
      updateExcerpt: p.updateExcerpt,
      progressPercent: p.progressPercent,
      raisedCents: p.raisedCents,
      goalCents: p.goalCents,
    });

    if (sub.userId) {
      await createAndEmail({
        userId: sub.userId,
        type: 'campaign_milestone',
        title: `Update on "${p.campaignTitle}": ${p.updateTitle}`,
        message: p.updateExcerpt.substring(0, 200),
        link: `/campaigns/${p.campaignSlug}`,
        email: { to: sub.donorEmail, ...emailContent },
      });
    } else {
      await sendEmailOnly({ to: sub.donorEmail, ...emailContent });
    }
  }
}

/**
 * Send a creator thank-you update email to subscribed donors.
 */
export async function notifyCreatorThankYouUpdate(p: {
  campaignId: string;
  campaignTitle: string;
  campaignSlug: string;
  creatorName: string;
  thankYouMessage: string;
  progressPercent: number;
}) {
  const subscribers = await getSubscribedDonors(p.campaignId);
  const nameMap = await resolveDonorNames(subscribers.map((s) => s.donorEmail));

  for (const sub of subscribers) {
    const name = nameMap.get(sub.donorEmail) ?? 'Donor';
    const emailContent = creatorThankYouUpdateEmail({
      donorName: name,
      donorEmail: sub.donorEmail,
      creatorName: p.creatorName,
      campaignTitle: p.campaignTitle,
      campaignSlug: p.campaignSlug,
      thankYouMessage: p.thankYouMessage,
      progressPercent: p.progressPercent,
    });

    if (sub.userId) {
      await createAndEmail({
        userId: sub.userId,
        type: 'campaign_milestone',
        title: `Message from ${p.creatorName} about "${p.campaignTitle}"`,
        message: `The campaign creator posted a personal thank-you message for donors.`,
        link: `/campaigns/${p.campaignSlug}`,
        email: { to: sub.donorEmail, ...emailContent },
      });
    } else {
      await sendEmailOnly({ to: sub.donorEmail, ...emailContent });
    }
  }
}

// ─── Impact Update Notifications ────────────────────────────────────────────

/**
 * Notify admins when a campaigner submits an impact update for review.
 */
export async function notifyAdminImpactUpdateSubmitted(p: {
  campaignTitle: string;
  campaignSlug: string;
  creatorName: string;
}) {
  const admins = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.role, 'admin'));

  for (const admin of admins) {
    await createAndEmail({
      userId: admin.id,
      type: 'campaign_milestone' as NotificationType,
      title: `[Impact Update] "${p.campaignTitle}" submitted`,
      message: `${p.creatorName} submitted an impact update showing how funds were used. Review required.`,
      link: `/admin/impact-updates`,
    });
  }
}

/**
 * Notify campaigner that their impact update was approved.
 */
export async function notifyCreatorImpactUpdateApproved(p: {
  creatorId: string;
  creatorEmail: string;
  creatorName: string;
  campaignTitle: string;
  campaignSlug: string;
}) {
  await createAndEmail({
    userId: p.creatorId,
    type: 'campaign_milestone' as NotificationType,
    title: `Impact update approved for "${p.campaignTitle}"`,
    message: `Your impact update has been reviewed and approved. Thank you for showing your supporters how their donations made a difference.`,
    link: `/campaigns/${p.campaignSlug}`,
    email: {
      to: p.creatorEmail,
      subject: `Impact update approved - ${p.campaignTitle}`,
      html: `<p>Hi ${p.creatorName},</p><p>Your impact update for "<strong>${p.campaignTitle}</strong>" has been reviewed and approved.</p><p>Your supporters can now see exactly how their donations were used. Thank you for your transparency!</p><p><a href="https://lastdonor.org/campaigns/${p.campaignSlug}">View your campaign</a></p>`,
    },
  });
}

/**
 * Notify campaigner that their impact update needs changes.
 */
export async function notifyCreatorImpactUpdateRejected(p: {
  creatorId: string;
  creatorEmail: string;
  creatorName: string;
  campaignTitle: string;
  campaignSlug: string;
  reviewerNotes: string;
}) {
  await createAndEmail({
    userId: p.creatorId,
    type: 'campaign_milestone' as NotificationType,
    title: `Changes requested for impact update on "${p.campaignTitle}"`,
    message: `Your impact update needs some changes before it can be approved. Please review the feedback and resubmit.`,
    link: `/dashboard/campaigns/${p.campaignSlug}/impact-update`,
    email: {
      to: p.creatorEmail,
      subject: `Changes requested - Impact update for ${p.campaignTitle}`,
      html: `<p>Hi ${p.creatorName},</p><p>Your impact update for "<strong>${p.campaignTitle}</strong>" needs a few changes before we can approve it.</p><p><strong>Feedback:</strong> ${p.reviewerNotes}</p><p><a href="https://lastdonor.org/dashboard/campaigns/${p.campaignSlug}/impact-update">Update your submission</a></p>`,
    },
  });
}
