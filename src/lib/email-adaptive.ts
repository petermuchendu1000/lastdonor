/**
 * Adaptive Behavioral Email System
 *
 * Changes messaging based on:
 * - Donor type (first-time vs repeat, high-value vs standard)
 * - Donation amount tier (small / medium / large / major)
 * - Campaign progress phase at time of action
 * - Donor engagement signals (click behavior, open history)
 * - Creator activity patterns (updates posted, sharing, inactivity)
 * - Verification stage escalation
 * - Refund context (campaign cancelled vs individual refund)
 * - Abandoned donation recovery sequencing
 *
 * Psychological rules:
 * 1. Never use em dashes, robotic phrasing, or manipulative language
 * 2. Reciprocity: acknowledge generosity immediately and specifically
 * 3. Social proof: show others are giving, but never fabricate numbers
 * 4. Commitment/consistency: for repeat donors, reinforce their identity
 * 5. Scarcity: only when genuinely applicable (campaign near goal)
 * 6. Loss aversion: frame as missed impact, not guilt
 * 7. Narrative transport: keep the human story front and center
 * 8. Identity: "You're someone who..." for repeat donors
 * 9. Autonomy: always offer a way out, never pressure
 * 10. Warmth: conversational, human, calm
 *
 * Design tokens match the existing email shell:
 * - Font: DM Sans
 * - Primary teal: #0F766E
 * - CTA: #0F766E (primary) / #EA580C (urgent)
 * - Max width: 600px
 */

import { campaignUnsubscribeMechanism } from '@/lib/unsubscribe-tokens';
import { renderEmail, emailButton } from './email-shell';

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

/**
 * The opt-out line for campaign-update mail.
 *
 * ## Why this is a function and not an inline link
 *
 * Both campaign-update templates used to inline
 * `${BASE_URL}/unsubscribe?email=...&campaign=<slug>` with **no token**, while
 * `DELETE /api/v1/campaigns/[slug]/subscribe` has required an HMAC token (or a
 * matching session) since the P1-6 fix. Every such link already in a donor's
 * inbox answered 403 unless the donor happened to be signed in as that
 * address, which makes the one-click path dead: a CAN-SPAM 16 CFR 316.5 and
 * GDPR Art. 7(3) defect, not a cosmetic one.
 *
 * The token signs over the campaign **UUID**, not the slug, which is why both
 * payload types now carry `campaignId`. The id is passed in by the caller
 * (`src/lib/notifications.ts` already holds it); this layer deliberately does
 * not look it up, because email templates must stay pure string builders.
 *
 * Without a signing secret, `campaignUnsubscribeMechanism` returns a `mailto:`
 * to the published support mailbox rather than a link that promises one-click
 * unsubscribe and then fails. `oneClick` is false for both branches: the
 * `/unsubscribe` page is a browser page, not an RFC 8058 POST endpoint, so the
 * branch is detected by inspecting the scheme.
 */
function campaignUnsubscribeFooter(p: {
  campaignId: string;
  campaignSlug: string;
  donorEmail: string;
}): string {
  const mechanism = campaignUnsubscribeMechanism({
    campaignId: p.campaignId,
    campaignSlug: p.campaignSlug,
    email: p.donorEmail,
    baseUrl: BASE_URL,
  });
  const signed = !mechanism.url.startsWith('mailto:');
  const label = signed ? 'Unsubscribe from updates' : 'Email us to unsubscribe';

  return `<p style="color: #666; font-size: 14px;">You're receiving this because you subscribed to this campaign. <a href="${mechanism.url}" style="color: #999;">${label}</a></p>`;
}

// ─── Shared Layout ──────────────────────────────────────────────────────────

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

function ctaButton(href: string, label: string, color: string = '#0F766E'): string {
  return emailButton(href, label, color as `#${string}`);
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function calloutBox(text: string, borderColor: string = '#0F766E', bgColor: string = '#f0fdf4'): string {
  return `
    <p style="background: ${bgColor}; padding: 16px; border-radius: 8px; border-left: 4px solid ${borderColor}; margin: 20px 0;">
      ${text}
    </p>
  `;
}

// ─── Context Types ──────────────────────────────────────────────────────────

/** Amount-based donor tier thresholds (in cents). */
export type DonorAmountTier = 'small' | 'medium' | 'large' | 'major';

export function getDonorAmountTier(amountCents: number): DonorAmountTier {
  if (amountCents >= 50000) return 'major';   // $500+
  if (amountCents >= 10000) return 'large';   // $100-499
  if (amountCents >= 2500) return 'medium';   // $25-99
  return 'small';                              // $5-24
}

/** Behavioral context about a donor, assembled from DB before template selection. */
export interface DonorContext {
  donorName: string;
  donorEmail: string;
  /** Total number of donations this donor has ever made on the platform. */
  totalDonationCount: number;
  /** Total amount donated across all campaigns (cents). */
  totalDonatedCents: number;
  /** Number of distinct campaigns this donor has supported. */
  campaignsSupported: number;
  /** Whether the donor has donated to this specific campaign before. */
  hasGivenToThisCampaign: boolean;
  /** The donor's registered user ID (null for guests). */
  userId: string | null;
}

/** Behavioral context about a campaign creator. */
export interface CreatorContext {
  creatorName: string;
  creatorEmail: string;
  creatorId: string;
  campaignTitle: string;
  campaignSlug: string;
  /** Days since the campaign went live. */
  daysSinceLaunch: number;
  /** Days since the last update was posted. */
  daysSinceLastUpdate: number | null;
  /** Number of updates the creator has posted. */
  updateCount: number;
  /** Current number of donors. */
  donorCount: number;
  /** Current raised amount in cents. */
  raisedCents: number;
  /** Campaign goal amount in cents. */
  goalCents: number;
  /** Campaign progress percentage (0-100). */
  progressPercent: number;
}

export interface AbandonedDonationContext {
  donorName: string;
  donorEmail: string;
  campaignTitle: string;
  campaignSlug: string;
  /** The amount the donor started to give (cents), if captured. */
  intendedAmountCents: number | null;
  /** Number of current donors on this campaign. */
  donorCount: number;
  /** Current raised amount in cents. */
  raisedCents: number;
  /** Campaign goal amount in cents. */
  goalCents: number;
  /** Which step of the recovery sequence (1, 2, or 3). */
  sequenceStep: 1 | 2 | 3;
  /** Current campaign progress percentage. */
  progressPercent: number;
}

// ─── 1. Adaptive Donation Receipt ───────────────────────────────────────────
//
// Psychology:
// - First-time: validate the decision, reduce post-purchase dissonance,
//   low-commitment next step (share)
// - Repeat: reinforce identity as a giver, acknowledge loyalty,
//   higher-commitment CTA (explore more campaigns)
// - High-value: personal tone, impact visualization, mention of exclusivity
// - Phase-aware: if campaign is in last_donor_zone, celebrate urgency

export function adaptiveDonationReceiptEmail(p: {
  campaignTitle: string;
  campaignSlug: string;
  amount: number;
  donorContext: DonorContext;
  campaignPhase: 'first_believers' | 'the_push' | 'closing_in' | 'last_donor_zone';
  campaignProgressPercent: number;
  donorCount: number;
}) {
  const tier = getDonorAmountTier(p.amount);
  const isFirstTime = p.donorContext.totalDonationCount <= 1;
  const isRepeat = p.donorContext.totalDonationCount > 1;
  const isHighValue = tier === 'major' || tier === 'large';
  const name = esc(p.donorContext.donorName);
  const campaignTitle = esc(p.campaignTitle);

  // Dynamic subject line
  let subject: string;
  if (isFirstTime) {
    subject = `Thank you, ${name}. Your first donation matters.`;
  } else if (isHighValue) {
    subject = `${name}, your generosity is extraordinary`;
  } else if (isRepeat) {
    subject = `You did it again, ${name}. Campaign #${p.donorContext.campaignsSupported}.`;
  } else {
    subject = `Thank you for your donation to "${p.campaignTitle}"`;
  }

  // Dynamic heading
  let heading: string;
  if (p.campaignPhase === 'last_donor_zone') {
    heading = 'You Could Be the Last Donor';
  } else if (isFirstTime) {
    heading = 'You Just Made a Real Difference';
  } else if (isHighValue) {
    heading = 'Your Generosity Stands Out';
  } else {
    heading = 'Thank You for Giving Again';
  }

  // Dynamic opening paragraph
  let openingParagraph: string;
  if (isFirstTime) {
    openingParagraph = `
      <p>Hi ${name},</p>
      <p>You just did something meaningful. Your donation of <strong>${formatCents(p.amount)}</strong> to <strong>${campaignTitle}</strong> is already making a difference.</p>
      <p>You're now one of <strong>${p.donorCount}</strong> people who've stepped up for this cause. That says something about who you are.</p>
    `;
  } else if (isRepeat) {
    openingParagraph = `
      <p>Hi ${name},</p>
      <p>You're back, and that matters more than you know. Your <strong>${formatCents(p.amount)}</strong> donation to <strong>${campaignTitle}</strong> brings your total giving on LastDonor to <strong>${formatCents(p.donorContext.totalDonatedCents)}</strong> across <strong>${p.donorContext.campaignsSupported}</strong> campaign${p.donorContext.campaignsSupported === 1 ? '' : 's'}.</p>
      <p>Repeat donors are the backbone of every successful campaign. Thank you for being one of them.</p>
    `;
  } else {
    openingParagraph = `
      <p>Hi ${name},</p>
      <p>Thank you for your <strong>${formatCents(p.amount)}</strong> donation to <strong>${campaignTitle}</strong>.</p>
    `;
  }

  // High-value callout
  let highValueSection = '';
  if (isHighValue) {
    highValueSection = calloutBox(
      `<strong>Your donation of ${formatCents(p.amount)} puts you among the top supporters of this campaign.</strong> We take extra care to keep major donors informed with detailed progress updates.`
    );
  }

  // Phase-aware context
  let phaseSection = '';
  if (p.campaignPhase === 'last_donor_zone') {
    phaseSection = calloutBox(
      `<strong>This campaign is ${p.campaignProgressPercent}% funded.</strong> It's in the final stretch, and your donation could help push it across the finish line. Share it with someone who might want to be the last donor.`,
      '#D97706',
      '#fffbeb'
    );
  } else if (p.campaignPhase === 'first_believers' && p.donorCount <= 10) {
    phaseSection = calloutBox(
      `<strong>You're one of the first ${p.donorCount} supporters.</strong> Early donations send a powerful signal. When others see people have already given, they're more likely to join in.`
    );
  } else if (p.campaignPhase === 'closing_in') {
    phaseSection = `<p>This campaign is <strong>${p.campaignProgressPercent}% of the way</strong> to its goal. Your donation is helping close the gap.</p>`;
  }

  // Dynamic CTA
  let ctaSection: string;
  if (isFirstTime) {
    ctaSection = `
      <p style="font-weight: 600; margin-top: 20px;">There is one thing you can do that the money cannot:</p>
      <p>Send this to one person you think would care. A public post reaches everyone and asks no one. A message asks someone, by name, and it comes from you, who already gave.</p>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'Share this campaign')}
    `;
  } else if (isRepeat) {
    ctaSection = `
      <p style="font-weight: 600; margin-top: 20px;">Looking for more campaigns that need your help?</p>
      ${ctaButton(`${BASE_URL}/campaigns`, 'See other campaigns')}
    `;
  } else {
    ctaSection = ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'See the campaign');
  }

  return {
    subject,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">${heading}</h1>
      ${openingParagraph}
      ${highValueSection}
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #f9fafb; border-radius: 8px;">
        <tr>
          <td style="padding: 12px 16px; color: #666;">Amount</td>
          <td style="padding: 12px 16px; font-weight: bold; text-align: right; font-family: 'DM Mono', monospace;">${formatCents(p.amount)}</td>
        </tr>
        <tr>
          <td style="padding: 12px 16px; color: #666;">Campaign</td>
          <td style="padding: 12px 16px; text-align: right;">${campaignTitle}</td>
        </tr>
        <tr>
          <td style="padding: 12px 16px; color: #666;">Date</td>
          <td style="padding: 12px 16px; text-align: right;">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
        </tr>
      </table>
      ${phaseSection}
      ${ctaSection}
      <p style="color: #666; font-size: 14px;">This email is your donation receipt. Save it for your records.</p>
    `),
  };
}

// ─── 2. Abandoned Donation Recovery ─────────────────────────────────────────
//
// Psychology:
// Step 1 (sent ~1 hour after): No pressure. Remind them of the story.
//   Reason: Most abandons are distraction, not rejection. Gentle recall works.
// Step 2 (sent ~24 hours after): Social proof + progress. Show momentum.
//   Reason: FOMO on impact, not guilt. "Others are helping, you could too."
// Step 3 (sent ~72 hours after): Final, respectful close. Offer alternatives.
//   Reason: Respect autonomy. If they don't act now, they won't. Honor that.

export function abandonedDonationRecoveryEmail(p: AbandonedDonationContext) {
  const progressPercent = p.progressPercent;
  const amountHint = p.intendedAmountCents ? ` of ${formatCents(p.intendedAmountCents)}` : '';
  const donorName = esc(p.donorName);
  const campaignTitle = esc(p.campaignTitle);

  switch (p.sequenceStep) {
    case 1: {
      return {
        subject: `You were about to do something great, ${p.donorName}`,
        html: wrap(`
          <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Still Thinking About It?</h1>
          <p>Hi ${donorName},</p>
          <p>We noticed you started a donation${amountHint} to <strong>"${campaignTitle}"</strong> but didn't finish. No worries at all. Life gets busy.</p>
          <p>If you'd still like to help, the campaign is right where you left it. Every contribution, no matter the size, moves things forward.</p>
          ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'Finish your gift')}
          <p style="color: #666; font-size: 14px;">Not interested anymore? That's completely okay. You can ignore this email and we won't send another about it.</p>
        `),
      };
    }

    case 2: {
      return {
        subject: `"${p.campaignTitle}" is ${progressPercent}% funded`,
        html: wrap(`
          <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Here's Where Things Stand</h1>
          <p>Hi ${donorName},</p>
          <p>Since you last visited, <strong>"${campaignTitle}"</strong> has raised <strong>${formatCents(p.raisedCents)}</strong> from <strong>${p.donorCount}</strong> donor${p.donorCount === 1 ? '' : 's'}.</p>
          <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <div style="background: #e5e7eb; border-radius: 4px; height: 12px; overflow: hidden;">
              <div style="background: #0F766E; height: 100%; width: ${Math.min(progressPercent, 100)}%; border-radius: 4px;"></div>
            </div>
            <p style="margin: 8px 0 0; color: #666; font-size: 14px;">${progressPercent}% of goal reached</p>
          </div>
          <p>Your donation would help close the remaining gap. But only if it feels right to you.</p>
          ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'Give now')}
          <p style="color: #666; font-size: 14px;">This is the second of three reminders. Reply "stop" to opt out.</p>
        `),
      };
    }

    case 3: {
      return {
        subject: `Last note about "${p.campaignTitle}"`,
        html: wrap(`
          <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">One Last Note</h1>
          <p>Hi ${donorName},</p>
          <p>This is our last message about <strong>"${campaignTitle}."</strong> We respect your time and your inbox.</p>
          <p>If this campaign moved you, the link is still here. If not, no hard feelings. There are many ways to make a difference, and donating is just one of them.</p>
          ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'See the campaign')}
          <p>Or if a different cause speaks to you:</p>
          ${ctaButton(`${BASE_URL}/campaigns`, 'See all campaigns', '#666')}
          <p style="color: #666; font-size: 14px;">You won't receive any more reminders about this donation.</p>
        `),
      };
    }
  }
}

// ─── 3. Adaptive Refund Emails ──────────────────────────────────────────────
//
// Psychology:
// - First-time donor: extra reassurance, trust-building, redirect to reviewed campaigns
// - Repeat donor: softer, relationship-focused, acknowledge history, invite back
// - Campaign-cancelled: transparency about what happened, proactive redirect
// - Individual refund: no alarm, just confirmation

export function adaptiveRefundEmail(p: {
  donorContext: DonorContext;
  amount: number;
  campaignTitle: string;
  campaignSlug: string;
  refundReason: 'campaign_cancelled' | 'donor_requested' | 'admin_initiated' | 'dispute';
  similarCampaigns?: Array<{ title: string; slug: string; raised: number; goal: number }>;
}) {
  const isRepeat = p.donorContext.totalDonationCount > 1;
  const name = esc(p.donorContext.donorName);
  const campaignTitle = esc(p.campaignTitle);

  // Subject line varies by context
  let subject: string;
  if (p.refundReason === 'campaign_cancelled') {
    subject = `Your donation to "${p.campaignTitle}" has been returned`;
  } else if (p.refundReason === 'donor_requested') {
    subject = `Refund confirmed for "${p.campaignTitle}"`;
  } else {
    subject = `Refund processed for your donation to "${p.campaignTitle}"`;
  }

  // Opening varies for first-time vs repeat
  let openingSection: string;
  if (p.refundReason === 'campaign_cancelled') {
    openingSection = `
      <p>Hi ${name},</p>
      <p>We have stopped the campaign <strong>"${campaignTitle}"</strong>. We are sending back all of your <strong>${formatCents(p.amount)}</strong>.</p>
      <p>We know that's not the outcome you hoped for when you gave. We're sorry about that.</p>
    `;
  } else if (isRepeat) {
    openingSection = `
      <p>Hi ${name},</p>
      <p>Your refund of <strong>${formatCents(p.amount)}</strong> from <strong>"${campaignTitle}"</strong> has been processed. It will appear on your statement within 5 to 10 business days.</p>
      <p>We appreciate your history of giving on LastDonor${p.donorContext.campaignsSupported > 1 ? ` across ${p.donorContext.campaignsSupported} campaigns` : ''}. We hope to see you again when the right cause comes along.</p>
    `;
  } else {
    openingSection = `
      <p>Hi ${name},</p>
      <p>Your refund of <strong>${formatCents(p.amount)}</strong> from <strong>"${campaignTitle}"</strong> has been processed. The refund will appear on your statement within 5 to 10 business days.</p>
      <p>Your generosity was real, and we want you to know that every donation on our platform is protected. Refunds are always available when a campaign doesn't work out.</p>
    `;
  }

  // Refund details table
  const detailsTable = `
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Amount Refunded</td>
        <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;">${formatCents(p.amount)}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Campaign</td>
        <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">${campaignTitle}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #666;">Refund Date</td>
        <td style="padding: 8px 0; text-align: right;">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
      </tr>
    </table>
  `;

  // Redirect section for cancelled campaigns
  let redirectSection = '';
  if (p.similarCampaigns && p.similarCampaigns.length > 0) {
    const campaignCards = p.similarCampaigns.map(c => `
      <div style="border: 1px solid #eee; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
        <p style="font-weight: 600; margin: 0 0 4px;">${esc(c.title)}</p>
        <p style="color: #666; margin: 0 0 8px; font-size: 14px;">${formatCents(c.raised)} raised of ${formatCents(c.goal)}</p>
        <a href="${BASE_URL}/campaigns/${c.slug}" style="color: #0F766E; font-weight: 600; font-size: 14px; text-decoration: none;">View campaign</a>
      </div>
    `).join('');

    redirectSection = `
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <h2 style="color: #0F766E; font-size: 18px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Other campaigns that could use your help</h2>
        <p>If you'd like to redirect your generosity, here are reviewed campaigns in a similar area:</p>
      ${campaignCards}
      ${ctaButton(`${BASE_URL}/campaigns`, 'See all campaigns')}
    `;
  }

  // Trust reinforcement for first-time donors
  let trustSection = '';
  if (!isRepeat) {
    trustSection = calloutBox(
      `<strong>Your trust matters.</strong> Every campaign on LastDonor goes through verification before funds are released. Your money is always protected.`
    );
  }

  return {
    subject,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Refund Processed</h1>
      ${openingSection}
      ${detailsTable}
      ${trustSection}
      ${redirectSection}
      <p style="color: #666; font-size: 14px;">Questions about this refund? Contact us at <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
    `),
  };
}

// ─── 4. Creator Motivation & Inactivity Emails ──────────────────────────────
//
// Psychology:
// - Celebration before ask: always lead with what's going well
// - Specific, actionable advice: not "share more" but "send this to 3 people"
// - Social accountability: "your donors are watching" (gently)
// - Loss aversion: "momentum is slipping" (only when true)
// - Never blame or shame: creators are often going through hard times

export type CreatorEmailType =
  | 'momentum_nudge'         // 5-7 days no update, campaign has momentum
  | 'engagement_drop'        // 10-14 days no update, donations slowing
  | 'stalled_campaign'       // 21+ days no update, campaign stalled
  | 'donor_milestone'        // Hit a donor count milestone (10, 25, 50, 100)
  | 'halfway_celebration'    // Campaign reached 50%
  | 'sharing_tips'           // 3 days post-launch, no organic traction
  | 'weekly_summary';        // Weekly campaign performance digest

export function creatorMotivationEmail(p: {
  context: CreatorContext;
  emailType: CreatorEmailType;
  /** For donor_milestone type: the milestone number reached. */
  donorMilestone?: number;
}) {
  const c = p.context;
  const progressPercent = c.progressPercent;
  const creatorName = esc(c.creatorName);
  const campaignTitle = esc(c.campaignTitle);

  switch (p.emailType) {
    case 'momentum_nudge': {
      return {
        subject: `"${c.campaignTitle}" is gaining traction. Keep it going.`,
        html: wrap(`
          <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your Campaign Has Momentum</h1>
          <p>Hi ${creatorName},</p>
          <p>Your campaign <strong>"${campaignTitle}"</strong> has raised <strong>${formatCents(c.raisedCents)}</strong> from <strong>${c.donorCount}</strong> donor${c.donorCount === 1 ? '' : 's'} so far. That's real progress.</p>
          <p>People who gave money like to hear from you. Even a few lines help. Tell them where things stand. They are then far more likely to share your page.</p>
          ${calloutBox(
            `<strong>Quick tip:</strong> Your donors have no way of knowing what their money did unless you tell them. Five minutes and one photo is the difference between a receipt and a reason to give again.`
          )}
          ${ctaButton(`${BASE_URL}/dashboard/campaigns/${c.campaignSlug}`, 'Post an Update')}
          <p style="color: #666; font-size: 14px;">Need help writing an update? Just reply to this email and we'll help you out.</p>
        `),
      };
    }

    case 'engagement_drop': {
      const daysSince = c.daysSinceLastUpdate ?? c.daysSinceLaunch;
      return {
        subject: `Your donors haven't heard from you in ${daysSince} days`,
        html: wrap(`
          <h1 style="color: #EA580C; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your Donors Are Wondering</h1>
          <p>Hi ${creatorName},</p>
          <p>You last wrote about <strong>"${campaignTitle}"</strong> <strong>${daysSince} days</strong> ago. <strong>${c.donorCount}</strong> ${c.donorCount === 1 ? 'person' : 'people'} gave because they believe in you. They would like to know how it is going.</p>
          <p>We've seen campaigns lose momentum when supporters don't hear back. It doesn't have to be long. Even a sentence or two can reignite interest and bring in new donations.</p>
          <p style="font-weight: 600;">Here are three ideas for a quick update:</p>
          <ol style="line-height: 2; color: #333;">
            <li>"Thank you to everyone who has donated so far. Here's what's happening next..."</li>
            <li>"We're ${progressPercent}% of the way there. Here's what your donations are making possible..."</li>
            <li>"A quick note to let you know we haven't forgotten about this. Here's our timeline..."</li>
          </ol>
          ${ctaButton(`${BASE_URL}/dashboard/campaigns/${c.campaignSlug}`, 'Post an Update Now')}
        `),
      };
    }

    case 'stalled_campaign': {
      return {
        subject: `We want to help "${c.campaignTitle}" succeed`,
        html: wrap(`
          <h1 style="color: #EA580C; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Let's Get Things Moving Again</h1>
          <p>Hi ${creatorName},</p>
          <p>We know things don't always go as planned. Your campaign <strong>"${campaignTitle}"</strong> hasn't received a new update in a while, and new donations have slowed down.</p>
          <p>That's completely normal. It happens to many campaigns. The good news is that it's not too late to turn things around.</p>
          <p style="font-weight: 600;">Here's what works for campaigns that recover momentum:</p>
          <ol style="line-height: 2; color: #333;">
            <li><strong>Post an honest update.</strong> Donors understand delays. What they don't understand is silence.</li>
            <li><strong>Share with 5 new people.</strong> A personal text or WhatsApp message is more effective than any social media post.</li>
            <li><strong>Ask a friend to share on your behalf.</strong> Sometimes a third-party endorsement carries more weight.</li>
          </ol>
          ${calloutBox(
            `<strong>Not sure what to say?</strong> Reply to this email. We will help you write it.`,
            '#EA580C',
            '#fff7ed'
          )}
          ${ctaButton(`${BASE_URL}/dashboard/campaigns/${c.campaignSlug}`, 'Write an update')}
          <p style="color: #666; font-size: 14px;">If your situation has changed and you need to pause or close the campaign, that's okay too. We can help with that. Contact us at <a href="mailto:support@lastdonor.org" style="color: #0F766E;">support@lastdonor.org</a>.</p>
        `),
      };
    }

    case 'donor_milestone': {
      const milestone = p.donorMilestone ?? c.donorCount;
      return {
        subject: `${milestone} people now support "${c.campaignTitle}"`,
        html: wrap(`
          <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">${milestone} Supporters and Counting</h1>
          <p>Hi ${creatorName},</p>
          <p>Something worth celebrating: <strong>${milestone} people</strong> have now donated to your campaign <strong>"${campaignTitle}."</strong> That's not just a number. That's ${milestone} people who read your story and decided to help.</p>
          <p>You've raised <strong>${formatCents(c.raisedCents)}</strong> so far, which is <strong>${progressPercent}%</strong> of your goal.</p>
          ${calloutBox(`<strong>Celebrate this milestone!</strong> Share it on social media or send a thank-you update to your donors. People love being part of a growing community.`)}
          ${ctaButton(`${BASE_URL}/dashboard/campaigns/${c.campaignSlug}`, 'Thank the people who gave')}
        `),
      };
    }

    case 'halfway_celebration': {
      return {
        subject: `You're halfway there! "${c.campaignTitle}" is 50% funded`,
        html: wrap(`
          <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">You're Halfway There!</h1>
          <p>Hi ${creatorName},</p>
          <p>Your campaign <strong>"${campaignTitle}"</strong> just crossed the 50% mark. You've raised <strong>${formatCents(c.raisedCents)}</strong> from <strong>${c.donorCount}</strong> supporter${c.donorCount === 1 ? '' : 's'}.</p>
          <p>This is a big step. The hardest part is usually the start, and you are past it.</p>
          <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <div style="background: #e5e7eb; border-radius: 4px; height: 16px; overflow: hidden;">
              <div style="background: #0F766E; height: 100%; width: ${progressPercent}%; border-radius: 4px;"></div>
            </div>
            <p style="margin: 8px 0 0; color: #0F766E; font-weight: 600;">${formatCents(c.raisedCents)} of ${formatCents(c.goalCents)} raised</p>
          </div>
          <p style="font-weight: 600;">What to do next:</p>
          <ol style="line-height: 2; color: #333;">
            <li>Post an update celebrating this milestone with your donors</li>
            <li>Share the progress bar on social media. People are drawn to campaigns that are already making progress.</li>
            <li>Reach out to 5 people who haven't donated yet. The personal ask is always the most effective.</li>
          </ol>
          ${ctaButton(`${BASE_URL}/campaigns/${c.campaignSlug}`, 'Share your progress')}
        `),
      };
    }

    case 'sharing_tips': {
      return {
        subject: `3 ways to get your first donations for "${c.campaignTitle}"`,
        html: wrap(`
          <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Let's Get Your First Donations</h1>
          <p>Hi ${creatorName},</p>
          <p>Your campaign <strong>"${campaignTitle}"</strong> has been live for a few days. Here are the three things that work best for getting early donations:</p>
          <h3 style="color: #333; margin: 20px 0 8px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">1. Send personal messages first</h3>
          <p>Before posting on social media, text or WhatsApp your campaign link to 5 to 10 people you know personally. Include a short note about why this matters to you. A public post reaches everyone and asks no one. A message asks someone, by name.</p>
          <h3 style="color: #333; margin: 20px 0 8px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">2. Be the first to donate</h3>
          <p>If you haven't already, make a small donation to your own campaign. It sounds simple, but it works. People are more likely to give when they see others have already started.</p>
          <h3 style="color: #333; margin: 20px 0 8px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">3. Tell the story, not the ask</h3>
          <p>When sharing, lead with why this campaign exists, not how much you need. People connect with stories. The money follows the emotion.</p>
          ${calloutBox(`<strong>Your campaign link:</strong><br/><a href="${BASE_URL}/campaigns/${c.campaignSlug}" style="color: #0F766E; word-break: break-all;">${BASE_URL}/campaigns/${c.campaignSlug}</a>`)}
          ${ctaButton(`${BASE_URL}/campaigns/${c.campaignSlug}`, 'See your campaign')}
        `),
      };
    }

    case 'weekly_summary': {
      const _raisedThisWeek = c.raisedCents; // caller should pass the weekly delta
      return {
        subject: `Weekly update: "${c.campaignTitle}" at ${progressPercent}%`,
        html: wrap(`
          <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your Weekly Campaign Summary</h1>
          <p>Hi ${creatorName},</p>
          <p>Here's how <strong>"${campaignTitle}"</strong> performed this week:</p>
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #f9fafb; border-radius: 8px;">
            <tr>
              <td style="padding: 12px 16px; color: #666;">Total Raised</td>
              <td style="padding: 12px 16px; font-weight: 600; text-align: right; font-family: 'DM Mono', monospace;">${formatCents(c.raisedCents)}</td>
            </tr>
            <tr>
              <td style="padding: 12px 16px; color: #666;">Total Donors</td>
              <td style="padding: 12px 16px; font-weight: 600; text-align: right;">${c.donorCount}</td>
            </tr>
            <tr>
              <td style="padding: 12px 16px; color: #666;">Progress</td>
              <td style="padding: 12px 16px; font-weight: 600; text-align: right; color: #0F766E;">${progressPercent}%</td>
            </tr>
            <tr>
              <td style="padding: 12px 16px; color: #666;">Updates Posted</td>
              <td style="padding: 12px 16px; font-weight: 600; text-align: right;">${c.updateCount}</td>
            </tr>
          </table>
          ${c.updateCount === 0
            ? `<p>You haven't posted any updates yet. Even a short one can boost donations this week.</p>${ctaButton(`${BASE_URL}/dashboard/campaigns/${c.campaignSlug}`, 'Write your first update')}`
            : ctaButton(`${BASE_URL}/dashboard/campaigns/${c.campaignSlug}`, 'View Dashboard')
          }
        `),
      };
    }
  }
}

// ─── 5. Verification Escalation Sequence ────────────────────────────────────
//
// Psychology uses graduated commitment:
// Stage 1 (day 0): Celebration + gentle verification intro
// Stage 2 (day 3): Specific instructions, lower barrier
// Stage 3 (day 7): Social accountability (donors waiting)
// Stage 4 (day 14): Urgency with empathy
// Stage 5 (day 21): Final warning with helpline
//
// The existing verificationReminderEmail handles 4 levels (gentle/firm/warning/final).
// This adds the initial celebration-to-verification bridge and a support escalation.

export type VerificationStage =
  | 'celebration_bridge'    // Right after completion, celebratory + "here's what's next"
  | 'gentle_instructions'   // Day 3: step-by-step, low barrier
  | 'social_accountability' // Day 7: your donors are waiting
  | 'urgency_with_empathy'  // Day 14: understand life is hard, but funds at risk
  | 'final_with_support';   // Day 21: direct support offer, last chance

export function verificationEscalationEmail(p: {
  creatorName: string;
  campaignTitle: string;
  campaignSlug: string;
  campaignId: string;
  stage: VerificationStage;
  donorCount: number;
  goalAmount: number;
  daysRemaining: number;
}) {
  const creatorName = esc(p.creatorName);
  const campaignTitle = esc(p.campaignTitle);

  switch (p.stage) {
    case 'celebration_bridge': {
      return {
        subject: `Incredible! "${p.campaignTitle}" is fully funded!`,
        html: wrap(`
          <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">You Did It!</h1>
          <p>Hi ${creatorName},</p>
          <p>Stop and take this in. <strong>${p.donorCount}</strong> people gave <strong>${formatCents(p.goalAmount)}</strong> to <strong>"${campaignTitle}."</strong></p>
          <p>Before we send you the money, we check a few things. This keeps you safe, and it keeps the people who gave safe too.</p>
          <p style="font-weight: 600;">Here's what you'll need:</p>
          <ol style="line-height: 2; color: #333;">
            <li>A government-issued photo ID</li>
            <li>A quick selfie for identity matching</li>
            <li>Supporting documents related to your campaign (receipts, letters, etc.)</li>
          </ol>
          ${calloutBox(`<strong>No rush today.</strong> You have ${p.daysRemaining} days to complete verification. But the sooner you start, the sooner your funds are released.`)}
          ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignId}/verification`, 'Start Verification')}
        `),
      };
    }

    case 'gentle_instructions': {
      return {
        subject: `Quick steps to get your funds from "${p.campaignTitle}"`,
        html: wrap(`
          <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Three Steps to Your Funds</h1>
          <p>Hi ${creatorName},</p>
          <p>Your campaign <strong>"${campaignTitle}"</strong> raised <strong>${formatCents(p.goalAmount)}</strong>. Here's exactly how to access those funds:</p>
          <div style="margin: 20px 0;">
            <div style="display: flex; margin-bottom: 16px;">
              <div style="background: #0F766E; color: white; border-radius: 50%; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; font-weight: 600; margin-right: 12px; flex-shrink: 0;">1</div>
              <div>
                <p style="margin: 0; font-weight: 600;">Verify your identity (2 minutes)</p>
                <p style="margin: 4px 0 0; color: #666;">Upload your photo ID and take a quick selfie. Stripe handles this securely.</p>
              </div>
            </div>
            <div style="display: flex; margin-bottom: 16px;">
              <div style="background: #0F766E; color: white; border-radius: 50%; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; font-weight: 600; margin-right: 12px; flex-shrink: 0;">2</div>
              <div>
                <p style="margin: 0; font-weight: 600;">Upload supporting documents (5 minutes)</p>
                <p style="margin: 4px 0 0; color: #666;">Hospital letters, receipts, or official correspondence related to your campaign.</p>
              </div>
            </div>
            <div style="display: flex; margin-bottom: 16px;">
              <div style="background: #0F766E; color: white; border-radius: 50%; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; font-weight: 600; margin-right: 12px; flex-shrink: 0;">3</div>
              <div>
                <p style="margin: 0; font-weight: 600;">Connect your bank account (3 minutes)</p>
                <p style="margin: 4px 0 0; color: #666;">Set up your payout account through Stripe so we know where to send the funds.</p>
              </div>
            </div>
          </div>
          <p>That's it. Once our team reviews everything (usually within 48 hours), your fund release begins.</p>
          ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignId}/verification`, 'Begin Now')}
          <p style="color: #666; font-size: 14px;">Having trouble? Contact <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a> and we'll walk you through it.</p>
        `),
      };
    }

    case 'social_accountability': {
      return {
        subject: `${p.donorCount} donors are waiting to hear from you`,
        html: wrap(`
          <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your Donors Are Watching</h1>
          <p>Hi ${creatorName},</p>
          <p><strong>${p.donorCount}</strong> people donated to <strong>"${campaignTitle}"</strong> because they trust you. Completing verification shows them their trust was well placed.</p>
          <p>We have not had your papers yet. We need them before we can send you your <strong>${formatCents(p.goalAmount)}</strong>.</p>
          ${calloutBox(
            `You have <strong>${p.daysRemaining} days remaining</strong> to complete verification. After that, we may need to return funds to donors.`,
            '#D97706',
            '#fffbeb'
          )}
          <p>If something is making this difficult, please tell us. We can extend deadlines, help with documents, or explain any part of the process.</p>
          ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignId}/verification`, 'Complete Verification')}
          <p style="color: #666; font-size: 14px;">Need help? <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a></p>
        `),
      };
    }

    case 'urgency_with_empathy': {
      return {
        subject: `${p.daysRemaining} days left to verify "${p.campaignTitle}"`,
        html: wrap(`
          <h1 style="color: #EA580C; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Time Is Running Short</h1>
          <p>Hi ${creatorName},</p>
          <p>We understand that life can get overwhelming, especially when you're going through a difficult time. But we need to let you know that your verification deadline for <strong>"${campaignTitle}"</strong> is approaching.</p>
          <p style="color: #EA580C; font-weight: 600;">You have ${p.daysRemaining} days to complete verification before we may need to begin returning the ${formatCents(p.goalAmount)} in donations back to donors.</p>
          <p>We don't want that to happen, and we know you don't either. If anything is standing in the way, we're here to help:</p>
          <ul style="line-height: 2; color: #333;">
            <li>Can't find your ID? We can work with alternative documents.</li>
            <li>Don't have receipts yet? We can extend your timeline.</li>
            <li>Confused about the process? Reply to this email and we'll guide you step by step.</li>
          </ul>
          ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignId}/verification`, 'Finish your checks')}
          <p style="color: #666; font-size: 14px;">Direct line: <a href="mailto:verify@lastdonor.org" style="color: #0F766E;">verify@lastdonor.org</a></p>
        `),
      };
    }

    case 'final_with_support': {
      return {
        subject: `Last chance: ${p.daysRemaining} days to verify and receive ${formatCents(p.goalAmount)}`,
        html: wrap(`
          <h1 style="color: #DC2626; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Final Notice</h1>
          <p>Hi ${creatorName},</p>
          <p>This is our last reminder about <strong>"${campaignTitle}."</strong></p>
          <p>You have <strong>${p.daysRemaining} days</strong> left. After that we start sending the <strong>${formatCents(p.goalAmount)}</strong> back to the <strong>${p.donorCount}</strong> people who gave it.</p>
          <p>We have written to you a few times. We want you to get this money. If something is making this hard, tell us. We can usually help.</p>
          ${calloutBox(
            `<strong>Need help now?</strong> Email <a href="mailto:verify@lastdonor.org" style="color: #DC2626;">verify@lastdonor.org</a>. Put the word URGENT in the subject line.`,
            '#DC2626',
            '#fef2f2'
          )}
          ${ctaButton(`${BASE_URL}/dashboard/campaigns/${p.campaignId}/verification`, 'Finish your checks', '#DC2626')}
        `),
      };
    }
  }
}

// ─── 6. Donor Re-engagement (Dormant Donors) ───────────────────────────────
//
// Psychology:
// - Day 30: Light touch, show new campaigns, no guilt
// - Day 60: Remind of past impact, offer fresh cause
// - Day 90: Final, respectful farewell with easy re-entry
//
// Key rule: Never guilt a dormant donor. They gave once. That was generous.
// The goal is to re-spark interest, not obligation.

export type ReengagementStage = 'light_touch' | 'impact_reminder' | 'farewell';

export function donorReengagementEmail(p: {
  donorName: string;
  donorEmail: string;
  stage: ReengagementStage;
  lastDonationDate: string;
  totalDonatedCents: number;
  campaignsSupported: number;
  featuredCampaigns: Array<{ title: string; slug: string; progressPercent: number; category: string }>;
}) {
  const donorName = esc(p.donorName);

  switch (p.stage) {
    case 'light_touch': {
      const campaignsList = p.featuredCampaigns.slice(0, 3).map(c => `
        <div style="border: 1px solid #eee; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
          <p style="font-weight: 600; margin: 0 0 4px;">${esc(c.title)}</p>
          <p style="color: #666; margin: 0; font-size: 14px;">${esc(c.category)} · ${c.progressPercent}% funded</p>
          <a href="${BASE_URL}/campaigns/${c.slug}" style="color: #0F766E; font-weight: 600; font-size: 14px; text-decoration: none;">Learn more</a>
        </div>
      `).join('');

      return {
        subject: `New campaigns on LastDonor that could use your help`,
        html: wrap(`
          <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Good to See You Again</h1>
          <p>Hi ${donorName},</p>
          <p>It's been a little while since your last donation. We hope you're doing well.</p>
          <p>A few new campaigns have launched since then, and we thought you might want to take a look:</p>
          ${campaignsList}
          ${ctaButton(`${BASE_URL}/campaigns`, 'See all campaigns')}
          <p style="color: #666; font-size: 14px;">Not interested right now? No problem at all. We'll check in again in a few weeks.</p>
        `),
      };
    }

    case 'impact_reminder': {
      return {
        subject: `Remember when you helped ${p.campaignsSupported} campaign${p.campaignsSupported === 1 ? '' : 's'}?`,
        html: wrap(`
          <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your Impact on LastDonor</h1>
          <p>Hi ${donorName},</p>
          <p>We wanted to take a moment to recognize what you've done. Since joining LastDonor, you've donated <strong>${formatCents(p.totalDonatedCents)}</strong> across <strong>${p.campaignsSupported}</strong> campaign${p.campaignsSupported === 1 ? '' : 's'}. That's real money that went to real people.</p>
          <p>There are always new campaigns that could use someone like you. No pressure, just an open door whenever you're ready.</p>
          ${p.featuredCampaigns.length > 0
            ? `
              <h3 style="color: #333; margin: 20px 0 12px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Campaigns near their goal:</h3>
              ${p.featuredCampaigns.slice(0, 2).map(c => `
                <div style="border: 1px solid #eee; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
                  <p style="font-weight: 600; margin: 0 0 4px;">${esc(c.title)}</p>
                  <p style="color: #0F766E; margin: 0; font-size: 14px;">${c.progressPercent}% funded</p>
                  <a href="${BASE_URL}/campaigns/${c.slug}" style="color: #0F766E; font-weight: 600; font-size: 14px; text-decoration: none;">See campaign</a>
                </div>
              `).join('')}
            `
            : ''
          }
          ${ctaButton(`${BASE_URL}/campaigns`, 'See other campaigns')}
        `),
      };
    }

    case 'farewell': {
      return {
        subject: `We'll miss you, ${p.donorName}`,
        html: wrap(`
          <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Just Checking In</h1>
          <p>Hi ${donorName},</p>
          <p>It's been a while since we've heard from you, and we wanted to say: thank you. Your past donations made a real difference, and that doesn't expire.</p>
          <p>This will be our last outreach for now. If you ever want to come back and explore new campaigns, we'll be here. No sign-up needed, no re-enrollment. Just visit whenever you're ready.</p>
          ${ctaButton(`${BASE_URL}/campaigns`, 'Visit LastDonor')}
          <p style="color: #666; font-size: 14px;">You can update your email preferences anytime at <a href="${BASE_URL}/settings" style="color: #999;">your settings page</a>.</p>
        `),
      };
    }
  }
}

// ─── 7. High-Value Donor Treatment ──────────────────────────────────────────
//
// Psychology:
// - Exclusivity without elitism: "your contribution stands out"
// - Direct communication channel: "reply to this email directly"
// - Impact visualization: specific about what the money enables
// - No upsell: never ask a high-value donor for more immediately

export function highValueDonorThankYouEmail(p: {
  donorName: string;
  amount: number;
  campaignTitle: string;
  campaignSlug: string;
  campaignCategory: string;
  campaignProgressPercent: number;
  donorContext: DonorContext;
}) {
  const isRepeat = p.donorContext.totalDonationCount > 1;
  const donorName = esc(p.donorName);
  const campaignTitle = esc(p.campaignTitle);

  return {
    subject: `A personal thank you from LastDonor, ${p.donorName}`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Thank You, ${donorName}</h1>
      <p>Your donation of <strong>${formatCents(p.amount)}</strong> to <strong>"${campaignTitle}"</strong> is remarkable. We don't say that lightly.</p>
      ${isRepeat
        ? `<p>You've now donated <strong>${formatCents(p.donorContext.totalDonatedCents)}</strong> across <strong>${p.donorContext.campaignsSupported}</strong> campaigns on LastDonor. You're among the people who make this platform possible.</p>`
        : `<p>A gift this size makes a real difference. It moves this campaign much closer to its goal.</p>`
      }
      ${calloutBox(
        `<strong>What you did:</strong> "${campaignTitle}" is now <strong>${p.campaignProgressPercent}%</strong> funded. A large part of that is your gift.`
      )}
      <p>Want to know how the money is used? Reply to this email and ask. A person will read it.</p>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'See the campaign')}
    `),
  };
}

// ─── 8. Post-Donation Engagement ────────────────────────────────────────────
//
// Psychology:
// - Reinforce the decision to give (reduce buyer's remorse)
// - Show tangible progress (the money is doing something)
// - Create anticipation (there's more to come)
// - Invite participation (share, follow, not just give)

export function postDonationImpactEmail(p: {
  donorName: string;
  campaignTitle: string;
  campaignSlug: string;
  donationDate: string;
  donationAmount: number;
  currentProgressPercent: number;
  currentDonorCount: number;
  latestUpdate?: string | null;
}) {
  const donorName = esc(p.donorName);
  const campaignTitle = esc(p.campaignTitle);

  return {
    subject: `Here's what your donation to "${p.campaignTitle}" is doing`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Your Donation at Work</h1>
      <p>Hi ${donorName},</p>
      <p>A week ago, you donated <strong>${formatCents(p.donationAmount)}</strong> to <strong>"${campaignTitle}."</strong> We wanted to show you what's happened since.</p>
      <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <div style="background: #e5e7eb; border-radius: 4px; height: 12px; overflow: hidden;">
          <div style="background: #0F766E; height: 100%; width: ${Math.min(p.currentProgressPercent, 100)}%; border-radius: 4px;"></div>
        </div>
        <p style="margin: 8px 0 0; color: #0F766E; font-weight: 600;">${p.currentProgressPercent}% funded · ${p.currentDonorCount} donors</p>
      </div>
      ${p.latestUpdate
        ? `
          <h3 style="color: #333; margin: 20px 0 8px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Latest update from the campaign:</h3>
          <blockquote style="border-left: 3px solid #0F766E; margin: 12px 0; padding: 8px 16px; color: #444; font-style: italic;">${esc(p.latestUpdate)}</blockquote>
        `
        : `<p>No updates yet, but the campaign is making progress. We'll keep you posted with new updates.</p>`
      }
      <p>The best thing you can do now is share this campaign with someone who might care. Personal shares are the single most effective way to drive donations.</p>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'View Campaign & Share')}
    `),
  };
}

// ─── 9. Donor Thank-You from Campaign Creator ──────────────────────────────
//
// Sent when the creator posts a thank-you update. Subscribers receive it
// with creator's personal message embedded.

export function creatorThankYouUpdateEmail(p: {
  donorName: string;
  donorEmail: string;
  creatorName: string;
  campaignTitle: string;
  campaignSlug: string;
  /** Campaigns table UUID. Required: the unsubscribe token signs over it. */
  campaignId: string;
  thankYouMessage: string;
  progressPercent: number;
}) {
  const donorName = esc(p.donorName);
  const creatorName = esc(p.creatorName);
  const campaignTitle = esc(p.campaignTitle);

  return {
    subject: `A message from ${p.creatorName}: "${p.campaignTitle}"`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">A Message From ${creatorName}</h1>
      <p>Hi ${donorName},</p>
      <p>The person behind <strong>"${campaignTitle}"</strong> wrote you a personal message:</p>
      <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #0F766E;">
        <p style="margin: 0; color: #333; line-height: 1.7;">${esc(p.thankYouMessage)}</p>
        <p style="margin: 12px 0 0; color: #666; font-size: 14px; font-style: italic;">- ${creatorName}</p>
      </div>
      <p>The campaign is currently <strong>${p.progressPercent}%</strong> funded.</p>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'See the campaign')}
      ${campaignUnsubscribeFooter({ campaignId: p.campaignId, campaignSlug: p.campaignSlug, donorEmail: p.donorEmail })}
    `),
  };
}

// ─── 10. Campaign Update Digest (Subscriber Email) ──────────────────────────
//
// For donors who subscribed to updates. Sent when the campaign posts
// a new update so they stay connected.

export function campaignUpdateDigestEmail(p: {
  donorName: string;
  donorEmail: string;
  campaignTitle: string;
  campaignSlug: string;
  /** Campaigns table UUID. Required: the unsubscribe token signs over it. */
  campaignId: string;
  updateTitle: string;
  updateExcerpt: string;
  progressPercent: number;
  raisedCents: number;
  goalCents: number;
}) {
  const donorName = esc(p.donorName);
  const campaignTitle = esc(p.campaignTitle);

  return {
    subject: `Update: "${p.campaignTitle}" - ${p.updateTitle}`,
    html: wrap(`
      <h1 style="color: #0F766E; font-size: 24px; margin: 0 0 16px;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">Campaign Update</h1>
      <p>Hi ${donorName},</p>
      <p>There's a new update on <strong>"${campaignTitle},"</strong> a campaign you donated to:</p>
      <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px; color: #333;font-family:Georgia, 'Times New Roman', Times, serif;line-height:1.2;">${esc(p.updateTitle)}</h3>
        <p style="margin: 0; color: #444; line-height: 1.6;">${esc(p.updateExcerpt)}</p>
      </div>
      <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <div style="background: #e5e7eb; border-radius: 4px; height: 12px; overflow: hidden;">
          <div style="background: #0F766E; height: 100%; width: ${Math.min(p.progressPercent, 100)}%; border-radius: 4px;"></div>
        </div>
        <p style="margin: 8px 0 0; color: #666; font-size: 14px;">${formatCents(p.raisedCents)} of ${formatCents(p.goalCents)} raised (${p.progressPercent}%)</p>
      </div>
      ${ctaButton(`${BASE_URL}/campaigns/${p.campaignSlug}`, 'Read Full Update')}
      ${campaignUnsubscribeFooter({ campaignId: p.campaignId, campaignSlug: p.campaignSlug, donorEmail: p.donorEmail })}
    `),
  };
}
