/**
 * Social profiles are a public claim of ownership.
 *
 * The Organization JSON-LD used to assert two of them — a LinkedIn company
 * page and an X handle — and both returned 404. `sameAs` is how a search
 * engine decides "this account is this organisation", so a wrong entry is
 * not a dead link, it is a claim about someone else's account.
 *
 * These tests do not check that a profile EXISTS (that needs the network,
 * and a CI job that fails when X rate-limits is a job people switch off).
 * They check the properties that can be checked offline, and that the
 * footer and the entity graph are fed from the same list. See docs/76.
 */
import { describe, it, expect } from 'vitest';
import { SOCIAL_LINKS } from './social-links';

describe('every entry is a usable, public profile URL', () => {
  it.each(SOCIAL_LINKS)('$name has an https URL', (link) => {
    expect(link.href).toMatch(/^https:\/\//);
  });

  it.each(SOCIAL_LINKS)('$name is a real URL object', (link) => {
    expect(() => new URL(link.href)).not.toThrow();
  });

  it.each(SOCIAL_LINKS)('$name has a visible name', (link) => {
    expect(link.name.trim().length).toBeGreaterThan(0);
  });

  it('lists each network once', () => {
    const hosts = SOCIAL_LINKS.map((l) => new URL(l.href).host);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it('lists each URL once', () => {
    const hrefs = SOCIAL_LINKS.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe('the two profiles that did not exist cannot come back by accident', () => {
  /*
    Checked 2026-10-16: both 404, calibrated against GoFundMe's equivalents
    on the same request shape, which return 200. If either of these is ever
    a real LastDonor account, delete the line rather than the assertion -
    and load the URL first.
  */
  const NEVER = [
    'https://www.linkedin.com/company/lastdonor',
    'https://x.com/lastdonororg',
  ];

  it.each(NEVER)('%s is not listed', (href) => {
    expect(SOCIAL_LINKS.map((l) => l.href)).not.toContain(href);
  });
});
