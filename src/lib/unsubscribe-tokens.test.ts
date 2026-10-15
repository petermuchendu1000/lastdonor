/**
 * Shared unsubscribe-token helper (extracted 2026-10-15).
 *
 * The mint/verify pair was duplicated between `cron/send-newsletter` and
 * `newsletter/unsubscribe`. These tests pin the wire format so the extraction
 * cannot change it — every link already sitting in a subscriber's inbox is
 * verified by the same algorithm.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import {
  createUnsubscribeToken,
  tryCreateUnsubscribeToken,
  verifyUnsubscribeToken,
  unsubscribeUrlForToken,
  unsubscribeUrlForSubscriber,
  unsubscribeMechanism,
  mailtoUnsubscribeMechanism,
  mailingPostalAddress,
  SUPPORT_MAILBOX,
} from './unsubscribe-tokens';

const SECRET = 'test-newsletter-unsubscribe-secret-0123456789';
const SUB_ID = '11111111-1111-4111-8111-111111111111';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = SECRET;
  process.env.NEXT_PUBLIC_APP_URL = 'https://lastdonor.org';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('token format', () => {
  it('mints `<id>.<hex hmac-sha256(secret, id)>` — the format already in inboxes', () => {
    const expected = createHmac('sha256', SECRET).update(SUB_ID).digest('hex');
    expect(createUnsubscribeToken(SUB_ID)).toBe(`${SUB_ID}.${expected}`);
  });

  it('round-trips mint -> verify', () => {
    expect(verifyUnsubscribeToken(createUnsubscribeToken(SUB_ID))).toBe(SUB_ID);
  });

  it('rejects a token signed with a different secret', () => {
    const forged = `${SUB_ID}.${createHmac('sha256', 'other').update(SUB_ID).digest('hex')}`;
    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  it.each([null, undefined, '', 'nodot', `${SUB_ID}.`, `.abc`])(
    'rejects the malformed token %p',
    (token) => {
      expect(verifyUnsubscribeToken(token as string | null)).toBeNull();
    },
  );
});

describe('missing secret', () => {
  beforeEach(() => {
    delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
  });

  it('throws on mint rather than signing with a fallback secret', () => {
    expect(() => createUnsubscribeToken(SUB_ID)).toThrow(/NEWSLETTER_UNSUBSCRIBE_SECRET/);
  });

  it('never falls back to NEXTAUTH_SECRET', () => {
    process.env.NEXTAUTH_SECRET = 'some-session-secret';
    expect(() => createUnsubscribeToken(SUB_ID)).toThrow();
    expect(tryCreateUnsubscribeToken(SUB_ID)).toBeNull();
  });

  it('fails closed on verify instead of accepting anything', () => {
    const anything = `${SUB_ID}.${'a'.repeat(64)}`;
    expect(verifyUnsubscribeToken(anything)).toBeNull();
  });
});

describe('link construction', () => {
  it('points at the newsletter unsubscribe route', () => {
    const url = unsubscribeUrlForSubscriber(SUB_ID);
    expect(url).toContain('https://lastdonor.org/api/v1/newsletter/unsubscribe?token=');
    expect(verifyUnsubscribeToken(decodeURIComponent(url!.split('token=')[1]))).toBe(SUB_ID);
  });

  it('strips a trailing slash from NEXT_PUBLIC_APP_URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.org/';
    expect(unsubscribeUrlForToken('t')).toBe('https://example.org/api/v1/newsletter/unsubscribe?token=t');
  });
});

describe('unsubscribeMechanism', () => {
  it('advertises RFC 8058 one-click for an https endpoint', () => {
    const m = unsubscribeMechanism(SUB_ID);
    expect(m.oneClick).toBe(true);
    expect(m.url).toContain('/api/v1/newsletter/unsubscribe?token=');
    expect(m.headers['List-Unsubscribe']).toBe(`<${m.url}>`);
    expect(m.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('falls back to a mailto when no subscriber row exists, and does NOT advertise one-click POST', () => {
    const m = unsubscribeMechanism(null);
    expect(m.oneClick).toBe(false);
    expect(m.url).toBe(`mailto:${SUPPORT_MAILBOX}?subject=Unsubscribe`);
    expect(m.headers['List-Unsubscribe']).toBe(`<mailto:${SUPPORT_MAILBOX}?subject=Unsubscribe>`);
    expect(m.headers).not.toHaveProperty('List-Unsubscribe-Post');
  });

  it('falls back to mailto rather than throwing when the secret is unset', () => {
    delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
    expect(unsubscribeMechanism(SUB_ID)).toEqual(mailtoUnsubscribeMechanism());
  });
});

describe('mailingPostalAddress (CAN-SPAM sender identity)', () => {
  it('returns null when unset — there is deliberately no default address', () => {
    delete process.env.MAILING_POSTAL_ADDRESS;
    expect(mailingPostalAddress()).toBeNull();
  });

  it('treats blank/whitespace as unset', () => {
    process.env.MAILING_POSTAL_ADDRESS = '   ';
    expect(mailingPostalAddress()).toBeNull();
  });

  it('returns the configured address, trimmed', () => {
    process.env.MAILING_POSTAL_ADDRESS = '  PO Box 1, Anytown, ST 00000 ';
    expect(mailingPostalAddress()).toBe('PO Box 1, Anytown, ST 00000');
  });

  it('returns only what the operator configured — no placeholder substitution', () => {
    delete process.env.MAILING_POSTAL_ADDRESS;
    expect(mailingPostalAddress()).toBeNull();
    process.env.MAILING_POSTAL_ADDRESS = 'PO Box 1, Anytown, ST 00000';
    expect(mailingPostalAddress()).toBe('PO Box 1, Anytown, ST 00000');
  });
});
