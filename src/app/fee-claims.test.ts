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

/**
 * ⛔ Comments blanked out, length preserved.
 *
 * Added 2026-10-26 with the rules at the foot of this file. Several of the
 * files these sweeps cover now carry a comment explaining why a rate or a
 * processor name was removed - and that explanation necessarily QUOTES the
 * thing being forbidden, so a sweep over raw source reports every fix as a
 * defect. The same hazard, from the other side, is recorded in
 * `src/lib/news/publisher-review-gate.test.ts`.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/^(\s*)\/\/.*$/gm, (m, indent: string) => indent + ' '.repeat(m.length - indent.length));
}

const FILES = sourceFiles(SRC);
const SOURCES = new Map(FILES.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]));

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

/**
 * Files where naming the payment processor is NOT a claim made to a donor.
 *
 * - `src/lib/`, `src/middleware.ts`: the SDK, its types, webhook routing and
 *   secret validation. `import Stripe from 'stripe'` is not copy.
 * - `src/app/admin/`, `src/components/admin/`: an administrator operates the
 *   gateway, and "Stripe: Missing" on the settings screen is the one place
 *   that fact belongs.
 * - `src/app/api/`: server code.
 * - `src/components/dashboard/`, `src/app/dashboard/` and the payout and
 *   verification POLICY pages: they describe the Connect out-rail, which is
 *   implemented, has never moved money (`docs/113`) and is the subject of an
 *   open owner decision (`docs/116` §5.3). Not silently exempt - reported.
 * - `src/app/privacy/`, `src/app/terms/`, `src/app/refund-policy/`: naming a
 *   sub-processor in a privacy policy is a COMPLIANCE DISCLOSURE. Removing it
 *   would reduce disclosure, which is the opposite of the point.
 * - `src/app/donate/page.tsx`: the general fund is the one page that really
 *   does route to the card rail, and the sentence is card-network
 *   disclosure text.
 * - `src/app/editorial-standards/page.tsx`: "Stars & Stripes" is a military
 *   publication and a news source name.
 */
const PROCESSOR_NAME_ALLOWED = [
  /^lib\//,
  /^middleware\.ts$/,
  /^app\/admin\//,
  /^components\/admin\//,
  /^app\/api\//,
  /^components\/dashboard\//,
  /^app\/dashboard\//,
  /^app\/privacy\/page\.tsx$/,
  /^app\/terms\/page\.tsx$/,
  /^app\/refund-policy\/page\.tsx$/,
  /^app\/fund-release-policy\/page\.tsx$/,
  /^app\/campaign-verification-policy\/page\.tsx$/,
  /^app\/campaign-rules\/page\.tsx$/,
  /^app\/donate\/page\.tsx$/,
  /^app\/editorial-standards\/page\.tsx$/,
  /^components\/campaign\/DonationForm\.tsx$/,
];

/**
 * No user-facing surface quotes a payment processor's RATE.
 *
 * ── THE DEFECT (2026-10-26, `docs/116` §5) ──────────────────────────────────
 *
 * Thirteen sites in ten files said "Stripe charges 2.9% plus 30 cents", and
 * several then did the arithmetic: "on a $50 donation that is $1.75, so the
 * campaign receives $48.25". Every part of that was wrong, and each part is
 * independently checkable:
 *
 *   1. Stripe cannot take a payment here at all. `STRIPE_SECRET_KEY` on Fly
 *      is the `sk_test_…0000` placeholder, so `create-checkout` 500s for
 *      every campaign (`docs/72`). Every donation this platform has ever
 *      collected came over M-Pesa (`docs/92`).
 *   2. That rate has never been charged to anybody here. The only fees ever
 *      incurred were PayHero's, and they are a FLAT KES 8.9 against a
 *      published table that says KES 6 (`docs/92`) - which is also why a
 *      vendor's rate card is not evidence of what gets charged.
 *   3. NOTHING DEDUCTS A PROCESSING FEE. `create-checkout` sets
 *      `unit_amount: data.amount` with no `application_fee` (pinned above),
 *      `payment-service.ts` credits `raisedAmount + amount`, and
 *      `withdraw/route.ts` computes the available balance as
 *      `released - withdrawn - pending`. There is no fee anywhere in it.
 *
 * So the copy named a processor that could not process, quoted a fee nobody
 * had paid, and described a deduction no code performs - on a platform
 * holding real money.
 *
 * ⛔ The replacement does NOT substitute another number. `docs/110` §10 left
 * this open because the correct figure needs an owner decision, and `docs/92`
 * shows the live gateway's own published table understating by 48%. What
 * remains is only what is traceable: we take 0%, and nothing is deducted.
 */
const RATE_PATTERNS: Array<[string, RegExp]> = [
  ['a percent-plus-fixed processing rate', /\d(?:\.\d+)?\s*%\s*(?:\+|plus)\s*(?:\$\s*)?\d/i],
  ['"30 cents" / "30c" beside a fee', /\b(?:30\s*cents|30c)\b/i],
  ['a named processor charging a rate', /\b(?:Stripe|PayHero)\b[^.<>]{0,40}charges\b/i],
];

describe('no user-facing surface quotes a processing rate', () => {
  it.each(RATE_PATTERNS)('%s is absent from src/', (_label, pattern) => {
    const offenders = FILES.filter((f) => pattern.test(SOURCES.get(f) ?? '')).map((f) =>
      f.slice(SRC.length + 1),
    );
    expect(offenders).toEqual([]);
  });

  it('and what replaced it is still true: the platform takes 0% and deducts nothing', () => {
    // A positive assertion, so the rules above cannot be satisfied by
    // deleting the fee disclosure altogether.
    const ledger = readFileSync(join(SRC, 'components/homepage/WhereYourMoneyGoes.tsx'), 'utf8');
    expect(ledger).toContain('LastDonor platform fee');
    expect(ledger).toContain('Reaches the campaign');
    expect(ledger).toMatch(/platformFeeCents\s*=\s*0/);
    expect(ledger).toMatch(/processingDeductedCents\s*=\s*0/);
  });
});

/**
 * No public, donor-facing surface names the payment processor.
 *
 * A vendor name in donor copy is a claim: "Secured by Stripe" in the footer of
 * every page, "Stripe secured" beside the donate button, "This is handled
 * securely by Stripe" on the screen where an organiser uploads their ID to a
 * DIDIT session (`docs/81`), and "standard Stripe processing fees apply" in
 * the campaign META DESCRIPTION that search engines republish - all on a
 * platform where Stripe has never moved a cent.
 *
 * ⚠️ The allowlist is the substance of this rule, not an escape from it.
 */
describe('no donor-facing surface names the payment processor', () => {
  const covered = FILES.map((f) => f.slice(SRC.length + 1)).filter(
    (rel) => !PROCESSOR_NAME_ALLOWED.some((re) => re.test(rel)),
  );

  it('has an allowlist that does not swallow the public pages', () => {
    // If the allowlist ever grows to cover everything, this rule is vacuous.
    expect(covered.length).toBeGreaterThan(50);
    expect(covered).toContain('components/layout/Footer.tsx');
    expect(covered).toContain('components/homepage/WhereYourMoneyGoes.tsx');
    expect(covered).toContain('app/transparency/page.tsx');
    expect(covered).toContain('components/verification/CampaignVerificationDashboard.tsx');
  });

  it('names no processor outside the allowlist', () => {
    const offenders = FILES.map(
      (f) => [f.slice(SRC.length + 1), SOURCES.get(f) ?? ''] as const,
    )
      .filter(([rel]) => !PROCESSOR_NAME_ALLOWED.some((re) => re.test(rel)))
      .filter(([, src]) => /\b(Stripe|PayHero)\b/.test(src))
      .map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });
});
