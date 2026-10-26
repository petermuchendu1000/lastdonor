/**
 * Outgoing mail states money in the currency it was given in.
 *
 * ── THE DEFECT, reproduced by rendering the real template ───────────────────
 *
 * `email-adaptive.ts` had a private
 * `formatCents(cents) => `$${(cents / 100).toFixed(2)}`` used at 28 sites
 * across nine templates. The one with a live caller is the campaign update
 * digest: an organiser posts an update, `notifyCampaignUpdateDigest` mails
 * EVERY SUBSCRIBED DONOR, and for a shilling campaign the body read
 *
 *     $18400.00 of $50000.00 raised (37%)
 *
 * where the campaign had raised KES 18,400.00 of KES 50,000.00. Three
 * separate faults in one line: the wrong symbol, no thousands separator, and
 * a hardcoded divide by 100 that understates a zero-decimal currency 100x
 * (`docs/103`).
 *
 * ⚠️ Eight of the nine templates have NO caller. They are covered here anyway,
 * because `docs/110` §7 is the precedent: dormant bad copy becomes mail
 * somebody receives the moment a cron or a route is wired to it.
 */
import { describe, expect, it } from 'vitest';

/*
  ⚠️ `formatMoney` separates the symbol from the number with a NON-BREAKING
  SPACE (U+00A0), which is what `Intl.NumberFormat` emits. Asserting
  'Ksh 18,400.00' with an ordinary space against raw HTML fails - the first
  draft of this file did exactly that. `testing-library` normalises
  whitespace, so component assertions elsewhere never had to notice.
*/
const nb = (s: string) => s.replace(/\u00a0/g, ' ');

import {
  campaignUpdateDigestEmail,
  verificationEscalationEmail,
  postDonationImpactEmail,
} from './email-adaptive';

const BASE = {
  donorName: 'Peter Kamau',
  donorEmail: 'donor@example.test',
  campaignTitle: 'Treatment for Baby Amani',
  campaignSlug: 'treatment-for-baby-amani',
  campaignId: '00000000-0000-0000-0000-000000000001',
  updateTitle: 'Amani is out of theatre',
  updateExcerpt: 'The operation went well.',
  progressPercent: 37,
  raisedCents: 1_840_000,
  goalCents: 5_000_000,
};

describe('campaign update digest renders the campaign currency', () => {
  it('⛔ a KES campaign says Ksh, and never a dollar sign', () => {
    const html = nb(campaignUpdateDigestEmail({ ...BASE, currency: 'KES' }).html);

    expect(html).toContain('Ksh 18,400.00');
    expect(html).toContain('Ksh 50,000.00');
    // The exact strings the defect produced.
    expect(html).not.toContain('$18400.00');
    expect(html).not.toContain('$50000.00');
    // And no dollar amount at all in the money line.
    const line = html.match(/[^>]*raised \(\d+%\)/)?.[0] ?? '';
    expect(line).not.toMatch(/\$\s?\d/);
  });

  it('a USD campaign still says $, now with a thousands separator', () => {
    const html = nb(campaignUpdateDigestEmail({ ...BASE, currency: 'USD' }).html);
    expect(html).toContain('$18,400.00');
    // The old renderer produced this; `formatMoney` groups thousands.
    expect(html).not.toContain('$18400.00');
  });

  it('the two currencies produce different output for identical amounts', () => {
    /*
      KES and USD share exponent 2, so the DIGITS are the same and only the
      symbol differs. That is exactly why the defect survived: every figure
      was numerically right. If these two ever render identically, the
      currency is being ignored again.
    */
    const kes = nb(campaignUpdateDigestEmail({ ...BASE, currency: 'KES' }).html);
    const usd = nb(campaignUpdateDigestEmail({ ...BASE, currency: 'USD' }).html);
    expect(kes).not.toEqual(usd);
  });
});

describe('the templates with no caller are covered too', () => {
  it('the verification escalation ladder names the currency', () => {
    const { html, subject } = verificationEscalationEmail({
      currency: 'KES',
      creatorName: 'Grace Wanjiru',
      campaignTitle: 'Treatment for Baby Amani',
      campaignSlug: 'treatment-for-baby-amani',
      campaignId: '00000000-0000-0000-0000-000000000001',
      stage: 'final_with_support',
      donorCount: 31,
      goalAmount: 5_000_000,
      daysRemaining: 3,
    });
    const body = nb(`${subject} ${html}`);
    expect(body).toContain('Ksh 50,000.00');
    expect(body).not.toMatch(/\$\s?\d/);
  });

  it('the post-donation impact mail names the currency', () => {
    const out = postDonationImpactEmail({
      currency: 'KES',
      donorName: 'Peter Kamau',
      campaignTitle: 'Treatment for Baby Amani',
      campaignSlug: 'treatment-for-baby-amani',
      donationDate: '2026-10-19',
      donationAmount: 250_000,
      currentProgressPercent: 37,
      currentDonorCount: 31,
    });
    const html = nb(out.html);
    expect(html).toContain('Ksh 2,500.00');
    expect(html).not.toMatch(/\$\s?\d/);
  });
});
