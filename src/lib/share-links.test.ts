/**
 * `src/lib/share-links.ts` - token shape and the rules that stop a share link
 * attributing the wrong donation.
 *
 * The database-touching functions are covered by their call sites; what is
 * worth pinning here is the validation, because it is the only thing standing
 * between a path segment and a query, and the token shape, because the links
 * are public and permanent.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  generateShareToken,
  isWellFormedShareToken,
  shareUrl,
  SHARE_ATTRIBUTION_COOKIE,
  SHARE_ATTRIBUTION_MAX_AGE_SECONDS,
} from './share-links';

describe('generateShareToken', () => {
  it('is URL-safe, so it survives being pasted anywhere', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateShareToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('carries 16 bytes of entropy', () => {
    // base64url of 16 bytes, unpadded.
    expect(generateShareToken()).toHaveLength(22);
  });

  it('does not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) seen.add(generateShareToken());
    expect(seen.size).toBe(2000);
  });

  it('round-trips through its own validator', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(isWellFormedShareToken(generateShareToken())).toBe(true);
    }
  });
});

describe('isWellFormedShareToken', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['too short', 'abc'],
    ['too long', 'a'.repeat(65)],
    ['a slash', 'abcdefghijklmnop/q'],
    ['a dot-dot traversal', '../../etc/passwd'],
    ['a quote', "abcdefghijklmnop'"],
    ['a space', 'abcdefghij klmnop'],
    ['a percent escape', 'abcdefghijklmnop%2F'],
  ])('rejects %s', (_label, value) => {
    expect(isWellFormedShareToken(value as string | null | undefined)).toBe(false);
  });

  it('accepts a plausible token', () => {
    expect(isWellFormedShareToken('AbCd1234_-efGH5678ij')).toBe(true);
  });
});

describe('shareUrl', () => {
  it('builds a /s/<token> link', () => {
    expect(shareUrl('tok123', 'https://lastdonor.org'))
      .toBe('https://lastdonor.org/s/tok123');
  });

  it('does not double the slash when the origin has a trailing one', () => {
    expect(shareUrl('tok123', 'https://lastdonor.org/'))
      .toBe('https://lastdonor.org/s/tok123');
  });
});

describe('attribution constants', () => {
  it('names the cookie once, so the setter and the reader cannot drift', () => {
    expect(SHARE_ATTRIBUTION_COOKIE).toBe('ld_via');
  });

  it('expires the window after seven days', () => {
    expect(SHARE_ATTRIBUTION_MAX_AGE_SECONDS).toBe(604800);
  });
});
