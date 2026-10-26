/**
 * The organiser's finance tiles, per currency.
 *
 * The decisive case is the MIXED-CURRENCY ORGANISER: one person holding a KES
 * campaign and a USD campaign. A campaign is single-currency by composite FK
 * (`docs/92`); a PERSON is not, and that is the case the four `reduce` calls
 * this replaces got wrong - they produced one number and a local `fmt()`
 * printed it with a dollar sign.
 */
import { describe, expect, it } from 'vitest';

import {
  financeTotalsByCurrency,
  type FinanceCampaignAmounts,
} from './dashboard-finance-totals';

function campaign(over: Partial<FinanceCampaignAmounts> = {}): FinanceCampaignAmounts {
  return {
    currency: 'KES',
    raisedAmount: 0,
    totalReleasedAmount: 0,
    totalWithdrawnAmount: 0,
    availableBalance: 0,
    ...over,
  };
}

describe('financeTotalsByCurrency', () => {
  it('returns nothing for an organiser with no campaigns', () => {
    // Which is every organiser on this platform on their first visit; the
    // caller must render no tile rather than a zero in an arbitrary currency.
    expect(financeTotalsByCurrency([])).toEqual([]);
  });

  it('⛔ THE DEFECT: two currencies give TWO rows, never one blended total', () => {
    const rows = financeTotalsByCurrency([
      campaign({ currency: 'KES', raisedAmount: 1_840_000, availableBalance: 200_000 }),
      campaign({ currency: 'USD', raisedAmount: 25_000, availableBalance: 5_000 }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.currency)).toEqual(['KES', 'USD']);
    // 1_865_000 / 205_000 are what the old reduces produced.
    expect(rows.some((r) => r.raisedMinor === 1_865_000)).toBe(false);
    expect(rows.some((r) => r.availableMinor === 205_000)).toBe(false);
  });

  it('adds up every column WITHIN one currency', () => {
    const [row] = financeTotalsByCurrency([
      campaign({ raisedAmount: 100_000, totalReleasedAmount: 40_000, totalWithdrawnAmount: 30_000, availableBalance: 10_000 }),
      campaign({ raisedAmount: 50_000, totalReleasedAmount: 50_000, totalWithdrawnAmount: 20_000, availableBalance: 30_000 }),
    ]);

    expect(row).toEqual({
      currency: 'KES',
      raisedMinor: 150_000,
      availableMinor: 40_000,
      withdrawnMinor: 50_000,
      // 60_000 from the first campaign, 0 from the second.
      pendingReleaseMinor: 60_000,
      campaignCount: 2,
    });
  });

  it('⛔ floors pendingRelease PER CAMPAIGN, so an overage cannot cancel a shortfall', () => {
    /*
      Released can exceed raised in the data (seed blending, a manual
      release). The original reduce had `Math.max(0, …)` INSIDE it, so the
      overage contributed 0 rather than a negative. Flooring the total
      instead would hide the second campaign's real 90,000 shortfall.
    */
    const campaigns = [
      campaign({ raisedAmount: 10_000, totalReleasedAmount: 80_000 }),
      campaign({ raisedAmount: 90_000, totalReleasedAmount: 0 }),
    ];

    expect(financeTotalsByCurrency(campaigns)[0].pendingReleaseMinor).toBe(90_000);

    /*
      ⚠️ THE ORDER IS LOAD-BEARING, and finding that out is why this assertion
      is doubled. A running `Math.max(0, total + raised - released)` gives the
      SAME 90,000 for the array above - the clamp happens to fire on the first
      element either way - so the first version of this test passed against
      that mutation. Reversed, the two diverge: per-campaign still yields
      90,000, while a running floor yields 20,000.
    */
    const reversed = [campaigns[1], campaigns[0]];
    expect(financeTotalsByCurrency(reversed)[0].pendingReleaseMinor).toBe(90_000);
    expect(financeTotalsByCurrency(reversed)[0].pendingReleaseMinor).not.toBe(20_000);
  });

  it('orders by raise, biggest first, and breaks ties by code', () => {
    const rows = financeTotalsByCurrency([
      campaign({ currency: 'USD', raisedAmount: 100 }),
      campaign({ currency: 'KES', raisedAmount: 900 }),
    ]);
    expect(rows.map((r) => r.currency)).toEqual(['KES', 'USD']);

    const tied = financeTotalsByCurrency([
      campaign({ currency: 'USD', raisedAmount: 500 }),
      campaign({ currency: 'KES', raisedAmount: 500 }),
    ]);
    expect(tied.map((r) => r.currency)).toEqual(['KES', 'USD']);
  });

  it('counts the campaigns behind each row', () => {
    const rows = financeTotalsByCurrency([
      campaign({ currency: 'KES' }),
      campaign({ currency: 'KES' }),
      campaign({ currency: 'USD' }),
    ]);
    expect(rows.map((r) => [r.currency, r.campaignCount])).toEqual([
      ['KES', 2],
      ['USD', 1],
    ]);
  });

  it('does not mutate its input', () => {
    const input = [campaign({ raisedAmount: 5 })];
    const copy = structuredClone(input);
    financeTotalsByCurrency(input);
    expect(input).toEqual(copy);
  });
});
