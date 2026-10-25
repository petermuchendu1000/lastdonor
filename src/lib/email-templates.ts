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
    subject: `Your money is on the way back`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">We sent your money back</h1>
      <p>Hi ${esc(p.donorName)},</p>
      <p>We have refunded your donation to <strong>${esc(p.campaignTitle)}</strong>.</p>
      <p>The money should reach your account in 5 to 10 working days. Your bank decides how long it takes.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Amount</td>
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
      <p style="color: #666; font-size: 14px;">Need help? Email <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `,
      'The money should reach your account in 5 to 10 working days.',
    ),
  };
}

export function donationRefundReversedEmail(p: {
  donorName: string;
  amount: number;
  campaignTitle: string;
}) {
  return {
    subject: `Your donation is active again`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">We cancelled your refund</h1>
      <p>Hi ${esc(p.donorName)},</p>
      <p>We refunded your ${formatCents(p.amount)} donation to <strong>${esc(p.campaignTitle)}</strong>. We have now cancelled that refund.</p>
      <p>Your donation counts again. You do not need to do anything.</p>
      <p style="color: #666; font-size: 14px;">If this looks wrong, email <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `,
      'Your donation counts again. You do not need to do anything.',
    ),
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
    subject: `"${p.campaignTitle}" reached its goal`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">The goal is reached</h1>
      <p>Hi ${esc(p.donorName)},</p>
      <p><strong>${esc(p.campaignTitle)}</strong> has raised its full goal of <strong>${formatCents(p.goalAmount, p.currency)}</strong>.</p>
      <p>You helped make that happen. Thank you.</p>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'See the campaign')}
    `,
      'You helped make that happen. Thank you.',
    ),
  };
}

export function campaignArchivedEmail(p: {
  donorName: string;
  campaignTitle: string;
}) {
  return {
    subject: `"${p.campaignTitle}" has closed`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">This campaign has closed</h1>
      <p>Hi ${esc(p.donorName)},</p>
      <p>Our team has closed <strong>${esc(p.campaignTitle)}</strong>. It can no longer take donations.</p>
      <p>We have a record of every donation, including yours.</p>
      <p style="color: #666; font-size: 14px;">Questions about your donation? Email <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `,
      'It can no longer take donations. We have a record of every donation.',
    ),
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
    subject: `Update on "${p.campaignTitle}"`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">A campaign you gave to has changed</h1>
      <p>Hi ${esc(p.donorName)},</p>
      <p><strong>${esc(p.campaignTitle)}</strong> is now marked <strong>${esc(statusDisplay)}</strong>.</p>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'See the campaign')}
    `,
      `This campaign is now marked ${statusDisplay.toLowerCase()}.`,
    ),
  };
}

export function roleChangedEmail(p: {
  userName: string;
  previousRole: string;
  newRole: string;
}) {
  return {
    subject: 'What you can do on LastDonor has changed',
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your account has changed</h1>
      <p>Hi ${esc(p.userName)},</p>
      <p>Your account was <strong>${esc(p.previousRole)}</strong>. It is now <strong>${esc(p.newRole)}</strong>.</p>
      ${
        p.newRole === 'editor' || p.newRole === 'admin'
          ? `<p>You can now open the admin pages. There you can help check campaigns before they go live.</p>${ctaButton(`${BASE_URL}/admin`, 'Open admin pages')}`
          : `<p>This changes what you can see and do on the site.</p>`
      }
      <p style="color: #666; font-size: 14px;">If you did not expect this, email <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a> straight away.</p>
    `,
      `Your account is now ${p.newRole}.`,
    ),
  };
}

export function accountDeletedEmail(p: {
  userName: string;
}) {
  return {
    subject: 'Your LastDonor account has been closed',
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your account has been closed</h1>
      <p>Hi ${esc(p.userName)},</p>
      <p>Someone on our team closed your LastDonor account. You can no longer sign in.</p>
      <p>We deleted your personal details. We kept a record of your past donations, but your name is no longer on them. The law says we must keep money records.</p>
      <p style="color: #666; font-size: 14px;">If you think this is a mistake, email <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `,
      'You can no longer sign in. We deleted your personal details.',
    ),
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
      <p>Someone has sent in a new campaign. It is <strong>not public</strong> until a person approves it.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px 0; color: #666; width: 120px;">Title</td><td style="padding: 8px 0; font-weight: 600;">${esc(p.campaignTitle)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Created by</td><td style="padding: 8px 0;">${esc(p.creatorName)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Category</td><td style="padding: 8px 0;">${esc(p.category)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Goal</td><td style="padding: 8px 0;">${formatCents(p.goalAmount)}</td></tr>
      </table>
      <p>Nobody can see it or give to it while it waits. The person who sent it is waiting too.</p>
      ${ctaButton(BASE_URL + '/admin/campaigns/' + p.campaignId + '/edit', 'Check this campaign')}
    `,
      'Nobody can see it or give to it while it waits.',
    ),
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
      <p><strong>Next: check your ID.</strong> We do this before we send anyone money. It takes a few minutes.</p>
      ${ctaButton(`${BASE_URL}/dashboard/campaigns`, 'Check my ID')}
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
    subject: `We have paused "${p.campaignTitle}"`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">We have paused this campaign</h1>
      <p>Hi ${esc(p.donorName)},</p>
      <p>You gave to <strong>${esc(p.campaignTitle)}</strong>. We have paused it for now, so it cannot take more money.</p>
      <p><strong>Why:</strong> ${esc(p.reason)}</p>
      <p style="color: #666;">Your money is safe. We will write to you when it starts again, or if we need to do anything else.</p>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'See the campaign')}
      <p style="color: #666; font-size: 14px;">Questions? Email <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `,
      'Your money is safe. We will write to you when it starts again.',
    ),
  };
}

export function campaignResumedDonorEmail(p: {
  donorName: string;
  campaignTitle: string;
  campaignSlug: string;
}) {
  return {
    subject: `"${p.campaignTitle}" is open again`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">This campaign is open again</h1>
      <p>Hi ${esc(p.donorName)},</p>
      <p>We paused <strong>${esc(p.campaignTitle)}</strong>. It is now open again and can take money.</p>
      <p>Thank you for waiting.</p>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'See the campaign')}
    `,
      'It is now open again and can take money.',
    ),
  };
}

export function campaignSuspendedDonorEmail(p: {
  donorName: string;
  campaignTitle: string;
  campaignSlug: string;
}) {
  return {
    subject: `We are checking "${p.campaignTitle}"`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">We are checking this campaign</h1>
      <p>Hi ${esc(p.donorName)},</p>
      <p>You gave to <strong>${esc(p.campaignTitle)}</strong>. Our team is checking it to make sure everything is right.</p>
      <p style="color: #666;">We are holding your money safely while we check. We will write to you when we are done. If the campaign cannot go on, we send your money back.</p>
      <p style="color: #666; font-size: 14px;">Questions? Email <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `,
      'We are holding your money safely while we check.',
    ),
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
      <h2 style="color: #0F766E; font-size: 18px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Other people who need help</h2>
      <p>A person has checked each of these campaigns:</p>
      ${p.similarCampaigns.map(formatCard).join('')}
      ${ctaButton(`${BASE_URL}/campaigns`, 'See all campaigns')}
    `
    : '';

  return {
    subject: `We stopped "${p.campaignTitle}" and sent your money back`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">We sent your money back</h1>
      <p>Hi ${esc(p.donorName)},</p>
      <p>We have stopped the campaign <strong>"${esc(p.campaignTitle)}"</strong>. You gave money to it, so we sent your money back.</p>

      <h3 style="color: #333; margin: 20px 0 8px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Why we stopped it</h3>
      <p>${esc(p.cancellationReason)}</p>

      <h3 style="color: #333; margin: 20px 0 8px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your money</h3>
      <p>We sent back all <strong>${formatCents(p.donationAmount)}</strong>. It goes back the same way you paid.</p>
      <p>It should reach your account in 5 to 10 working days. Your bank decides how long it takes.</p>
      ${p.refundReference ? `<p style="color: #666; font-size: 14px;">Refund number: ${esc(p.refundReference)}</p>` : ''}

      ${similarSection}
      <p style="color: #666; font-size: 14px;">Need help? Email <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `,
      `We sent back all ${formatCents(p.donationAmount)}. It should reach you in 5 to 10 working days.`,
    ),
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
    subject: `We need one more thing for "${p.campaignTitle}"`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">We need one more thing</h1>
      <p>Hi ${esc(p.campaignerName)},</p>
      <p>A person is checking <strong>"${esc(p.campaignTitle)}"</strong>. To finish, we need one more thing from you.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px 0; color: #666; width: 120px;">We need</td><td style="padding: 8px 0;">${esc(p.requestType.replace(/_/g, ' '))}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Send it by</td><td style="padding: 8px 0; font-weight: 600; color: #0F766E;">${esc(p.deadline)}</td></tr>
      </table>
      <p><strong>What to send:</strong> ${esc(p.details)}</p>
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignId}/verification`, 'Send it now')}
      <p style="color: #666; font-size: 14px;">Need more time? Email <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a>. Just ask.</p>
    `,
      'To finish checking your campaign, we need one more thing from you.',
    ),
  };
}

export function infoRequestReminderEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  daysLeft: number;
  campaignId: string;
}) {
  return {
    subject: `${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} left to send what we asked for`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">A reminder</h1>
      <p>Hi ${esc(p.campaignerName)},</p>
      <p>We asked you for something for <strong>"${esc(p.campaignTitle)}"</strong>. You have <strong>${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'}</strong> left to send it.</p>
      <p style="color: #666;">If you do not send it, we cannot send you your money yet.</p>
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignId}/verification`, 'Send it now')}
    `,
      `You have ${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} left to send what we asked for.`,
    ),
  };
}

export function welcomeCampaignerEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  campaignSlug: string;
}) {
  return {
    subject: `Your campaign is live. Here is what to do first`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your campaign is live</h1>
      <p>Hi ${esc(p.campaignerName)},</p>
      <p><strong>"${esc(p.campaignTitle)}"</strong> is now open. People can see it and give to it.</p>
      <p style="font-size: 16px; color: #333; font-weight: 600; margin: 20px 0 8px;">Do these four things today:</p>
      <ol style="line-height: 2; color: #333;">
        <li><strong>Message 5 people you know well.</strong> One message to one person works far better than one post to everybody.</li>
        <li><strong>Give the first gift yourself.</strong> Even a small one. It shows people this is real.</li>
        <li><strong>Post the link.</strong> Say in your own words why this matters to you.</li>
        <li><strong>Send the link straight to people.</strong> Use WhatsApp, a text or an email.</li>
      </ol>
      <p style="background: #f0fdf4; padding: 16px; border-radius: 8px; border-left: 4px solid #0F766E; margin: 20px 0;">
        <strong>Why the first gift matters:</strong> a page showing nothing raised asks every visitor to go first. Most people will wait. One gift, even a small one, changes that.
      </p>
      <p style="background: #fff7ed; padding: 16px; border-radius: 8px; border-left: 4px solid #EA580C; margin: 20px 0;">
        <strong>One more thing.</strong> We check who you are before we send anyone money. Until that is done, this campaign can only raise a small amount, and we cannot pay you. It takes a few minutes. Start it from your dashboard.
      </p>
      ${/*
        `?launched=true` is what renders `LaunchSuccessBanner` ("Your campaign
        is live", "Make the first donation", the share buttons). It used to be
        appended by the submission redirect, where every word of it was FALSE
        after the review gate landed (docs/78) - a campaign waiting for a
        person is not live and cannot be donated to. This email fires from the
        approval route, which is the moment all of it becomes true, so the
        banner moved here with it. See docs/109.
      */ ''}
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}?launched=true`, 'See and share your page')}
      <p style="color: #666; font-size: 14px;">Need help? Email <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `,
      'People can see it and give to it. Here is what to do first.',
    ),
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
    subject: `${formatCents(p.amount, p.currency)} for "${p.campaignTitle}"`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Someone gave to your campaign</h1>
      <p>Good news. Someone has given money to <strong>"${esc(p.campaignTitle)}"</strong>.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px 0; color: #666; width: 120px;">From</td><td style="padding: 8px 0; font-weight: 600;">${esc(donor)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Amount</td><td style="padding: 8px 0; font-weight: 600;">${formatCents(p.amount, p.currency)}</td></tr>
      </table>
      ${p.message ? `<p><strong>They left you a message:</strong></p><blockquote style="border-left: 3px solid #0F766E; margin: 12px 0; padding: 8px 16px; color: #444;">${esc(p.message)}</blockquote>` : ''}
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'See your campaign')}
    `,
      `${donor} gave ${formatCents(p.amount, p.currency)}.`,
    ),
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
    subject: `Your receipt for ${formatCents(p.amount, p.currency)}`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Thank you for your gift</h1>
      <p>Hi ${esc(greeting)},</p>
      <p>We got your gift to <strong>${esc(p.campaignTitle)}</strong>. Here is your receipt.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Amount</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;">${formatCents(p.amount, p.currency)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Campaign</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">${esc(p.campaignTitle)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Payment number</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-family: monospace; font-size: 12px;">${esc(p.transactionId)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Date</td><td style="padding: 8px 0; text-align: right;">${stamped} (UTC)</td></tr>
      </table>
      <p style="color: #666; font-size: 14px;">LastDonor takes nothing from your gift. The company that moves the money charges a small fee. The rest goes to the campaign.</p>
      <p style="color: #666; font-size: 14px;">Keep this email. It shows you gave. It is not a tax receipt, and we cannot tell you if you can claim it on your taxes. Ask a tax adviser about that.</p>
    `,
      `We got your gift to ${p.campaignTitle}. Here is your receipt.`,
    ),
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
    subject: `You got your first gift for "${p.campaignTitle}"`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">You got your first gift</h1>
      <p>Hi ${esc(p.campaignerName)},</p>
      <p><strong>${esc(p.donorName)}</strong> gave <strong>${formatCents(p.amount, p.currency)}</strong> to <strong>"${esc(p.campaignTitle)}"</strong>. This is the hardest one to get.</p>
      <p style="background: #f0fdf4; padding: 16px; border-radius: 8px; border-left: 4px solid #0F766E; margin: 20px 0;">
        <strong>Set up where we send your money now.</strong> Do it today and you will not have to wait later. It takes a few minutes.
      </p>
      ${ctaButton(`${BASE_URL}/dashboard/payout-settings`, 'Set up your payments')}
      <p style="font-weight: 600; margin-top: 24px;">Three things to do next</p>
      <ul style="line-height: 2; color: #333;">
        <li>Tell people the news. Say: "We just got our first gift."</li>
        <li>Thank ${esc(p.donorName)} in public, if they are happy for you to.</li>
        <li>Send your link to 5 more people today.</li>
      </ul>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'See your campaign')}
    `,
      `${p.donorName} gave your first gift. This is the hardest one to get.`,
    ),
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
    subject: `"${p.campaignTitle}" reached its goal. Here is how to get the money`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">You reached your goal</h1>
      <p>Hi ${esc(p.campaignerName)},</p>
      <p><strong>"${esc(p.campaignTitle)}"</strong> has raised its full goal of <strong>${formatCents(p.goalAmount, p.currency)}</strong>. ${p.donorCount} ${p.donorCount === 1 ? 'person' : 'people'} gave.</p>
      <p style="background: #f0fdf4; padding: 20px; border-radius: 8px; border-left: 4px solid #0F766E; margin: 24px 0; font-size: 16px;">
        <strong>Before we send the money,</strong> we check who you are and what the money is for. This keeps you safe, and it keeps the people who gave safe too.
      </p>
      <h2 style="color: #333; font-size: 18px; margin: 24px 0 12px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Papers we need from you</h2>
      <ol style="line-height: 2; color: #333;">
        ${p.documentRequirementsHtml}
      </ol>
      <h2 style="color: #333; font-size: 18px; margin: 24px 0 12px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">How to get your money</h2>
      <ol style="line-height: 2; color: #333;">
        <li><strong>Show us who you are.</strong> Send a photo of your ID and a photo of your face. This takes about 2 minutes.</li>
        <li><strong>Send your papers.</strong> These show what the money is for.</li>
        <li><strong>Wait for our check.</strong> A person looks at everything you sent.</li>
        <li><strong>Get your money.</strong> We send it to your bank.</li>
      </ol>
      <p style="color: #0F766E; font-weight: 600;">Please start within 14 days.</p>
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignSlug}/verification`, 'Start now')}
      <p style="color: #666; font-size: 14px;">Need help? Email <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a>.</p>
    `,
      'Before we send the money, we check who you are and what the money is for.',
    ),
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
      subject: `A reminder: finish your checks to get your money`,
      heading: 'A reminder',
      headingColor: '#0F766E',
      body: `<p>Your campaign <strong>"${esc(p.campaignTitle)}"</strong> reached its goal ${p.daysSinceCompletion} days ago.</p><p>We still need to check who you are before we can send you the money. It takes a few minutes.</p>`,
    },
    firm: {
      subject: `${p.deadlineDays} days left to finish your checks`,
      heading: 'Please finish your checks',
      headingColor: '#0F766E',
      body: `<p>Your campaign <strong>"${esc(p.campaignTitle)}"</strong> reached its goal ${p.daysSinceCompletion} days ago. We have not had your ID or your papers yet.</p><p>You have <strong>${p.deadlineDays} days</strong> left. After that we may have to send the money back to the people who gave it.</p>`,
    },
    warning: {
      subject: `Only ${p.deadlineDays} days left to finish your checks`,
      heading: 'Time is running out',
      headingColor: '#EA580C',
      body: `<p>Your campaign <strong>"${esc(p.campaignTitle)}"</strong> reached its goal ${p.daysSinceCompletion} days ago. We cannot send you the money until our checks are done.</p><p style="color: #EA580C; font-weight: 600;">You have ${p.deadlineDays} days left.</p><p>If you are stuck, tell us. We want you to get this money.</p>`,
    },
    final: {
      subject: `Last reminder: ${p.deadlineDays} days to finish your checks`,
      heading: 'Last reminder',
      headingColor: '#EA580C',
      body: `<p>This is our last reminder about <strong>"${esc(p.campaignTitle)}"</strong>.</p><p style="color: #EA580C; font-weight: 600;">If our checks are not done in ${p.deadlineDays} days, we will send the money back to the people who gave it.</p><p>We know life gets busy. If you need more time, write to us today. We can often give you longer.</p>`,
    },
  };

  const config = urgencyConfig[p.urgencyLevel];
  return {
    subject: config.subject,
    html: wrap(`
      <h1 style="color: ${config.headingColor}; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">${config.heading}</h1>
      <p>Hi ${esc(p.campaignerName)},</p>
      ${config.body}
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignSlug}/verification`, 'Finish your checks')}
      <p style="color: #666; font-size: 14px;">Need help? Contact <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a> - we're here for you.</p>
    `),
  };
}

/**
 * The consequence-keyed verification reminder, sent by
 * `cron/verification-reminders`.
 *
 * ⛔ This is NOT `verificationReminderEmail` above, and the difference is
 * deliberate. That one opens every level with "reached its goal N days ago"
 * and threatens to send the donations back. [VERIFIED 2026-10-25] nothing in
 * this codebase sends money back on a clock - every refund path is started by
 * an admin - and the campaigns this cron finds have usually reached no goal.
 * See the header of `src/lib/verification-reminders.ts`.
 *
 * Each level states one thing that is true of the campaign right now. No
 * deadline, no countdown, no turnaround time (`docs/78`), and no claim about
 * what happens to money nobody has decided to move.
 *
 * `capLabel`, `raisedLabel` and `goalLabel` arrive already formatted by
 * `formatMoney`, so this template does no money arithmetic and cannot divide
 * a zero-decimal currency by 100 (`docs/92`).
 */
/**
 * What an organiser is told when a person decides NOT to publish their
 * campaign.
 *
 * -- WHY THIS EXISTS -----------------------------------------------------------
 *
 * Until 2026-10-25 a refused campaign notified NOBODY, the organiser
 * included. `docs/93` found it and left it open as a policy call, because
 * what should happen to a refused campaign is not an engineering decision.
 * Owner decision, 2026-10-25: email the organiser, with a reason the admin
 * writes.
 *
 * -- WHAT IT MAY NOT SAY -----------------------------------------------------
 *
 * (STOP) No promise to look at it again, and no promise of a revision loop.
 * The owner chose the version that ends the silence, not one that commits to
 * a process the product does not have. It says what happened, why, and where
 * to write.
 *
 * (STOP) No turnaround time (`docs/78`).
 *
 * (STOP) `reason` is TYPED BY AN ADMIN and goes straight into the document,
 * so it is escaped. The same hazard as the preheader in `docs/94` section 4.
 */
/**
 * An invitation to help run somebody's campaign.
 *
 * ⛔ It says what the helper CANNOT do, in the body, not in small print. A
 * person invited to "help with a fundraiser" will reasonably assume they are
 * being given access to the money unless told otherwise, and the honest
 * answer shapes whether they accept at all. `docs/111` §1 has the traced
 * reason the capability set stops where it does.
 *
 * ⛔ `inviterName` and `campaignTitle` are other people's words rendered into
 * a document, so both are escaped.
 */
export function collaboratorInviteEmail(p: {
  inviterName: string;
  campaignTitle: string;
  acceptUrl: string;
}) {
  return {
    subject: `${esc(p.inviterName)} asked you to help with a fundraiser`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">You have been asked to help</h1>
      <p>Hi,</p>
      <p><strong>${esc(p.inviterName)}</strong> asked you to help with <strong>&quot;${esc(p.campaignTitle)}&quot;</strong>.</p>
      <p>You will be able to write updates for the page and change what it says.</p>
      <p style="background: #fff7ed; padding: 16px; border-radius: 8px; border-left: 4px solid #EA580C; margin: 20px 0;">
        <strong>You will not be able to touch the money.</strong> Only the person who started the campaign can ask for a payout or change where it goes.
      </p>
      <p>To start helping, sign in and accept.</p>
      ${ctaButton(p.acceptUrl, 'Accept and start helping')}
      <p>This link works for seven days. If you were not expecting this, you can ignore it.</p>
      <p style="color: #666; font-size: 14px;">Questions? Write to <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `,
      'You can write updates for the page. You cannot touch the money.',
    ),
  };
}

export function campaignRefusedEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  reason: string;
}) {
  return {
    subject: 'We could not publish your campaign',
    html: wrap(
      `
      <h1 style="color: #EA580C; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">We could not publish your campaign</h1>
      <p>Hi ${esc(p.campaignerName)},</p>
      <p>A person read <strong>&quot;${esc(p.campaignTitle)}&quot;</strong>. We have decided not to publish it.</p>
      <p style="background: #fff7ed; padding: 16px; border-radius: 8px; border-left: 4px solid #EA580C; margin: 20px 0;">
        <strong>What they said:</strong> ${esc(p.reason)}
      </p>
      <p>Your campaign is not public. Nobody can see it or give to it.</p>
      <p>If you want to talk about this, write to us.</p>
      ${ctaButton(`${BASE_URL}/dashboard/campaigns`, 'See your campaigns')}
      <p style="color: #666; font-size: 14px;">Write to <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a> and a person will read it.</p>
    `,
      'A person read it and decided not to publish it.',
    ),
  };
}

export function verificationConsequenceEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  campaignId: string;
  level: 'first_money' | 'approaching_cap' | 'at_cap' | 'funded_and_stuck';
  capLabel: string;
  raisedLabel: string;
  goalLabel: string;
}) {
  const title = `<strong>&quot;${esc(p.campaignTitle)}&quot;</strong>`;

  const levels = {
    first_money: {
      subject: 'Your campaign has money. Now check your ID.',
      heading: 'Check your ID',
      headingColor: '#0F766E',
      body:
        `<p>People have started giving to ${title}.</p>` +
        `<p>We cannot send you any of it until we check who you are.</p>` +
        `<p>It takes a few minutes. You need a photo ID.</p>` +
        `<p>This campaign can raise up to ${esc(p.capLabel)} before it stops taking gifts.</p>`,
    },
    approaching_cap: {
      subject: 'Your campaign is close to its limit',
      heading: 'Your campaign is close to its limit',
      headingColor: '#0F766E',
      body:
        `<p>${title} has raised ${esc(p.raisedLabel)}.</p>` +
        `<p>It can raise up to ${esc(p.capLabel)} until we check who you are.</p>` +
        `<p>After that it stops taking gifts.</p>` +
        `<p>Checking your ID takes a few minutes and lifts the limit.</p>`,
    },
    at_cap: {
      subject: 'Your campaign has stopped taking gifts',
      heading: 'Your campaign has stopped taking gifts',
      headingColor: '#EA580C',
      body:
        `<p>${title} has raised ${esc(p.raisedLabel)}.</p>` +
        `<p style="color: #EA580C; font-weight: 600;">It cannot take any more until we check who you are.</p>` +
        `<p>People who try to give are turned away.</p>` +
        `<p>Checking your ID takes a few minutes. Then it starts again.</p>`,
    },
    funded_and_stuck: {
      subject: 'Your campaign met its goal. We need your ID.',
      heading: 'Your campaign met its goal',
      headingColor: '#0F766E',
      body:
        `<p>${title} has reached its goal of ${esc(p.goalLabel)}.</p>` +
        `<p>We hold that money for you.</p>` +
        `<p>We cannot send it until a person has checked your ID and your papers.</p>` +
        `<p>Start with your ID. It takes a few minutes.</p>`,
    },
  };

  const config = levels[p.level];
  return {
    subject: config.subject,
    html: wrap(`
      <h1 style="color: ${config.headingColor}; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">${config.heading}</h1>
      <p>Hi ${esc(p.campaignerName)},</p>
      ${config.body}
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignId}/verification`, 'Check my ID')}
      <p style="color: #666; font-size: 14px;">Stuck? Write to <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a> and we will help.</p>
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
    subject: `We checked your ID. Next: your papers`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">We know who you are</h1>
      <p>Hi ${esc(p.campaignerName)},</p>
      <p>We checked your ID for <strong>"${esc(p.campaignTitle)}"</strong>. It is good.</p>
      <p>Now send us papers that show what the money is for. A receipt, a bill or a letter from a doctor all work.</p>
      <p>We need these before you can take money out.</p>
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignSlug}/verification`, 'Send your papers')}
      <p style="color: #666; font-size: 14px;">Need help? Email <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a>.</p>
    `,
      'Next, send us papers that show what the money is for.',
    ),
  };
}

export function identityDeclinedEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  campaignSlug: string;
  reason: string;
}) {
  return {
    subject: `We could not check your ID. Please try again`,
    html: wrap(
      `
      <h1 style="color: #DC2626; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">We could not check your ID</h1>
      <p>Hi ${esc(p.campaignerName)},</p>
      <p>We could not check your ID for <strong>"${esc(p.campaignTitle)}"</strong>.</p>
      <p><strong>Why:</strong> ${esc(p.reason)}</p>
      <p>You can try again now. Before you do, please check three things:</p>
      <ul style="margin:0 0 16px;padding-left:20px;">
        <li>Your ID has not run out of date.</li>
        <li>The photo is sharp and you can read every word.</li>
        <li>The name on the ID matches the name on your account.</li>
      </ul>
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignSlug}/verification`, 'Try again')}
      <p style="color: #666; font-size: 14px;">Stuck? Email <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a>.</p>
    `,
      'You can try again now. Check your ID is in date and easy to read.',
    ),
  };
}

export function identityResubmissionEmail(p: {
  campaignerName: string;
  campaignTitle: string;
  campaignSlug: string;
}) {
  return {
    subject: `Please send your ID again`,
    html: wrap(
      `
      <h1 style="color: #EA580C; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Please send your ID again</h1>
      <p>Hi ${esc(p.campaignerName)},</p>
      <p>We need a new photo of your ID for <strong>"${esc(p.campaignTitle)}"</strong>.</p>
      <p>This usually means the photo was blurred, too dark, or cut off at the edge. Nothing is wrong with your ID.</p>
      <p>Take the photo again in good light. Make sure all four corners are in the picture.</p>
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignSlug}/verification`, 'Send your ID again')}
      <p style="color: #666; font-size: 14px;">Stuck? Email <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a>.</p>
    `,
      'The photo was hard to read. Nothing is wrong with your ID.',
    ),
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
    subject: `[Admin] Papers to check: "${p.campaignTitle}"`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Someone sent papers to check</h1>
      <p>A person has sent papers for their campaign. Someone needs to look at them.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px 0; color: #666; width: 140px;">Campaign</td><td style="padding: 8px 0; font-weight: 600;">${esc(p.campaignTitle)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Sent by</td><td style="padding: 8px 0;">${esc(p.creatorName)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Files</td><td style="padding: 8px 0;">${p.documentCount} file${p.documentCount === 1 ? '' : 's'}</td></tr>
      </table>
      <p>They cannot take their money out until someone checks these.</p>
      ${ctaButton(`${BASE_URL}/admin/verification`, 'Check the papers')}
    `,
      'They cannot take their money out until someone checks these.',
    ),
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
      ? `You can now take out your money`
      : `We checked your ID. One more step`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">${isFull ? 'You can now take out your money' : 'We know who you are'}</h1>
      <p>Hi ${esc(p.creatorName)},</p>
      ${
        isFull
          ? `<p>We have checked everything for <strong>"${esc(p.campaignTitle)}"</strong>.</p>
           <p>The money people gave you is ready. You can send it to your bank whenever you want.</p>`
          : `<p>We checked your ID for <strong>"${esc(p.campaignTitle)}"</strong>. It is good.</p>
           <p style="background: #f0fdf4; padding: 16px; border-radius: 8px; border-left: 4px solid #0F766E; margin: 16px 0;">
             <strong>One more step:</strong> send us papers that show what the money is for. A hospital letter, a receipt or an official letter all work. Our team will look at them.
           </p>`
      }
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignId}/verification`, isFull ? 'Take out your money' : 'Send your papers')}
      <p style="color: #666; font-size: 14px;">Need help? Email <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a>.</p>
    `,
      isFull
        ? 'The money people gave you is ready to send to your bank.'
        : 'Next, send us papers that show what the money is for.',
    ),
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
    subject: `We need better papers for "${p.campaignTitle}"`,
    html: wrap(
      `
      <h1 style="color: #EA580C; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">We need better papers</h1>
      <p>Hi ${esc(p.creatorName)},</p>
      <p>We looked at the papers you sent for <strong>"${esc(p.campaignTitle)}"</strong>. We cannot accept them yet.</p>
      <p style="background: #fff7ed; padding: 16px; border-radius: 8px; border-left: 4px solid #EA580C; margin: 16px 0;">
        <strong>Why:</strong> ${esc(p.reason)}
      </p>
      <p>You can send new papers now. There is no limit on how many times you try.</p>
      ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignId}/verification`, 'Send new papers')}
      <p style="color: #666; font-size: 14px;">If you think we got this wrong, email <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a>. A person will read it.</p>
    `,
      'You can send new papers now. There is no limit on how many times you try.',
    ),
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
    subject: `We sent you ${formatCents(p.amount)}`,
    html: wrap(
      `
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your money is on its way</h1>
      <p>Hi ${esc(p.campaignerName)},</p>
      <p>We have sent you <strong>${formatCents(p.amount)}</strong> from <strong>"${esc(p.campaignTitle)}"</strong>.</p>
      <p>It should reach your bank in about 2 working days.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #f9fafb; border-radius: 8px;">
        <tr><td style="padding: 12px 16px; color: #666;">Amount</td><td style="padding: 12px 16px; font-weight: 600; font-family: 'DM Mono', monospace;">${formatCents(p.amount)}</td></tr>
        <tr><td style="padding: 12px 16px; color: #666;">Payment number</td><td style="padding: 12px 16px; font-family: 'DM Mono', monospace; font-size: 13px;">${esc(p.transferId)}</td></tr>
      </table>
      <p>Keep the payment number. We will ask for it if you need help.</p>
      ${ctaButton(`${BASE_URL}/dashboard/payout-settings`, 'See your payments')}
    `,
      `It should reach your bank in about 2 working days.`,
    ),
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
      <p>Hi ${esc(p.campaignerName)},</p>
      <p>Your withdrawal of <strong>${formatCents(p.amount)}</strong> from <strong>"${esc(p.campaignTitle)}"</strong> could not be completed.</p>
      <p style="background: #fef2f2; padding: 16px; border-radius: 8px; border-left: 4px solid #DC2626; margin: 16px 0;">
        <strong>Reason:</strong> ${esc(p.reason)}
      </p>
      <p>Your money is still here. Nothing is lost. Check the details you gave us, then try again.</p>
      ${ctaButton(`${BASE_URL}/dashboard/payout-settings`, 'Try again')}
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
      <p style="color: #666; font-size: 14px;">Forgot your password? You can set a new one at <a href="${BASE_URL}/login/forgot-password" style="color: #0F766E;">the password reset page</a>.</p>
      <p style="color: #666; font-size: 14px;">Did not sign up? Ignore this email. Nothing will happen.</p>
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
      <p>Someone asked to reset a LastDonor password for this email address. There is no account here, so there was nothing to reset.</p>
      <p><strong>If that was you:</strong> you may have used a different email address. You can also make a new account.</p>
      ${ctaButton(signUpUrl, 'Make an account')}
      <p style="color: #666; font-size: 14px;">If it was not you, do nothing. We made no account. We did not tell the person whether this address is in use.</p>
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
      <p>Someone asked to reset the password on your LastDonor account.</p>
      <p>${
        named
          ? `You do not have one. You sign in with <strong>${named}</strong> instead.`
          : 'You do not have one. You sign in through another account instead.'
      }</p>
      ${ctaButton(signInUrl, named ? `Sign in with ${named}` : 'Sign in')}
      <p style="color: #666; font-size: 14px;">Nothing on your account has changed. If you did not ask for this, ignore this email.</p>
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
