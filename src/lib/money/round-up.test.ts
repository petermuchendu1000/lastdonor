/**
 * Round-up at the moment of giving.
 *
 * The money-safety property this file exists to hold: **an offer never
 * reduces a donation, and never offers an amount the server would refuse.**
 *
 * ⚠️ Two of Gate 7's required cases do not apply and are not faked. There is
 * no concurrency here (the function is pure, with no I/O and no shared
 * state) and no provider to time out. The nearest real analogues ARE
 * covered: taking the offer twice (idempotence), and the no-conversion path
 * where `charge` is null because the campaign already uses the rail's
 * currency.
 */
import { describe, it, expect } from 'vitest';
import {
  ROUND_UP_STEP_MINOR,
  hasRoundUpStep,
  nextRoundFigure,
  roundUpIncrementMinor,
  roundUpOffer,
} from './round-up';
import { CURRENCIES, SUPPORTED_CURRENCY_CODES } from './currencies';
import type { ChargePreview } from './fx-charge';

/**
 * The live production rate, copied from `MpesaDonationForm.test.tsx`:
 * 129.901648 KES per USD at a margin of 0. $5.00 -> Ksh 650.00, which is the
 * charge `docs/168` measured on the real cross-currency donation.
 */
const USD_OVER_MPESA: ChargePreview = {
  chargeCurrency: 'KES',
  chargeExponent: 2,
  creditExponent: 2,
  rateMicro: 129_901_648,
  marginBps: 0,
  roundUpToMultiple: 100,
};

describe('roundUpOffer: the headline case', () => {
  it('offers Ksh 700.00 to a donor who entered Ksh 650.00', () => {
    expect(roundUpOffer(65_000, 'KES', null)).toBe(70_000);
  });

  it('reports the increment the campaign gains', () => {
    const offer = roundUpOffer(65_000, 'KES', null)!;
    expect(roundUpIncrementMinor(65_000, offer)).toBe(5_000); // Ksh 50.00
  });
});

describe('it rounds UP, never to nearest', () => {
  /*
    THE DISCRIMINATING CASE. Ksh 610.00 sits below the midpoint of its step,
    so `Math.round` would return Ksh 600.00 — an offer to give LESS than the
    donor typed. Only `Math.ceil` can pass this.
  */
  it('offers Ksh 700.00 for Ksh 610.00, never Ksh 600.00', () => {
    const offer = roundUpOffer(61_000, 'KES', null);
    expect(offer).toBe(70_000);
    expect(offer).not.toBe(60_000);
  });

  it('MONEY SAFETY: an offer is always strictly greater than the amount typed', () => {
    for (let minor = 5_000; minor <= 300_000; minor += 137) {
      const offer = roundUpOffer(minor, 'KES', null);
      if (offer !== null) {
        expect(offer, `offer for ${minor} must exceed it`).toBeGreaterThan(minor);
      }
    }
  });
});

describe('it offers nothing when there is nothing to offer', () => {
  it('is null on a figure already round', () => {
    expect(roundUpOffer(70_000, 'KES', null)).toBeNull();
  });

  it('is null for every preset on the KES ladder', () => {
    /*
      presetsFor('KES') in MpesaDonationForm, in major units. Five are whole
      multiples of the step. The sixth, the Ksh 50.00 FLOOR, is not — and an
      earlier version of this module offered to round it to Ksh 100.00,
      doubling the smallest gift the platform accepts. That is what the
      below-one-step rule now withholds.
    */
    for (const major of [2_000, 1_000, 500, 200, 100, 50]) {
      expect(roundUpOffer(major * 100, 'KES', null), `preset ${major}`).toBeNull();
    }
  });

  it('is null below the first round figure, so the floor tile is never doubled', () => {
    const step = ROUND_UP_STEP_MINOR.KES!;
    expect(roundUpOffer(5_000, 'KES', null)).toBeNull(); // Ksh 50.00, the floor
    expect(roundUpOffer(step - 1, 'KES', null)).toBeNull(); // Ksh 99.99
  });

  it('CONTROL: offers from one full step upward, so the rule is not blanket', () => {
    const step = ROUND_UP_STEP_MINOR.KES!;
    expect(roundUpOffer(step + 1, 'KES', null)).toBe(step * 2); // Ksh 100.01 -> 200.00
  });

  it('is null below the donation floor', () => {
    const floor = CURRENCIES.KES.minDonationMinor;
    expect(roundUpOffer(floor - 1, 'KES', null)).toBeNull();
  });

  /*
    ⚠️ The KES case above does NOT isolate the floor guard: Ksh 49.99 is also
    below one step, so the step rule would catch it even with the floor guard
    deleted. USD does isolate it — $4.99 clears the $1 step, rounds to
    exactly $5.00, and lands inside the bounds — so only the floor guard can
    refuse it.
  */
  it('is null below the floor even when the rounded figure would be valid (USD)', () => {
    const floor = CURRENCIES.USD.minDonationMinor; // 500 = $5.00
    expect(roundUpOffer(floor - 1, 'USD', null)).toBeNull();
  });

  it('is null for a currency with no step', () => {
    expect(roundUpOffer(65_000, 'GBP', null)).toBeNull();
  });

  it('is null for a non-integer or non-positive amount', () => {
    expect(roundUpOffer(650.5, 'KES', null)).toBeNull();
    expect(roundUpOffer(0, 'KES', null)).toBeNull();
    expect(roundUpOffer(-65_000, 'KES', null)).toBeNull();
  });

  it('IDEMPOTENCE: taking the offer twice offers nothing the second time', () => {
    const first = roundUpOffer(65_000, 'KES', null)!;
    expect(roundUpOffer(first, 'KES', null)).toBeNull();
  });
});

describe('the maximum guard (reachable only through nextRoundFigure today)', () => {
  /*
    ⚠️ With today's constants this branch CANNOT fire through `roundUpOffer`:
    both maxima are whole multiples of their step, so `Math.ceil` of any
    in-bounds amount lands on or below the maximum. The test below pins that
    fact, and these two pin the guard itself — so if a future
    `maxDonationMinor` stops dividing evenly, the protection is already here
    and already proven.
  */
  it('withholds an offer that would exceed the maximum', () => {
    expect(nextRoundFigure(95, 10, 99)).toBeNull();
  });

  it('CONTROL: offers the same figure when the maximum allows it', () => {
    expect(nextRoundFigure(95, 10, 100)).toBe(100);
  });

  it('documents why the guard is unreachable through roundUpOffer today', () => {
    for (const code of Object.keys(ROUND_UP_STEP_MINOR)) {
      const max = CURRENCIES[code]!.maxDonationMinor;
      expect(
        max % ROUND_UP_STEP_MINOR[code]!,
        `${code}: max ${max} is a whole number of steps, so ceil() cannot exceed it`,
      ).toBe(0);
    }
  });

  it('rejects a non-positive step', () => {
    expect(nextRoundFigure(95, 0, 1_000)).toBeNull();
    expect(nextRoundFigure(95, -10, 1_000)).toBeNull();
  });
});

describe('cross-currency: it rounds the CREDIT, never the charge', () => {
  it('returns the credit in the campaign currency, not the KES charge', () => {
    // $5.40 -> $6.00. ($4.30 is below USD's $5.00 floor and is refused
    // by the bounds guard, which is how that floor was confirmed here.)
    const offer = roundUpOffer(540, 'USD', USD_OVER_MPESA);
    expect(offer).toBe(600);
    // Had it rounded the charge it would be a KES-scale number.
    expect(offer).toBeLessThan(10_000);
  });

  it('withholds an offer whose CHARGE would exceed the rail maximum', () => {
    // $1,924.99 -> $1,925.00, which converts above Ksh 250,000.00.
    expect(roundUpOffer(192_499, 'USD', USD_OVER_MPESA)).toBeNull();
  });

  it('CONTROL: offers when the converted charge still fits', () => {
    // $1,919.99 -> $1,920.00, which converts just under the ceiling.
    expect(roundUpOffer(191_999, 'USD', USD_OVER_MPESA)).toBe(192_000);
  });

  it('the no-conversion path (charge null) still offers', () => {
    expect(roundUpOffer(65_000, 'KES', null)).toBe(70_000);
    expect(roundUpOffer(65_000, 'KES', undefined)).toBe(70_000);
  });
});

describe('the step table covers what the platform can collect', () => {
  /*
    Derived from CURRENCIES, not restated: adding a collectable currency
    without deciding its round figure fails here rather than silently
    shipping a donate form with no round-up.
  */
  it('every collectable currency has a step', () => {
    for (const code of SUPPORTED_CURRENCY_CODES) {
      expect(hasRoundUpStep(code), `${code} needs a ROUND_UP_STEP_MINOR`).toBe(true);
    }
  });

  it('ANTI-VACUITY: the collectable set is non-empty and includes the live rail', () => {
    expect(SUPPORTED_CURRENCY_CODES.length).toBeGreaterThan(0);
    expect(SUPPORTED_CURRENCY_CODES).toContain('KES');
  });

  it('each step is a whole number of major units', () => {
    for (const [code, step] of Object.entries(ROUND_UP_STEP_MINOR)) {
      const minorPer = 10 ** CURRENCIES[code]!.exponent;
      expect(step % minorPer, `${code} step must be whole major units`).toBe(0);
    }
  });
});
