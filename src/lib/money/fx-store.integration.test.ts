/**
 * The snapshot round-trip through `site_settings`, against a real Postgres.
 *
 * Written because the last time this change set trusted a text-level check
 * over a jsonb read, the SQL was silently wrong and returned 0 for every row
 * (docs/101 §5). A snapshot that writes but reads back as `null` would take
 * every converted figure off the site with no error anywhere.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '@/db';
import { siteSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import {
  FX_SNAPSHOT_KEY,
  readFxSnapshot,
  writeFxSnapshot,
  parseFxSnapshot,
} from './fx-store.server';
import { convertMinor } from './fx-convert';
import type { FxSnapshot } from './fx-providers';
import { KNOWN_CURRENCY_CODES } from './world-currencies';
import { SUPPORTED_CURRENCY_CODES } from './currencies';

const SNAPSHOT: FxSnapshot = {
  base: 'USD',
  rates: { USD: 1, KES: 129.84786 },
  asOf: '2026-10-24T00:02:31.000Z',
  provider: 'open.er-api.com',
  fetchedAt: '2026-10-24T02:00:00.000Z',
};

async function clearFx() {
  await db.delete(siteSettings).where(eq(siteSettings.key, FX_SNAPSHOT_KEY));
}

describe('fx snapshot store', () => {
  beforeEach(clearFx);
  afterAll(clearFx);

  it('reads back null when nothing is stored', async () => {
    expect(await readFxSnapshot()).toBeNull();
  });

  it('round-trips a snapshot through jsonb without losing precision', async () => {
    await writeFxSnapshot(SNAPSHOT);
    const got = await readFxSnapshot();
    expect(got).not.toBeNull();
    // The rate must survive exactly - a float mangled in storage is a wrong
    // money figure, not a rounding curiosity.
    expect(got!.rates.KES).toBe(129.84786);
    expect(got!.rates.USD).toBe(1);
    expect(got!.asOf).toBe(SNAPSHOT.asOf);
    expect(got!.provider).toBe('open.er-api.com');
  });

  it('upserts rather than erroring on a second write', async () => {
    await writeFxSnapshot(SNAPSHOT);
    await writeFxSnapshot({ ...SNAPSHOT, rates: { USD: 1, KES: 131.5 }, asOf: '2026-10-25T00:02:31.000Z' });
    const got = await readFxSnapshot();
    expect(got!.rates.KES).toBe(131.5);
    expect(got!.asOf).toBe('2026-10-25T00:02:31.000Z');

    // and leaves exactly one row
    const rows = await db.select().from(siteSettings).where(eq(siteSettings.key, FX_SNAPSHOT_KEY));
    expect(rows).toHaveLength(1);
  });

  it('a stored snapshot actually drives a conversion', async () => {
    await writeFxSnapshot(SNAPSHOT);
    const got = await readFxSnapshot();
    const out = convertMinor(
      got!,
      { amountMinor: 50_000, fromCurrency: 'USD', toCurrency: 'KES' },
      new Date('2026-10-24T12:00:00Z'),
    );
    expect(out).toBe(6_492_393);
  });

  it('reads a row missing a supported currency as null, not as a partial table', async () => {
    // Reachable: an older deploy wrote a snapshot before KES existed.
    await db.insert(siteSettings).values({
      key: FX_SNAPSHOT_KEY,
      value: { ...SNAPSHOT, rates: { USD: 1 } },
    });
    expect(await readFxSnapshot()).toBeNull();
  });

  it('reads a structurally wrong row as null rather than throwing', async () => {
    await db.insert(siteSettings).values({ key: FX_SNAPSHOT_KEY, value: { nonsense: true } });
    expect(await readFxSnapshot()).toBeNull();
  });

  it('does not collide with other settings keys', async () => {
    await db.insert(siteSettings).values({ key: 'some:other:key', value: { a: 1 } });
    await writeFxSnapshot(SNAPSHOT);
    const other = await db.select().from(siteSettings).where(eq(siteSettings.key, 'some:other:key'));
    expect(other).toHaveLength(1);
    expect(await readFxSnapshot()).not.toBeNull();
    await db.delete(siteSettings).where(eq(siteSettings.key, 'some:other:key'));
  });
});

describe('parseFxSnapshot rejects what it should', () => {
  it.each([
    ['null', null],
    ['a string', 'USD'],
    ['wrong base', { ...SNAPSHOT, base: 'EUR' }],
    ['unparseable asOf', { ...SNAPSHOT, asOf: 'nope' }],
    ['missing provider', { ...SNAPSHOT, provider: undefined }],
    ['rates not an object', { ...SNAPSHOT, rates: 'none' }],
    ['a zero rate', { ...SNAPSHOT, rates: { USD: 1, KES: 0 } }],
    ['a negative rate', { ...SNAPSHOT, rates: { USD: 1, KES: -1 } }],
    ['a stringified rate', { ...SNAPSHOT, rates: { USD: 1, KES: '129.8' } }],
  ])('rejects %s', (_label, value) => {
    expect(parseFxSnapshot(value)).toBeNull();
  });

  it('accepts the real shape', () => {
    expect(parseFxSnapshot(SNAPSHOT)).not.toBeNull();
  });
});

describe('the reader must keep what the writer stores', () => {
  /*
    THE REGRESSION THESE EXIST FOR, shipped in 2ac929a and found by a real
    browser rather than by any of these suites.

    `narrowToSupported` in `fx-providers.ts` was widened to persist a rate for
    every KNOWN currency; `parseFxSnapshot` was left iterating
    `SUPPORTED_CURRENCY_CODES`. So 152 rates were written and 150 discarded on
    every read, and the only currency that could ever be displayed was KES.

    The old round-trip test used USD and KES exclusively, which is precisely
    why it could not fail. These use a NON-collectable currency on purpose.
  */
  beforeEach(clearFx);
  afterAll(clearFx);

  it('keeps a known-but-not-collectable currency through a round-trip', async () => {
    await writeFxSnapshot({ ...SNAPSHOT, rates: { USD: 1, KES: 129.84786, UGX: 3700 } });
    const got = await readFxSnapshot();
    expect(got).not.toBeNull();
    expect(got!.rates.UGX).toBe(3700);
  });

  it('a stored UGX rate actually drives a conversion after a read', async () => {
    await writeFxSnapshot({ ...SNAPSHOT, rates: { USD: 1, KES: 129.84786, UGX: 3700 } });
    const got = await readFxSnapshot();
    // $10,000 -> UGX 37,000,000 (UGX is zero-decimal, so minor == major).
    const out = convertMinor(
      got!,
      { amountMinor: 1_000_000, fromCurrency: 'USD', toCurrency: 'UGX' },
      new Date('2026-10-24T12:00:00Z'),
    );
    expect(out).toBe(37_000_000);
  });

  it('the reader accepts EVERY currency the writer can store', async () => {
    // The superset invariant, asserted directly rather than by example.
    const rates = Object.fromEntries(KNOWN_CURRENCY_CODES.map((c) => [c, c === 'USD' ? 1 : 2]));
    await writeFxSnapshot({ ...SNAPSHOT, rates });
    const got = await readFxSnapshot();
    expect(got).not.toBeNull();
    expect(Object.keys(got!.rates).sort()).toEqual([...KNOWN_CURRENCY_CODES].sort());
  });

  it('still REQUIRES every collectable currency', async () => {
    // Widening the reader must not have made it permissive about the two
    // currencies that actually take money.
    for (const missing of SUPPORTED_CURRENCY_CODES) {
      const rates = Object.fromEntries(
        KNOWN_CURRENCY_CODES.filter((c) => c !== missing).map((c) => [c, c === 'USD' ? 1 : 2]),
      );
      await clearFx();
      await db.insert(siteSettings).values({ key: FX_SNAPSHOT_KEY, value: { ...SNAPSHOT, rates } });
      expect(await readFxSnapshot(), `missing ${missing} must reject`).toBeNull();
    }
  });

  it('still refuses junk keys a provider might offer', async () => {
    await writeFxSnapshot({
      ...SNAPSHOT,
      rates: { USD: 1, KES: 129.84786, UGX: 3700, BTC: 0.0000094, XAU: 0.0004 } as Record<string, number>,
    });
    const got = await readFxSnapshot();
    expect(got!.rates).not.toHaveProperty('BTC');
    expect(got!.rates).not.toHaveProperty('XAU');
    expect(got!.rates.UGX).toBe(3700);
  });
});
