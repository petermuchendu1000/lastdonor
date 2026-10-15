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

const BASE_URL = process.env.NEXTAUTH_URL || 'https://lastdonor.org';

/** Escape user-controlled strings to prevent HTML injection in email templates. */
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrap(body: string): string {
  return `
    <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      ${body}
      <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0 16px;" />
      <p style="color: #999; font-size: 12px; line-height: 1.5;">
        LastDonor.org - Every campaign has a last donor. Will it be you?<br/>
        <a href="${BASE_URL}/settings" style="color: #999;">Manage notification preferences</a>
      </p>
    </div>
  `;
}

function ctaButton(href: string, label: string): string {
  return `
    <p style="margin: 24px 0;">
      <a href="${href}" style="background-color: #0F766E; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
        ${label}
      </a>
    </p>
  `;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Donation Refund Processed</h1>
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Refund Reversed</h1>
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
}) {
  return {
    subject: `Great News! "${p.campaignTitle}" Reached Its Goal!`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Campaign Goal Reached!</h1>
      <p>Dear ${esc(p.donorName)},</p>
      <p>Thanks to generous donors like you, the campaign <strong>${esc(p.campaignTitle)}</strong> has reached its goal of <strong>${formatCents(p.goalAmount)}</strong>!</p>
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Campaign Update</h1>
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Campaign Status Update</h1>
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Account Role Updated</h1>
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Account Removed</h1>
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
    subject: `[Admin] New Campaign Live: ${p.campaignTitle}`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">New Campaign Published</h1>
      <p>A new campaign has been published and is now accepting donations:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px 0; color: #666; width: 120px;">Title</td><td style="padding: 8px 0; font-weight: 600;">${esc(p.campaignTitle)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Created by</td><td style="padding: 8px 0;">${esc(p.creatorName)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Category</td><td style="padding: 8px 0;">${esc(p.category)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Goal</td><td style="padding: 8px 0;">${formatCents(p.goalAmount)}</td></tr>
      </table>
      <p>This campaign is <strong>active</strong> and live. Verification will be requested upon campaign completion.</p>
      ${ctaButton(BASE_URL + '/admin/campaigns/' + p.campaignId + '/edit', 'View Campaign')}
    `),
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Campaign Update</h1>
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Campaign Resumed</h1>
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Campaign Under Review</h1>
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
      <h2 style="color: #0F766E; font-size: 18px;">You Can Still Make a Difference</h2>
      <p>Here are reviewed campaigns that need your support:</p>
      ${p.similarCampaigns.map(formatCard).join('')}
      ${ctaButton(`${BASE_URL}/campaigns`, 'View All Reviewed Campaigns')}
    `
    : '';

  return {
    subject: `Important: Your Donation to "${p.campaignTitle}" Has Been Refunded`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Donation Refunded</h1>
      <p>Dear ${esc(p.donorName)},</p>
      <p>We're writing to inform you that the campaign <strong>"${esc(p.campaignTitle)}"</strong> has been cancelled.</p>

      <h3 style="color: #333; margin: 20px 0 8px;">What Happened</h3>
      <p>${esc(p.cancellationReason)}</p>

      <h3 style="color: #333; margin: 20px 0 8px;">Your Refund</h3>
      <p>Your donation of <strong>${formatCents(p.donationAmount)}</strong> has been fully refunded to your original payment method. Please allow 5–10 business days for the refund to appear on your statement.</p>
      ${p.refundReference ? `<p style="color: #666; font-size: 14px;">Refund Reference: ${esc(p.refundReference)}</p>` : ''}

      <h3 style="color: #333; margin: 20px 0 8px;">Our Commitment to You</h3>
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">We Need a Little More Info</h1>
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">A Quick Reminder</h1>
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Your Campaign Is Live!</h1>
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
        <strong>Did you know?</strong> Campaigns that receive their first donation within 24 hours raise 3x more on average.
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
  isAnonymous: boolean;
  message?: string | null;
}) {
  const donor = p.isAnonymous ? 'Anonymous' : p.donorName;
  return {
    subject: `New Donation: ${formatCents(p.amount)} to "${p.campaignTitle}"`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">New Donation Received</h1>
      <p>A donation has been made to <strong>"${esc(p.campaignTitle)}"</strong>.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px 0; color: #666; width: 120px;">Donor</td><td style="padding: 8px 0; font-weight: 600;">${esc(donor)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Amount</td><td style="padding: 8px 0; font-weight: 600;">${formatCents(p.amount)}</td></tr>
      </table>
      ${p.message ? `<p><strong>Message from donor:</strong></p><blockquote style="border-left: 3px solid #0F766E; margin: 12px 0; padding: 8px 16px; color: #444;">${esc(p.message)}</blockquote>` : ''}
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'View Campaign')}
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Bulk Refund Completed</h1>
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
}) {
  return {
    subject: `You Got Your First Donation! "${p.campaignTitle}"`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Your First Donation Is In!</h1>
      <p>Dear ${esc(p.campaignerName)},</p>
      <p><strong>${esc(p.donorName)}</strong> just made the first donation of <strong>${formatCents(p.amount)}</strong> to your campaign <strong>"${esc(p.campaignTitle)}"</strong>. This is a huge moment!</p>
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
  donorCount: number;
  documentRequirementsHtml: string;
}) {
  return {
    subject: `Congratulations! "${p.campaignTitle}" Is Fully Funded!`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Your Campaign Is Fully Funded!</h1>
      <p>Dear ${esc(p.campaignerName)},</p>
      <p>Incredible news! Your campaign <strong>"${esc(p.campaignTitle)}"</strong> has reached its goal of <strong>${formatCents(p.goalAmount)}</strong> thanks to <strong>${p.donorCount}</strong> generous donor${p.donorCount === 1 ? '' : 's'}.</p>
      <p style="background: #f0fdf4; padding: 20px; border-radius: 8px; border-left: 4px solid #0F766E; margin: 24px 0; font-size: 16px;">
        <strong>What happens next?</strong> To release your funds, we need to verify your identity and review evidence that funds are being used as described. This protects both you and your donors.
      </p>
      <h2 style="color: #333; font-size: 18px; margin: 24px 0 12px;">Documents we'll need from you:</h2>
      <ol style="line-height: 2; color: #333;">
        ${p.documentRequirementsHtml}
      </ol>
      <h2 style="color: #333; font-size: 18px; margin: 24px 0 12px;">How to receive your funds:</h2>
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
      <h1 style="color: ${config.headingColor}; font-size: 24px; margin: 0 0 16px;">${config.heading}</h1>
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Identity Verified</h1>
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
      <h1 style="color: #DC2626; font-size: 24px; margin: 0 0 16px;">Identity Verification Unsuccessful</h1>
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
      <h1 style="color: #EA580C; font-size: 24px; margin: 0 0 16px;">Resubmission Needed</h1>
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">[Admin] New Verification Submission</h1>
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">${isFull ? 'Full Verification Approved' : 'Identity Verification Approved'}</h1>
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
      <h1 style="color: #EA580C; font-size: 24px; margin: 0 0 16px;">Verification Update</h1>
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Withdrawal Completed</h1>
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
      <h1 style="color: #DC2626; font-size: 24px; margin: 0 0 16px;">Withdrawal Failed</h1>
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
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">Your account is ready</h1>
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
export function registrationExistingAccountEmail() {
  const signInUrl = `${BASE_URL}/login`;
  return {
    subject: 'You already have a LastDonor.org account',
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;">You already have an account</h1>
      <p>Someone just used this email address to sign up for LastDonor.org. You already have an account here, so we did not create a second one and we did not change anything.</p>
      <p><strong>If that was you:</strong> sign in with your existing password.</p>
      ${ctaButton(signInUrl, 'Sign in')}
      <p><strong>If you have forgotten your password:</strong> <a href="${BASE_URL}/login/forgot-password" style="color: #0F766E;">reset it here</a>.</p>
      <p style="color: #666; font-size: 14px;">If it was not you, there is nothing to do. Your password still works and whoever submitted the form was not told that this address is registered.</p>
    `),
  };
}
