/**
 * The charge quote: credit in the campaign's currency, charge in the rail's.
 *
 * The scenario that prompted this (docs/168): all 8 live campaigns were USD,
 * the card rail answered 503 on dead credentials and the M-Pesa rail answered
 * 400 WRONG_PAYMENT_RAIL, so nobody could donate to any of them.
 */
import { describe, it, expect } from 'vitest';
import {
  FX_MARGIN_BPS,
  chargeMinorFor,
  quoteChargeFrom,
  MAX_FX_AGE_HOURS,
} from './fx-quote.server';
import { CURRENCIES } from './currencies';
import type { FxSnapshot } from './fx-providers';

/** The live production rate, read from the stored snapshot on 2026-11-02. */
const KES_PER_USD = 129.901648;

function snapshot(ageHours = 0, rates: Record<string, number> = { USD: 1, KES: KES_PER_USD }): FxSnapshot {
  const fetched = new Date(Date.now() - ageHours * 3_600_000);
  return {
    base: 'USD',
    rates,
    asOf: fetched.toISOString(),
    provider: 'test',
    fetchedAt: fetched.toISOString(),
  };
}

const WHOLE_SHILLING = 100; // KES exponent 2 -> 100 minor units per shilling

describe('the margin is the owner decision, recorded here', () => {
  it('is 0 basis points - mid-market, no spread', () => {
    expect(FX_MARGIN_BPS).toBe(0);
  });

  /*
    ⛔ NOT decoration. The platform tells donors "We take 0%... we receive no
    part of that fee" in five live surfaces, and PayHero performs no
    conversion of its own, so any spread would be LastDonor revenue and would
    make that false. Raising this is a copy change first. See docs/168.
  */
  it('a non-zero margin would change what the donor is charged', () => {
    const mid = chargeMinorFor(500, { exponent: 2, rate: 1 }, { exponent: 2, rate: 100 }, 0, 1);
    const withSpread = chargeMinorFor(500, { exponent: 2, rate: 1 }, { exponent: 2, rate: 100 }, 200, 1);
    expect(mid).toBe(50_000);
    expect(withSpread).toBe(51_000); // +2%
    expect(withSpread).toBeGreaterThan(mid);
  });
});

describe('the reported symptom: a USD campaign collected over an M-Pesa rail', () => {
  it('quotes a KES charge for a USD credit', () => {
    const r = quoteChargeFrom(snapshot(), {
      creditMinor: 500, // $5.00, the USD minimum
      creditCurrency: 'USD',
      chargeCurrency: 'KES',
      roundChargeUpToMultiple: WHOLE_SHILLING,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 5.00 x 129.901648 = 649.508... -> rounded UP to a whole shilling
    expect(r.quote.chargeMinor).toBe(65_000);
    expect(r.quote.chargeCurrency).toBe('KES');
    expect(r.quote.creditMinor).toBe(500);
    expect(r.quote.creditCurrency).toBe('USD');
    expect(r.quote.marginBps).toBe(0);
    expect(r.quote.rateMicro).toBe(Math.round(KES_PER_USD * 1_000_000));
  });

  it('the charge is always a WHOLE shilling - PayHero refuses fractions', () => {
    for (const creditMinor of [500, 777, 1234, 9999, 100_000]) {
      const r = quoteChargeFrom(snapshot(), {
        creditMinor,
        creditCurrency: 'USD',
        chargeCurrency: 'KES',
        roundChargeUpToMultiple: WHOLE_SHILLING,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.quote.chargeMinor % WHOLE_SHILLING).toBe(0);
    }
  });

  it('rounds the charge UP, never to nearest - we never collect less than the credit', () => {
    // A credit whose exact charge lands just above a whole shilling.
    const exact = chargeMinorFor(
      500,
      { exponent: 2, rate: 1 },
      { exponent: 2, rate: KES_PER_USD },
      0,
      1,
    );
    const rounded = chargeMinorFor(
      500,
      { exponent: 2, rate: 1 },
      { exponent: 2, rate: KES_PER_USD },
      0,
      WHOLE_SHILLING,
    );
    expect(rounded).toBeGreaterThanOrEqual(exact);
    expect(rounded - exact).toBeLessThan(WHOLE_SHILLING);
  });
});

describe('both boundaries', () => {
  it('the USD floor of $5.00 converts to a charge inside the KES bounds', () => {
    const r = quoteChargeFrom(snapshot(), {
      creditMinor: CURRENCIES.USD.minDonationMinor,
      creditCurrency: 'USD',
      chargeCurrency: 'KES',
      roundChargeUpToMultiple: WHOLE_SHILLING,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote.chargeMinor).toBeGreaterThanOrEqual(CURRENCIES.KES.minDonationMinor);
    expect(r.quote.chargeMinor).toBeLessThanOrEqual(CURRENCIES.KES.maxDonationMinor);
  });

  /*
    The M-Pesa ceiling binds long before the USD one: KES 250,000 is the real
    per-transaction limit (docs/92), which is about US$1,900. The caller
    refuses such a charge; this pins that the quote really does cross the line
    there, so that refusal is not dead code.
  */
  it('a large USD credit produces a charge ABOVE the KES ceiling', () => {
    const r = quoteChargeFrom(snapshot(), {
      creditMinor: 500_000, // $5,000
      creditCurrency: 'USD',
      chargeCurrency: 'KES',
      roundChargeUpToMultiple: WHOLE_SHILLING,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote.chargeMinor).toBeGreaterThan(CURRENCIES.KES.maxDonationMinor);
  });
});

describe('staleness REFUSES the charge', () => {
  it('a snapshot past the window is refused, not guessed', () => {
    const r = quoteChargeFrom(snapshot(MAX_FX_AGE_HOURS + 1), {
      creditMinor: 500,
      creditCurrency: 'USD',
      chargeCurrency: 'KES',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('fx_stale');
  });

  /*
    ⛔ CONTROL. Without this the staleness test passes against a function that
    refuses everything, which would "fix" the defect by collecting nothing.
  */
  it('CONTROL: a fresh snapshot of the same shape is accepted', () => {
    const r = quoteChargeFrom(snapshot(1), {
      creditMinor: 500,
      creditCurrency: 'USD',
      chargeCurrency: 'KES',
    });
    expect(r.ok).toBe(true);
  });
});

describe('refusals', () => {
  it('refuses a currency the platform does not collect', () => {
    const r = quoteChargeFrom(snapshot(0, { USD: 1, KES: KES_PER_USD, UGX: 3700 }), {
      creditMinor: 500,
      creditCurrency: 'UGX',
      chargeCurrency: 'KES',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('unsupported_currency');
  });

  it('refuses when the snapshot carries no usable rate', () => {
    const r = quoteChargeFrom(snapshot(0, { USD: 1 }), {
      creditMinor: 500,
      creditCurrency: 'USD',
      chargeCurrency: 'KES',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_rate');
  });

  it.each([0, -1, 1.5, NaN])('refuses a credit of %s', (creditMinor) => {
    const r = quoteChargeFrom(snapshot(), {
      creditMinor,
      creditCurrency: 'USD',
      chargeCurrency: 'KES',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('bad_credit_amount');
  });
});

describe('same currency is a no-op, not a conversion', () => {
  it('KES credit charged in KES is unchanged', () => {
    const r = quoteChargeFrom(snapshot(), {
      creditMinor: 5_000,
      creditCurrency: 'KES',
      chargeCurrency: 'KES',
      roundChargeUpToMultiple: WHOLE_SHILLING,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote.chargeMinor).toBe(5_000);
    expect(r.quote.rateMicro).toBe(1_000_000);
  });
});

describe('the zero-decimal path, exercised before such a currency exists', () => {
  /*
    `CURRENCIES` holds only USD and KES, both exponent 2, so a hardcoded 100
    and a real exponent are behaviourally identical today - `fx-convert.ts`
    records a mutation proving the hardcoded version survives the suite.
    `chargeMinorFor` takes the exponents so the case can be tested now.
  */
  it('a zero-decimal CHARGE currency is not inflated 100x', () => {
    // $5.00 credit (exponent 2) into a zero-decimal currency at 1000/USD.
    const charge = chargeMinorFor(
      500,
      { exponent: 2, rate: 1 },
      { exponent: 0, rate: 1000 },
      0,
      1,
    );
    // 5.00 x 1000 = 5000 major units, and exponent 0 means minor == major.
    expect(charge).toBe(5_000);
  });

  it('a zero-decimal CREDIT currency is not divided 100x', () => {
    const charge = chargeMinorFor(
      5_000, // 5000 major units, exponent 0
      { exponent: 0, rate: 1000 },
      { exponent: 2, rate: 1 },
      0,
      1,
    );
    // 5000 / 1000 = 5.00 major units -> 500 minor at exponent 2.
    expect(charge).toBe(500);
  });
});
