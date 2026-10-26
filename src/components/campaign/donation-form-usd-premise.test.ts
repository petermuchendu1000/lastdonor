/**
 * `DonationForm` is a DOLLAR form, and this is the tripwire on that premise.
 *
 * ── THE PREMISE ─────────────────────────────────────────────────────────────
 *
 * `src/app/campaigns/[slug]/donate/client.tsx` picks the donation form by
 * GATEWAY: `payhero` gets `MpesaDonationForm`, which reads its bounds, presets
 * and symbol from the currency registry; everything else gets `DonationForm`,
 * which is dollars throughout - a USD-cent preset ladder, impact hints keyed
 * by USD cents, and `$` in its copy.
 *
 * That is correct only because `CURRENCIES` holds exactly two entries and only
 * USD is on Stripe. The moment a third collectable currency lands on `stripe`,
 * this form renders a dollar ladder for it with **no error anywhere** - the
 * failure mode `docs/112` describes, where the only non-USD campaign was
 * archived so nobody had seen the wrong figure yet.
 *
 * ⚠️ This test does not assert that today's answer is two currencies. It
 * asserts the PREMISE: at most one Stripe currency, and it is USD. Adding KES
 * to PayHero, or a third PayHero currency, leaves it green; adding EUR to
 * Stripe fails it, which is exactly the moment the form needs rewriting.
 */
import { describe, expect, it } from 'vitest';

import { CURRENCIES } from '@/lib/money/currencies';

const stripeCurrencies = Object.values(CURRENCIES)
  .filter((c) => c.gateway === 'stripe')
  .map((c) => c.code)
  .sort();

describe('DonationForm USD premise', () => {
  it('⛔ exactly one currency is collected through Stripe, and it is USD', () => {
    expect(stripeCurrencies).toEqual(['USD']);
  });

  it('states why, so the failure above is actionable', () => {
    /*
      If the assertion above fails, DO NOT widen it. `DonationForm` must
      either be rewritten to read its currency the way `MpesaDonationForm`
      does, or the new currency must be routed to a form that already can.
      See the comment block above `MIN_DONATION_CENTS` in DonationForm.tsx.
    */
    expect(stripeCurrencies.length).toBeLessThanOrEqual(1);
  });

  it('the form reads its bounds from the registry rather than re-declaring them', () => {
    // Pinned as text because the constants are module-private and the point
    // is that no literal re-states what the validator already enforces.
    const src = readSource();
    expect(src).toContain('const MIN_DONATION_CENTS = CURRENCIES.USD.minDonationMinor;');
    expect(src).toContain('const MAX_DONATION_CENTS = CURRENCIES.USD.maxDonationMinor;');
    // The old literals, which could drift from the server-side validator.
    expect(src).not.toContain('const MIN_DONATION_CENTS = 500;');
    expect(src).not.toContain('const MAX_DONATION_CENTS = 10_000_000;');
  });
});

function readSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path') as typeof import('node:path');
  return readFileSync(join(process.cwd(), 'src/components/campaign/DonationForm.tsx'), 'utf8');
}
