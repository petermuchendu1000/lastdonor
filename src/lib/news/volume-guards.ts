/**
 * Volume guards for automated campaign creation.
 *
 * ── Why this module exists ─────────────────────────────────────────────────
 *
 * `runNewsPipeline` has always enforced three limits before inserting a
 * campaign (`news-pipeline.ts`: daily limit, `simulation.max_concurrent`, and
 * the phase-out floor). The two OTHER paths that publish campaigns did not:
 *
 *   - `/api/v1/cron/publish-campaigns` (batch, every 30 min per `vercel.json`)
 *   - `/api/v1/admin/news-feed/[id]/create-campaign` (the admin "Create" button)
 *
 * Both reach `publishCampaignFromNewsItem`, which enforced dedup and quality
 * but no volume limit at all. Observed consequence (2026-10-14): four manual
 * `publish-campaigns` runs created 12 campaigns, past a
 * `campaign_creation_daily_limit` of 10 and a `simulation.max_concurrent` of
 * 10, with nothing logged as rate-limited.
 *
 * The guards therefore live here and are called from
 * `publishCampaignFromNewsItem`, so every caller inherits them by default and
 * an override has to be written down at the call site
 * (`{ bypassVolumeGuards: true }`).
 *
 * ── Why counts are re-read per item rather than cached ────────────────────
 *
 * `news-pipeline` reads the counts once per run and adds its own
 * `campaignsCreatedThisRun` to them. That works inside one loop but is wrong
 * across concurrent callers (cron batch + an admin click). Re-reading is three
 * cheap aggregate queries per publish, against a path that already spends
 * 4-6 AI calls, so correctness is the better trade here.
 *
 * Every threshold below is a *setting*, not a hard cap: this module decides
 * nothing on its own, it only makes the existing settings apply everywhere.
 */

import 'server-only';

import { db } from '@/db';
import * as schema from '@/db/schema';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { getSetting } from '@/lib/settings.server';

/**
 * Fallback for `campaign_creation_daily_limit` when the row is absent.
 *
 * This key is NOT in `SETTING_DEFAULTS` (`src/lib/settings.ts`) - it is read
 * straight off `site_settings` - so the default has to live in code. Kept here
 * so `news-pipeline.ts` and this module cannot drift apart on it.
 */
export const DEFAULT_CAMPAIGN_DAILY_LIMIT = 10;

/** Fallback for `simulation.max_concurrent`, mirroring `SETTING_DEFAULTS`. */
export const DEFAULT_MAX_CONCURRENT_SIMULATED = 10;

export type VolumeGuardOutcome =
  | { allowed: true }
  | {
      allowed: false;
      /** Which guard refused, for the audit row and the caller's error. */
      guard: 'phase_out' | 'daily_limit' | 'max_concurrent';
      reason: string;
    };

/** Read `campaign_creation_daily_limit` off `site_settings`. */
async function readDailyLimit(): Promise<number> {
  const [row] = await db
    .select({ value: schema.siteSettings.value })
    .from(schema.siteSettings)
    .where(eq(schema.siteSettings.key, 'campaign_creation_daily_limit'));

  if (!row) return DEFAULT_CAMPAIGN_DAILY_LIMIT;

  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : DEFAULT_CAMPAIGN_DAILY_LIMIT;
}

/**
 * Check every volume limit that applies to creating one automated campaign.
 *
 * Ordered cheapest-refusal-first only incidentally; the real ordering rule is
 * that the phase-out floor comes first, because it is the one guard that means
 * "stop permanently", not "not right now".
 */
export async function checkCampaignVolumeGuards(): Promise<VolumeGuardOutcome> {
  // ── Guard 1: phase-out floor ───────────────────────────────────────────
  // `calculateAutoVolume()` returns 0 once enough REAL campaigns exist that
  // the simulation is meant to stop. Imported dynamically to match
  // `news-pipeline.ts` and keep this module importable from contexts that do
  // not need the seed subsystem.
  const { calculateAutoVolume } = await import('@/lib/seed/phase-out');
  const autoVolume = await calculateAutoVolume();
  if (autoVolume === 0) {
    return {
      allowed: false,
      guard: 'phase_out',
      reason:
        'Phase-out threshold reached: enough real campaigns are active that no ' +
        'new simulated campaigns should be created.',
    };
  }

  // ── Guard 2: campaigns created today ──────────────────────────────────
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const dailyLimit = await readDailyLimit();

  const [today] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.campaigns)
    .where(
      and(
        eq(schema.campaigns.source, 'automated'),
        gte(schema.campaigns.publishedAt, startOfDay),
      ),
    );

  const todayCount = today?.count ?? 0;
  if (todayCount >= dailyLimit) {
    return {
      allowed: false,
      guard: 'daily_limit',
      reason: `Daily campaign creation limit reached (${todayCount}/${dailyLimit} automated campaigns published today).`,
    };
  }

  // ── Guard 3: concurrent simulated campaigns ───────────────────────────
  const maxConcurrent =
    (await getSetting('simulation.max_concurrent')) ?? DEFAULT_MAX_CONCURRENT_SIMULATED;

  const [active] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.campaigns)
    .where(
      and(
        eq(schema.campaigns.simulationFlag, true),
        inArray(schema.campaigns.status, ['active', 'last_donor_zone']),
      ),
    );

  const activeCount = active?.count ?? 0;
  if (activeCount >= maxConcurrent) {
    return {
      allowed: false,
      guard: 'max_concurrent',
      reason: `Max concurrent simulated campaigns reached (${activeCount}/${maxConcurrent} active).`,
    };
  }

  return { allowed: true };
}
