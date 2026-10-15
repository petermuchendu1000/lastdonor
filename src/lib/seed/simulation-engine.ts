import { db } from '@/db';
import * as schema from '@/db/schema';
import { eq, and, sql, inArray, desc } from 'drizzle-orm';
import { seedAmountCents } from './amount-generator';
import { selectSimulatedDonor, maybeBuildCohort } from './donor-selector';
import { pickSeedMessage, generatePhaseTransitionMessages } from './message-generator';
import { getCampaignPhase } from '@/lib/utils/phase';
import { buildGenerateUpdatePrompt, buildPhaseTransitionTitle } from '@/lib/ai/prompts/generate-update';
import { buildGenerateImpactPrompt } from '@/lib/ai/prompts/generate-impact';
import { callAI } from '@/lib/ai/call-ai';
import { getActiveSurgeMultiplier, type SurgeState } from './trajectory-profiles';
import type { Campaign, DonationPhase, TrajectoryProfile, CampaignOrganizer, CampaignCategory, SimulationConfig } from '@/types';
import crypto from 'crypto';

export type SimulationResult = {
  campaignsProcessed: number;
  donationsCreated: number;
  phaseTransitions: number;
  completions: number;
  errors: string[];
};

/**
 * ── Structural opt-in for fabricated donations ────────────────────────────
 *
 * `docs/33` records an owner decision to run seed donations indistinguishably
 * from real ones, and an engineering refusal to implement it. Until 2026-10-15
 * that refusal rested on nothing but `SETTING_DEFAULTS['simulation.enabled']`
 * being `false` (`src/lib/settings.ts:122`) plus the absence of a scheduler -
 * i.e. one admin-UI checkbox, writable from `/api/v1/admin/simulation/settings`,
 * stood between a live deployment and fabricated money-shaped rows appearing in
 * public campaign totals. `vercel.json` shipped a quarter-hourly schedule for
 * it, so any Vercel deploy would have supplied the missing scheduler.
 *
 * The gate below is deliberately NOT a setting: it cannot be flipped from the
 * admin UI, by an API call, or by a compromised admin session - only by whoever
 * controls the deployment environment, who is the only party able to accept the
 * decision in docs/33 §2.
 *
 * It is also deliberately not a boolean. `=true` is the value someone copies in
 * by reflex while pattern-matching other flags (`BLOG_PIPELINE_ENABLED=false`);
 * the sentinel has to be typed on purpose and names what it switches on.
 */
export const SEED_DONATIONS_OPT_IN_ENV = 'SEED_DONATIONS_OPT_IN';

/** The only accepted value of `SEED_DONATIONS_OPT_IN`. */
export const SEED_DONATIONS_OPT_IN_SENTINEL = 'fabricated-donations-acknowledged';

/**
 * Whether this deployment has explicitly opted in to writing fabricated
 * donations. Read at call time, never cached, so a misconfiguration cannot be
 * frozen into a warm process.
 */
export function seedDonationsOptedIn(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[SEED_DONATIONS_OPT_IN_ENV]?.trim() === SEED_DONATIONS_OPT_IN_SENTINEL;
}

/** Human-readable refusal reason, for the cron response and the audit row. */
export const SEED_DONATIONS_REFUSAL_REASON =
  `Refused: fabricated donations write to donations.stripe_payment_id and into public ` +
  `campaign totals. This deployment has not opted in. Set ` +
  `${SEED_DONATIONS_OPT_IN_ENV}=${SEED_DONATIONS_OPT_IN_SENTINEL} to override ` +
  `(see docs/33). The simulation.enabled setting alone is not sufficient.`;

/** 15-minute cron window in milliseconds. */
const CYCLE_WINDOW_MS = 15 * 60 * 1000;

/** Maximum overfunding: 150% of the goal amount. */
export const OVERFUND_CAP_PERCENT = 1.50;

/** Overfunding window after goal is met: 48 hours in milliseconds. */
export const OVERFUND_WINDOW_MS = 48 * 60 * 60 * 1000;

// Time-of-day activity multipliers (ET, hour index 0-23)
const HOURLY_ACTIVITY: number[] = [
  0.10, 0.10, 0.10, 0.10, 0.10, 0.10, // 12am-5am
  0.40, 0.40, 0.40,                     // 6am-8am
  0.70, 0.70, 0.70,                     // 9am-11am
  0.60, 0.60,                           // 12pm-1pm
  0.80, 0.80, 0.80,                     // 2pm-4pm
  1.00, 1.00, 1.00,                     // 5pm-7pm
  0.90, 0.90,                           // 8pm-9pm
  0.30, 0.30,                           // 10pm-11pm
];

/** @internal Exported for testing. Get the current hour (0-23) in US Eastern Time, DST-aware. */
export function getETHour(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: 'America/New_York',
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  return h === 24 ? 0 : h; // midnight can be 24 in some implementations
}

/** @internal Exported for testing. Get the current day-of-week (0=Sun..6=Sat) in US Eastern Time, DST-aware. */
export function getETDay(now: Date = new Date()): number {
  const dayStr = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'America/New_York',
  }).formatToParts(now).find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[dayStr] ?? 1;
}

function getHourlyMultiplier(): number {
  const now = new Date();
  const etHour = getETHour(now);
  const hourlyMultiplier = HOURLY_ACTIVITY[etHour] ?? 0.5;

  const etDay = getETDay(now);
  const isWeekend = etDay === 0 || etDay === 6;
  const weekendMultiplier = isWeekend ? 1.2 : 1.0;

  return hourlyMultiplier * weekendMultiplier;
}

/**
 * Determine whether this campaign should receive donations this cycle.
 *
 * Profile-driven: `profile.baseDonateChance Ã- phaseMultiplier Ã- hourlyMultiplier Ã- surgeMultiplier`.
 * Falls back to legacy flat-probability if no profile exists (pre-Milestone-1 campaigns).
 */
function shouldDonateThisCycle(
  campaign: Campaign,
  profile: TrajectoryProfile | null,
  currentPhase: DonationPhase,
  surgeMultiplier: number,
  volumeMultiplier: number,
): boolean {
  const hourly = getHourlyMultiplier();

  if (!profile) {
    // Legacy path for campaigns created before profile assignment
    const percent = campaign.goalAmount > 0
      ? (campaign.raisedAmount / campaign.goalAmount) * 100
      : 0;
    const ageMs = Date.now() - new Date(campaign.publishedAt ?? campaign.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    let baseChance: number;
    if (ageDays <= 3) baseChance = 0.60;
    else if (percent > 75) baseChance = 0.80;
    else baseChance = 0.40;
    return Math.random() < baseChance * hourly * volumeMultiplier;
  }

  const phaseMultiplier = profile.phaseMultipliers[currentPhase] ?? 1.0;
  const effectiveChance = profile.baseDonateChance * phaseMultiplier * hourly * surgeMultiplier * volumeMultiplier;

  return Math.random() < Math.min(effectiveChance, 1.0);
}

/**
 * How many donations to create this cycle.
 *
 * Profile-driven: uniform random in [min, max] from profile.donationsPerCycle.
 * Falls back to legacy 1-3 distribution if no profile exists.
 */
function donationCountThisCycle(profile: TrajectoryProfile | null, surgeMultiplier: number): number {
  if (!profile) {
    const rand = Math.random();
    if (rand < 0.6) return 1;
    if (rand < 0.9) return 2;
    return 3;
  }

  const { min, max } = profile.donationsPerCycle;
  const base = min + Math.floor(Math.random() * (max - min + 1));

  // During surges, multiply the count (rounded up, minimum 1 extra)
  if (surgeMultiplier > 1) {
    return Math.max(base, Math.ceil(base * surgeMultiplier));
  }

  return base;
}

/**
 * Generate a jittered timestamp spread across the 15-minute cron window.
 * Prevents all donations from a cycle sharing the exact same createdAt.
 */
function jitteredTimestamp(cycleStart: Date): Date {
  const offsetMs = Math.floor(Math.random() * CYCLE_WINDOW_MS);
  return new Date(cycleStart.getTime() + offsetMs);
}

/**
 * Calculate campaign age in 15-min cycles since publish.
 */
function campaignAgeCycles(campaign: Campaign): number {
  const publishedAt = campaign.publishedAt ?? campaign.createdAt;
  const ageMs = Date.now() - new Date(publishedAt).getTime();
  return Math.floor(ageMs / CYCLE_WINDOW_MS);
}

/**
 * Check whether a campaign can still accept donations.
 *
 * - Pre-goal: always yes (status is 'active' or 'last_donor_zone')
 * - Post-goal: yes if within the 48-hour overfunding window AND under 150% cap
 */
/** @internal Exported for testing. */
export function canAcceptDonation(campaign: Campaign): boolean {
  if (campaign.raisedAmount < campaign.goalAmount) return true;

  // Post-goal overfunding checks
  const completedAt = campaign.completedAt ? new Date(campaign.completedAt) : null;
  if (!completedAt) {
    // Goal just crossed this cycle but handleCompletion hasn't run yet â€” allow
    return campaign.raisedAmount < campaign.goalAmount * OVERFUND_CAP_PERCENT;
  }

  const elapsed = Date.now() - completedAt.getTime();
  if (elapsed > OVERFUND_WINDOW_MS) return false;

  return campaign.raisedAmount < campaign.goalAmount * OVERFUND_CAP_PERCENT;
}

// â”€â”€ Transactional seed-donation write â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** One simulated donation's worth of work, as it is written to the database. */
type SeedDonationWrite = {
  campaignId: string;
  amountCents: number;
  donorName: string;
  donorEmail: string;
  donorLocation: string | null;
  message: string | null;
  isAnonymous: boolean;
  phase: DonationPhase;
  createdAt: Date;
  /** Display name on the public message wall ('Anonymous' when anonymous). */
  wallDonorName: string;
  wallDonorLocation: string | null;
};

/**
 * Write one simulated donation, its message-wall mirror and the campaign tally
 * as a **single transaction**, and enforce the overfund cap in the database.
 *
 * Remediation P1-11 (`docs/29` / `docs/31` §2.4). These were three
 * un-transacted statements, which gave two distinct failure modes:
 *
 *  1. A mid-run failure (or a machine killed at `maxDuration`) between them left
 *     a donation row with no tally increment, or a tally increment with no
 *     message — silent, permanent drift that only `cron/reconcile` would later
 *     notice.
 *  2. The cap was checked by `canAcceptDonation` against `campaign`, an
 *     **in-memory copy** mutated locally through the loop. Two overlapping cron
 *     runs each hold their own copy, so both believe there is room and the 150%
 *     overfund cap is breached.
 *
 * The conditional `UPDATE` fixes (2) properly: the predicate re-evaluates
 * `canAcceptDonation`'s conditions against committed state, and taking the
 * campaign row lock first serialises concurrent writers on the same campaign.
 * The cron lock in `src/lib/locks.ts` is the first line of defence; this is the
 * one that holds when the lock backend is degraded.
 *
 * The predicate deliberately mirrors `canAcceptDonation` exactly — "allowed to
 * *start* a donation while still under the cap" — rather than "the result must
 * stay under the cap", so the goal-crossing / last-donor behaviour is unchanged.
 *
 * No external I/O inside the transaction (message and donor selection happen
 * before it), preserving the property `docs/29` §7 verified for all 17 existing
 * transactions.
 *
 * @returns `true` when committed; `false` when the database refused the tally
 *   because the cap or the overfund window had been reached, in which case
 *   nothing at all was written.
 */
async function commitSeedDonation(write: SeedDonationWrite): Promise<boolean> {
  return db.transaction(async (tx) => {
    // 1. Tally first: takes the campaign row lock and re-checks the cap against
    //    committed state, not the caller's stale in-memory copy.
    const updated = await tx
      .update(schema.campaigns)
      .set({
        raisedAmount: sql`${schema.campaigns.raisedAmount} + ${write.amountCents}`,
        donorCount: sql`${schema.campaigns.donorCount} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.campaigns.id, write.campaignId),
          sql`${schema.campaigns.raisedAmount} < ${schema.campaigns.goalAmount} * ${OVERFUND_CAP_PERCENT}`,
          sql`(${schema.campaigns.completedAt} IS NULL OR ${schema.campaigns.completedAt} > now() - (${OVERFUND_WINDOW_MS / 1000} * interval '1 second'))`,
        ),
      )
      .returning({ id: schema.campaigns.id });

    if (updated.length === 0) return false;

    // 2. The donation itself.
    const [donationRecord] = await tx
      .insert(schema.donations)
      .values({
        campaignId: write.campaignId,
        stripePaymentId: generateSeedPaymentId(),
        amount: write.amountCents,
        donorName: write.donorName,
        donorEmail: write.donorEmail,
        donorLocation: write.donorLocation,
        message: write.message ?? undefined,
        isAnonymous: write.isAnonymous,
        phaseAtTime: write.phase,
        source: 'seed',
        createdAt: write.createdAt,
      })
      .returning({ id: schema.donations.id });

    // 3. Mirror the message onto the public wall.
    if (write.message) {
      await tx.insert(schema.campaignMessages).values({
        campaignId: write.campaignId,
        donorName: write.wallDonorName,
        donorLocation: write.wallDonorLocation,
        message: write.message,
        isAnonymous: write.isAnonymous,
        donationId: donationRecord.id,
        createdAt: write.createdAt,
      });
    }

    return true;
  });
}

// â”€â”€ Realistic seed-data generators â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Prefix for seed-donation payment identifiers.
 *
 * `donations.stripe_payment_id` carries a UNIQUE index
 * (`idx_donations_stripe_payment_id` in the migrations-v2 baseline) and
 * `payment-service.ts` relies on it via
 * `onConflictDoNothing({ target: donations.stripePaymentId })`. That index is
 * the ONLY replay protection against a duplicated Stripe webhook, so the
 * namespace it governs belongs to Stripe alone.
 *
 * Until 2026-10-15 the simulation minted `pi_` + 24 random alphanumerics into
 * that column, which put fabricated rows inside Stripe's own id space. A
 * collision there is silent and unrecoverable in the worst direction: the
 * `onConflictDoNothing` would swallow a REAL PaymentIntent whose id already sat
 * in the table as a seed row, leaving Stripe holding the money and the database
 * holding no donation. (`0014_dual_campaign_system.sql:77-79`, in the inert
 * `migrations/` directory, had deliberately rewritten `seed_` ids INTO `pi_`
 * form for realism; that is the change being reversed here.)
 *
 * `seed_<uuid>` instead:
 *   - still satisfies the UNIQUE constraint (v4 UUID collision is ~2^-122);
 *   - cannot collide with a Stripe id, since Stripe ids are `pi_`-prefixed;
 *   - makes every fabricated row greppable in SQL (`LIKE 'seed_%'`), which the
 *     purge/launch-gate options in docs/33 §6 need.
 */
export const SEED_PAYMENT_ID_PREFIX = 'seed_';

/**
 * @internal Exported for testing. Mint a payment identifier for a SEED
 * donation. Deliberately NOT Stripe-shaped - see `SEED_PAYMENT_ID_PREFIX`.
 */
export function generateSeedPaymentId(): string {
  return `${SEED_PAYMENT_ID_PREFIX}${crypto.randomUUID()}`;
}

/** True when `id` was minted by the simulation rather than by Stripe. */
export function isSeedPaymentId(id: string): boolean {
  return id.startsWith(SEED_PAYMENT_ID_PREFIX);
}

export const EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'icloud.com', 'aol.com', 'protonmail.com', 'mail.com',
];

/** @internal Exported for testing. Generate a realistic-looking email from a donor display name. */
export function generateRealisticEmail(donorName: string): string {
  const slug = donorName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12) || 'donor';
  const suffix = crypto.randomBytes(3).toString('hex');
  const domain = EMAIL_DOMAINS[Math.floor(Math.random() * EMAIL_DOMAINS.length)];
  return `${slug}${suffix}@${domain}`;
}

/**
 * Run simulation for active simulated campaigns.
 *
 * @param volumeMultiplier Global volume multiplier from settings (0.0â€“1.0).
 */
export async function runSimulation(volumeMultiplier = 1.0): Promise<SimulationResult> {
  const cycleStart = new Date();

  const result: SimulationResult = {
    campaignsProcessed: 0,
    donationsCreated: 0,
    phaseTransitions: 0,
    completions: 0,
    errors: [],
  };

  // Query only simulated active/LDZ campaigns
  const activeCampaigns = await db
    .select()
    .from(schema.campaigns)
    .where(
      and(
        inArray(schema.campaigns.status, ['active', 'last_donor_zone']),
        eq(schema.campaigns.simulationFlag, true),
      ),
    );

  for (const campaign of activeCampaigns) {
    try {
      // Per-campaign pause check
      const simConfig = campaign.simulationConfig as SimulationConfig | null;
      if (simConfig?.paused) continue;

      result.campaignsProcessed++;

      // Per-campaign volume override takes precedence over global multiplier
      const effectiveVolume = simConfig?.volumeOverride ?? volumeMultiplier;

      const profile = (campaign.campaignProfile as TrajectoryProfile) ?? null;
      const currentPercent = campaign.goalAmount > 0
        ? (campaign.raisedAmount / campaign.goalAmount) * 100
        : 0;
      const ageCycles = campaignAgeCycles(campaign);

      // Load persisted surge state (survives across cron runs)
      const surgeState: SurgeState = { ...(simConfig?.surgeState ?? {}) };

      // Compute surge multiplier using persisted state with duration tracking
      const surgeMultiplier = profile
        ? getActiveSurgeMultiplier(profile, currentPercent, ageCycles, surgeState)
        : 1.0;

      const currentPhase = getCampaignPhase(campaign.raisedAmount, campaign.goalAmount);

      if (!shouldDonateThisCycle(campaign, profile, currentPhase, surgeMultiplier, effectiveVolume)) continue;

      const count = donationCountThisCycle(profile, surgeMultiplier);
      const previousPhase = currentPhase;
      const amountTier = profile?.amountTier ?? 'mid';

      // Track whether this campaign just crossed its goal during this cycle
      const wasAlreadyFunded = campaign.raisedAmount >= campaign.goalAmount;
      let goalCrossingDonorName: string | null = null;
      let goalCrossingDonorAmount: number | null = null;

      for (let i = 0; i < count; i++) {
        // Stop if overfunding cap reached or overfunding window expired
        if (!canAcceptDonation(campaign)) break;

        const amountCents = seedAmountCents(amountTier);
        let donor = await selectSimulatedDonor(campaign);

        // If this donation will cross the goal, ensure the last donor is NOT anonymous
        const willCrossGoal = !wasAlreadyFunded
          && campaign.raisedAmount < campaign.goalAmount
          && campaign.raisedAmount + amountCents >= campaign.goalAmount;

        if (willCrossGoal && donor.isAnonymous) {
          // Re-roll up to 5 times to get a named donor for the last-donor moment
          for (let attempt = 0; attempt < 5; attempt++) {
            donor = await selectSimulatedDonor(campaign);
            if (!donor.isAnonymous) break;
          }
          // If still anonymous after 5 attempts, force non-anonymous
          if (donor.isAnonymous) {
            donor = { ...donor, isAnonymous: false };
          }
        }

        const phase = getCampaignPhase(campaign.raisedAmount, campaign.goalAmount);
        const message = await pickSeedMessage(campaign.id, phase);
        const donationTime = jitteredTimestamp(cycleStart);

        // Donation + message-wall mirror + campaign tally in ONE transaction,
        // with the overfund cap enforced against committed state (P1-11).
        const committed = await commitSeedDonation({
          campaignId: campaign.id,
          amountCents,
          donorName: donor.displayName,
          donorEmail: generateRealisticEmail(donor.displayName),
          donorLocation: donor.displayLocation || null,
          message: message ?? null,
          isAnonymous: donor.isAnonymous,
          phase,
          createdAt: donationTime,
          wallDonorName: donor.isAnonymous ? 'Anonymous' : donor.displayName,
          wallDonorLocation: donor.isAnonymous ? null : (donor.displayLocation || null),
        });

        // The database refused the tally: the cap or overfund window was reached
        // by a writer we could not see. Stop this campaign's cycle - the stale
        // in-memory total says there is room, and there is not.
        if (!committed) break;

        // Update local reference for subsequent iterations
        campaign.raisedAmount += amountCents;
        campaign.donorCount += 1;

        result.donationsCreated++;

        // Record the goal-crossing donor
        if (willCrossGoal) {
          goalCrossingDonorName = donor.displayName;
          goalCrossingDonorAmount = amountCents;
        }
      }

      // â”€â”€ Cohort injection â”€â”€
      // Occasionally inject a group of donors that form a visible pattern
      const cohort = maybeBuildCohort(campaign);
      if (cohort && canAcceptDonation(campaign)) {
        // For workplace_match, all donors donate the same amount
        const sharedWorkplaceAmount = cohort.type === 'workplace_match'
          ? seedAmountCents(amountTier)
          : 0;

        for (let ci = 0; ci < cohort.donors.length; ci++) {
          if (!canAcceptDonation(campaign)) break;

          const cohortAmount = cohort.type === 'workplace_match'
            ? sharedWorkplaceAmount
            : seedAmountCents(amountTier);

          let cohortDonor = cohort.donors[ci];

          // Check if this cohort donation crosses the goal
          const willCrossGoal = !wasAlreadyFunded
            && goalCrossingDonorName === null
            && campaign.raisedAmount < campaign.goalAmount
            && campaign.raisedAmount + cohortAmount >= campaign.goalAmount;

          // Ensure last donor is not anonymous
          if (willCrossGoal && cohortDonor.isAnonymous) {
            cohortDonor = { ...cohortDonor, isAnonymous: false };
          }

          const cohortPhase = getCampaignPhase(campaign.raisedAmount, campaign.goalAmount);
          const cohortMessage = await pickSeedMessage(campaign.id, cohortPhase);

          // For family chains, stagger timestamps; otherwise cluster within cron window
          let cohortTime: Date;
          if (cohort.type === 'family_chain' && cohort.staggerMs) {
            // Clamp family chain stagger to the cron window
            const staggerOffset = Math.min(ci * cohort.staggerMs, CYCLE_WINDOW_MS - 1);
            cohortTime = new Date(cycleStart.getTime() + staggerOffset);
          } else {
            // Community/workplace: cluster within the 15-min cron window
            const clusterOffsetMs = Math.floor(Math.random() * CYCLE_WINDOW_MS);
            cohortTime = new Date(cycleStart.getTime() + clusterOffsetMs);
          }

          // Same single-transaction, cap-guarded write as the main loop (P1-11).
          const cohortCommitted = await commitSeedDonation({
            campaignId: campaign.id,
            amountCents: cohortAmount,
            donorName: cohortDonor.displayName,
            donorEmail: generateRealisticEmail(cohortDonor.displayName),
            donorLocation: cohortDonor.displayLocation || null,
            message: cohortMessage ?? null,
            isAnonymous: cohortDonor.isAnonymous,
            phase: cohortPhase,
            createdAt: cohortTime,
            wallDonorName: cohortDonor.isAnonymous ? 'Anonymous' : cohortDonor.displayName,
            wallDonorLocation: cohortDonor.isAnonymous ? null : (cohortDonor.displayLocation || null),
          });

          if (!cohortCommitted) break;

          campaign.raisedAmount += cohortAmount;
          campaign.donorCount += 1;
          result.donationsCreated++;

          // Record the goal-crossing donor
          if (willCrossGoal) {
            goalCrossingDonorName = cohortDonor.displayName;
            goalCrossingDonorAmount = cohortAmount;
          }
        }
      }

      // Check phase transition
      const newPhase = getCampaignPhase(campaign.raisedAmount, campaign.goalAmount);
      if (newPhase !== previousPhase) {
        result.phaseTransitions++;
        await handlePhaseTransition(campaign, newPhase);
      }

      // Check completion - only trigger once when we first cross the goal this cycle
      if (!wasAlreadyFunded && campaign.raisedAmount >= campaign.goalAmount) {
        await handleCompletion(campaign, goalCrossingDonorName, goalCrossingDonorAmount);
        result.completions++;
      }

      // Persist updated surge state so duration tracking survives across cron runs
      if (profile && Object.keys(surgeState).length > 0) {
        const updatedConfig: SimulationConfig = {
          ...(simConfig ?? { paused: false, fundAllocation: 'pool' }),
          surgeState,
        };
        await db
          .update(schema.campaigns)
          .set({ simulationConfig: updatedConfig })
          .where(eq(schema.campaigns.id, campaign.id));
      }

    } catch (error) {
      result.errors.push(`Simulation error for campaign ${campaign.id}: ${String(error)}`);
    }
  }

  return result;
}

/**
 * Handle phase transition: update campaign status, generate update post,
 * and pre-fill messages for the new phase.
 */
async function handlePhaseTransition(campaign: Campaign, newPhase: DonationPhase): Promise<void> {
  // Update status if entering last_donor_zone
  if (newPhase === 'last_donor_zone') {
    await db
      .update(schema.campaigns)
      .set({ status: 'last_donor_zone' })
      .where(eq(schema.campaigns.id, campaign.id));
  }

  // Generate phase-transition seed messages for the new phase (fire-and-forget)
  generatePhaseTransitionMessages(campaign, newPhase).catch((err) =>
    console.error(`Phase transition message generation failed for ${campaign.id}:`, err),
  );

  // Gather context for enriched update prompt
  const percentage = Math.floor((campaign.raisedAmount / campaign.goalAmount) * 100);
  const publishedAt = campaign.publishedAt ?? campaign.createdAt;
  const campaignAgeDays = Math.floor(
    (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24),
  );
  const organizer = campaign.campaignOrganizer as CampaignOrganizer | null;

  // Fetch previous updates for context continuity
  const previousUpdates = await db
    .select({ title: schema.campaignUpdates.title })
    .from(schema.campaignUpdates)
    .where(eq(schema.campaignUpdates.campaignId, campaign.id))
    .orderBy(desc(schema.campaignUpdates.createdAt))
    .limit(3);

  // Get story summary (strip HTML, first 200 chars)
  const storySummary = campaign.storyHtml
    .replace(/<[^>]+>/g, '')
    .slice(0, 200)
    .trim();

  const prompt = buildGenerateUpdatePrompt({
    subjectName: campaign.subjectName,
    phase: newPhase,
    percentage,
    raisedAmount: campaign.raisedAmount,
    goalAmount: campaign.goalAmount,
    campaignAgeDays,
    donorCount: campaign.donorCount,
    storySummary,
    previousUpdates: previousUpdates.map((u) => u.title),
    organizer: organizer ?? undefined,
  });

  try {
    const updateText = await callAI<string>({
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      parseJson: false,
      promptType: 'generate-update',
      campaignId: campaign.id,
    });

    const title = buildPhaseTransitionTitle(
      campaign.subjectName,
      newPhase,
      previousUpdates.map((u) => u.title),
    );

    await db.insert(schema.campaignUpdates).values({
      campaignId: campaign.id,
      title,
      bodyHtml: `<p>${updateText}</p>`,
      updateType: 'phase_transition',
    });
  } catch (error) {
    console.error(`Phase transition update generation failed for ${campaign.id}:`, error);
  }

  // Log audit
  await db.insert(schema.auditLogs).values({
    eventType: 'campaign.phase_transition',
    targetType: 'campaign',
    targetId: campaign.id,
    severity: 'info',
    details: {
      newPhase,
      percentage: Math.floor((campaign.raisedAmount / campaign.goalAmount) * 100),
      raisedAmount: campaign.raisedAmount,
    },
  });
}

/**
 * Handle campaign completion: record last donor, generate celebration update,
 * organizer thank-you, and schedule impact report.
 */
async function handleCompletion(
  campaign: Campaign,
  lastDonorName: string | null,
  lastDonorAmount: number | null,
): Promise<void> {
  const completedAt = new Date();

  // Persist completion status and last donor details
  await db
    .update(schema.campaigns)
    .set({
      status: 'completed',
      completedAt,
      lastDonorName: lastDonorName ?? undefined,
      lastDonorAmount: lastDonorAmount ?? undefined,
      updatedAt: completedAt,
    })
    .where(eq(schema.campaigns.id, campaign.id));

  // Update local reference so subsequent code sees the new state
  campaign.completedAt = completedAt;

  // â”€â”€ 1. AI-generated celebration update â”€â”€
  try {
    const donorMention = lastDonorName
      ? ` Thanks to ${lastDonorName}'s generous donation of $${((lastDonorAmount ?? 0) / 100).toLocaleString()}, the campaign crossed the finish line!`
      : '';

    const celebrationPrompt = {
      systemPrompt: `You write celebration updates for a nonprofit fundraising platform. Write a short, warm, celebratory post (2-3 paragraphs). Mention the subject by name, the total raised, donor count, and the last donor if provided. Return ONLY plain text paragraphs separated by blank lines, no formatting.`,
      userPrompt: `Campaign "${campaign.subjectName}" has been fully funded!
Goal: $${(campaign.goalAmount / 100).toLocaleString()}
Raised: $${(campaign.raisedAmount / 100).toLocaleString()}
Total Donors: ${campaign.donorCount}
${lastDonorName ? `Last Donor: ${lastDonorName} ($${((lastDonorAmount ?? 0) / 100).toLocaleString()})` : ''}

Write a celebration post announcing the campaign has reached its goal.`,
    };

    const celebrationText = await callAI<string>({
      systemPrompt: celebrationPrompt.systemPrompt,
      userPrompt: celebrationPrompt.userPrompt,
      parseJson: false,
      promptType: 'generate-celebration',
      campaignId: campaign.id,
    });

    const celebrationHtml = celebrationText
      .split('\n\n')
      .filter(Boolean)
      .map((p) => `<p>${p.trim()}</p>`)
      .join('\n');

    await db.insert(schema.campaignUpdates).values({
      campaignId: campaign.id,
      title: `${campaign.subjectName}'s campaign is fully funded!${donorMention ? ' ðŸŽ‰' : ''}`,
      bodyHtml: celebrationHtml,
      updateType: 'celebration',
    });
  } catch (error) {
    console.error(`Celebration update failed for ${campaign.id}:`, error);
    // Fallback: insert a simple completion update so the campaign always has one
    await db.insert(schema.campaignUpdates).values({
      campaignId: campaign.id,
      title: `${campaign.subjectName}'s campaign is fully funded!`,
      bodyHtml: `<p>${campaign.subjectName}'s campaign has reached its goal of $${(campaign.goalAmount / 100).toLocaleString()}! Thank you to every single donor who made this possible.</p>`,
      updateType: 'completion',
    });
  }

  // â”€â”€ 2. Organizer thank-you update â”€â”€
  const organizer = campaign.campaignOrganizer as CampaignOrganizer | null;
  if (organizer) {
    generateOrganizerThankYou(campaign, organizer, lastDonorName).catch((err) =>
      console.error(`Organizer thank-you failed for ${campaign.id}:`, err),
    );
  }

  // â”€â”€ 3. Impact report (fire-and-forget, conceptually delayed) â”€â”€
  generateImpactReport(campaign, lastDonorName).catch((err) =>
    console.error(`Impact report generation failed for ${campaign.id}:`, err),
  );

  // â”€â”€ 4. Audit log â”€â”€
  await db.insert(schema.auditLogs).values({
    eventType: 'campaign.completed',
    targetType: 'campaign',
    targetId: campaign.id,
    severity: 'info',
    details: {
      raisedAmount: campaign.raisedAmount,
      goalAmount: campaign.goalAmount,
      donorCount: campaign.donorCount,
      lastDonorName,
      lastDonorAmount,
    },
  });
}

/**
 * Generate an organizer thank-you update for a completed campaign.
 */
async function generateOrganizerThankYou(
  campaign: Campaign,
  organizer: CampaignOrganizer,
  lastDonorName: string | null,
): Promise<void> {
  const thankYouText = await callAI<string>({
    systemPrompt: `You write thank-you messages from a campaign organizer on a nonprofit fundraising platform. Write in first person as ${organizer.name} (${organizer.relation} of ${campaign.subjectName}, from ${organizer.city}). Be heartfelt, personal, and grateful. 1-2 short paragraphs. Return ONLY plain text, no formatting.`,
    userPrompt: `Write a thank-you message from ${organizer.name} now that ${campaign.subjectName}'s campaign has been fully funded.
Goal: $${(campaign.goalAmount / 100).toLocaleString()}
Raised: $${(campaign.raisedAmount / 100).toLocaleString()}
Donors: ${campaign.donorCount}
${lastDonorName ? `Last Donor (the one who completed the campaign): ${lastDonorName}` : ''}

Thank all donors warmly. If a last donor name is provided, give them a special mention.`,
    parseJson: false,
    promptType: 'generate-thank-you',
    campaignId: campaign.id,
  });

  const bodyHtml = thankYouText
    .split('\n\n')
    .filter(Boolean)
    .map((p) => `<p>${p.trim()}</p>`)
    .join('\n');

  await db.insert(schema.campaignUpdates).values({
    campaignId: campaign.id,
    title: `A message from ${organizer.name}: Thank you`,
    bodyHtml,
    updateType: 'thank_you',
  });
}

/**
 * Generate an impact report for a completed campaign.
 * Uses the generate-impact prompt to create a 3-paragraph report
 * covering recap, disbursement plan, and thank-you.
 */
async function generateImpactReport(
  campaign: Campaign,
  lastDonorName: string | null,
): Promise<void> {
  const category = (campaign.category as CampaignCategory) ?? 'community';

  // Derive the event from the story (first sentence, cleaned of HTML)
  const storyText = campaign.storyHtml.replace(/<[^>]+>/g, '').trim();
  const event = storyText.slice(0, 120) || `${campaign.subjectName}'s campaign`;

  const prompt = buildGenerateImpactPrompt({
    subjectName: campaign.subjectName,
    event,
    category,
    goalAmount: campaign.goalAmount,
    raisedAmount: campaign.raisedAmount,
    donorCount: campaign.donorCount,
    lastDonorName: lastDonorName ?? undefined,
  });

  const impactText = await callAI<string>({
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    parseJson: false,
    promptType: 'generate-impact',
    campaignId: campaign.id,
  });

  const bodyHtml = impactText
    .split('\n\n')
    .filter(Boolean)
    .map((p) => `<p>${p.trim()}</p>`)
    .join('\n');

  await db.insert(schema.campaignUpdates).values({
    campaignId: campaign.id,
    title: `Impact Report: ${campaign.subjectName}'s Campaign`,
    bodyHtml,
    updateType: 'impact_report',
  });
}
