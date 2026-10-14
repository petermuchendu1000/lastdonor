/**
 * Fee-claim substantiation guard (audit docs/29 P2-3).
 *
 * Ten user-facing surfaces claimed that processing fees are shown, displayed or
 * disclosed before checkout. They are not: the checkout session is created with
 * a single line item at the donation amount and no fee line of any kind, so the
 * donor never sees a fee before paying. Per CLAUDE.md an unsubstantiated claim
 * is a factual problem, not microcopy, so the claim was removed everywhere —
 * including the `DonateAction` JSON-LD, which search engines re-publish.
 *
 * This test fails if the claim comes back in copy OR in structured data. It
 * also watches the checkout route: if a fee line item ever appears there, the
 * claim becomes substantiable and this guard should be revisited deliberately
 * rather than quietly deleted.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');
const CHECKOUT = join(SRC, 'app/api/v1/donations/create-checkout/route.ts');

const SKIP_DIRS = new Set(['node_modules', '.next']);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Each pattern is a way of asserting pre-checkout fee visibility. They are
 * deliberately broad: the original claim appeared in six different wordings
 * ("are shown", "is shown", "are displayed", "disclosed", "visible before",
 * "shows the fee breakdown").
 */
const CLAIM_PATTERNS: Array<[string, RegExp]> = [
  ['fees shown/displayed/disclosed before checkout', /\b(fee|fees|processing)\b[^.<>]{0,80}\b(shown|displayed|disclosed|visible|see|shows)\b[^.<>]{0,40}before\s+(checkout|you\s+check|donating|you\s+donate)/i],
  ['generic "before checkout" disclosure', /\bbefore\s+checkout\b/i],
  ['fee breakdown promise', /fee\s+breakdown/i],
  ['itemised-fee promise', /\b(exact|total)\s+fee\s+is\s+(shown|displayed)/i],
];

const FILES = sourceFiles(SRC);

describe('no surface claims fees are shown before checkout', () => {
  it('finds source files to scan at all', () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  it.each(CLAIM_PATTERNS)('%s is absent from src/', (_label, pattern) => {
    const offenders = FILES.filter((f) => pattern.test(readFileSync(f, 'utf8'))).map((f) =>
      f.slice(SRC.length + 1),
    );
    expect(offenders).toEqual([]);
  });

  it('is absent from the DonateAction structured data', () => {
    const page = readFileSync(join(SRC, 'app/campaigns/[slug]/page.tsx'), 'utf8');
    const start = page.indexOf("'@type': 'DonateAction'");
    expect(start, 'DonateAction JSON-LD still emitted from this file').toBeGreaterThan(-1);
    const block = page.slice(start, start + 2000);
    expect(block).not.toMatch(/before\s+checkout/i);
    // What remains must still be true: the platform really does take 0%.
    expect(block).toMatch(/0% platform fees/);
  });
});

describe('what checkout actually does', () => {
  const route = readFileSync(CHECKOUT, 'utf8');

  it('creates checkout line items with no fee line', () => {
    const lineItems = route.match(/line_items:\s*\[[\s\S]*?\]/g) ?? [];
    expect(lineItems.length).toBeGreaterThan(0);
    for (const block of lineItems) {
      expect(block).not.toMatch(/fee/i);
    }
  });

  it('charges the donation amount and nothing added on top', () => {
    expect(route).toMatch(/unit_amount:\s*data\.amount/);
    expect(route).not.toMatch(/application_fee|processing_fee|feeAmount/i);
  });
});
