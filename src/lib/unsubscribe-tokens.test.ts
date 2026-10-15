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
  CAMPAIGN_TOKEN_VERSION,
  campaignUnsubscribeSecret,
  createCampaignUnsubscribeToken,
  tryCreateCampaignUnsubscribeToken,
  verifyCampaignUnsubscribeToken,
  campaignUnsubscribeUrl,
  campaignUnsubscribeMechanism,
  normalizeUnsubscribeEmail,
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

/**
 * Consolidation guard (2026-10-15).
 *
 * `src/app/api/v1/newsletter/unsubscribe/route.ts` carried a private
 * `verifyUnsubscribeToken` until 2026-10-15. These tests pin the properties
 * that made deleting it safe: the legacy route copy and this module verify the
 * same bytes, the campaign-unsubscribe format is a different kind and must not
 * cross over, and nothing here loosens when the secret is absent.
 */
describe('legacy route-local verifier parity', () => {
  /**
   * Verbatim reimplementation of the verifier deleted from
   * `src/app/api/v1/newsletter/unsubscribe/route.ts` (lines 69-104 before the
   * change): untrimmed `process.env` read, `lastIndexOf('.')` framing, hex
   * HMAC-SHA256 over the bare subscriber id.
   */
  function legacyRouteVerify(token: string | null | undefined): string | null {
    if (!token) return null;
    const legacySecret = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
    if (!legacySecret) return null;
    const separator = token.lastIndexOf('.');
    if (separator <= 0 || separator === token.length - 1) return null;
    const subscriberId = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const expected = createHmac('sha256', legacySecret).update(subscriberId).digest('hex');
    return signature === expected ? subscriberId : null;
  }

  /** A token minted the way the pre-224e069 cron minted them. */
  function legacyMint(subscriberId: string, withSecret = SECRET): string {
    return `${subscriberId}.${createHmac('sha256', withSecret).update(subscriberId).digest('hex')}`;
  }

  it('verifies a legacy-format token — the link already in an inbox still works', () => {
    const legacy = legacyMint(SUB_ID);
    expect(legacyRouteVerify(legacy)).toBe(SUB_ID);
    expect(verifyUnsubscribeToken(legacy)).toBe(SUB_ID);
  });

  it('verifies a newly-minted token', () => {
    expect(verifyUnsubscribeToken(createUnsubscribeToken(SUB_ID))).toBe(SUB_ID);
  });

  it('mints the same bytes the legacy minter did, so the two are one format', () => {
    expect(createUnsubscribeToken(SUB_ID)).toBe(legacyMint(SUB_ID));
  });

  it.each([
    'sub-1',
    '11111111-1111-4111-8111-111111111111',
    'id.with.dots',
    'id-with-UPPER_and-0123',
  ])('agrees with the deleted route verifier for subscriber id %p', (id) => {
    const token = legacyMint(id);
    expect(legacyRouteVerify(token)).toBe(id);
    expect(verifyUnsubscribeToken(token)).toBe(id);
  });

  it.each(['', 'nodot', `${SUB_ID}.`, '.abc', `${SUB_ID}.${'f'.repeat(64)}`])(
    'agrees with the deleted route verifier in rejecting %p',
    (token) => {
      expect(legacyRouteVerify(token)).toBeNull();
      expect(verifyUnsubscribeToken(token)).toBeNull();
    },
  );

  it('rejects a tampered subscriber id (signature no longer covers it)', () => {
    const [, signature] = legacyMint(SUB_ID).split('.');
    const tampered = `22222222-2222-4222-8222-222222222222.${signature}`;
    expect(legacyRouteVerify(tampered)).toBeNull();
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = createUnsubscribeToken(SUB_ID);
    const flipped = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    expect(verifyUnsubscribeToken(flipped)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    expect(verifyUnsubscribeToken(legacyMint(SUB_ID, 'a-completely-different-secret'))).toBeNull();
  });

  it('rejects a token minted under one secret after the secret is rotated', () => {
    const minted = createUnsubscribeToken(SUB_ID);
    process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = 'rotated-newsletter-unsubscribe-secret-98765';
    expect(verifyUnsubscribeToken(minted)).toBeNull();
  });

  it('fails closed when the secret is absent, for both legacy and new tokens', () => {
    const legacy = legacyMint(SUB_ID);
    const fresh = createUnsubscribeToken(SUB_ID);
    delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
    expect(verifyUnsubscribeToken(legacy)).toBeNull();
    expect(verifyUnsubscribeToken(fresh)).toBeNull();
  });

  it('treats a whitespace-only secret as absent rather than signing with it', () => {
    process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = '   ';
    expect(() => createUnsubscribeToken(SUB_ID)).toThrow(/NEWSLETTER_UNSUBSCRIBE_SECRET/);
    expect(verifyUnsubscribeToken(`${SUB_ID}.${'a'.repeat(64)}`)).toBeNull();
    // Nothing could ever have been minted under it, so nothing is being broken.
    expect(verifyUnsubscribeToken(legacyMint(SUB_ID, '   '))).toBeNull();
  });

  it('still verifies links minted under an untrimmed secret (whitespace padding)', () => {
    // The pre-224e069 cron HMAC'd the raw env value; this module trims it.
    process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = `${SECRET}\n`;
    const mintedRaw = legacyMint(SUB_ID, `${SECRET}\n`);
    const mintedTrimmed = legacyMint(SUB_ID, SECRET);

    expect(verifyUnsubscribeToken(mintedRaw)).toBe(SUB_ID);
    expect(verifyUnsubscribeToken(mintedTrimmed)).toBe(SUB_ID);
    // The tolerance is for that one secret only, not for any secret.
    expect(verifyUnsubscribeToken(legacyMint(SUB_ID, `${SECRET}\n\n`))).toBeNull();
  });
});

describe('cross-kind rejection (newsletter vs campaign unsubscribe)', () => {
  // The campaign format: a bare hex digest over a purpose+version-prefixed
  // message, no `<id>.` framing. It moved into this module on 2026-10-15, so
  // it is now minted through the real exported function rather than
  // reproduced by hand; the literal below pins that the move did not change
  // the bytes.
  const CAMPAIGN_ID = '33333333-3333-4333-8333-333333333333';
  const EMAIL = 'donor@example.com';

  function campaignToken(secret = SECRET): string {
    return createHmac('sha256', secret)
      .update(`campaign-unsubscribe:v1:${CAMPAIGN_ID}:${EMAIL}`)
      .digest('hex');
  }

  it('mints the same bytes the route-local minter would have', () => {
    expect(createCampaignUnsubscribeToken(CAMPAIGN_ID, EMAIL)).toBe(campaignToken());
  });

  it('does not accept a campaign token as a newsletter subscriber-id token', () => {
    expect(verifyUnsubscribeToken(campaignToken())).toBeNull();
  });

  it('does not accept a campaign token even dressed in subscriber-id framing', () => {
    expect(verifyUnsubscribeToken(`${CAMPAIGN_ID}.${campaignToken()}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${SUB_ID}.${campaignToken()}`)).toBeNull();
  });

  it('does not accept a newsletter token as a campaign token', () => {
    const newsletter = createUnsubscribeToken(SUB_ID);
    expect(newsletter).not.toBe(campaignToken());
    expect(newsletter.split('.')[1]).not.toBe(campaignToken());
  });
});

/**
 * Campaign-update unsubscribe tokens (moved here 2026-10-15).
 *
 * The format is pinned byte-for-byte against the private verifier that lived
 * in `src/app/api/v1/campaigns/[slug]/subscribe/route.ts`, because links
 * minted from now on must verify against a route that did not change, and the
 * route's own tests mint by hand with the same literal message.
 */
describe('campaign unsubscribe tokens', () => {
  const CAMPAIGN_ID = '44444444-4444-4444-4444-444444444444';
  const OTHER_CAMPAIGN_ID = '55555555-5555-5555-5555-555555555555';
  const EMAIL = 'donor@example.com';
  const CAMPAIGN_SECRET = 'test-campaign-unsubscribe-secret-0123456789';

  /**
   * Verbatim reimplementation of the verifier deleted from the campaign
   * subscribe route: hex HMAC-SHA256 over
   * `campaign-unsubscribe:v1:<campaignId>:<email>`, trimmed secret, trimmed
   * token, exact digest compare.
   */
  function routeLocalMint(campaignId: string, email: string, withSecret = CAMPAIGN_SECRET): string {
    return createHmac('sha256', withSecret)
      .update(`campaign-unsubscribe:v1:${campaignId}:${email}`)
      .digest('hex');
  }

  beforeEach(() => {
    process.env.CAMPAIGN_UNSUBSCRIBE_SECRET = CAMPAIGN_SECRET;
  });

  describe('format', () => {
    it('is the version string the route signs with', () => {
      expect(CAMPAIGN_TOKEN_VERSION).toBe('campaign-unsubscribe:v1');
    });

    it('mints a bare 64-char hex digest, not `<id>.<sig>` framing', () => {
      const token = createCampaignUnsubscribeToken(CAMPAIGN_ID, EMAIL);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(token).not.toContain('.');
    });

    it('mints exactly what the deleted route-local verifier expected', () => {
      expect(createCampaignUnsubscribeToken(CAMPAIGN_ID, EMAIL)).toBe(
        routeLocalMint(CAMPAIGN_ID, EMAIL),
      );
    });

    it('signs over campaignId, so the slug is not interchangeable with it', () => {
      expect(createCampaignUnsubscribeToken(CAMPAIGN_ID, EMAIL)).not.toBe(
        createCampaignUnsubscribeToken('a-campaign-slug', EMAIL),
      );
    });
  });

  describe('verification', () => {
    it('verifies a minted token for the same (campaignId, email)', () => {
      const token = createCampaignUnsubscribeToken(CAMPAIGN_ID, EMAIL);
      expect(verifyCampaignUnsubscribeToken(token, CAMPAIGN_ID, EMAIL)).toBe(true);
    });

    it('verifies a token minted the way the route-local minter would have', () => {
      expect(
        verifyCampaignUnsubscribeToken(routeLocalMint(CAMPAIGN_ID, EMAIL), CAMPAIGN_ID, EMAIL),
      ).toBe(true);
    });

    it('does NOT verify for a different campaign', () => {
      const token = createCampaignUnsubscribeToken(CAMPAIGN_ID, EMAIL);
      expect(verifyCampaignUnsubscribeToken(token, OTHER_CAMPAIGN_ID, EMAIL)).toBe(false);
    });

    it('does NOT verify for a different email', () => {
      const token = createCampaignUnsubscribeToken(CAMPAIGN_ID, EMAIL);
      expect(verifyCampaignUnsubscribeToken(token, CAMPAIGN_ID, 'victim@example.com')).toBe(false);
    });

    it('rejects a tampered signature', () => {
      const token = createCampaignUnsubscribeToken(CAMPAIGN_ID, EMAIL);
      const flipped = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
      expect(verifyCampaignUnsubscribeToken(flipped, CAMPAIGN_ID, EMAIL)).toBe(false);
    });

    it('rejects a token signed with a foreign secret', () => {
      const forged = routeLocalMint(CAMPAIGN_ID, EMAIL, 'a-completely-different-secret');
      expect(verifyCampaignUnsubscribeToken(forged, CAMPAIGN_ID, EMAIL)).toBe(false);
    });

    it('rejects a token minted before the secret was rotated', () => {
      const token = createCampaignUnsubscribeToken(CAMPAIGN_ID, EMAIL);
      process.env.CAMPAIGN_UNSUBSCRIBE_SECRET = 'rotated-campaign-unsubscribe-secret-98765';
      expect(verifyCampaignUnsubscribeToken(token, CAMPAIGN_ID, EMAIL)).toBe(false);
    });

    it.each([null, undefined, '', 'not-hex', 'a'.repeat(64)])(
      'rejects the junk token %p',
      (token) => {
        expect(
          verifyCampaignUnsubscribeToken(token as string | null, CAMPAIGN_ID, EMAIL),
        ).toBe(false);
      },
    );

    it('tolerates transport whitespace around an otherwise valid token', () => {
      const token = createCampaignUnsubscribeToken(CAMPAIGN_ID, EMAIL);
      expect(verifyCampaignUnsubscribeToken(`  ${token}\n`, CAMPAIGN_ID, EMAIL)).toBe(true);
    });

    it('does not accept a newsletter token as a campaign token', () => {
      const newsletter = createUnsubscribeToken(SUB_ID);
      expect(verifyCampaignUnsubscribeToken(newsletter, CAMPAIGN_ID, EMAIL)).toBe(false);
      expect(verifyCampaignUnsubscribeToken(newsletter.split('.')[1], CAMPAIGN_ID, EMAIL)).toBe(
        false,
      );
    });
  });

  describe('secret resolution', () => {
    it('prefers CAMPAIGN_UNSUBSCRIBE_SECRET over the newsletter secret', () => {
      process.env.CAMPAIGN_UNSUBSCRIBE_SECRET = CAMPAIGN_SECRET;
      process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = SECRET;
      expect(campaignUnsubscribeSecret()).toBe(CAMPAIGN_SECRET);
      expect(createCampaignUnsubscribeToken(CAMPAIGN_ID, EMAIL)).toBe(
        routeLocalMint(CAMPAIGN_ID, EMAIL, CAMPAIGN_SECRET),
      );
    });

    it('falls back to NEWSLETTER_UNSUBSCRIBE_SECRET when the campaign one is unset', () => {
      delete process.env.CAMPAIGN_UNSUBSCRIBE_SECRET;
      process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = SECRET;
      expect(campaignUnsubscribeSecret()).toBe(SECRET);
      expect(
        verifyCampaignUnsubscribeToken(
          routeLocalMint(CAMPAIGN_ID, EMAIL, SECRET),
          CAMPAIGN_ID,
          EMAIL,
        ),
      ).toBe(true);
    });

    it('trims the secret, and treats a whitespace-only value as unset', () => {
      process.env.CAMPAIGN_UNSUBSCRIBE_SECRET = `  ${CAMPAIGN_SECRET}  `;
      expect(campaignUnsubscribeSecret()).toBe(CAMPAIGN_SECRET);

      process.env.CAMPAIGN_UNSUBSCRIBE_SECRET = '   ';
      delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
      expect(campaignUnsubscribeSecret()).toBeNull();
    });

    it('never falls back to NEXTAUTH_SECRET', () => {
      delete process.env.CAMPAIGN_UNSUBSCRIBE_SECRET;
      delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
      process.env.NEXTAUTH_SECRET = 'some-session-secret';
      expect(campaignUnsubscribeSecret()).toBeNull();
      expect(tryCreateCampaignUnsubscribeToken(CAMPAIGN_ID, EMAIL)).toBeNull();
    });
  });

  describe('missing secret', () => {
    beforeEach(() => {
      delete process.env.CAMPAIGN_UNSUBSCRIBE_SECRET;
      delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
    });

    it('throws on mint rather than signing with a blank key', () => {
      expect(() => createCampaignUnsubscribeToken(CAMPAIGN_ID, EMAIL)).toThrow(
        /CAMPAIGN_UNSUBSCRIBE_SECRET/,
      );
    });

    it('returns null from the non-throwing mint', () => {
      expect(tryCreateCampaignUnsubscribeToken(CAMPAIGN_ID, EMAIL)).toBeNull();
    });

    it('fails closed on verify instead of accepting anything', () => {
      expect(
        verifyCampaignUnsubscribeToken(routeLocalMint(CAMPAIGN_ID, EMAIL), CAMPAIGN_ID, EMAIL),
      ).toBe(false);
      expect(verifyCampaignUnsubscribeToken('f'.repeat(64), CAMPAIGN_ID, EMAIL)).toBe(false);
    });

    it('emits no link at all rather than a tokenless one that would 403', () => {
      expect(
        campaignUnsubscribeUrl({ campaignId: CAMPAIGN_ID, campaignSlug: 'a-campaign', email: EMAIL }),
      ).toBeNull();
    });
  });

  describe('link construction', () => {
    it('builds a /unsubscribe link whose token verifies against the route inputs', () => {
      const url = campaignUnsubscribeUrl({
        campaignId: CAMPAIGN_ID,
        campaignSlug: 'a-campaign',
        email: EMAIL,
        baseUrl: 'https://lastdonor.org',
      })!;

      expect(url.startsWith('https://lastdonor.org/unsubscribe?')).toBe(true);

      const query = new URL(url).searchParams;
      expect(query.get('email')).toBe(EMAIL);
      expect(query.get('campaign')).toBe('a-campaign');
      expect(verifyCampaignUnsubscribeToken(query.get('token'), CAMPAIGN_ID, EMAIL)).toBe(true);
    });

    it('normalises the address exactly as the route does before verifying', () => {
      // The route verifies against `email.trim().toLowerCase()`, so a mint over
      // the raw address would produce a signature the route cannot reproduce.
      const url = campaignUnsubscribeUrl({
        campaignId: CAMPAIGN_ID,
        campaignSlug: 'a-campaign',
        email: '  DONOR@Example.COM ',
      })!;

      const query = new URL(url).searchParams;
      expect(query.get('email')).toBe(EMAIL);
      expect(normalizeUnsubscribeEmail('  DONOR@Example.COM ')).toBe(EMAIL);
      expect(verifyCampaignUnsubscribeToken(query.get('token'), CAMPAIGN_ID, EMAIL)).toBe(true);
    });

    it('percent-encodes the query so an address with a + survives', () => {
      const url = campaignUnsubscribeUrl({
        campaignId: CAMPAIGN_ID,
        campaignSlug: 'a-campaign',
        email: 'donor+tag@example.com',
      })!;

      expect(url).toContain('donor%2Btag%40example.com');
      const query = new URL(url).searchParams;
      expect(query.get('email')).toBe('donor+tag@example.com');
      expect(
        verifyCampaignUnsubscribeToken(query.get('token'), CAMPAIGN_ID, 'donor+tag@example.com'),
      ).toBe(true);
    });

    it('strips a trailing slash from the base url', () => {
      const url = campaignUnsubscribeUrl({
        campaignId: CAMPAIGN_ID,
        campaignSlug: 'a-campaign',
        email: EMAIL,
        baseUrl: 'https://example.org/',
      })!;
      expect(url.startsWith('https://example.org/unsubscribe?')).toBe(true);
    });
  });

  describe('campaignUnsubscribeMechanism', () => {
    const args = { campaignId: CAMPAIGN_ID, campaignSlug: 'a-campaign', email: EMAIL };

    it('returns the signed page link when a secret is configured', () => {
      const m = campaignUnsubscribeMechanism(args);
      expect(m.url).toContain('/unsubscribe?');
      expect(m.url).toContain('token=');
      expect(m.headers['List-Unsubscribe']).toBe(`<${m.url}>`);
    });

    it('never advertises RFC 8058 one-click: /unsubscribe is a page, not a POST endpoint', () => {
      expect(campaignUnsubscribeMechanism(args).oneClick).toBe(false);
      expect(campaignUnsubscribeMechanism(args).headers).not.toHaveProperty(
        'List-Unsubscribe-Post',
      );
    });

    it('falls back to the support mailbox, naming the campaign, when no secret is set', () => {
      delete process.env.CAMPAIGN_UNSUBSCRIBE_SECRET;
      delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;

      const m = campaignUnsubscribeMechanism(args);
      expect(m.url.startsWith(`mailto:${SUPPORT_MAILBOX}?subject=`)).toBe(true);
      expect(decodeURIComponent(m.url.split('subject=')[1])).toContain('a-campaign');
      expect(m.oneClick).toBe(false);
      expect(m.url).not.toContain('/unsubscribe?');
    });

    it('never throws, with or without a secret', () => {
      expect(() => campaignUnsubscribeMechanism(args)).not.toThrow();
      delete process.env.CAMPAIGN_UNSUBSCRIBE_SECRET;
      delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
      expect(() => campaignUnsubscribeMechanism(args)).not.toThrow();
    });
  });
});

describe('mailtoUnsubscribeMechanism subject', () => {
  it('defaults to `Unsubscribe`, unchanged for the newsletter callers', () => {
    expect(mailtoUnsubscribeMechanism().url).toBe(`mailto:${SUPPORT_MAILBOX}?subject=Unsubscribe`);
  });

  it('percent-encodes a custom subject', () => {
    const m = mailtoUnsubscribeMechanism(SUPPORT_MAILBOX, 'Unsubscribe: a-campaign');
    expect(m.url).toBe(`mailto:${SUPPORT_MAILBOX}?subject=Unsubscribe%3A%20a-campaign`);
    expect(m.headers['List-Unsubscribe']).toBe(`<${m.url}>`);
  });
});
