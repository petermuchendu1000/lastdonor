/**
 * Provider parsing, written against responses MEASURED from the real
 * endpoints on 2026-10-24 rather than invented.
 *
 * The first describe block is the important one: the primary provider reports
 * its own errors with HTTP 200, so a client that trusts the status line
 * accepts an error body as a rate table.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchFromErApi,
  fetchFromCurrencyApi,
  fetchFxSnapshot,
  FxProviderError,
  FX_ATTRIBUTION,
} from './fx-providers';
import type { FxSnapshot } from './fx-providers';

function mockFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fn = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Real shape, trimmed, from https://open.er-api.com/v6/latest/USD */
const ER_API_OK = {
  result: 'success',
  provider: 'https://www.exchangerate-api.com',
  time_last_update_unix: 1792800151,
  time_last_update_utc: 'Sat, 24 Oct 2026 00:02:31 +0000',
  time_next_update_utc: 'Sun, 25 Oct 2026 00:17:01 +0000',
  time_eol_unix: 0,
  base_code: 'USD',
  rates: { USD: 1, EUR: 0.892784, KES: 129.84786 },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the primary provider answers HTTP 200 for its OWN errors', () => {
  /*
    MEASURED: GET https://open.er-api.com/v6/latest/ZZZ returns
      HTTP 200  {"result":"error","error-type":"unsupported-code"}
    This is the docs/92 PayHero trap in a different costume - there,
    `success: true` arrived alongside `status: "FAILED"`. A client that reads
    `res.ok` treats this as a rate table with no rates.
  */
  it('rejects result=error even though the status is 200', async () => {
    mockFetch({ result: 'error', 'error-type': 'unsupported-code' }, { ok: true, status: 200 });
    await expect(fetchFromErApi()).rejects.toThrow(FxProviderError);
    await expect(fetchFromErApi()).rejects.toThrow(/result=error/);
  });

  it('rejects a 200 body with no result field at all', async () => {
    mockFetch({ base_code: 'USD', rates: { USD: 1, KES: 130 } });
    await expect(fetchFromErApi()).rejects.toThrow(/result=missing/);
  });

  it('still rejects a genuine non-2xx', async () => {
    mockFetch({}, { ok: false, status: 503 });
    await expect(fetchFromErApi()).rejects.toThrow(/HTTP 503/);
  });
});

describe('open.er-api.com parsing', () => {
  it('parses a measured success response', async () => {
    mockFetch(ER_API_OK);
    const s = await fetchFromErApi();
    expect(s.base).toBe('USD');
    expect(s.rates.KES).toBe(129.84786);
    expect(s.rates.USD).toBe(1);
    expect(s.provider).toBe('open.er-api.com');
    expect(new Date(s.asOf).toISOString()).toBe('2026-10-24T00:02:31.000Z');
  });

  it('keeps known currencies as well as collectable ones', async () => {
    /*
      Changed 2026-10-24 (docs/103): the snapshot used to hold only USD and
      KES. It now carries every KNOWN currency the provider offers, because a
      visitor in Lagos needs a naira rate to see a KES appeal in their own
      money - and no gateway takes naira. Collectable currencies stay
      REQUIRED; the rest are best effort.
    */
    mockFetch(ER_API_OK);
    const s = await fetchFromErApi();
    expect(Object.keys(s.rates).sort()).toEqual(['EUR', 'KES', 'USD']);
  });

  it('a missing NON-collectable rate does not take the snapshot down', async () => {
    // The provider publishes 166 codes and we know 152; neither is a subset
    // of the other, so one absent currency must not stop every conversion.
    mockFetch({ ...ER_API_OK, rates: { USD: 1, KES: 129.84786 } });
    const s = await fetchFromErApi();
    expect(Object.keys(s.rates).sort()).toEqual(['KES', 'USD']);
  });

  it('rejects a table missing a currency this platform supports', async () => {
    mockFetch({ ...ER_API_OK, rates: { USD: 1, EUR: 0.89 } });
    await expect(fetchFromErApi()).rejects.toThrow(/no usable rate for KES/);
  });

  it('rejects a table whose base is not actually USD', async () => {
    // A table where 1 USD != 1 USD is not USD-based, and every conversion
    // off it would be silently scaled.
    mockFetch({ ...ER_API_OK, rates: { USD: 0.92, KES: 119 } });
    await expect(fetchFromErApi()).rejects.toThrow(/base is not USD/);
  });

  it('rejects base_code that is not USD', async () => {
    mockFetch({ ...ER_API_OK, base_code: 'EUR' });
    await expect(fetchFromErApi()).rejects.toThrow(/base_code=EUR/);
  });

  it('rejects a response with no parseable timestamp, because the staleness guard needs one', async () => {
    mockFetch({ ...ER_API_OK, time_last_update_utc: undefined });
    await expect(fetchFromErApi()).rejects.toThrow(/time_last_update_utc/);
  });
});

describe('the fallback: lowercase keys and cryptocurrencies', () => {
  /*
    MEASURED: the fallback's 339 keys include `1inch`, `aave`, `ada`, `btc`,
    `eth`, and fiat codes are LOWERCASE. Both facts would corrupt a money
    table if passed through.
  */
  it('reads lowercase keys, keeps known fiat, and ignores crypto entries', async () => {
    mockFetch({
      date: '2026-10-23',
      usd: { kes: 129.85584106, eur: 0.89177251, btc: 0.0000094, eth: 0.00031, '1inch': 3.2, ada: 1.7 },
    });
    const s = await fetchFromCurrencyApi();
    // EUR is a real currency and is kept; the crypto entries are not and
    // must never reach a money store, whatever the provider calls them.
    expect(Object.keys(s.rates).sort()).toEqual(['EUR', 'KES', 'USD']);
    for (const notACurrency of ['BTC', 'ETH', '1INCH', 'ADA', 'btc', 'eth', 'ada']) {
      expect(s.rates).not.toHaveProperty(notACurrency);
    }
    expect(s.rates.KES).toBe(129.85584106);
    expect(s.rates.USD).toBe(1);
  });

  it('reads its date-only timestamp as UTC midnight', async () => {
    mockFetch({ date: '2026-10-23', usd: { kes: 129.85 } });
    const s = await fetchFromCurrencyApi();
    expect(s.asOf).toBe('2026-10-23T00:00:00.000Z');
  });

  it('rejects a missing usd object', async () => {
    mockFetch({ date: '2026-10-23' });
    await expect(fetchFromCurrencyApi()).rejects.toThrow(/no usd object/);
  });

  it('rejects an unparseable date', async () => {
    mockFetch({ date: 'yesterday', usd: { kes: 129.85 } });
    await expect(fetchFromCurrencyApi()).rejects.toThrow(/parseable date/);
  });
});

describe('failover', () => {
  const good: FxSnapshot = {
    base: 'USD',
    rates: { USD: 1, KES: 130 },
    asOf: '2026-10-24T00:00:00Z',
    provider: 'stub',
    fetchedAt: '2026-10-24T02:00:00Z',
  };

  it('uses the primary when it works and does not call the fallback', async () => {
    const fallback = vi.fn();
    const { snapshot, errors } = await fetchFxSnapshot([async () => good, fallback]);
    expect(snapshot.provider).toBe('stub');
    expect(errors).toEqual([]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back, and REPORTS the primary failure rather than swallowing it', async () => {
    /*
      docs/90 found `fetchGNewsArticles` catching every error and returning
      `[]`, which made its blackout detection dead code for the platform's
      whole life. A silent failover hides a provider that has been down for
      a month until it is the last one left.
    */
    const { snapshot, errors } = await fetchFxSnapshot([
      async () => { throw new FxProviderError('primary exploded'); },
      async () => good,
    ]);
    expect(snapshot.provider).toBe('stub');
    expect(errors).toEqual(['primary exploded']);
  });

  it('throws when every provider fails, naming all of them', async () => {
    await expect(
      fetchFxSnapshot([
        async () => { throw new Error('a down'); },
        async () => { throw new Error('b down'); },
      ]),
    ).rejects.toThrow(/a down \| b down/);
  });

  it('throws rather than returning an empty table when there are no providers', async () => {
    await expect(fetchFxSnapshot([])).rejects.toThrow(FxProviderError);
  });
});

describe('attribution', () => {
  /*
    The provider's documentation states the open endpoint "requires
    attribution" (read 2026-10-24). This is a licence term, so it is pinned
    here as well as in the component ratchet.
  */
  it('names the provider and links to it', () => {
    expect(FX_ATTRIBUTION.label).toMatch(/ExchangeRate-API/i);
    expect(FX_ATTRIBUTION.href).toBe('https://www.exchangerate-api.com');
  });
});
