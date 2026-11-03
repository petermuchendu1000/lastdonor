/**
 * The duplicate hostnames are `noindex`, and the apex is NOT.
 *
 * ## Why this rule exists at all
 *
 * `origin.lastdonor.org` and `lastdonor.fly.dev` each serve the entire site.
 * [VERIFIED live 2026-11-03] all four hostnames answered 200 with
 * `index, follow` and no `X-Robots-Tag`, and Google Search Console reported
 * **6 URLs** under "Alternative page with proper canonical tag" - crawl
 * budget spent re-deciding that duplicates are duplicates, on a domain where
 * zero of the 60 URLs Google knows are indexed.
 *
 * ⛔ **The blast radius of getting the host pattern wrong is the apex going
 * `noindex`**, which would de-index the entire site - the exact opposite of
 * what this change is for, and invisible until traffic vanished. That is why
 * the apex is asserted as a must-NOT-match control rather than merely left
 * out: a rule that only checks "the two duplicates match" is satisfied by a
 * pattern that matches EVERYTHING.
 *
 * ## Why it reconstructs Next's matcher instead of trusting the docs
 *
 * The published documentation calls `has.value` "a regex like string" and
 * does not say whether it is anchored - which is the whole question, because
 * an unanchored pattern matches substrings. So the matcher below is taken
 * from Next's own implementation, read at
 * `next/dist/shared/lib/router/utils/prepare-destination.js:104`:
 *
 *     const matcher = new RegExp("^" + hasItem.value + "$");
 *
 * and the host it is applied to is lowercased with the port stripped (`:88`).
 * [VERIFIED] it is anchored. If a future Next changes that, this test keeps
 * asserting the behaviour this config was written against, and the live
 * check in the deploy notes is what would catch a divergence.
 *
 * The rule values are read from the REAL config - never re-typed here, which
 * would only prove this file equals itself.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

/** Next's own host normalisation, from `prepare-destination.js`. */
function normaliseHost(host: string): string {
  return host.split(':', 1)[0].toLowerCase();
}

/** Next's own `has` matcher, from `prepare-destination.js:104`. */
function hasValueMatches(value: string, host: string): boolean {
  return new RegExp('^' + value + '$').test(normaliseHost(host));
}

type HeaderRule = {
  source: string;
  has?: { type: string; key?: string; value?: string }[];
  headers: { key: string; value: string }[];
};

async function headerRules(): Promise<HeaderRule[]> {
  const fn = nextConfig.headers;
  expect(typeof fn, 'next.config.ts no longer defines headers()').toBe('function');
  return (await fn!()) as unknown as HeaderRule[];
}

/** Every X-Robots-Tag value a given hostname would receive for a page path. */
async function robotsTagsFor(host: string): Promise<string[]> {
  const rules = await headerRules();
  const out: string[] = [];
  for (const rule of rules) {
    const tag = rule.headers.find((h) => h.key === 'X-Robots-Tag');
    if (!tag) continue;
    const hostConditions = (rule.has ?? []).filter((h) => h.type === 'host');
    // `has` entries are ANDed. A rule with no host condition applies to all.
    const applies = hostConditions.every((h) => h.value && hasValueMatches(h.value, host));
    if (applies) out.push(tag.value);
  }
  return out;
}

describe('rule 1: the duplicate hostnames are noindex', () => {
  it('origin.lastdonor.org receives noindex', async () => {
    const tags = await robotsTagsFor('origin.lastdonor.org');
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.join(' ')).toContain('noindex');
  });

  it('lastdonor.fly.dev receives noindex', async () => {
    const tags = await robotsTagsFor('lastdonor.fly.dev');
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.join(' ')).toContain('noindex');
  });

  it('the port is stripped before matching, as Next does', async () => {
    // Fly's internal routing can present a host with a port. If the pattern
    // were applied to the raw header these would miss and the duplicate host
    // would quietly stay indexable.
    expect(await robotsTagsFor('lastdonor.fly.dev:443')).not.toEqual([]);
    expect(await robotsTagsFor('ORIGIN.LASTDONOR.ORG')).not.toEqual([]);
  });
});

describe('rule 2: the apex and www are NOT noindex', () => {
  /*
    ⛔ The control that makes rule 1 mean anything. A pattern matching the
    apex would satisfy every assertion above while de-indexing the site.
  */
  it('lastdonor.org receives no X-Robots-Tag at all', async () => {
    expect(await robotsTagsFor('lastdonor.org')).toEqual([]);
  });

  it('www.lastdonor.org receives no X-Robots-Tag at all', async () => {
    // Deliberately still indexable - it is a conventional alias whose
    // canonical already points at the apex. A different decision.
    expect(await robotsTagsFor('www.lastdonor.org')).toEqual([]);
  });

  it('near-miss hostnames do not match, because the pattern is anchored', async () => {
    // An unanchored `lastdonor\.fly\.dev` would match these. Next anchors
    // with ^...$, and these rows are what prove it still does.
    expect(await robotsTagsFor('notlastdonor.fly.dev.evil.com')).toEqual([]);
    expect(await robotsTagsFor('lastdonor.fly.dev.attacker.test')).toEqual([]);
    expect(await robotsTagsFor('xorigin.lastdonor.org')).toEqual([]);
  });
});

describe('rule 3: the mechanism is a header, never a redirect', () => {
  it('declares no redirect for the duplicate hosts', async () => {
    /*
      ⛔ `docs/66`'s cron Worker calls `lastdonor.fly.dev` to dodge
      Cloudflare's 100s proxy ceiling, and `origin.lastdonor.org` is
      grey-clouded on purpose (`docs/105`) to keep a non-proxied path to the
      origin. Redirecting either to the apex breaks both, and it is the
      obvious "tidier" fix for somebody who has not read those docs.
    */
    const redirects = nextConfig.redirects ? await nextConfig.redirects() : [];
    const hostRedirects = (redirects as { has?: { type: string }[] }[]).filter((r) =>
      (r.has ?? []).some((h) => h.type === 'host'),
    );
    expect(hostRedirects).toEqual([]);
  });

  it('the matcher can actually reject (anti-vacuity)', () => {
    // Without this, a broken `hasValueMatches` returning true for everything
    // would make rule 1 pass and rule 2 fail loudly - but one returning
    // false for everything would make rule 2 pass silently.
    expect(hasValueMatches('lastdonor\\.fly\\.dev', 'lastdonor.fly.dev')).toBe(true);
    expect(hasValueMatches('lastdonor\\.fly\\.dev', 'lastdonor.org')).toBe(false);
  });
});
