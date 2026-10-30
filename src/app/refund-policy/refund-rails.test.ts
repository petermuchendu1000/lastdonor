/**
 * The refund policy describes every rail that can take money, not just one.
 *
 * ── THE DEFECT (2026-10-30, `docs/152`) ─────────────────────────────────────
 *
 * "How To Request a Refund" said:
 *
 *     "If approved, the refund is submitted through Stripe and may take 5 to
 *      10 business days to appear on the original payment method."
 *
 * [VERIFIED three independent ways]
 *
 *   1. CODE - `api/v1/admin/donations/[id]/route.ts` branches on
 *      `provider !== 'stripe'`, calls NO gateway on that branch, and answers
 *      `manualRefundRequired: true` with "which has no refund API ... the
 *      money must be returned to the donor manually". The route's own comment
 *      says the Stripe wording "would be false here".
 *   2. PRODUCTION - every donation this platform has ever taken is `payhero`
 *      (3 of 3, all KES). Stripe has refunded nobody, because Stripe has
 *      collected from nobody (`docs/125`).
 *   3. LIVE PAGE - production served that exact sentence.
 *
 * ⚠️ And the file contradicted itself. Fifty lines above, "Donation Payments"
 * already said "Card payments are processed by Stripe, and M-Pesa payments by
 * PayHero" - which is `docs/148` §B's own correction to this page. The sweep
 * that fixed that sentence did not reach this one, and nothing compares two
 * sentences in one file to each other (`docs/109`).
 *
 * ⚠️ WHY NO EXISTING RULE CAUGHT IT. `fee-claims.test.ts` forbids naming a
 * processor on a user-facing surface - and `PROCESSOR_NAME_ALLOWED` exempts
 * this page, correctly, because naming a sub-processor on a policy page is a
 * compliance disclosure. The exemption says a processor MAY be named. Nothing
 * said the one named had to be the right one.
 *
 * ── WHAT THIS RULE DOES NOT DO ──────────────────────────────────────────────
 *
 * ⛔ It is SECTION-scoped, not page-scoped, and that is load-bearing. The
 * "Payment Disputes" section names Stripe alone and is CORRECT to: a
 * chargeback is a card-network mechanism and M-Pesa has none, so that
 * paragraph is card-scoped on purpose ("If a dispute is opened through a bank
 * or card issuer..."). A page-wide rule would fail against correct copy and
 * the obvious way to satisfy it would be to name PayHero in a paragraph about
 * card disputes - making the page worse. Rule 3 pins that as a control.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENCIES } from '@/lib/money/currencies';

const PAGE = join(__dirname, 'page.tsx');
const SRC = readFileSync(PAGE, 'utf8');

/** Comments stripped: `docs/116` §4 - the comment above the fix quotes it. */
const CODE = SRC.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every gateway that can actually take money today, from the one source. */
const GATEWAYS = [...new Set(Object.values(CURRENCIES).map((c) => c.gateway))].sort();

/** How each gateway is spelled in prose. */
const PROSE_NAME: Record<string, RegExp> = {
  stripe: /\bStripe\b/,
  payhero: /\bPayHero\b|\bM-?Pesa\b/i,
};

/**
 * The body of one `<section>`, found by its `<h2>` text.
 *
 * Slices from the heading to the closing `</section>`, so it cannot run on
 * into the next section's prose - which is what makes a section-scoped rule
 * different from a page-scoped one.
 */
function section(heading: string): string {
  const h = CODE.indexOf(heading);
  expect(h, `section "${heading}" not found - the rules below would be vacuous`).toBeGreaterThan(-1);
  const end = CODE.indexOf('</section>', h);
  expect(end, `section "${heading}" has no closing tag`).toBeGreaterThan(h);
  /*
    ⚠️ Whitespace is COLLAPSED, and that is not cosmetic. JSX wraps prose at
    the source margin, so "bank or card issuer" is stored with a newline and
    ten spaces inside it and a literal match can never fire. My first version
    of rule 5 failed for exactly that reason - a rule that cannot see its
    subject reports the same thing as a subject that is absent
    (`docs/135` §5, `docs/146` §5.2).
  */
  return CODE.slice(h, end).replace(/\s+/g, ' ');
}

/** Which collectable gateways a chunk of prose names. */
function named(text: string): string[] {
  return GATEWAYS.filter((g) => PROSE_NAME[g]?.test(text));
}

describe('the refund policy names every rail that can take money', () => {
  it('the premise holds: more than one gateway can collect (tripwire)', () => {
    /*
      If this platform ever collects through a single gateway, rule 1 becomes
      vacuously true and stops protecting anything. Fail here instead, so
      somebody re-reads this decision rather than inheriting a dead rule.
    */
    expect(
      GATEWAYS.length,
      'only one gateway collects now - rule 1 no longer means anything',
    ).toBeGreaterThan(1);
    expect(GATEWAYS.every((g) => PROSE_NAME[g]), 'a gateway has no prose spelling').toBe(true);
  });

  it('found both sections, and they carry real prose (anti-vacuity)', () => {
    expect(section('How To Request a Refund').length).toBeGreaterThan(300);
    expect(section('Payment Disputes').length).toBeGreaterThan(200);
    expect(section('Donation Payments').length).toBeGreaterThan(300);
  });

  it('⛔ the refund section names ALL collectable rails, or none of them', () => {
    const body = section('How To Request a Refund');
    const hits = named(body);
    if (hits.length === 0) return; // naming none is honest; naming one is not
    expect(
      hits,
      'this section tells donors how their money comes back and names only some of ' +
        'the rails it can come back over - the rail it leaves out is the one that ' +
        'has actually taken every donation',
    ).toEqual(GATEWAYS);
  });

  it('⛔ and it agrees with the section that already named the rails', () => {
    /*
      `docs/148` §B.5's shape: two surfaces asserting one fact must AGREE.
      These two drifted apart inside a single file, so an assertion on either
      one alone would have stayed green.
    */
    expect(named(section('How To Request a Refund'))).toEqual(named(section('Donation Payments')));
  });

  it('⚠️ the card-only dispute paragraph stays card-only (the control)', () => {
    /*
      Without this, the obvious way to satisfy rule 1 is to apply it page-wide
      and then name PayHero in a paragraph about card chargebacks - which
      would be a claim the platform cannot substantiate, since M-Pesa has no
      chargeback mechanism at all.
    */
    const disputes = section('Payment Disputes');
    expect(named(disputes)).toEqual(['stripe']);
    expect(disputes).toMatch(/bank or card issuer/);
  });

  it('⛔ no arrival date is promised for the rail a person settles by hand', () => {
    /*
      `docs/78`: quote no turnaround. The manual return has no gateway behind
      it, so any figure would be invented. The card timetable is kept, because
      Stripe really does state one.
    */
    const body = section('How To Request a Refund');
    const sentences = body.replace(/\s+/g, ' ').split(/(?<=\.)\s+/);
    const arrival = sentences.filter((s) => /business days to|days to show up|days to appear/i.test(s));
    expect(arrival.length, 'no arrival timetable at all - the control is gone').toBeGreaterThan(0);
    for (const s of arrival) {
      expect(
        PROSE_NAME.stripe.test(s) || /\bcard\b/i.test(s),
        `an arrival timetable that is not scoped to the card rail: ${s}`,
      ).toBe(true);
    }
  });
});
