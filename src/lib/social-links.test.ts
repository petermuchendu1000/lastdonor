/**
 * Social profiles are a public claim of ownership.
 *
 * The Organization JSON-LD used to assert two of them — a LinkedIn company
 * page and an X handle — and both returned 404. `sameAs` is how a search
 * engine decides "this account is this organisation", so a wrong entry is
 * not a dead link, it is a claim about someone else's account.
 *
 * Since 2026-10-19 the list also carries placeholders (`href: null`) for
 * platforms we intend to be on. The tests below split into two jobs:
 *
 *   - a real entry must be a usable, unique, https profile URL;
 *   - a placeholder must stay out of everything that asserts ownership.
 *
 * These tests do not check that a profile EXISTS (that needs the network,
 * and a CI job that fails when X rate-limits is a job people switch off).
 * They check the properties that can be checked offline, and that the
 * footer and the entity graph are fed from the same list. See docs/76 and
 * docs/91.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SOCIAL_LINKS, PUBLISHED_SOCIAL_LINKS } from './social-links';

const REAL = SOCIAL_LINKS.filter((l) => l.href !== null);
const PLACEHOLDERS = SOCIAL_LINKS.filter((l) => l.href === null);

describe('every entry has a visible name', () => {
  it.each(SOCIAL_LINKS)('$name has a visible name', (link) => {
    expect(link.name.trim().length).toBeGreaterThan(0);
  });

  it('names each platform once', () => {
    const names = SOCIAL_LINKS.map((l) => l.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('every real entry is a usable, public profile URL', () => {
  it.each(REAL)('$name has an https URL', (link) => {
    expect(link.href).toMatch(/^https:\/\//);
  });

  it.each(REAL)('$name is a real URL object', (link) => {
    expect(() => new URL(link.href!)).not.toThrow();
  });

  it('lists each network once', () => {
    const hosts = REAL.map((l) => new URL(l.href!).host);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it('lists each URL once', () => {
    const hrefs = REAL.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe('a placeholder asserts nothing', () => {
  /*
    This is the property that lets placeholders exist at all. `sameAs` is
    a machine-readable ownership claim; a placeholder is by definition an
    account that does not exist yet. If these two ever meet, the defect
    docs/76 removed is back, with the extra twist that the handle may well
    belong to someone else by then.
  */
  it('PUBLISHED_SOCIAL_LINKS contains no placeholder', () => {
    expect(PUBLISHED_SOCIAL_LINKS.every((l) => typeof l.href === 'string')).toBe(true);
  });

  it('PUBLISHED_SOCIAL_LINKS is exactly the entries with a URL', () => {
    expect(PUBLISHED_SOCIAL_LINKS.map((l) => l.name)).toEqual(REAL.map((l) => l.name));
  });

  it('a placeholder href is null, never an empty string or a guess', () => {
    // `''` or `'#'` would render as a link and could reach `sameAs` as a
    // relative URL. Only `null` is the placeholder encoding.
    for (const link of PLACEHOLDERS) expect(link.href).toBeNull();
  });

  it('the entity graph reads the filtered list, not the raw one', () => {
    // A direct `SOCIAL_LINKS.map(l => l.href)` in layout.tsx would publish
    // nulls as soon as a placeholder exists. Pin the call site, because
    // the type system stops complaining the moment someone adds a `!`.
    const layout = readFileSync(
      join(process.cwd(), 'src/app/layout.tsx'),
      'utf8',
    );
    expect(layout).toContain('PUBLISHED_SOCIAL_LINKS.map((link) => link.href)');
    expect(layout).not.toMatch(/\bSOCIAL_LINKS\.map\(/);
  });

  it('the footer renders a placeholder without an href', () => {
    // Inert text, not an `<a href="#">`: a keyboard user must not tab onto
    // something that does nothing, and a crawler must not see a link.
    const footer = readFileSync(
      join(process.cwd(), 'src/components/layout/Footer.tsx'),
      'utf8',
    );
    expect(footer).toContain('link.href === null');
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
