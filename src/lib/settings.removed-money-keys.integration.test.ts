/**
 * The five money settings are gone, and removing them was safe.
 *
 * ── WHAT WAS REMOVED AND WHY ────────────────────────────────────────────────
 *
 * `donation.min_amount`, `donation.max_amount`, `donation.preset_amounts`,
 * `campaign.min_goal` and `campaign.max_goal` were stored, rendered and
 * cross-validated, and [VERIFIED 2026-10-26 by enumerating every
 * `getSetting()` call - all of which pass literal keys - and every
 * `getAllSettings()` consumer] read by NO money path. The real bounds are per
 * currency in `CURRENCIES` (`docs/98`), which is where they must be: one
 * platform-wide integer cannot express a floor for both USD and KES, since
 * 500 minor units is US$5.00 or KES 5.00.
 *
 * They were also the only `inputType: 'cents'` settings, and being
 * currency-less they rendered with a dollar sign they had no claim to.
 *
 * ── THE PROPERTY THAT MAKES REMOVAL SAFE ────────────────────────────────────
 *
 * ⛔ No production row was deleted, and none needs to be. `getAllSettings()`
 * keeps `if (row.key in SETTING_DEFAULTS)`, so a row stored for a removed key
 * is ignored rather than crashing a read or leaking into the map - and
 * `updateSettings` filters the same way, so it cannot be written again.
 *
 * That is the half worth testing against a real database: a type-level check
 * cannot see a row that is already there.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import * as schema from '@/db/schema';
import { SETTING_DEFAULTS, SETTING_META } from '@/lib/settings';
import { getAllSettings, updateSettings } from '@/lib/settings.server';
import { clearDatabase } from '../../test/helpers';

/** Exactly the keys removed on 2026-10-26. */
const REMOVED = [
  'donation.min_amount',
  'donation.max_amount',
  'donation.preset_amounts',
  'campaign.min_goal',
  'campaign.max_goal',
] as const;

beforeEach(async () => {
  await clearDatabase();
});

describe('the removed money settings', () => {
  it('finds a non-trivial settings map at all', () => {
    // Guards the assertions below: if the map were empty they would all pass
    // against anything.
    expect(Object.keys(SETTING_DEFAULTS).length).toBeGreaterThan(10);
    expect(Object.keys(SETTING_META).length).toBe(Object.keys(SETTING_DEFAULTS).length);
  });

  it('⛔ are absent from the defaults and the UI metadata', () => {
    for (const key of REMOVED) {
      expect(Object.keys(SETTING_DEFAULTS)).not.toContain(key);
      expect(Object.keys(SETTING_META)).not.toContain(key);
    }
  });

  it('⛔ no setting is money-typed any more', () => {
    /*
      `inputType: 'cents'` existed only for these five. A new one would be a
      platform-wide money figure in no currency, which is the defect this
      removal closes - so the type is asserted unused rather than deleted
      from the union, where its absence would be a silent compile error for
      whoever adds one.
    */
    const moneyTyped = Object.entries(SETTING_META)
      .filter(([, meta]) => meta.inputType === 'cents')
      .map(([key]) => key);
    expect(moneyTyped).toEqual([]);
  });

  it('⛔ a stored row for a removed key is IGNORED, not surfaced or crashed on', async () => {
    // The production-safety property: these rows may well exist.
    await db.insert(schema.siteSettings).values(
      REMOVED.map((key) => ({ key, value: 12_345 as unknown as Record<string, unknown> })),
    );

    const settings = await getAllSettings();

    for (const key of REMOVED) {
      expect(settings).not.toHaveProperty(key);
    }
    // And a real setting still reads correctly alongside the orphans.
    expect(settings['campaign.max_impact_tiers']).toBe(
      SETTING_DEFAULTS['campaign.max_impact_tiers'],
    );
  });

  it('⛔ a removed key cannot be written back through updateSettings', async () => {
    await updateSettings({ 'donation.min_amount': 999 } as never);

    const rows = await db
      .select({ key: schema.siteSettings.key })
      .from(schema.siteSettings);
    expect(rows.map((r) => r.key)).not.toContain('donation.min_amount');
  });

  it('still writes and reads a setting that WAS kept', async () => {
    // The other half: removal must not have broken the mechanism itself.
    await updateSettings({ 'campaign.max_impact_tiers': 7 });
    const settings = await getAllSettings();
    expect(settings['campaign.max_impact_tiers']).toBe(7);
  });
});
