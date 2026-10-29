/**
 * The fee-float verdict, and the two things about it that can be wrong.
 *
 * ── WHAT PROMPTED IT ────────────────────────────────────────────────────────
 *
 * The float read **2,239** on 2026-10-21 and **182.9** on the morning of
 * 2026-10-29 - drained by another company's collections on a shared wallet -
 * and nobody was told, because `/api/v1/health` could judge it and could not
 * reach anybody. At zero, M-Pesa donations fail with NO reason from PayHero
 * (`docs/147` §11.2), so the symptom is indistinguishable from the two
 * unexplained failures of that day.
 *
 * ── THE TWO THINGS THAT CAN BE WRONG ────────────────────────────────────────
 *
 * 1. THE UNIT. `getWalletBalance()` returns PayHero's `available_balance`,
 *    which is a MAJOR-unit decimal, while every amount column in this codebase
 *    is minor units - so the reflex here is a `* 100`, which is the `docs/114`
 *    defect and would move the alert to a hundredth of the intended balance.
 * 2. THE DUPLICATE. The predicate used to live inline in the health route; a
 *    second copy in the cron would be a threshold that drifts (`docs/146`,
 *    `docs/138`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assessFloat,
  lowFloatCollections,
  LOW_FLOAT_WARN_KES,
  LOW_FLOAT_EMAIL_COOLDOWN_HOURS,
  PAYHERO_FEE_PER_COLLECTION_KES,
} from './payhero-float';

describe('the verdict', () => {
  it('⛔ the reported symptom: the balances actually observed are judged correctly', () => {
    // 2026-10-21, healthy.
    expect(assessFloat(2239).isLow).toBe(false);
    // 2026-10-29 morning, after another company's collections drained it.
    expect(assessFloat(182.9).isLow).toBe(true);
    // 2026-10-29 afternoon, after a top-up.
    expect(assessFloat(2027.6).isLow).toBe(false);
  });

  it('counts whole collections, because a part-paid collection is not one', () => {
    // 182.9 / 8.9 = 20.55
    expect(assessFloat(182.9).collectionsRemaining).toBe(20);
    expect(assessFloat(2027.6).collectionsRemaining).toBe(227);
  });

  it('both boundaries: at the threshold is already low, a hair above is not', () => {
    /*
      `<=`, deliberately. Landing exactly on the line is the state the alert
      exists for, and a strict `<` would make the threshold mean "below 500"
      while the constant says "warn at 500".
    */
    expect(assessFloat(LOW_FLOAT_WARN_KES).isLow).toBe(true);
    expect(assessFloat(LOW_FLOAT_WARN_KES + 0.01).isLow).toBe(false);
    expect(assessFloat(LOW_FLOAT_WARN_KES - 0.01).isLow).toBe(true);
  });

  it('exhausted means it cannot pay for even one more collection', () => {
    expect(assessFloat(PAYHERO_FEE_PER_COLLECTION_KES).isExhausted).toBe(false);
    expect(assessFloat(PAYHERO_FEE_PER_COLLECTION_KES - 0.01).isExhausted).toBe(true);
    expect(assessFloat(0).isExhausted).toBe(true);
    // And exhausted is always also low, or the alert copy would contradict itself.
    expect(assessFloat(0).isLow).toBe(true);
  });

  it('a negative or unreadable balance is treated as empty, never as healthy', () => {
    /*
      PayHero's balance HAS gone negative (`docs/84`), so this is not
      hypothetical. The dangerous failure is a non-number reading as fine.
     */
    expect(assessFloat(-50).isLow).toBe(true);
    expect(assessFloat(-50).isExhausted).toBe(true);
    expect(assessFloat(-50).collectionsRemaining).toBe(0);
    expect(assessFloat(Number.NaN).isLow).toBe(true);
    expect(assessFloat(Number.POSITIVE_INFINITY).isLow).toBe(true);
  });
});

describe('⛔ the unit, which is the thing that can be 100x wrong', () => {
  it('the threshold is in the same units PayHero reports', () => {
    /*
      PayHero reported `available_balance: 2027.6` for a wallet holding KES
      2,027.60 - major units. If the threshold were ever read as minor units,
      KES 500 would become KES 5.00 and the alert would effectively never fire.

      This is checked by ARITHMETIC rather than by reading the constant: a
      balance of 450 must be low and a balance of 45000 (the same figure in
      minor units) must not be, which can only both hold if the comparison is
      in major units.
    */
    expect(assessFloat(450).isLow).toBe(true);
    expect(assessFloat(45_000).isLow).toBe(false);
  });

  it('no module in the float path multiplies a balance by 100', () => {
    // The `docs/114` signature, as text, over the two files that hold the
    // balance. `email-templates` legitimately converts for `formatMoney`, and
    // does it through `majorToMinor` - which is why that file is not here.
    const files = ['src/lib/payhero-float.ts', 'src/app/api/v1/cron/payhero-float/route.ts'];
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, `${rel} scales a balance`).not.toMatch(/balance\w*\s*\*\s*100|\*\s*100\b/);
    }
  });

  it('the collection count derives from the threshold rather than restating it', () => {
    // 500 / 8.9 = 56.17 -> 56. Recomputed, not pinned, so changing the
    // threshold cannot leave a stale count behind.
    expect(lowFloatCollections()).toBe(
      Math.floor(LOW_FLOAT_WARN_KES / PAYHERO_FEE_PER_COLLECTION_KES),
    );
    expect(lowFloatCollections()).toBeGreaterThan(0);
  });
});

describe('⛔ the cadence invariant', () => {
  it('the email cooldown is shorter than the time it takes to drain from the threshold', () => {
    /*
      THE INVARIANT:  cooldown  <  threshold / drain rate

      ⚠️ The drain rate is ONE measurement, not a guarantee: 159.6 KES in
      2h53m on 2026-10-29 (`docs/147` §11.3), which is ~55 KES/hour and almost
      entirely the other company's traffic on the shared wallet. A cooldown
      longer than the drain window would make the first alert potentially the
      only one - it would arrive, then go quiet while the float ran out.

      The rate being one sample is an argument for a SHORTER cooldown, never a
      longer one, which is why this test exists rather than a comment.
    */
    const OBSERVED_DRAIN_KES_PER_HOUR = 159.6 / (2 + 53 / 60);
    const hoursToEmpty = LOW_FLOAT_WARN_KES / OBSERVED_DRAIN_KES_PER_HOUR;
    expect(OBSERVED_DRAIN_KES_PER_HOUR).toBeGreaterThan(50);
    expect(LOW_FLOAT_EMAIL_COOLDOWN_HOURS).toBeLessThan(hoursToEmpty);
  });

  it('and the check runs more often than the cooldown, so the cooldown governs volume', () => {
    // The job is hourly; if the cadence were longer than the cooldown, the
    // cadence would silently become the real alert interval.
    const scheduleSrc = readFileSync(
      join(process.cwd(), 'src/lib/cron-schedule.ts'),
      'utf8',
    );
    const block = scheduleSrc.slice(scheduleSrc.indexOf("job: 'payhero-float'"));
    expect(block).toMatch(/cron: '0 \* \* \* \*'/);
    expect(1).toBeLessThan(LOW_FLOAT_EMAIL_COOLDOWN_HOURS);
  });
});

describe('⛔ one predicate, two surfaces', () => {
  const read = (rel: string) =>
    readFileSync(join(process.cwd(), rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('the health route asks this module instead of keeping its own copy', () => {
    /*
      `docs/146`: the predicate that COUNTS a group must be the predicate that
      LISTS it. Here, the route that DETECTS a low float and the job that
      REPORTS it have to agree, or an administrator is emailed about a state
      the status endpoint calls healthy.
    */
    const health = read('src/app/api/v1/health/route.ts');
    expect(health).toMatch(/assessFloat\(/);
    // And has no threshold of its own any more.
    expect(health).not.toMatch(/LOW_FLOAT_COLLECTIONS|PAYHERO_FEE_PER_COLLECTION\s*=/);
  });

  it('the cron asks the same module', () => {
    const cron = read('src/app/api/v1/cron/payhero-float/route.ts');
    expect(cron).toMatch(/assessFloat\(/);
    expect(cron).toMatch(/payhero-float/);
  });

  it('and neither hardcodes the numbers the module owns', () => {
    for (const rel of [
      'src/app/api/v1/health/route.ts',
      'src/app/api/v1/cron/payhero-float/route.ts',
    ]) {
      const src = read(rel);
      expect(src, `${rel} hardcodes the fee`).not.toMatch(/8\.9\b/);
      /*
        ⚠️ Scoped to a COMPARISON or an ASSIGNMENT. The first version was a
        bare `\b500\b` and it fired on `{ status: 500 }` in the cron's error
        response - the rule was wrong, not the code. An HTTP status literal
        appears as an object value, never on either side of a comparison.
      */
      expect(src, `${rel} compares against a hardcoded threshold`).not.toMatch(
        /[<>]=?\s*500\b|=\s*500\s*[;,)]/,
      );
    }
  });
});
