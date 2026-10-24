/**
 * Where the rate snapshot lives.
 *
 * `site_settings` (key/value jsonb) rather than a new table: the snapshot is
 * one row of cached data, it must be shared by every instance, and it must
 * survive a restart. A new table for one row would be a migration against a
 * live money database for no gain, and an in-memory cache would refetch on
 * every cold start and let two instances show different numbers on the same
 * page.
 *
 * It is deliberately NOT routed through `src/lib/settings.server.ts`. That
 * module is a typed map of OPERATOR CONFIGURATION which the admin settings
 * screen renders and edits; rates are machine-written cache data with a
 * provider and a timestamp. Putting them in the same map would put a rate
 * table in a settings form. Separate key namespace, same table.
 *
 * The provider's terms permit caching explicitly ("You're welcome to cache the
 * data we respond with") and forbid re-distribution, which is why this is a
 * private cache feeding our own pages and not an endpoint of ours.
 */

import 'server-only';

import { db } from '@/db';
import { siteSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { SUPPORTED_CURRENCY_CODES } from './currencies';
import type { FxSnapshot } from './fx-providers';

/**
 * Versioned key. A future snapshot shape gets `:v2` rather than overwriting
 * this one, so a rollback to older code still finds a snapshot it understands
 * instead of crashing on a shape it has never seen.
 */
export const FX_SNAPSHOT_KEY = 'fx:usd-rates:v1';

/**
 * Validate anything read back out of the database.
 *
 * The row is machine-written, but it is still external input to this code: an
 * older deploy, a half-finished write, or a hand-edited row can all produce a
 * shape this version does not expect. A page must render without rates rather
 * than throw on them.
 */
export function parseFxSnapshot(value: unknown): FxSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.base !== 'USD') return null;
  if (typeof v.asOf !== 'string' || Number.isNaN(new Date(v.asOf).getTime())) return null;
  if (typeof v.provider !== 'string' || typeof v.fetchedAt !== 'string') return null;
  if (!v.rates || typeof v.rates !== 'object') return null;

  const raw = v.rates as Record<string, unknown>;
  const rates: Record<string, number> = {};
  for (const code of SUPPORTED_CURRENCY_CODES) {
    const r = raw[code];
    // A snapshot missing a currency we support cannot convert it, and a
    // partial table read as complete is how a page ends up showing one
    // currency converted and another silently not.
    if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) return null;
    rates[code] = r;
  }

  return {
    base: 'USD',
    rates,
    asOf: v.asOf,
    provider: v.provider,
    fetchedAt: v.fetchedAt,
  };
}

/** One sequential query. Returns null when no usable snapshot is stored. */
export async function readFxSnapshot(): Promise<FxSnapshot | null> {
  const [row] = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, FX_SNAPSHOT_KEY))
    .limit(1);
  return row ? parseFxSnapshot(row.value) : null;
}

/** Upsert the snapshot. Written only by the refresh cron. */
export async function writeFxSnapshot(snapshot: FxSnapshot): Promise<void> {
  await db
    .insert(siteSettings)
    .values({ key: FX_SNAPSHOT_KEY, value: snapshot, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value: snapshot, updatedAt: new Date() },
    });
}
