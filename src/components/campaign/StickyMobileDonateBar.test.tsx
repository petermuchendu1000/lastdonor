/**
 * The sticky donate bar renders the campaign's OWN currency.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * The bar used `centsToDollarsWhole`, which hardcodes USD, while every amount
 * column in this schema is in the MINOR UNITS OF ITS ROW'S CURRENCY
 * (`docs/92`). On a KES campaign it printed **"$31,600 to go"** immediately
 * beneath a verification badge correctly reading "Ksh 50,000.00".
 *
 * `docs/112` recorded this class of defect as LATENT, on the grounds that the
 * only non-USD campaign was archived and therefore unservable. That was true
 * and it was never going to stay true: KES over M-Pesa is the only rail that
 * has ever collected money on this platform (`docs/92`). It was found the
 * first time a servable KES campaign was rendered in a browser - which is
 * the `docs/107` §8 lesson, that some defects are invisible to every test
 * until somebody looks.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { StickyMobileDonateBar } from './StickyMobileDonateBar';

/** KES 50,000.00 goal, KES 18,400.00 raised - the seeded journey campaign. */
const KES = { raisedAmount: 1_840_000, goalAmount: 5_000_000, currency: 'KES' };
const USD = { raisedAmount: 184_000, goalAmount: 500_000, currency: 'USD' };

describe('StickyMobileDonateBar', () => {
  it('⛔ never prints a dollar sign on a KES campaign', () => {
    render(<StickyMobileDonateBar {...KES} donateHref="/donate" />);
    expect(document.body.textContent).not.toContain('$');
  });

  it('renders the shilling figure the row actually holds', () => {
    render(<StickyMobileDonateBar {...KES} donateHref="/donate" />);
    // 5,000,000 - 1,840,000 = 3,160,000 minor = KES 31,600
    // NBSP between "Ksh" and the digits - normalise before matching.
    const text = (document.body.textContent ?? '').replace(/\u00a0/g, ' ');
    expect(text).toMatch(/Ksh 31,600/);
  });

  it('still renders USD correctly, so the fix did not just swap one hardcode for another', () => {
    render(<StickyMobileDonateBar {...USD} donateHref="/donate" />);
    expect(document.body.textContent).toMatch(/\$3,160/);
  });

  it('⛔ requires a currency rather than defaulting to USD', () => {
    /*
      Read as TEXT, because a default parameter is exactly how this defect
      comes back: `currency = 'USD'` would compile, satisfy every caller and
      silently restore the dollar sign on a shilling campaign.
    */
    const src = codeOnly(readSource());
    expect(src).not.toMatch(/currency\s*=\s*['"]USD['"]/);
    expect(src).not.toMatch(/centsToDollars/);
  });
});

/*
  Comments are stripped first. The doc comment in that file NAMES the defect
  ("this bar used centsToDollarsWhole"), and a raw-text rule matched its own
  explanation - the `docs/112` icon-ratchet trap, where naming the svg tag in
  a comment tripped the rule about svg tags.
*/
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function readSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path');
  return readFileSync(
    join(process.cwd(), 'src/components/campaign/StickyMobileDonateBar.tsx'),
    'utf8',
  );
}
