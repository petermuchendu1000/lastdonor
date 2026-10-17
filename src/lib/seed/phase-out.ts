import 'server-only';

import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { getSetting } from '@/lib/settings.server';
import type { SettingsMap } from '@/lib/settings';

/**
 * Calculate auto-adjusted simulation volume based on the number of real
 * (non-simulated) active campaigns. Returns a multiplier:
 *   - -1: phase-out is disabled (not applicable)
 *   - 0.0: simulation should stop (high threshold reached)
 *   - 0.3: mid threshold
 *   - 0.7: low threshold
 *   - 1.0: below all thresholds (full volume)
 */
export async function calculateAutoVolume(
  /*
    Settings the caller has already loaded. Passing them turns four
    single-row queries into none: `/admin/simulation` calls
    `getAllSettings()` anyway, and on a pool of five connections four
    avoidable queries are not free (see the comment in that page about
    pool exhaustion). Omitted, the function reads them itself, so every
    other caller is unchanged.
  */
  settings?: Pick<
    SettingsMap,
    | 'simulation.phase_out.enabled'
    | 'simulation.phase_out.threshold_low'
    | 'simulation.phase_out.threshold_mid'
    | 'simulation.phase_out.threshold_high'
  >,
): Promise<number> {
  const phaseOutEnabled =
    settings?.['simulation.phase_out.enabled'] ??
    (await getSetting('simulation.phase_out.enabled'));
  if (!phaseOutEnabled) return -1;

  const thresholdLow =
    settings?.['simulation.phase_out.threshold_low'] ??
    (await getSetting('simulation.phase_out.threshold_low'));
  const thresholdMid =
    settings?.['simulation.phase_out.threshold_mid'] ??
    (await getSetting('simulation.phase_out.threshold_mid'));
  const thresholdHigh =
    settings?.['simulation.phase_out.threshold_high'] ??
    (await getSetting('simulation.phase_out.threshold_high'));

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.simulationFlag, false),
        inArray(campaigns.status, ['active', 'last_donor_zone']),
      ),
    );

  const realCampaigns = result.count;

  if (realCampaigns >= thresholdHigh) return 0.0;
  if (realCampaigns >= thresholdMid) return 0.3;
  if (realCampaigns >= thresholdLow) return 0.7;
  return 1.0;
}
