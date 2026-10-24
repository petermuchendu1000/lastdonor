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
  'src/app/api/v1/cron/refresh-fx-rates/route.ts': 'the refresh job',
  'src/app/campaigns/[slug]/page.tsx': 'reads the snapshot to pass to ApproxMoney',
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

  it('no file that writes money can see an exchange rate', () => {
    const offenders = files
      .filter((f) => importsFx(f.src))
      .filter((f) => MONEY_WRITE_SIGNALS.some((sig) => f.src.includes(sig)))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
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
