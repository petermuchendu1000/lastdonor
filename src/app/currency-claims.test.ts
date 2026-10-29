/**
 * A user-facing page may not state the platform's money in ONE named
 * currency.
 *
 * Since `docs/118` §10 an organiser chooses the campaign's currency, and
 * `docs/147` put the platform's own general fund on KES. So a sentence like
 * *"Donations are charged in U.S. dollars"* is not a stale preference, it is
 * a statement that is **false for every other currency** — and the only money
 * this platform has ever taken is KES (three donations, `docs/147` §11).
 *
 * Three instances of one mistake make a sweep rather than three assertions
 * (`docs/110` §9.2):
 *
 *   - `app/campaign-rules/page.tsx`  "A clear fundraising goal in U.S. dollars."
 *   - `app/refund-policy/page.tsx`   "Donations are charged in U.S. dollars."
 *   - `app/refund-policy/page.tsx`   "minimum donation is $5.00 … maximum …
 *                                     $100,000.00", correct for USD and wrong
 *                                     for KES, whose real bounds are 5,000 and
 *                                     25,000,000 minor units
 *   - `app/donate/page.tsx`          *"processed in U.S. dollars by Stripe"*,
 *                                     already removed by `docs/147`
 *
 * ⚠️ Comments are stripped first, and that is load-bearing here: the comment
 * in `layout.tsx` explaining why `areaServed` was removed necessarily QUOTES
 * the removed value, and the header of this very file quotes all four
 * forbidden sentences. A raw-source sweep reports the fix as the defect
 * (`docs/116` §4).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPORTED_CURRENCY_CODES } from '@/lib/money/currencies';

const SRC = join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.next']);

/**
 * Surfaces a donor or organiser reads.
 *
 * `app/api/` and the admin trees are excluded on purpose: an API comment or an
 * admin screen naming US dollars is describing a rule, not promising a donor
 * anything, and `docs/110` §4 already refused to merge admin vocabulary with
 * the public one.
 */
const EXCLUDED = [/^app\/api\//, /^app\/admin\//, /^components\/admin\//];

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/^(\s*)\/\/.*$/gm, (m, indent: string) => indent + ' '.repeat(m.length - indent.length));
}

const ALL = sourceFiles(SRC);
const SWEPT = ALL.map((f) => [f.slice(SRC.length + 1), stripComments(readFileSync(f, 'utf8'))] as const).filter(
  ([rel]) => !EXCLUDED.some((re) => re.test(rel)),
);

const REFUND = join(SRC, 'app/refund-policy/page.tsx');
const LAYOUT = join(SRC, 'app/layout.tsx');

/**
 * The one file allowed to carry USD literals in a donor-visible message, and
 * the reason it is allowed.
 *
 * `createIntentSchema` bounds its `amount` at 500..10_000_000 with the
 * messages *"Minimum donation is $5.00"* / *"Maximum donation is $100,000"*.
 * Its own comment (`donation.ts:50-58`) states that this is deliberate: the
 * schema serves only the Stripe routes, Stripe is the USD rail, and those
 * routes refuse a campaign whose currency Stripe does not collect. Per-rail
 * amounts are checked by `checkDonationAmount` against
 * `CURRENCIES[code].minDonationMinor`.
 *
 * ⚠️ [VERIFIED] the schema is parsed at `create-checkout/route.ts:31` and the
 * currency is not checked until `:124`, so the parse really does run FIRST -
 * an API request for a KES campaign below 500 minor units is refused naming
 * dollars. No wrong amount is ever accepted (the currency guard still fires
 * before any charge) and no UI reaches it, since `docs/147` routes a KES
 * campaign to the M-Pesa form. So this is a message on an unreachable path,
 * not a money defect, and the fix would be larger than the problem.
 *
 * ⛔ THE EXEMPTION CARRIES A TRIPWIRE ON ITS OWN PREMISE. It holds only while
 * every non-test importer of the schema is a Stripe route. The moment a
 * third module imports it, this is no longer "the USD rail's validator" and
 * the next test fails so somebody re-reads the decision rather than
 * inheriting an exemption whose reason has expired.
 */
const USD_LITERAL_EXEMPT = 'lib/validators/donation.ts';

const STRIPE_ROUTE_IMPORTERS = [
  'app/api/v1/donations/create-intent/route.ts',
  'app/api/v1/donations/create-checkout/route.ts',
];

/**
 * Each pattern is a way of pinning the platform's money to one currency.
 *
 * They match the CLAIM, not today's wording of it: rule 3 looks for a money
 * literal next to the words minimum/maximum donation, so restoring the
 * sentence with different numbers still fails.
 */
const SINGLE_CURRENCY_CLAIMS: ReadonlyArray<readonly [string, RegExp]> = [
  ['charged / processed in U.S. dollars', /(charged|processed|collected|priced)\s+in\s+U\.?\s?S\.?\s?(dollars|\$)/i],
  ['a goal stated in U.S. dollars', /goal\s+(in|is\s+in)\s+U\.?\s?S\.?\s?dollars/i],
  ['a hardcoded donation limit', /(minimum|maximum)\s+donation\s+(is|of)\s+\p{Sc}\s?[\d,]/iu],
];

describe('no user-facing surface pins the platform to one currency', () => {
  it('collects enough files to be a real sweep', () => {
    // Anti-vacuity: an EXCLUDED list that swallowed everything would pass
    // every rule below without reading a single donor-facing page.
    expect(ALL.length).toBeGreaterThan(100);
    expect(SWEPT.length).toBeGreaterThan(50);
    expect(SWEPT.map(([rel]) => rel)).toContain('app/refund-policy/page.tsx');
    expect(SWEPT.map(([rel]) => rel)).toContain('app/campaign-rules/page.tsx');
    expect(SWEPT.map(([rel]) => rel)).toContain('app/donate/page.tsx');
  });

  it.each(SINGLE_CURRENCY_CLAIMS)('%s is absent from donor-facing source', (_label, pattern) => {
    const offenders = SWEPT.filter(([, src]) => pattern.test(src))
      .map(([rel]) => rel)
      .filter((rel) => rel !== USD_LITERAL_EXEMPT);
    expect(offenders).toEqual([]);
  });

  it('the one USD-literal exemption still has the premise it was granted on', () => {
    // The tripwire. `createIntentSchema` may keep its dollar messages only
    // while it is the Stripe rail's validator and nothing else. A third
    // importer means the exemption's reason has expired.
    /*
      ⚠️ This must ask whether a module IMPORTS the symbol, not whether its
      text mentions it. The first version matched the bare name and reported
      `lib/money/currencies.ts` and `lib/validators/payhero.ts` as importers -
      both of which only NAME it in a comment explaining their relationship to
      it. Same hole as `docs/146` §6.1, where a `toContain` was satisfied by
      an import line, and `docs/116` §4, where a comment quoting the defect
      was read as the defect.
    */
    const IMPORTS_SCHEMA = /import\s*(?:type\s*)?\{[^}]*\bcreateIntentSchema\b[^}]*\}\s*from/;
    const importers = ALL.map(
      (f) => [f.slice(SRC.length + 1), stripComments(readFileSync(f, 'utf8'))] as const,
    )
      .filter(([rel, src]) => rel !== USD_LITERAL_EXEMPT && IMPORTS_SCHEMA.test(src))
      .map(([rel]) => rel);
    expect(importers.sort()).toEqual([...STRIPE_ROUTE_IMPORTERS].sort());
  });

  it('states the donation limits for EVERY collectable currency', () => {
    // The positive half. Deleting the limits section would satisfy the rule
    // above, so the page must still tell a donor what the limits are - and
    // for each currency money can actually be taken in (`docs/103`: KNOWN is
    // not COLLECTABLE).
    const src = readFileSync(REFUND, 'utf8');
    expect(src).toMatch(/minDonationMinor/);
    expect(src).toMatch(/maxDonationMinor/);
    for (const code of SUPPORTED_CURRENCY_CODES) {
      expect(src, `refund-policy must cover ${code}`).toMatch(
        new RegExp(`SUPPORTED_CURRENCY_CODES|${code}`),
      );
    }
  });
});

describe('the Organization graph claims no service area it cannot settle in', () => {
  /*
    `areaServed` was `{ '@type': 'Country', name: 'United States' }` while the
    card rail answered 503 for every USD campaign, so it asserted service in
    the one country where nobody could give.

    The rule is DERIVED, not a ban: while more than one currency is
    collectable, a single-country `areaServed` cannot be right, and listing
    every region a gateway does not reach would be worse. `docs/76` settled
    the same question for `sameAs` - absent is the honest encoding.
  */
  const layout = stripComments(readFileSync(LAYOUT, 'utf8'));

  it('declares no areaServed while more than one currency is collectable', () => {
    expect(SUPPORTED_CURRENCY_CODES.length).toBeGreaterThan(1);
    expect(layout).not.toMatch(/areaServed/);
  });

  it('still publishes the Organization entity it is meant to describe', () => {
    /*
      Anti-vacuity: deleting the whole JSON-LD block would satisfy the rule
      above, so the entity graph must survive the removal of one claim.

      ⚠️ SCOPED to the Organization object, and that is not tidiness. The
      first version asserted `/description:/` over the WHOLE FILE, where the
      `metadata` export and its `openGraph` block each carry a `description:`
      of their own - so renaming the Organization's key satisfied it anyway.
      Injection row 8 DID NOT FIRE against that version: a control that
      cannot fail is not a control (Gate 4).
    */
    const start = layout.indexOf("'Organization'");
    const end = layout.indexOf('knowsAbout');
    expect(start, "Organization entity not found").toBeGreaterThan(-1);
    expect(end, 'knowsAbout not found').toBeGreaterThan(start);

    const organisation = layout.slice(start, end);
    expect(organisation).toMatch(/\bdescription:/);
    expect(organisation).toMatch(/\burl:/);
    expect(layout).toMatch(/knowsAbout/);
  });

  it('does not describe the site as belonging to one country', () => {
    expect(layout).not.toMatch(/\ba US fundraising site\b/i);
    expect(layout).not.toMatch(/fundraising site (in|for) the United States/i);
  });
});
