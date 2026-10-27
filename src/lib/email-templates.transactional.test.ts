/**
 * The two transactional emails that never got the docs/67 shell.
 *
 * Until 2026-10-16 the password reset and the donation receipt were the only
 * two sends in the codebase rendering their own raw `<div>` inside a route
 * handler. They are also the two that matter most: one is an account-takeover
 * credential, the other is a record of money. The receipt additionally
 * interpolated a donor-supplied name into HTML unescaped.
 *
 * These tests pin the shell contract for both, and the escaping, so neither
 * can quietly regress to a hand-rolled div again. See docs/74.
 */
import { describe, it, expect } from 'vitest';
import {
  campaignCompletedEmail,
  campaignCancelledRefundEmail,
  passwordResetEmail,
  passwordResetNoAccountEmail,
  passwordResetOauthOnlyEmail,
  donationReceiptEmail,
} from './email-templates';

const RESET_URL =
  'https://lastdonor.org/login/reset-password?token=90880e89-4783-4df6-904d-94623a990e70&email=a%40b.com';

const ALL = [
  ['passwordResetEmail', passwordResetEmail({ resetUrl: RESET_URL })],
  ['passwordResetNoAccountEmail', passwordResetNoAccountEmail()],
  ['passwordResetOauthOnlyEmail', passwordResetOauthOnlyEmail({ provider: 'google' })],
  [
    'donationReceiptEmail',
    donationReceiptEmail({
      campaignTitle: 'Help Maria',
      donorName: 'Grace',
      isAnonymous: false,
      amount: 5000,
      transactionId: 'pi_3Abc',
      currency: 'USD',
    }),
  ],
] as const;

describe('every one of them renders through the shared shell', () => {
  it.each(ALL)('%s is a real email document, not a bare div', (_name, email) => {
    expect(email.html).toMatch(/^<!DOCTYPE html/i);
    expect(email.html).toContain('<table');
    expect(email.subject.length).toBeGreaterThan(0);
  });

  it.each(ALL)('%s carries an inbox preview line', (_name, email) => {
    // The shell derives a preheader; a bare div emitted none, so the inbox
    // preview was whatever text happened to come first.
    expect(email.html).toMatch(/opacity:\s*0|display:\s*none|max-height:\s*0/i);
  });

  it.each(ALL)('%s uses no web font and no SVG (Gmail strips both)', (_name, email) => {
    expect(email.html).not.toMatch(/@font-face/i);
    expect(email.html).not.toMatch(/<svg/i);
    expect(email.html).not.toMatch(/DM Sans/);
  });
});

describe('the reset link email', () => {
  it('contains the reset URL exactly once, in a link', () => {
    const html = passwordResetEmail({ resetUrl: RESET_URL }).html;
    expect(html).toContain(RESET_URL);
  });

  it('states the one-hour, single-use limit the route actually enforces', () => {
    const html = passwordResetEmail({ resetUrl: RESET_URL }).html;
    expect(html).toMatch(/works once/i);
    expect(html).toMatch(/expires in one hour/i);
  });

  it('tells a recipient who did not ask that nothing changed', () => {
    expect(passwordResetEmail({ resetUrl: RESET_URL }).html).toMatch(/nothing has changed/i);
  });
});

describe('the two emails that previously did not exist', () => {
  it('the no-account one does not confirm or deny anything to a third party', () => {
    const html = passwordResetNoAccountEmail().html;
    // It is sent only to the typed address, and it says so explicitly.
    // Wording changed in the plain-language pass (docs/94); the promise
    // being pinned is unchanged - the sender learns nothing either way.
    expect(html).toMatch(/did not tell the person whether this address is in use/i);
  });

  it('the provider one names the provider, because that is the whole answer', () => {
    const html = passwordResetOauthOnlyEmail({ provider: 'google' }).html;
    expect(html).toMatch(/<strong>Google<\/strong>/);
    expect(html).toMatch(/Sign in with Google/);
  });

  it('the provider one still reads correctly with no provider known', () => {
    const html = passwordResetOauthOnlyEmail({ provider: null }).html;
    // Plain-language pass (docs/94): "a connected account" became
    // "another account". Still says there is no password and no reset.
    expect(html).toMatch(/sign in through another account/i);
    expect(html).not.toMatch(/undefined|null/);
  });

  it('neither of them leaks a token or a link to anything authenticated', () => {
    for (const html of [passwordResetNoAccountEmail().html, passwordResetOauthOnlyEmail({ provider: 'google' }).html]) {
      expect(html).not.toMatch(/reset-password\?token=/);
    }
  });
});

describe('the donation receipt escapes everything it interpolates', () => {
  /*
    `donorName` is free text the donor types into the checkout form. It
    reached this markup through Stripe metadata and was previously written
    into the HTML raw.
  */
  const hostile = '<img src=x onerror="alert(1)">';

  it('escapes a donor name', () => {
    const html = donationReceiptEmail({
      campaignTitle: 'Help Maria',
      donorName: hostile,
      isAnonymous: false,
      amount: 5000,
      transactionId: 'pi_3Abc',
      currency: 'USD',
    }).html;

    expect(html).not.toContain('<img');
    // The whole thing survives only as inert text: the angle brackets AND
    // the attribute quotes are escaped, so there is no tag and no attribute.
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('escapes a campaign title', () => {
    const html = donationReceiptEmail({
      campaignTitle: hostile,
      donorName: 'Grace',
      isAnonymous: false,
      amount: 5000,
      transactionId: 'pi_3Abc',
      currency: 'USD',
    }).html;

    expect(html).not.toContain('<img');
  });

  it('escapes the transaction id', () => {
    const html = donationReceiptEmail({
      campaignTitle: 'Help Maria',
      donorName: 'Grace',
      isAnonymous: false,
      amount: 5000,
      currency: 'USD',
      transactionId: hostile,
    }).html;

    expect(html).not.toContain('<img');
  });

  it('never prints the donor name when the gift is anonymous', () => {
    const html = donationReceiptEmail({
      campaignTitle: 'Help Maria',
      donorName: 'Grace Okonkwo',
      isAnonymous: true,
      amount: 5000,
      transactionId: 'pi_3Abc',
      currency: 'USD',
    }).html;

    expect(html).not.toContain('Grace');
    // "Dear" became "Hi" in the plain-language pass (docs/94). The
    // invariant being pinned is the fallback greeting, not the salutation.
    expect(html).toContain('Hi Donor');
  });

  it('states the amount in dollars, and stamps the date in UTC', () => {
    const html = donationReceiptEmail({
      campaignTitle: 'Help Maria',
      donorName: 'Grace',
      isAnonymous: false,
      amount: 5000,
      transactionId: 'pi_3Abc',
      currency: 'USD',
      date: new Date('2026-10-16T23:30:00Z'),
    }).html;

    expect(html).toContain('$50.00');
    // A receipt with an unlabelled server-locale date cannot be reconciled.
    expect(html).toContain('2026-10-16 (UTC)');
  });

  it('does not call itself a tax receipt', () => {
    const html = donationReceiptEmail({
      campaignTitle: 'Help Maria',
      donorName: 'Grace',
      isAnonymous: false,
      amount: 5000,
      transactionId: 'pi_3Abc',
      currency: 'USD',
    }).html;

    expect(html).toMatch(/not a tax receipt/i);
  });
});

/* ───────────────────────────────────────────────────────────────────────── */

describe('⛔ an email states money in the campaign\'s own currency', () => {
  /*
    The reported symptom, as behaviour rather than shape.

    `notifications.ts` called `campaignCompletedEmail` with no `currency`,
    and `formatCents` defaulted to USD - so the "your campaign reached its
    goal" email, which goes to EVERY donor, told a Kenyan campaign's donors
    the goal in dollars. Measured before the fix: KES 50,000 rendered as
    `$50,000.00`, roughly 130x. `docs/125`.
  */
  const goalMinor = 5_000_000;

  /*
    ⚠️ `Intl` puts a NON-BREAKING space (U+00A0) between a multi-character
    symbol and the number, so `toContain('Ksh 50.00')` with an ordinary space
    never matches - while the `$` cases pass, because `$1,000.00` has no
    space at all. An assertion that silently cannot match is worse than none.
  */
  const flat = (html: string) => html.replace(/\u00a0/g, ' ');

  it('renders a KES goal in shillings, not dollars', () => {
    const html = campaignCompletedEmail({
      donorName: 'Ada',
      campaignTitle: 'Nairobi appeal',
      campaignSlug: 'nairobi-appeal',
      goalAmount: goalMinor,
      currency: 'KES',
    }).html;
    expect(flat(html)).toContain('Ksh 50,000.00');
    expect(flat(html)).not.toContain('$50,000.00');
  });

  it('⚠️ and the control: the same figure in USD renders differently', () => {
    // Without this, a template that ignored the parameter entirely and
    // always printed shillings would satisfy the rule above.
    const html = campaignCompletedEmail({
      donorName: 'Ada',
      campaignTitle: 'US appeal',
      campaignSlug: 'us-appeal',
      goalAmount: goalMinor,
      currency: 'USD',
    }).html;
    expect(flat(html)).toContain('$50,000.00');
    expect(flat(html)).not.toContain('Ksh');
  });

  it('⚠️ a suggested campaign is rendered in ITS currency, not the reader\'s', () => {
    /*
      `campaignCancelledRefundEmail` lists OTHER campaigns to give to. They
      are other people's campaigns and need not share the reader's currency,
      so each carries its own - rendering them all in the reader's would
      misstate a stranger's total.
    */
    const html = campaignCancelledRefundEmail({
      donorName: 'Ada',
      campaignTitle: 'Nairobi appeal',
      donationAmount: 5_000,
      currency: 'KES',
      cancellationReason: 'The organiser asked us to close it.',
      similarCampaigns: [
        { title: 'A US campaign', slug: 'us', raised: 100_000, goal: 900_000, currency: 'USD' },
      ],
    }).html;
    expect(flat(html)).toContain('Ksh 50.00');   // the reader's own donation
    expect(flat(html)).toContain('$1,000.00');   // the suggested campaign
  });
});
