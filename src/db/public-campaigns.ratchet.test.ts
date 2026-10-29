import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { PgDialect } from 'drizzle-orm/pg-core';
import { join } from 'node:path';
import {
  LISTED_CAMPAIGN_STATUSES,
  PLATFORM_FUND_CAMPAIGN_IDS,
  isPlatformFund,
  listedCampaignFilter,
} from './public-campaigns';
import { GENERAL_FUND_CAMPAIGN_ID } from '@/lib/constants';

/**
 * Listing and eligibility are different questions (`docs/147`).
 *
 * `or(eq(status,'active'), eq(status,'last_donor_zone'))` answers *"may this
 * campaign take money"*. Eight public surfaces were using it to answer
 * *"should this campaign appear in a list of appeals"*, and the two came apart
 * when the platform's own general fund had to hold a listed status in order to
 * collect at all.
 *
 * So this rule does not ban the raw pair. It requires every file that uses it
 * to have DECIDED which question it is asking.
 */

const SRC = join(__dirname, '..');

/**
 * Files that legitimately use the raw status pair, each with the reason.
 *
 * Every one asks about ONE campaign the caller already named - "may this
 * specific campaign take this donation / be viewed" - and the platform fund
 * must answer YES to all of them. Putting `listedCampaignFilter()` here would
 * make the general fund unable to take the donation `/donate` collects.
 */
const ELIGIBILITY: Record<string, string> = {
  'app/api/v1/donations/create-checkout/route.ts':
    'money in, by card: one named campaign, and the fund must qualify',
  'app/api/v1/donations/create-intent/route.ts':
    'money in: one named campaign',
  'app/api/v1/donations/payhero/initiate/route.ts':
    'money in, by M-Pesa: this is the route that collects for the fund',
  'app/campaigns/[slug]/page.tsx':
    'one campaign, looked up by slug, for its own page',
  'app/campaigns/[slug]/donate/page.tsx':
    'one campaign, looked up by slug, for its own donate page',
  'app/api/v1/campaigns/[slug]/route.ts':
    'one campaign, by slug',
  'app/api/v1/campaigns/[slug]/messages/route.ts':
    'one campaign, by slug',
  'app/api/v1/og/campaign/[slug]/route.tsx':
    'one campaign, by slug, for its share card',
  'app/donate/page.tsx':
    "the fund's OWN existence check, by id - the predicate is deliberately identical to the money route's",
};

/** Directories whose audience is staff, not the public. */
const NOT_PUBLIC = ['app/admin', 'app/dashboard', 'app/api/v1/admin'];

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** A single-status filter that would also list campaigns. */
const RAW_ACTIVE_ONLY = /eq\(\s*campaigns\.status\s*,\s*'active'\s*\)/;

function filesUsingRawStatus(): { rel: string; code: string }[] {
  const out: { rel: string; code: string }[] = [];
  for (const f of sourceFiles(SRC)) {
    const rel = f.slice(SRC.length + 1).split('\\').join('/');
    if (NOT_PUBLIC.some((p) => rel.startsWith(p))) continue;
    const code = strip(readFileSync(f, 'utf8'));
    if (RAW_ACTIVE_ONLY.test(code)) out.push({ rel, code });
  }
  return out;
}

describe('rule 1: every public campaign-status filter has decided which question it asks', () => {
  it('only an eligibility site, or this module, may name the raw active status', () => {
    /*
      ⚠️ THE FIRST TWO VERSIONS OF THIS RULE WERE TOO WEAK, each proven by an
      injection that did not fire:

        v1 asked whether the file `includes('listedCampaignFilter')` - and the
           leftover IMPORT satisfied it (`docs/146` §6.1's hole again).
        v2 asked whether the file CALLS it - and
           `campaigns/(index)/page.tsx` calls it TWICE (the rows query and the
           tab count), so regressing one of the two stayed green.

      A file-level "does it also use the helper" question cannot see a single
      regressed occurrence. So the rule is now absolute: a PUBLIC surface may
      not name the raw active status at all. Nine eligibility sites are named
      above with reasons, and this module is where the pair legitimately lives
      exactly once.
    */
    const offenders = filesUsingRawStatus()
      .filter(({ rel }) => !ELIGIBILITY[rel] && rel !== 'db/public-campaigns.ts')
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });

  it('the sweep reads a meaningful number of files', () => {
    // Anti-vacuity: a broken walker reports no offenders forever.
    expect(sourceFiles(SRC).length).toBeGreaterThan(300);
  });

  it('and actually finds the files that use the raw status', () => {
    // Anti-vacuity on the PATTERN, not just the walker.
    const found = filesUsingRawStatus().map((f) => f.rel);
    expect(found.length).toBeGreaterThan(5);
    expect(found).toContain('app/api/v1/donations/payhero/initiate/route.ts');
  });
});

describe('rule 2: the eligibility allowlist describes reality', () => {
  it.each(Object.keys(ELIGIBILITY))('%s exists and really filters on status', (rel) => {
    /*
      A stale allowlist entry is worse than none: it reads as a decision
      somebody made about a file that may no longer filter this way at all.
    */
    const code = strip(readFileSync(join(SRC, rel), 'utf8'));
    expect(RAW_ACTIVE_ONLY.test(code), rel).toBe(true);
  });

  it('every entry carries a written reason', () => {
    for (const [rel, reason] of Object.entries(ELIGIBILITY)) {
      expect(reason.length, rel).toBeGreaterThan(20);
    }
  });

  it('the money-in routes are all present, derived from disk', () => {
    /*
      ⛔ The three routes that take money must be eligibility sites, and this
      row derives them rather than trusting the list above. If a fourth
      money-in route appears, it fails here until somebody decides.
    */
    const moneyIn = sourceFiles(join(SRC, 'app/api/v1/donations'))
      .map((f) => f.slice(SRC.length + 1).split('\\').join('/'))
      .filter((rel) => RAW_ACTIVE_ONLY.test(strip(readFileSync(join(SRC, rel), 'utf8'))));

    expect(moneyIn.length).toBeGreaterThanOrEqual(3);
    for (const rel of moneyIn) {
      expect(ELIGIBILITY[rel], `${rel} takes money and is not named as eligibility`).toBeTruthy();
    }
  });
});

describe('rule 3: the filter excludes the platform fund and nothing else', () => {
  it('renders both halves: the listed statuses AND the fund exclusion', () => {
    /*
      Reading the rendered SQL rather than trusting the builder - the
      `docs/130` habit. The fund id must appear as a bound parameter, and both
      statuses must be in the predicate.
    */
    const { sql: text, params } = new PgDialect().sqlToQuery(listedCampaignFilter());
    expect(text.toLowerCase()).toContain('not in');
    expect(params).toContain(GENERAL_FUND_CAMPAIGN_ID);
    for (const status of LISTED_CAMPAIGN_STATUSES) {
      expect(params).toContain(status);
    }
  });

  it('isPlatformFund answers for the fund and refuses a real campaign id', () => {
    expect(isPlatformFund(GENERAL_FUND_CAMPAIGN_ID)).toBe(true);
    // A real production campaign id (keisha-wallace), as a control.
    expect(isPlatformFund('11a22000-a78e-4a96-98a5-0a58e9c8bfc4')).toBe(false);
  });

  it('the fund list is not empty, and holds only the fund', () => {
    expect(PLATFORM_FUND_CAMPAIGN_IDS).toEqual([GENERAL_FUND_CAMPAIGN_ID]);
  });
});

describe('rule 4: the sitemap never advertises a platform fund campaign URL', () => {
  it('filters campaign rows by the fund list', () => {
    /*
      The sitemap does NOT use `listedCampaignFilter` - it has its own wider
      status set, including closed campaigns - so rule 1 cannot cover it. It
      must still exclude the fund, because it filters on status alone and
      `/campaigns/[slug]` additionally requires `published_at` (`docs/131`):
      without this it would submit a URL to Google that answers 404.
    */
    const code = strip(readFileSync(join(SRC, 'app/sitemap.ts'), 'utf8'));
    expect(code).toContain('PLATFORM_FUND_CAMPAIGN_IDS');
    expect(code).toMatch(/notInArray\(\s*campaigns\.id/);
  });
});
