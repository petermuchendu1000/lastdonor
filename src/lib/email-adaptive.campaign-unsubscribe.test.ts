/**
 * Campaign-update footers must carry a token the unsubscribe route accepts.
 *
 * ## The defect these tests pin
 *
 * `creatorThankYouUpdateEmail` and `campaignUpdateDigestEmail` built their
 * footer as `/unsubscribe?email=...&campaign=<slug>` with no `token`, while
 * `DELETE /api/v1/campaigns/[slug]/subscribe` has required an HMAC token (or a
 * session owning the address) since the P1-6 fix. Every one-click unsubscribe
 * link already in a donor's inbox therefore answered 403. That is a CAN-SPAM
 * 16 CFR 316.5 and GDPR Art. 7(3) defect.
 *
 * The token signs over the campaign UUID, so the regression is only really
 * closed if the footer link's token verifies against (campaignId, normalised
 * email): that is what the assertions below check, with the same verifier the
 * route uses.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SECRET = 'test-campaign-unsubscribe-secret-0123456789';
const CAMPAIGN_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_CAMPAIGN_ID = '99999999-9999-9999-9999-999999999999';
const SLUG = 'help-a-neighbour';
const DONOR_EMAIL = 'donor@example.com';

const originalEnv = { ...process.env };

// `BASE_URL` in `email-adaptive.ts` is captured at module load.
process.env.NEXTAUTH_URL = 'https://lastdonor.org';

const { creatorThankYouUpdateEmail, campaignUpdateDigestEmail } = await import('./email-adaptive');
const { verifyCampaignUnsubscribeToken, SUPPORT_MAILBOX } = await import('./unsubscribe-tokens');

beforeEach(() => {
  process.env.NEXTAUTH_URL = 'https://lastdonor.org';
  process.env.CAMPAIGN_UNSUBSCRIBE_SECRET = SECRET;
  delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

const thankYou = () =>
  creatorThankYouUpdateEmail({
    donorName: 'Dana',
    donorEmail: DONOR_EMAIL,
    creatorName: 'Sam',
    campaignTitle: 'Help a neighbour',
    campaignSlug: SLUG,
    campaignId: CAMPAIGN_ID,
    thankYouMessage: 'Thank you so much.',
    progressPercent: 62,
  });

const digest = () =>
  campaignUpdateDigestEmail({
    donorName: 'Dana',
    donorEmail: DONOR_EMAIL,
    campaignTitle: 'Help a neighbour',
    campaignSlug: SLUG,
    campaignId: CAMPAIGN_ID,
    updateTitle: 'Week two',
    updateExcerpt: 'Here is what happened.',
    progressPercent: 62,
    raisedCents: 620_00,
    goalCents: 1000_00,
  });

/** The single footer href out of a rendered email. */
function footerHref(html: string): string {
  const matches = [...html.matchAll(/href="([^"]*(?:\/unsubscribe\?|mailto:)[^"]*)"/g)].map(
    (m) => m[1],
  );
  expect(matches).toHaveLength(1);
  return matches[0];
}

const TEMPLATES: Array<[string, () => { html: string }]> = [
  ['creatorThankYouUpdateEmail', thankYou],
  ['campaignUpdateDigestEmail', digest],
];

describe.each(TEMPLATES)('%s footer', (_name, build) => {
  it('carries a token (the link is no longer the tokenless one that 403s)', () => {
    const href = footerHref(build().html);
    expect(href).toContain('/unsubscribe?');
    expect(href).toContain('token=');
  });

  it('carries a token that verifies for this campaign and this donor', () => {
    const query = new URL(footerHref(build().html)).searchParams;

    expect(query.get('email')).toBe(DONOR_EMAIL);
    expect(query.get('campaign')).toBe(SLUG);
    expect(verifyCampaignUnsubscribeToken(query.get('token'), CAMPAIGN_ID, DONOR_EMAIL)).toBe(true);
  });

  it('does not mint a token that works for another campaign or another donor', () => {
    const token = new URL(footerHref(build().html)).searchParams.get('token');

    expect(verifyCampaignUnsubscribeToken(token, OTHER_CAMPAIGN_ID, DONOR_EMAIL)).toBe(false);
    expect(verifyCampaignUnsubscribeToken(token, CAMPAIGN_ID, 'victim@example.com')).toBe(false);
  });

  it('points at the configured base url, not a hardcoded host', () => {
    expect(footerHref(build().html).startsWith('https://lastdonor.org/unsubscribe?')).toBe(true);
  });

  it('keeps the slug in the path the page needs, since the token alone is opaque', () => {
    expect(new URL(footerHref(build().html)).searchParams.get('campaign')).toBe(SLUG);
  });

  describe('with no signing secret configured', () => {
    beforeEach(() => {
      delete process.env.CAMPAIGN_UNSUBSCRIBE_SECRET;
      delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
    });

    it('does not emit a tokenless /unsubscribe link that would 403', () => {
      const html = build().html;
      expect(html).not.toContain('/unsubscribe?');
    });

    it('offers the support mailbox instead, naming the campaign', () => {
      const href = footerHref(build().html);
      expect(href.startsWith(`mailto:${SUPPORT_MAILBOX}?subject=`)).toBe(true);
      expect(decodeURIComponent(href)).toContain(SLUG);
    });

    it('does not label a mailto as a one-click unsubscribe', () => {
      const html = build().html;
      expect(html).toContain('Email us to unsubscribe');
      expect(html).not.toContain('>Unsubscribe from updates<');
    });

    it('still renders rather than throwing', () => {
      expect(() => build()).not.toThrow();
    });
  });

  it('falls back to the newsletter secret when only that one is set', () => {
    delete process.env.CAMPAIGN_UNSUBSCRIBE_SECRET;
    process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = SECRET;

    const token = new URL(footerHref(build().html)).searchParams.get('token');
    expect(verifyCampaignUnsubscribeToken(token, CAMPAIGN_ID, DONOR_EMAIL)).toBe(true);
  });

  it('normalises a mixed-case address so the route can reproduce the signature', () => {
    // The route verifies against `email.trim().toLowerCase()`, so the mint has
    // to apply the same normalisation or the signature cannot be reproduced.
    const mixed =
      _name === 'creatorThankYouUpdateEmail'
        ? creatorThankYouUpdateEmail({
            donorName: 'Dana',
            donorEmail: '  Donor@Example.COM ',
            creatorName: 'Sam',
            campaignTitle: 'Help a neighbour',
            campaignSlug: SLUG,
            campaignId: CAMPAIGN_ID,
            thankYouMessage: 'Thank you so much.',
            progressPercent: 62,
          })
        : campaignUpdateDigestEmail({
            donorName: 'Dana',
            donorEmail: '  Donor@Example.COM ',
            campaignTitle: 'Help a neighbour',
            campaignSlug: SLUG,
            campaignId: CAMPAIGN_ID,
            updateTitle: 'Week two',
            updateExcerpt: 'Here is what happened.',
            progressPercent: 62,
            raisedCents: 620_00,
            goalCents: 1000_00,
          });

    const query = new URL(footerHref(mixed.html)).searchParams;
    expect(query.get('email')).toBe(DONOR_EMAIL);
    expect(verifyCampaignUnsubscribeToken(query.get('token'), CAMPAIGN_ID, DONOR_EMAIL)).toBe(true);
  });
});
