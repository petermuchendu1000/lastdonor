/**
 * Ratchet: converted figures stay OUT of accounting.
 *
 * This is the test that makes the promise in `fx-convert.ts` enforceable
 * rather than aspirational.
 *
 * CLAUDE.md: "A campaign has exactly one currency, and two currencies are
 * never added together... report per currency - never sum." That rule is
 * backed by a composite foreign key on `(campaign_id, currency)` referencing
 * `campaigns (id, currency)` (docs/92). An exchange rate is the one tool that
 * makes violating it feel reasonable - "just show a combined total" is a
 * five-line change that quietly turns a database guarantee into a rounding
 * error that moves daily.
 *
 * So the FX modules have an ALLOWLIST of importers. Adding one is not
 * forbidden; doing it without noticing is. A new importer fails this test and
 * whoever added it has to put the file in the list on purpose.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(process.cwd(), 'src');

/** Modules whose import means "this file can see an exchange rate". */
const FX_MODULES = [
  '@/lib/money/fx-convert',
  '@/lib/money/fx-providers',
  '@/lib/money/fx-store.server',
  './fx-convert',
  './fx-providers',
  './fx-store.server',
  /*
    Added 2026-11-02 (docs/168). `fx-quote.server` converts a credit into a
    charge, so importing it IS seeing a rate.

    ⛔ It is listed here deliberately. The cheap move would have been to leave
    it out, which would let any file reach a rate through it without tripping
    rule 1 - that is evading the mechanism, not satisfying it. The boundary
    has to be able to see the new door.
  */
  '@/lib/money/fx-quote.server',
  './fx-quote.server',
] as const;

/**
 * Every file allowed to import an FX module, with why.
 *
 * Deliberately short. If this list grows past a handful, the boundary has
 * stopped being a boundary.
 */
const ALLOWED_IMPORTERS: Record<string, string> = {
  'src/lib/money/fx-convert.ts': 'the conversion itself',
  'src/lib/money/fx-providers.ts': 'the providers themselves',
  'src/lib/money/fx-store.server.ts': 'persistence for the snapshot',
  'src/components/money/ApproxMoney.tsx': 'the one display component',
  'src/components/money/LocalAmount.tsx': 'detects the viewer currency and delegates to ApproxMoney',
  'src/app/api/v1/cron/refresh-fx-rates/route.ts': 'the refresh job',

  /*
    Added 2026-11-02 (docs/168). Cross-currency collection.

    `fx-quote.server.ts` is the ONE place a rate becomes a charge. The
    initiate route is the ONE caller, and it is also a money writer - which
    is exactly what rule 2 below used to forbid outright. That rule is now
    stricter rather than relaxed: such a file must PERSIST the quote it used.

    Why this had to change at all: the rail charges KES and nothing else
    (`initiateStkPush` sends no currency field), so a USD campaign could be
    collected for by no rail at all - the card one answers 503 on dead
    credentials and this one used to answer 400. Denomination and rail are
    different questions; Stripe calls them presentment and settlement.
  */
  'src/lib/money/fx-quote.server.ts': 'turns a credit into a charge; the only rate-to-money door',
  'src/app/api/v1/donations/payhero/initiate/route.ts':
    'quotes the charge and persists the rate it used',
  'src/app/campaigns/[slug]/page.tsx': 'reads the snapshot to pass to ApproxMoney',

  /*
    Added 2026-10-29. The converter had been wired to ONE figure - the goal on
    `campaigns/[slug]`- while the cards a visitor actually browses carried no
    local equivalent at all. These entries are the honest cost of showing it
    on the listing surfaces, and this comment is the "on purpose" the header
    of this file asks for.

    ⚠️ Every one of them only PASSES A SNAPSHOT THROUGH to `LocalAmount`.
    None calls `convertMinor`, and none appears in `MONEY_WRITE_SIGNALS` - the
    second rule below is what actually checks that, and it is the rule that
    matters. They are listed here because `importsFx` matches the module path
    as raw text, so even `import type { FxSnapshot }` trips it.
  */
  'src/components/money/FxAttribution.tsx':
    'the page-level provider credit; renders a link and no figure at all',
  'src/components/campaign/CampaignCard.tsx':
    'takes the snapshot as a prop and hands it to LocalAmount for the goal',
  'src/components/campaign/CampaignGrid.tsx':
    'passes the snapshot to cards it appends in the browser after Load more',
  'src/app/(home)/page.tsx': 'reads the snapshot inside its cached data function, for the card grid',
  'src/app/campaigns/(index)/page.tsx': 'reads the snapshot to pass to CampaignGrid',
  'src/app/completed-campaigns/page.tsx': 'reads the snapshot to pass to CampaignGrid',
  'src/app/campaigns/category/[category]/page.tsx':
    'reads the snapshot to pass to its CampaignCards',
};

/**
 * Signals that a file WRITES money. Not exhaustive as a security control -
 * it is a tripwire for the specific mistake of using a rate in an amount.
 */
const MONEY_WRITE_SIGNALS = [
  'raisedAmount: sql',
  'totalReleasedAmount',
  'totalWithdrawnAmount',
  '.insert(donations)',
  '.insert(refundRecords)',
  '.insert(campaignWithdrawals)',
  'createTransfer(',
  'stripe.refunds.create',
  'initiateStkPush(',
] as const;

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((p) => /\.tsx?$/.test(p))
    .filter((p) => !/\.test\.tsx?$|\.ratchet\.test\.tsx?$/.test(p))
    .map((p) => join(SRC, p));
}

function rel(path: string): string {
  return path.replace(process.cwd() + '/', '');
}

function importsFx(src: string): boolean {
  return FX_MODULES.some((m) => src.includes(`'${m}'`));
}

describe('FX is display-only, enforced', () => {
  const files = sourceFiles().map((path) => ({
    path,
    rel: rel(path),
    src: readFileSync(path, 'utf8'),
  }));

  it('finds the source tree at all (guards against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(200);
    // And finds the FX modules themselves, so the importer scan is live.
    expect(files.some((f) => f.rel === 'src/lib/money/fx-convert.ts')).toBe(true);
  });

  it('no file outside the allowlist imports an FX module', () => {
    const unexpected = files
      .filter((f) => importsFx(f.src))
      .map((f) => f.rel)
      .filter((r) => !(r in ALLOWED_IMPORTERS));
    expect(unexpected).toEqual([]);
  });

  /*
    AMENDED 2026-11-02 (docs/168).

    This used to be "no file that writes money can see an exchange rate",
    which was right while FX was display-only and is wrong now that a rate
    legitimately decides a charge.

    The replacement is STRICTER, not looser. The hazard was never that a rate
    reaches a money write; it is that it does so UNRECORDED, leaving a figure
    nobody can reproduce and that settlement might re-derive differently. So:
    see a rate and write money, and you must PERSIST the quote.
  */
  /*
    ⚠️ GATE 4 CAUGHT THIS RULE TWICE, and both were known traps.

    v1 was `src.includes('fxRateMicro')`. Injecting `fxRateMicroX:` DID NOT
    FIRE, because the original is a SUBSTRING of the mutant - `docs/149` §5.1
    exactly (`<LocalAmount` matching `<LocalAmountXX`). And the route's own
    comment NAMES both keys, so deleting the properties outright would also
    have passed - `docs/116` §4, where the comment explaining a fix quotes
    the very string being searched for.

    So: comments are stripped first, and the key must appear as a PROPERTY
    ASSIGNMENT, not anywhere in the text.
  */
  const PERSISTS_QUOTE = [/\bfxRateMicro\s*:/, /\bfxQuotedAt\s*:/] as const;

  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

  const rateAndMoney = () =>
    files
      .filter((f) => importsFx(f.src))
      .filter((f) => MONEY_WRITE_SIGNALS.some((sig) => f.src.includes(sig)));

  it('a file that sees a rate and writes money must PERSIST the quote', () => {
    const offenders = rateAndMoney()
      .filter((f) => {
        const code = stripComments(f.src);
        return !PERSISTS_QUOTE.every((re) => re.test(code));
      })
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  /*
    ⛔ ANTI-VACUITY for the stripper itself: if `stripComments` ever stopped
    removing anything, the rule above would silently go back to matching
    comment text. The route carries a long block comment, so a real strip
    removes a lot.
  */
  it('CONTROL: comments really are stripped before the check', () => {
    const route = files.find(
      (f) => f.rel === 'src/app/api/v1/donations/payhero/initiate/route.ts',
    );
    expect(route, 'the initiate route is still where it was').toBeDefined();
    const removed = route!.src.length - stripComments(route!.src).length;
    expect(removed).toBeGreaterThan(500);
  });

  /*
    ⛔ ANTI-VACUITY. The rule above passes trivially if NO file both sees a
    rate and writes money - which was the state before docs/168 and would be
    the state again if someone quietly reverted the quote. Then the rule
    would go green while protecting nothing.

    So assert the set is non-empty and contains the one file that is supposed
    to be in it.
  */
  it('CONTROL: the initiate route really is in the rate-and-money set', () => {
    const inSet = rateAndMoney().map((f) => f.rel);
    expect(inSet.length).toBeGreaterThan(0);
    expect(inSet).toContain('src/app/api/v1/donations/payhero/initiate/route.ts');
  });

  it('the settlement writer in particular has no FX import', () => {
    const settlement = files.find((f) => f.rel === 'src/lib/services/payment-service.ts');
    expect(settlement).toBeDefined();
    expect(importsFx(settlement!.src)).toBe(false);
  });

  it('the pre-verification cap has no FX import either', () => {
    // A cap is a money decision. Converting into it would make the ceiling
    // move with the market.
    const cap = files.find((f) => f.rel === 'src/lib/campaign-raise-cap.ts');
    expect(cap).toBeDefined();
    expect(importsFx(cap!.src)).toBe(false);
  });
});

describe('the display component keeps its promises', () => {
  const approx = () =>
    readFileSync(join(SRC, 'components/money/ApproxMoney.tsx'), 'utf8');

  it('renders the provider attribution, which the licence requires', () => {
    expect(approx()).toMatch(/FX_ATTRIBUTION/);
    expect(approx()).toMatch(/href=\{FX_ATTRIBUTION\.href\}/);
  });

  it('marks the figure as approximate in words, not just a symbol', () => {
    // A bare "~" is easy to miss and does not survive being read aloud.
    expect(approx()).toMatch(/about /);
  });

  it('dates the rate it used', () => {
    expect(approx()).toMatch(/rateDay/);
  });

  it('renders nothing when there is no snapshot', () => {
    expect(approx()).toMatch(/if \(!snapshot\) return null;/);
  });

  it('renders nothing when conversion refuses', () => {
    expect(approx()).toMatch(/if \(converted === null\) return null;/);
  });
});
