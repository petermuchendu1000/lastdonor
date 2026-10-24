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
