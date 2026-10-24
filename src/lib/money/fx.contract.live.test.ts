/**
 * Live contract test: runs the REAL providers against the REAL endpoints.
 *
 * Read-only, no credentials involved (both providers are keyless), no writes.
 * Skipped unless `FX_LIVE_CONTRACT=1`, following
 * `src/lib/payhero.contract.live.test.ts` - a provider contract asserted from
 * mocks only tells you the mocks still agree with each other.
 *
 *   FX_LIVE_CONTRACT=1 npx vitest run src/lib/money/fx.contract.live.test.ts
 *
 * Last run 2026-10-24 from the sandbox AND from the production machine in
 * `arn` (170ms primary / 75ms fallback). Results recorded in docs/102.
 */

import { describe, it, expect } from 'vitest';
import {
  fetchFromErApi,
  fetchFromCurrencyApi,
  fetchFxSnapshot,
} from './fx-providers';
import { convertMinor, fxAgeHours, isFxFresh } from './fx-convert';
import { SUPPORTED_CURRENCY_CODES } from './currencies';

const LIVE = process.env.FX_LIVE_CONTRACT === '1';
const d = LIVE ? describe : describe.skip;

d('FX live contract (read-only)', () => {
  it('the primary answers with every supported currency', async () => {
    const s = await fetchFromErApi();
    console.log(`  primary: ${s.provider} asOf=${s.asOf} age=${fxAgeHours(s).toFixed(2)}h KES=${s.rates.KES}`);
    for (const code of SUPPORTED_CURRENCY_CODES) {
      expect(s.rates[code]).toBeGreaterThan(0);
    }
    expect(s.rates.USD).toBe(1);
  });

  it('the primary is fresh enough to be usable', async () => {
    const s = await fetchFromErApi();
    expect(isFxFresh(s)).toBe(true);
  });

  it('the fallback answers independently, with every supported currency', async () => {
    const s = await fetchFromCurrencyApi();
    console.log(`  fallback: ${s.provider} asOf=${s.asOf} age=${fxAgeHours(s).toFixed(2)}h KES=${s.rates.KES}`);
    for (const code of SUPPORTED_CURRENCY_CODES) {
      expect(s.rates[code]).toBeGreaterThan(0);
    }
  });

  it('the two providers agree to within 1%', async () => {
    /*
      They are separate aggregations, so they will not be identical. 1% is
      wide enough for genuine source differences and narrow enough to catch
      one of them going stale, switching base, or reporting a different
      quote convention (inverted rates would be off by ~16,000%).
    */
    const [a, b] = await Promise.all([fetchFromErApi(), fetchFromCurrencyApi()]);
    const spread = Math.abs(a.rates.KES - b.rates.KES) / a.rates.KES;
    console.log(`  KES spread: ${(spread * 100).toFixed(4)}%  (${a.rates.KES} vs ${b.rates.KES})`);
    expect(spread).toBeLessThan(0.01);
  });

  it('failover reaches the real fallback when the primary throws', async () => {
    const { snapshot, errors } = await fetchFxSnapshot([
      async () => { throw new Error('simulated primary outage'); },
      fetchFromCurrencyApi,
    ]);
    expect(snapshot.rates.KES).toBeGreaterThan(0);
    expect(errors).toEqual(['simulated primary outage']);
  });

  it('a live snapshot converts a plausible goal into a plausible figure', async () => {
    const { snapshot } = await fetchFxSnapshot();
    // KES 64,923.93 should be in the low hundreds of dollars, not thousands.
    const usd = convertMinor(snapshot, { amountMinor: 6_492_393, fromCurrency: 'KES', toCurrency: 'USD' });
    console.log(`  KES 64,923.93 -> USD minor ${usd}`);
    expect(usd).not.toBeNull();
    expect(usd!).toBeGreaterThan(30_000);
    expect(usd!).toBeLessThan(80_000);
  });
});
