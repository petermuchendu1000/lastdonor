import 'server-only';

import { CRON_JOBS, TICK_MINUTES } from '@/lib/cron-schedule';
import {
  SEED_DONATIONS_OPT_IN_ENV,
  SEED_DONATIONS_OPT_IN_SENTINEL,
  seedDonationsOptedIn,
} from './simulation-engine';

/**
 * Whether the donation simulation can actually run, and if not, why
 * (docs/88 F9).
 *
 * ── What this is fixing ──────────────────────────────────────────────
 *
 * `/admin/simulation` offers a master switch, a volume slider, pause and
 * resume, phase-out thresholds, and a badge reading "Active". Nothing an
 * admin does there has ever caused a single seed donation, and the
 * screen said so nowhere. Toggle "Simulation Enabled", get "Settings
 * saved", watch nothing happen, forever.
 *
 * The audit (docs/88 F9) named two reasons. There are THREE, and they
 * are independent - clearing any two still leaves nothing running:
 *
 *   1. `SEED_DONATIONS_OPT_IN` is not set to the sentinel, so the cron
 *      route refuses with 403 before any write (docs/33, docs/41).
 *   2. `simulate-donations` is deliberately absent from `CRON_JOBS`, so
 *      even a healthy scheduler would never call it (docs/66).
 *   3. No scheduler exists yet: the Cloudflare Worker is built and
 *      tested but not deployed (docs/65, docs/66).
 *
 * ── Why this is computed and not written as copy ─────────────────────
 *
 * A hardcoded "this does not work yet" banner becomes a lie the day it
 * starts working, and nobody deletes a stale warning. Each blocker is
 * read from the thing that actually blocks: the environment variable,
 * the schedule table the deployed Worker imports, and the audit log the
 * crons write. When a blocker is cleared, its line disappears on the
 * next page load.
 *
 * ── Never print the value ────────────────────────────────────────────
 *
 * `optedIn` is a boolean derived from the env var. The value itself
 * never reaches the client: it is a deployment-level acknowledgement,
 * and the screen only needs to know whether it is present.
 */

/** The job that would have to be scheduled for any of this to run. */
export const SIMULATION_JOB = 'simulate-donations';

/**
 * How long without any cron activity before the scheduler is presumed
 * dead. The Worker's single trigger fires every `TICK_MINUTES` and
 * `update-phases` is due on every tick, so three missed ticks is a
 * confident call rather than a slow minute.
 */
export const SCHEDULER_STALE_AFTER_MS = TICK_MINUTES * 3 * 60 * 1000;

export interface SimulationBlocker {
  /** Stable id, for tests and for keying the list. */
  readonly id: 'not-opted-in' | 'not-scheduled' | 'no-scheduler';
  /** What is wrong, in one line. */
  readonly title: string;
  /** Why it is wrong, for a reader who has not read the docs. */
  readonly detail: string;
  /** What would clear it, and who can do it. */
  readonly fix: string;
}

export interface SimulationReadiness {
  /** True only when nothing at all stands in the way of a seed donation. */
  readonly canRun: boolean;
  readonly blockers: readonly SimulationBlocker[];
  /** Most recent cron run of any job, or null if none has ever run. */
  readonly schedulerLastRunAt: string | null;
}

/**
 * Build the readiness report.
 *
 * `schedulerLastRunAt` is passed in rather than queried here so this
 * module stays pure and the page keeps its database access in one
 * place - which matters on this page in particular, see the comment in
 * `src/app/admin/simulation/page.tsx` about pool exhaustion.
 */
export function getSimulationReadiness(
  schedulerLastRunAt: Date | null,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): SimulationReadiness {
  const blockers: SimulationBlocker[] = [];

  if (!seedDonationsOptedIn(env)) {
    blockers.push({
      id: 'not-opted-in',
      title: 'This deployment has not opted in to fabricated donations.',
      detail:
        'Seed donations are written into the same table and the same public ' +
        'campaign totals as real ones. The cron route refuses with 403 before ' +
        'any write until the host says otherwise.',
      fix:
        `Set ${SEED_DONATIONS_OPT_IN_ENV}=${SEED_DONATIONS_OPT_IN_SENTINEL} on the ` +
        'host, then redeploy. This is deliberately not a setting: it cannot be ' +
        'switched on from this screen, by an API call, or by a stolen admin ' +
        'session. See docs/33.',
    });
  }

  const scheduled = CRON_JOBS.some((j) => j.job === SIMULATION_JOB);
  if (!scheduled) {
    blockers.push({
      id: 'not-scheduled',
      title: `"${SIMULATION_JOB}" is not on the cron schedule.`,
      detail:
        'The route exists and works, but no schedule calls it, so a healthy ' +
        'scheduler would still never run it.',
      fix:
        'Add it to CRON_JOBS in src/lib/cron-schedule.ts and redeploy the ' +
        'Worker. Left out on purpose: putting a job that writes money-shaped ' +
        'rows on a timer is an owner decision, not a side effect of fixing ' +
        'the scheduler. See docs/66.',
    });
  }

  const lastRunMs = schedulerLastRunAt?.getTime() ?? null;
  const schedulerLive =
    lastRunMs !== null && now.getTime() - lastRunMs < SCHEDULER_STALE_AFTER_MS;

  if (!schedulerLive) {
    blockers.push({
      id: 'no-scheduler',
      title: 'No cron job has run recently, so nothing is driving any schedule.',
      detail:
        schedulerLastRunAt === null
          ? 'No cron job has ever recorded a run.'
          : `The most recent cron run of any job was ${schedulerLastRunAt.toISOString()}. ` +
            `A live scheduler ticks every ${TICK_MINUTES} minutes.`,
      fix:
        'Deploy the Worker in workers/cron. It is built and tested but has ' +
        'never been deployed, so none of the nine scheduled jobs has ever ' +
        'run in production. See docs/65 and docs/66.',
    });
  }

  return {
    canRun: blockers.length === 0,
    blockers,
    schedulerLastRunAt: schedulerLastRunAt?.toISOString() ?? null,
  };
}
