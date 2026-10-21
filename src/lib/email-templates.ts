/**
 * Branded email template builder for LastDonor.org.
 * Provides a consistent email shell and per-action content generators.
 *
 * Design tokens match the existing donation receipt / password reset emails:
 * - Font: DM Sans
 * - Primary brand teal: #0F766E
 * - Accent orange CTA: #EA580C
 * - Max width: 600px
 */

import { formatMoney } from '@/lib/money/format';
import { renderEmail, emailButton, escapeHtml } from './email-shell';

const BASE_URL = process.env.NEXTAUTH_URL || 'https://lastdonor.org';

/** Escaping lives in the shell so there is one implementation. */
const esc = escapeHtml;

/**
 * Every template in this file renders through the one shared shell.
 *
 * This used to be a bare `div` with no doctype, no `<head>` and no tables,
 * which Outlook's Word engine cannot lay out reliably, and it emitted no
 * inbox preview line. `renderEmail` supplies all of that; `derivePreheader`
 * means each template gains a preview line without being rewritten. See
 * `email-shell.ts` and `docs/67`.
 */
function wrap(body: string, preheader?: string): string {
  return renderEmail({ body, preheader });
}

/**
 * Padding on an inline `<a>` is ignored by Outlook's Word engine, so the old
 * version of this rendered the primary action as plain blue text there.
 * `emailButton` wraps a table in VML for exactly that case.
 */
function ctaButton(href: string, label: string): string {
  return emailButton(href, label, 'primary');
}

/**
 * Render an amount for an email.
 *
 * Defaults to USD so the 19 call sites that predate multi-currency are
 * unchanged, but every template that states an amount a donor or campaigner
 * actually paid or received now passes the currency through. An email is the
 * copy of a money fact that people keep, so a KES gift receipted as "$50.00"
 * is not a formatting slip - it is a wrong figure, off by the exchange rate.
 *
 * Grouping changed with this: the old implementation produced `$100000.00`
 * and `formatMoney` produces `$100,000.00`. No test pinned the ungrouped
 * form and the grouped one is what every other surface already renders
 * (`src/components/ui/Money.tsx`).
 */
function formatCents(cents: number, currency: string = 'USD'): string {
  return formatMoney(cents, currency, 'exact');
}

// ─── Email generators ───────────────────────────────────────────────────────

export function donationRefundedEmail(p: {
  donorName: string;
  amount: number;
  campaignTitle: string;
  campaignSlug: string;
}) {
  return {
    subject: `Refund Processed - ${p.campaignTitle}`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Donation Refund Processed</h1>
      <p>Dear ${esc(p.donorName)},</p>
      <p>Your <strong>${formatCents(p.amount)}</strong> donation to <strong>${esc(p.campaignTitle)}</strong> has been refunded. The refund will appear on your statement within 5–10 business days.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Amount Refunded</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;">${formatCents(p.amount)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Campaign</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">${esc(p.campaignTitle)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Date</td>
          <td style="padding: 8px 0; text-align: right;">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
        </tr>
      </table>
      <p style="color: #666; font-size: 14px;">If you have questions about this refund, please contact us at <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `),
  };
}

export function donationRefundReversedEmail(p: {
  donorName: string;
  amount: number;
  campaignTitle: string;
}) {
  return {
    subject: `Refund Reversed - ${p.campaignTitle}`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Refund Reversed</h1>
      <p>Dear ${esc(p.donorName)},</p>
      <p>A previously processed refund for your <strong>${formatCents(p.amount)}</strong> donation to <strong>${esc(p.campaignTitle)}</strong> has been reversed. Your donation is now active again.</p>
      <p style="color: #666; font-size: 14px;">If you have questions, please contact us at <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `),
  };
}

export function campaignCompletedEmail(p: {
  donorName: string;
  campaignTitle: string;
  campaignSlug: string;
  goalAmount: number;
  /** ISO 4217 of the amounts above. Defaults to USD. */
  currency?: string;
}) {
  return {
    subject: `Great News! "${p.campaignTitle}" Reached Its Goal!`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Campaign Goal Reached!</h1>
      <p>Dear ${esc(p.donorName)},</p>
      <p>Thanks to generous donors like you, the campaign <strong>${esc(p.campaignTitle)}</strong> has reached its goal of <strong>${formatCents(p.goalAmount, p.currency)}</strong>!</p>
      <p>Your contribution made a real difference. Every donation brought this campaign closer to success, and we are grateful for your support.</p>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'View Campaign')}
    `),
  };
}

export function campaignArchivedEmail(p: {
  donorName: string;
  campaignTitle: string;
}) {
  return {
    subject: `Campaign Update - ${p.campaignTitle}`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Campaign Update</h1>
      <p>Dear ${esc(p.donorName)},</p>
      <p>The campaign <strong>${esc(p.campaignTitle)}</strong> has been concluded by our team. All donations and contributions have been recorded and accounted for.</p>
      <p style="color: #666; font-size: 14px;">If you have any questions about this campaign or your donation, please contact us at <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `),
  };
}

export function campaignStatusChangedEmail(p: {
  donorName: string;
  campaignTitle: string;
  campaignSlug: string;
  newStatus: string;
}) {
  const statusDisplay = p.newStatus.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  return {
    subject: `Campaign Update - ${p.campaignTitle}`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Campaign Status Update</h1>
      <p>Dear ${esc(p.donorName)},</p>
      <p>The campaign <strong>${esc(p.campaignTitle)}</strong> has been updated to <strong>${esc(statusDisplay)}</strong> status.</p>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'View Campaign')}
    `),
  };
}

export function roleChangedEmail(p: {
  userName: string;
  previousRole: string;
  newRole: string;
}) {
  return {
    subject: 'Your Account Role Has Been Updated - LastDonor.org',
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Account Role Updated</h1>
      <p>Dear ${esc(p.userName)},</p>
      <p>Your LastDonor.org account role has been changed from <strong>${esc(p.previousRole)}</strong> to <strong>${esc(p.newRole)}</strong>.</p>
      ${p.newRole === 'editor' || p.newRole === 'admin'
        ? `<p>You now have access to the admin panel where you can help manage campaigns and content.</p>${ctaButton(`${BASE_URL}/admin`, 'Go to Admin Panel')}`
        : `<p>Your account permissions have been updated accordingly.</p>`
      }
      <p style="color: #666; font-size: 14px;">If you did not expect this change, please contact us immediately at <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `),
  };
}

export function accountDeletedEmail(p: {
  userName: string;
}) {
  return {
    subject: 'Your LastDonor.org Account Has Been Removed',
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Account Removed</h1>
      <p>Dear ${esc(p.userName)},</p>
      <p>Your LastDonor.org account has been removed by an administrator. Your donation records have been anonymized for financial compliance, and your personal information has been deleted.</p>
      <p style="color: #666; font-size: 14px;">If you believe this was done in error, please contact us at <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `),
  };
}

export function campaignSubmittedEmail(p: {
  campaignTitle: string;
  creatorName: string;
  category: string;
  goalAmount: number;
  campaignId: string;
}) {
  return {
    subject: `[Admin] Review needed: ${p.campaignTitle}`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">A campaign is waiting for review</h1>
      <p>A new campaign has been submitted and is <strong>not public</strong> until someone approves it:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px 0; color: #666; width: 120px;">Title</td><td style="padding: 8px 0; font-weight: 600;">${esc(p.campaignTitle)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Created by</td><td style="padding: 8px 0;">${esc(p.creatorName)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Category</td><td style="padding: 8px 0;">${esc(p.category)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Goal</td><td style="padding: 8px 0;">${formatCents(p.goalAmount)}</td></tr>
      </table>
      <p>Nobody can see or donate to it while it sits here, so the organiser is waiting on this.</p>
      ${ctaButton(BASE_URL + '/admin/campaigns/' + p.campaignId + '/edit', 'Review campaign')}
    `),
  };
}

/**
 * The organiser's receipt for a submission. Sent INSTEAD of
 * `welcomeCampaignerEmail`, which now fires only on approval.
 *
 * Deliberately short — three facts, once each. The previous version spent
 * 95 visible words saying them repeatedly: the subject, the preheader, the
 * h1 and the opening sentence each announced that the campaign was in
 * review, the campaign title appeared three times, and a whole line ("You
 * can see the campaign and its status any time in your dashboard")
 * described the button sitting directly beneath it. 43 words now.
 *
 * The preheader is passed explicitly rather than derived. `derivePreheader`
 * takes the opening body text, which made the inbox preview a second copy
 * of the subject line; the one slot that could carry new information spent
 * it on repetition.
 *
 * Two things are deliberately NOT said:
 *
 * 1. Any turnaround time. The platform has never published a reviewed user
 *    campaign, so there is no honest "typically within N hours" to quote —
 *    the same reason that phrase came out of the wizard in `docs/77`.
 *
 * 2. That we will write if the campaign needs changes. It used to promise
 *    "If anything needs changing first, we will tell you exactly what", and
 *    nothing in the product does that: `under_review` transitions only to
 *    `active` or `suspended`, and the suspend path notifies nobody at all.
 *    Approval is the one outcome we can commit to writing about, so it is
 *    the only one promised. See `docs/93`.
 */
export function campaignSubmittedForReviewEmail(p: {
  campaignerName: string;
  campaignTitle: string;
}) {
  return {
    subject: `Received: "${p.campaignTitle}"`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your campaign is in review</h1>
      <p>Thanks, ${esc(p.campaignerName)}. It is not public and cannot take donations until a reviewer approves it.</p>
      <p>We will email you when it goes live.</p>
      ${ctaButton(`${BASE_URL}/dashboard`, 'Check status')}
    `,
      'A person reviews every campaign before it goes live.',
    ),
  };
}

// ─── Phase 2: Governance & Transparency email templates ─────────────────────

export function campaignPausedDonorEmail(p: {
  donorName: string;
  campaignTitle: string;
  campaignSlug: string;
  reason: string;
}) {
  return {
    subject: `Update on "${p.campaignTitle}" - Campaign Paused`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Campaign Update</h1>
      <p>Dear ${esc(p.donorName)},</p>
      <p>The campaign <strong>${esc(p.campaignTitle)}</strong> has been temporarily paused.</p>
      <p><strong>Reason:</strong> ${esc(p.reason)}</p>
      <p style="color: #666;">Your funds are secure. We will notify you when the campaign resumes or if further action is needed.</p>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'View Campaign')}
      <p style="color: #666; font-size: 14px;">Questions? Contact us at <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `),
  };
}

export function campaignResumedDonorEmail(p: {
  donorName: string;
  campaignTitle: string;
  campaignSlug: string;
}) {
  return {
    subject: `Good News! "${p.campaignTitle}" Has Resumed`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Campaign Resumed</h1>
      <p>Dear ${esc(p.donorName)},</p>
      <p>Great news - the campaign <strong>${esc(p.campaignTitle)}</strong> has resumed and is now accepting donations again.</p>
      <p>Thank you for your patience and continued support.</p>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'View Campaign')}
    `),
  };
}

export function campaignSuspendedDonorEmail(p: {
  donorName: string;
  campaignTitle: string;
  campaignSlug: string;
}) {
  return {
    subject: `Update on "${p.campaignTitle}" - Under Review`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Campaign Under Review</h1>
      <p>Dear ${esc(p.donorName)},</p>
      <p>The campaign <strong>${esc(p.campaignTitle)}</strong> is currently being reviewed by our team to make sure everything checks out.</p>
      <p style="color: #666;">Your funds are held securely. We will notify you once the review is complete. If anything changes, you will receive a full refund automatically.</p>
      <p style="color: #666; font-size: 14px;">Questions? Contact us at <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `),
  };
}

export function campaignCancelledRefundEmail(p: {
  donorName: string;
  campaignTitle: string;
  donationAmount: number;
  cancellationReason: string;
  refundReference?: string;
  similarCampaigns?: Array<{ title: string; slug: string; raised: number; goal: number }>;
}) {
  const formatCard = (c: { title: string; slug: string; raised: number; goal: number }) => `
    <div style="border: 1px solid #eee; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <p style="font-weight: 600; margin: 0 0 4px;">${esc(c.title)}</p>
      <p style="color: #666; margin: 0 0 8px; font-size: 14px;">${formatCents(c.raised)} raised of ${formatCents(c.goal)} - ✅ Fully Verified</p>
      <a href="${BASE_URL}/campaigns/${c.slug}" style="background-color: #EA580C; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">Donate Now</a>
    </div>
  `;

  const similarSection = p.similarCampaigns && p.similarCampaigns.length > 0
    ? `
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <h2 style="color: #0F766E; font-size: 18px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">You Can Still Make a Difference</h2>
      <p>Here are reviewed campaigns that need your support:</p>
      ${p.similarCampaigns.map(formatCard).join('')}
      ${ctaButton(`${BASE_URL}/campaigns`, 'View All Reviewed Campaigns')}
    `
    : '';

  return {
    subject: `Important: Your Donation to "${p.campaignTitle}" Has Been Refunded`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Donation Refunded</h1>
      <p>Dear ${esc(p.donorName)},</p>
      <p>We're writing to inform you that the campaign <strong>"${esc(p.campaignTitle)}"</strong> has been cancelled.</p>

      <h3 style="color: #333; margin: 20px 0 8px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">What Happened</h3>
      <p>${esc(p.cancellationReason)}</p>

      <h3 style="color: #333; margin: 20px 0 8px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your Refund</h3>
      <p>Your donation of <strong>${formatCents(p.donationAmount)}</strong> has been fully refunded to your original payment method. Please allow 5–10 business days for the refund to appear on your statement.</p>
      ${p.refundReference ? `<p style="color: #666; font-size: 14px;">Refund Reference: ${esc(p.refundReference)}</p>` : ''}

      <h3 style="color: #333; margin: 20px 0 8px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Our Commitment to You</h3>
      <p>We take your trust seriously. At LastDonor.org, every campaign goes through a careful review process, and your generosity is always protected.</p>

      ${similarSection}
      <p style="color: #666; font-size: 14px;">Need help? 📧 <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a></p>
    `),
  };
}

export function infoRequestCampaignerEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  requestType: string;
  details: string;
  deadline: string;
  campaignId: string;
}) {
  return {
    subject: `Next Step for Your Campaign "${p.campaignTitle}"`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">We Need a Little More Info</h1>
      <p>Dear ${esc(p.campaignerName)},</p>
      <p>Our team is reviewing your campaign <strong>"${esc(p.campaignTitle)}"</strong> and we need a bit more information to keep things moving.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px 0; color: #666; width: 120px;">Request</td><td style="padding: 8px 0;">${esc(p.requestType.replace(/_/g, ' '))}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Due by</td><td style="padding: 8px 0; font-weight: 600; color: #0F766E;">${esc(p.deadline)}</td></tr>
      </table>
      <p><strong>Details:</strong> ${esc(p.details)}</p>
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignId}/verification`, 'Respond Now')}
      <p style="color: #666; font-size: 14px;">Need more time? Contact us at <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a>.</p>
    `),
  };
}

export function infoRequestReminderEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  daysLeft: number;
  campaignId: string;
}) {
  return {
    subject: `Quick Reminder: ${p.daysLeft} Day${p.daysLeft === 1 ? '' : 's'} Left to Respond - "${p.campaignTitle}"`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">A Quick Reminder</h1>
      <p>Dear ${esc(p.campaignerName)},</p>
      <p>You have <strong>${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'}</strong> remaining to provide the requested information for your campaign <strong>"${esc(p.campaignTitle)}"</strong>.</p>
      <p style="color: #666;">If we don't hear from you, there may be a delay in releasing your funds.</p>
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignId}/verification`, 'Respond Now')}
    `),
  };
}

export function welcomeCampaignerEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  campaignSlug: string;
}) {
  return {
    subject: `Your Campaign Is Live! Share "${p.campaignTitle}" Now`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your Campaign Is Live!</h1>
      <p>Dear ${esc(p.campaignerName)},</p>
      <p>Congratulations! Your campaign <strong>"${esc(p.campaignTitle)}"</strong> is now live and ready to receive donations.</p>
      <p style="font-size: 16px; color: #333; font-weight: 600; margin: 20px 0 8px;">Here's how to get your first donation fast:</p>
      <ol style="line-height: 2; color: #333;">
        <li><strong>Share with 5 close friends or family members</strong> - personal messages work 10x better than social posts</li>
        <li><strong>Be the first to donate</strong> - even a small donation signals trust and encourages others to give</li>
        <li><strong>Post on social media</strong> - share your campaign link with a personal note about why this matters</li>
        <li><strong>Send the link directly</strong> - WhatsApp, text, or email your campaign to people who care</li>
      </ol>
      <p style="background: #f0fdf4; padding: 16px; border-radius: 8px; border-left: 4px solid #0F766E; margin: 20px 0;">
        <strong>Worth knowing:</strong> an empty total asks every visitor to be the first one. Getting that first donation, even a small one from someone close to you, is what turns the page from a request into something already moving.
      </p>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'View & Share Your Campaign')}
      <p style="color: #666; font-size: 14px;">Questions? We're here to help at <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a></p>
    `),
  };
}

export function donationReceivedEmail(p: {
  campaignTitle: string;
  campaignSlug: string;
  donorName: string;
  amount: number;
  /** ISO 4217 of the amounts above. Defaults to USD. */
  currency?: string;
  isAnonymous: boolean;
  message?: string | null;
}) {
  const donor = p.isAnonymous ? 'Anonymous' : p.donorName;
  return {
    subject: `New Donation: ${formatCents(p.amount, p.currency)} to "${p.campaignTitle}"`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">New Donation Received</h1>
      <p>A donation has been made to <strong>"${esc(p.campaignTitle)}"</strong>.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px 0; color: #666; width: 120px;">Donor</td><td style="padding: 8px 0; font-weight: 600;">${esc(donor)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Amount</td><td style="padding: 8px 0; font-weight: 600;">${formatCents(p.amount, p.currency)}</td></tr>
      </table>
      ${p.message ? `<p><strong>Message from donor:</strong></p><blockquote style="border-left: 3px solid #0F766E; margin: 12px 0; padding: 8px 16px; color: #444;">${esc(p.message)}</blockquote>` : ''}
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'View Campaign')}
    `),
  };
}

/**
 * The donor's own receipt.
 *
 * Moved here 2026-10-16 from an inline template literal in
 * `payment-service.ts`, where it was the other half of the gap `docs/67`
 * left (see the password reset family below). Two things were wrong with it
 * beyond the missing shell:
 *
 *  1. **`donorName` and `campaignTitle` were interpolated into HTML
 *     unescaped.** `donorName` is a free-text field the donor types into the
 *     checkout form, carried through Stripe metadata and straight into the
 *     markup of an email. `esc()` everywhere now, which is the rule every
 *     other template in this file already followed.
 *  2. The date was computed with `toLocaleDateString` on the SERVER, so the
 *     receipt was stamped in the container's locale and timezone rather than
 *     anything meaningful to the donor. It is now an explicit UTC date,
 *     labelled as such, because a receipt that says "October 16, 2026" with
 *     no zone is a figure that cannot be reconciled.
 */
export function donationReceiptEmail(p: {
  campaignTitle: string;
  donorName: string;
  isAnonymous: boolean;
  amount: number;
  /** ISO 4217 of `amount`. Defaults to USD for callers that predate KES. */
  currency?: string;
  transactionId: string;
  date?: Date;
}) {
  const greeting = p.isAnonymous || !p.donorName ? 'Donor' : p.donorName;
  const stamped = (p.date ?? new Date()).toISOString().slice(0, 10);
  return {
    subject: `Donation receipt - ${p.campaignTitle}`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Thank you for your donation</h1>
      <p>Dear ${esc(greeting)},</p>
      <p>Your donation to <strong>${esc(p.campaignTitle)}</strong> has been received and processed.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Amount</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;">${formatCents(p.amount, p.currency)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Campaign</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">${esc(p.campaignTitle)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Transaction ID</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-family: monospace; font-size: 12px;">${esc(p.transactionId)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Date</td><td style="padding: 8px 0; text-align: right;">${stamped} (UTC)</td></tr>
      </table>
      <p style="color: #666; font-size: 14px;">LastDonor charges no platform fee, so the full amount above went to the campaign less Stripe&rsquo;s processing fee.</p>
      <p style="color: #666; font-size: 14px;">Please keep this email as confirmation of your donation. It is not a tax receipt and does not determine tax deductibility. Consult a tax advisor about your own situation.</p>
    `),
  };
}

export function bulkRefundCompletedEmail(p: {
  adminName: string;
  campaignTitle: string;
  totalDonors: number;
  totalAmount: number;
  failedCount: number;
}) {
  return {
    subject: `Refund Batch Complete - "${p.campaignTitle}"`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Bulk Refund Completed</h1>
      <p>The refund batch for campaign <strong>"${esc(p.campaignTitle)}"</strong> has been processed.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px 0; color: #666;">Donors Refunded</td><td style="padding: 8px 0; font-weight: 600;">${p.totalDonors}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Total Amount</td><td style="padding: 8px 0; font-weight: 600;">${formatCents(p.totalAmount)}</td></tr>
        ${p.failedCount > 0 ? `<tr><td style="padding: 8px 0; color: #c00;">Failed</td><td style="padding: 8px 0; color: #c00; font-weight: 600;">${p.failedCount}</td></tr>` : ''}
      </table>
      ${p.failedCount > 0 ? '<p style="color: #c00;">Please review the failed refunds in the admin panel.</p>' : ''}
      ${ctaButton(`${BASE_URL}/admin/campaigns`, 'View in Admin')}
    `),
  };
}

// ─── New: Instant-live & post-completion templates ──────────────────────────

export function firstDonationCelebrationEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  campaignSlug: string;
  donorName: string;
  amount: number;
  /** ISO 4217 of the amounts above. Defaults to USD. */
  currency?: string;
}) {
  return {
    subject: `You Got Your First Donation! "${p.campaignTitle}"`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your First Donation Is In!</h1>
      <p>Dear ${esc(p.campaignerName)},</p>
      <p><strong>${esc(p.donorName)}</strong> just made the first donation of <strong>${formatCents(p.amount, p.currency)}</strong> to your campaign <strong>"${esc(p.campaignTitle)}"</strong>. This is a huge moment!</p>
      <p style="background: #f0fdf4; padding: 16px; border-radius: 8px; border-left: 4px solid #0F766E; margin: 20px 0;">
        <strong>Set up your payout account now</strong> so you're ready to receive funds once verification is complete. It only takes a few minutes.
      </p>
      ${ctaButton(`${BASE_URL}/dashboard/payout-settings`, 'Set Up Payouts')}
      <p style="font-size: 16px; font-weight: 600; color: #333;">Share the news and keep the momentum going:</p>
      <p>Once your campaign reaches its goal, you'll complete a quick verification process to receive your funds.</p>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'View Your Campaign')}
      <p style="font-weight: 600; margin-top: 24px;">Keep the momentum going:</p>
      <ul style="line-height: 2; color: #333;">
        <li>Share this achievement with your supporters - "We just got our first donation!"</li>
        <li>Thank ${esc(p.donorName)} publicly on social media (with their permission)</li>
        <li>Send your campaign link to 5 more people today</li>
      </ul>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'View Your Campaign')}
    `),
  };
}

export function campaignCompletedCreatorEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  campaignSlug: string;
  goalAmount: number;
  /** ISO 4217 of the amounts above. Defaults to USD. */
  currency?: string;
  donorCount: number;
  documentRequirementsHtml: string;
}) {
  return {
    subject: `Congratulations! "${p.campaignTitle}" Is Fully Funded!`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your Campaign Is Fully Funded!</h1>
      <p>Dear ${esc(p.campaignerName)},</p>
      <p>Incredible news! Your campaign <strong>"${esc(p.campaignTitle)}"</strong> has reached its goal of <strong>${formatCents(p.goalAmount, p.currency)}</strong> thanks to <strong>${p.donorCount}</strong> generous donor${p.donorCount === 1 ? '' : 's'}.</p>
      <p style="background: #f0fdf4; padding: 20px; border-radius: 8px; border-left: 4px solid #0F766E; margin: 24px 0; font-size: 16px;">
        <strong>What happens next?</strong> To release your funds, we need to verify your identity and review evidence that funds are being used as described. This protects both you and your donors.
      </p>
      <h2 style="color: #333; font-size: 18px; margin: 24px 0 12px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Documents we'll need from you:</h2>
      <ol style="line-height: 2; color: #333;">
        ${p.documentRequirementsHtml}
      </ol>
      <h2 style="color: #333; font-size: 18px; margin: 24px 0 12px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">How to receive your funds:</h2>
      <ol style="line-height: 2; color: #333;">
        <li><strong>Verify your identity</strong> - Upload your ID and a selfie (takes 2 minutes)</li>
        <li><strong>Upload supporting documents</strong> - Provide evidence for your campaign</li>
        <li><strong>Admin review</strong> - Our team reviews and approves within 48 hours</li>
        <li><strong>Withdraw your funds</strong> - Full amount released to your connected bank account</li>
      </ol>
      <p style="color: #0F766E; font-weight: 600;">We recommend completing verification within 14 days so your funds can be released.</p>
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignSlug}/verification`, 'Start Verification Now')}
      <p style="color: #666; font-size: 14px;">Need help? Our team is ready at <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a></p>
    `),
  };
}

export function verificationReminderEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  campaignSlug: string;
  daysSinceCompletion: number;
  deadlineDays: number;
  urgencyLevel: 'gentle' | 'firm' | 'warning' | 'final';
}) {
  const urgencyConfig = {
    gentle: {
      subject: `Reminder: Complete Verification to Receive Funds - "${p.campaignTitle}"`,
      heading: 'Friendly Reminder',
      headingColor: '#0F766E',
      body: `<p>Your campaign <strong>"${esc(p.campaignTitle)}"</strong> was fully funded ${p.daysSinceCompletion} days ago. Your donors are excited to see their contributions put to use!</p><p>Complete your verification to start receiving funds. It only takes a few minutes.</p>`,
    },
    firm: {
      subject: `Next Step: ${p.deadlineDays} Days Left to Complete Verification - "${p.campaignTitle}"`,
      heading: 'Verification Reminder',
      headingColor: '#0F766E',
      body: `<p>It's been ${p.daysSinceCompletion} days since your campaign <strong>"${esc(p.campaignTitle)}"</strong> was fully funded, and we haven't received your verification documents yet.</p><p>You have <strong>${p.deadlineDays} days remaining</strong> to complete verification. After that, we may need to return funds to your donors.</p>`,
    },
    warning: {
      subject: `Important: ${p.deadlineDays} Days Left to Verify - "${p.campaignTitle}"`,
      heading: 'Verification Reminder',
      headingColor: '#EA580C',
      body: `<p>Your campaign <strong>"${esc(p.campaignTitle)}"</strong> has been fully funded for ${p.daysSinceCompletion} days. To release your funds, we need to complete verification.</p><p style="color: #EA580C; font-weight: 600;">You have ${p.deadlineDays} days remaining to complete this step.</p><p>If you're having trouble with verification, please reach out - we want to help you receive these funds.</p>`,
    },
    final: {
      subject: `Last Reminder: ${p.deadlineDays} Days to Complete Verification - "${p.campaignTitle}"`,
      heading: 'Last Reminder',
      headingColor: '#EA580C',
      body: `<p>This is a final reminder regarding your campaign <strong>"${esc(p.campaignTitle)}"</strong>.</p><p style="color: #EA580C; font-weight: 600;">Without verification within ${p.deadlineDays} days, we will need to return donated funds to your donors.</p><p>We understand life gets busy. If you need more time or are experiencing difficulties, contact us immediately - we may be able to extend your timeline.</p>`,
    },
  };

  const config = urgencyConfig[p.urgencyLevel];
  return {
    subject: config.subject,
    html: wrap(`
      <h1 style="color: ${config.headingColor}; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">${config.heading}</h1>
      <p>Dear ${esc(p.campaignerName)},</p>
      ${config.body}
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignSlug}/verification`, 'Complete Verification Now')}
      <p style="color: #666; font-size: 14px;">Need help? Contact <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a> - we're here for you.</p>
    `),
  };
}

// ─── Identity Verification Emails ──────────────────────────────────────────

export function identityApprovedEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  campaignSlug: string;
}) {
  return {
    subject: `Identity Verified - "${p.campaignTitle}"`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Identity Verified</h1>
      <p>Dear ${esc(p.campaignerName)},</p>
      <p>Great news! Your identity for <strong>"${esc(p.campaignTitle)}"</strong> has been successfully verified.</p>
      <p>You can now proceed to upload your supporting documents (receipts, medical letters, etc.) to complete the full verification and start receiving funds.</p>
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignSlug}/verification`, 'Continue Verification')}
      <p style="color: #666; font-size: 14px;">Questions? Contact <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a></p>
    `),
  };
}

export function identityDeclinedEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  campaignSlug: string;
  reason: string;
}) {
  return {
    subject: `Identity Verification Update - "${p.campaignTitle}"`,
    html: wrap(`
      <h1 style="color: #DC2626; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Identity Verification Unsuccessful</h1>
      <p>Dear ${esc(p.campaignerName)},</p>
      <p>Unfortunately, the identity verification for <strong>"${esc(p.campaignTitle)}"</strong> was not successful.</p>
      <p><strong>Reason:</strong> ${esc(p.reason)}</p>
      <p>You can try again from your verification dashboard. Please ensure your ID is valid, clearly visible, and matches your profile information.</p>
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignSlug}/verification`, 'Try Again')}
      <p style="color: #666; font-size: 14px;">Need help? Contact <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a></p>
    `),
  };
}

export function identityResubmissionEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  campaignSlug: string;
}) {
  return {
    subject: `Resubmission Needed - "${p.campaignTitle}"`,
    html: wrap(`
      <h1 style="color: #EA580C; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Resubmission Needed</h1>
      <p>Dear ${esc(p.campaignerName)},</p>
      <p>The identity verification for <strong>"${esc(p.campaignTitle)}"</strong> requires resubmission. This can happen when the submitted images were unclear or the document could not be fully read.</p>
      <p>Please return to your verification dashboard and start a new identity verification session.</p>
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignSlug}/verification`, 'Re-verify Identity')}
      <p style="color: #666; font-size: 14px;">Need help? Contact <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a></p>
    `),
  };
}

// ─── Document review & decision emails ──────────────────────────────────────

/**
 * Notify admins that a campaign creator has submitted verification documents for review.
 */
export function verificationDocumentsAdminEmail(p: {
  campaignTitle: string;
  creatorName: string;
  documentCount: number;
  campaignId: string;
}) {
  return {
    subject: `[Admin] Verification Submission: "${p.campaignTitle}"`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">[Admin] New Verification Submission</h1>
      <p>A campaign creator has submitted documents for verification review:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px 0; color: #666; width: 140px;">Campaign</td><td style="padding: 8px 0; font-weight: 600;">${esc(p.campaignTitle)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Creator</td><td style="padding: 8px 0;">${esc(p.creatorName)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Documents</td><td style="padding: 8px 0;">${p.documentCount} file${p.documentCount === 1 ? '' : 's'} uploaded</td></tr>
      </table>
      <p>Please review the submitted documents and take action within 1 to 2 business days.</p>
      ${ctaButton(`${BASE_URL}/admin/verification`, 'Review in Admin Queue')}
    `),
  };
}

/**
 * Notify the campaign creator that their verification has been approved.
 */
export function verificationApprovedCreatorEmail(p: {
  creatorName: string;
  campaignTitle: string;
  campaignId: string;
  tier: 1 | 2;
}) {
  const isFull = p.tier === 2;
  return {
    subject: isFull
      ? `Fully Verified! Funds Are Ready to Release - "${p.campaignTitle}"`
      : `Identity Verified! Next Step - "${p.campaignTitle}"`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">${isFull ? 'Full Verification Approved' : 'Identity Verification Approved'}</h1>
      <p>Dear ${esc(p.creatorName)},</p>
      ${isFull
        ? `<p>Excellent news! Your campaign <strong>"${esc(p.campaignTitle)}"</strong> has been fully verified. Your raised funds are now available for withdrawal.</p>
           <p>Visit your Payout Settings to withdraw funds to your connected bank account. If you have any questions, contact us at <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a>.</p>`
        : `<p>Your identity has been successfully verified for campaign <strong>"${esc(p.campaignTitle)}"</strong>.</p>
           <p style="background: #f0fdf4; padding: 16px; border-radius: 8px; border-left: 4px solid #0F766E; margin: 16px 0;">
             <strong>Next step:</strong> Upload your supporting documents (hospital letters, receipts, official correspondence) from your verification dashboard. Our team will review and complete the full verification.
           </p>`
      }
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignId}/verification`, 'View Verification Status')}
      <p style="color: #666; font-size: 14px;">Questions? Contact <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a></p>
    `),
  };
}

/**
 * Notify the campaign creator that their verification has been rejected.
 */
export function verificationRejectedCreatorEmail(p: {
  creatorName: string;
  campaignTitle: string;
  campaignId: string;
  reason: string;
}) {
  return {
    subject: `Verification Update - "${p.campaignTitle}"`,
    html: wrap(`
      <h1 style="color: #EA580C; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Verification Update</h1>
      <p>Dear ${esc(p.creatorName)},</p>
      <p>We were unable to complete the verification for your campaign <strong>"${esc(p.campaignTitle)}"</strong> at this time.</p>
      <p style="background: #fff7ed; padding: 16px; border-radius: 8px; border-left: 4px solid #EA580C; margin: 16px 0;">
        <strong>What we found:</strong> ${esc(p.reason)}
      </p>
      <p>You can update your documents and resubmit from your verification dashboard. If you have questions or think something was missed, we are happy to help.</p>
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignId}/verification`, 'Resubmit Documents')}
      <p style="color: #666; font-size: 14px;">Need help? Contact <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a> and we will assist you.</p>
    `),
  };
}

// ─── Withdrawal / Payout Emails ─────────────────────────────────────────────

export function withdrawalCompletedEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  amount: number;
  transferId: string;
}) {
  return {
    subject: `Withdrawal Complete - ${formatCents(p.amount)} from "${p.campaignTitle}"`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Withdrawal Completed</h1>
      <p>Dear ${esc(p.campaignerName)},</p>
      <p>Your withdrawal of <strong>${formatCents(p.amount)}</strong> from <strong>"${esc(p.campaignTitle)}"</strong> has been successfully processed.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #f9fafb; border-radius: 8px;">
        <tr><td style="padding: 12px 16px; color: #666;">Amount</td><td style="padding: 12px 16px; font-weight: 600; font-family: 'DM Mono', monospace;">${formatCents(p.amount)}</td></tr>
        <tr><td style="padding: 12px 16px; color: #666;">Transfer ID</td><td style="padding: 12px 16px; font-family: 'DM Mono', monospace; font-size: 13px;">${esc(p.transferId)}</td></tr>
      </table>
      <p>Funds will arrive in your bank account according to your Stripe payout schedule (typically 2 business days).</p>
      ${ctaButton(`${BASE_URL}/dashboard/payout-settings`, 'View Payout Settings')}
    `),
  };
}

export function withdrawalFailedEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  amount: number;
  reason: string;
}) {
  return {
    subject: `Withdrawal Failed - "${p.campaignTitle}"`,
    html: wrap(`
      <h1 style="color: #DC2626; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Withdrawal Failed</h1>
      <p>Dear ${esc(p.campaignerName)},</p>
      <p>Your withdrawal of <strong>${formatCents(p.amount)}</strong> from <strong>"${esc(p.campaignTitle)}"</strong> could not be completed.</p>
      <p style="background: #fef2f2; padding: 16px; border-radius: 8px; border-left: 4px solid #DC2626; margin: 16px 0;">
        <strong>Reason:</strong> ${esc(p.reason)}
      </p>
      <p>The funds remain in your available balance. Please check your Stripe account and try again.</p>
      ${ctaButton(`${BASE_URL}/dashboard/payout-settings`, 'Try Again')}
      <p style="color: #666; font-size: 14px;">Need help? Contact <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `),
  };
}

/* ---- Registration mail: the only place the two outcomes may differ --------
 *
 * `POST /api/auth/register` answers a duplicate address exactly as it answers
 * a creation (audit A4, commit 9a14dc6), and `src/app/register/page.tsx` now
 * renders one terminal "check your email" screen for both. The information
 * "this address already had an account" therefore reaches exactly one party:
 * whoever can open that inbox. Keep it that way — these two builders are the
 * only existence-dependent branch left in the registration flow, and they are
 * reached only by a send to the submitted address itself.
 *
 * Both are transactional: they answer an action the recipient's address was
 * just used for, and the existing-account one is a security notice. Neither is
 * gated on a notification preference (see `notifyRegistrationOutcome`).
 */

/** Sent when the submitted address was free and an account was created. */
export function registrationWelcomeEmail(p: { name: string }) {
  const signInUrl = `${BASE_URL}/login`;
  return {
    subject: 'Your LastDonor.org account is ready',
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your account is ready</h1>
      <p>Hi ${esc(p.name)},</p>
      <p>Your LastDonor.org account has been created. Sign in with the email address and password you just chose.</p>
      ${ctaButton(signInUrl, 'Sign in')}
      <p style="color: #666; font-size: 14px;">If you forget your password you can set a new one at any time from <a href="${BASE_URL}/login/forgot-password" style="color: #0F766E;">the password reset page</a>.</p>
      <p style="color: #666; font-size: 14px;">If you did not create this account, you can ignore this email and nothing further will happen.</p>
    `),
  };
}

/**
 * Sent when the submitted address already had an account. Nothing was created
 * and nothing was changed, so this is a notice, not a credential: it carries
 * no token and grants no access. The recipient recovers the account through
 * the normal reset flow, which mints its own token.
 */
/*
  ── The password reset family ─────────────────────────────────────────────

  Added 2026-10-16. The reset email was the LAST template still rendering its
  own raw `<div style="font-family: 'DM Sans'">` inside the route handler,
  which meant the single most security-sensitive message this platform sends
  was also the only one with no doctype, no Outlook table scaffolding, no
  preheader and no CAN-SPAM footer. docs/67 moved 44 templates onto the
  shell and missed this one because it never lived in this file.

  Two of the three are new behaviour, not just a re-render. See docs/74.
*/

/** The reset link itself. Sent only to an address that has a password. */
export function passwordResetEmail(p: { resetUrl: string }) {
  return {
    subject: 'Reset your LastDonor.org password',
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Reset your password</h1>
      <p>Someone asked to reset the password on your LastDonor.org account. If that was you, use the button below.</p>
      ${ctaButton(p.resetUrl, 'Reset password')}
      <p style="color: #666; font-size: 14px;">This link works once and expires in one hour.</p>
      <p style="color: #666; font-size: 14px;">If it was not you, nothing has changed and your password still works. You can ignore this email.</p>
    `),
  };
}

/**
 * Sent when the address has no account.
 *
 * The HTTP response is unchanged and still says "if an account exists" — the
 * oracle `docs/32` closed stays closed, because only the inbox owner learns
 * which branch ran. This is the shape `/register` already uses for its two
 * outcomes (`docs/39`); the reset route simply never had it, so a visitor who
 * typed the wrong address got silence and no way to find out why.
 */
export function passwordResetNoAccountEmail() {
  const signUpUrl = `${BASE_URL}/register`;
  return {
    subject: 'No LastDonor.org account for this address',
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">There is no account for this address</h1>
      <p>Someone asked to reset a LastDonor.org password for this email address, but there is no account here, so there was nothing to reset.</p>
      <p><strong>If that was you:</strong> you may have signed up with a different address. You can also create an account.</p>
      ${ctaButton(signUpUrl, 'Create an account')}
      <p style="color: #666; font-size: 14px;">If it was not you, there is nothing to do. No account was created and whoever submitted the form was not told whether this address is registered.</p>
    `),
  };
}

/**
 * Sent when the account exists but signs in through an identity provider and
 * has no password to reset.
 *
 * Before this, that case returned early and sent nothing at all, so a real
 * account holder who had forgotten *how* they signed up was told nothing,
 * every time, forever. The provider name is included because "use Google"
 * is the entire answer and withholding it helps nobody — the person already
 * owns the inbox.
 */
export function passwordResetOauthOnlyEmail(p: { provider?: string | null }) {
  const signInUrl = `${BASE_URL}/login`;
  const named = p.provider ? esc(titleCaseProvider(p.provider)) : null;
  return {
    subject: 'Sign in to LastDonor.org without a password',
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">This account has no password</h1>
      <p>Someone asked to reset the password on your LastDonor.org account. ${
        named
          ? `You sign in with <strong>${named}</strong>, so there is no password to reset.`
          : 'You sign in through a connected account rather than with a password, so there is no password to reset.'
      }</p>
      ${ctaButton(signInUrl, named ? `Sign in with ${named}` : 'Sign in')}
      <p style="color: #666; font-size: 14px;">Nothing has changed on your account. If it was not you who asked, you can ignore this email.</p>
    `),
  };
}

/** `google` -> `Google`. Providers are lowercase slugs in the accounts table. */
function titleCaseProvider(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function registrationExistingAccountEmail() {
  const signInUrl = `${BASE_URL}/login`;
  return {
    subject: 'You already have a LastDonor.org account',
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">You already have an account</h1>
      <p>Someone just used this email address to sign up for LastDonor.org. You already have an account here, so we did not create a second one and we did not change anything.</p>
      <p><strong>If that was you:</strong> sign in with your existing password.</p>
      ${ctaButton(signInUrl, 'Sign in')}
      <p><strong>If you have forgotten your password:</strong> <a href="${BASE_URL}/login/forgot-password" style="color: #0F766E;">reset it here</a>.</p>
      <p style="color: #666; font-size: 14px;">If it was not you, there is nothing to do. Your password still works and whoever submitted the form was not told that this address is registered.</p>
    `),
  };
}
