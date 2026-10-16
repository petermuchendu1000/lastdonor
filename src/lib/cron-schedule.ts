/**
 * Which cron jobs are due at a given minute.
 *
 * ## Why this exists in `src/` rather than inside the Worker
 *
 * It is the one piece of the scheduler with real logic, so it lives where
 * `npm run test:unit` can see it (`vitest.config.ts` includes only
 * `src/**`). `workers/cron/src/index.ts` imports this exact module, so the
 * tests cover the deployed behaviour rather than a copy of it.
 *
 * ## Why one trigger instead of nine
 *
 * VERIFIED against Cloudflare's own limits page on 2026-10-16:
 *
 *   "Number of Cron Triggers per account   Free 5   Paid 250"
 *   "CPU time per Cron Trigger             Free 10 ms"
 *
 * The cap is **per account**, not per Worker, so the nine triggers declared
 * in `vercel.json` cannot exist on the free plan at all. A single
 * `* / 5 * * * *` trigger that decides internally which jobs are due costs
 * one of the five, leaves four spare, and is the only shape that fits.
 *
 * The 10 ms CPU ceiling is why the Worker computes this table and then fires
 * requests without reading their bodies: `fetch` wait time is I/O, not CPU.
 *
 * ## Why the minute arithmetic is safe
 *
 * The trigger fires at minute 0, 5, 10 ... 55, so `minute % 30 === 0` lands
 * exactly on :00 and :30, and `minute === 0` lands exactly once an hour.
 * None of the nine schedules needs a minute the tick does not visit.
 *
 * See `docs/66`.
 */

/** Tick interval of the single Cloudflare trigger, in minutes. */
export const TICK_MINUTES = 5;

export interface CronJob {
  /** Path segment under `/api/v1/cron/`. */
  readonly job: string;
  /** The schedule this reproduces, as declared in `vercel.json`. */
  readonly cron: string;
  /** True when the job should run at this UTC instant. */
  readonly isDue: (utc: {
    minute: number;
    hour: number;
    /** 0 = Sunday. */
    weekday: number;
  }) => boolean;
}

/**
 * The nine jobs from `vercel.json`, which never ran because that file is
 * Vercel-only and this deploys to Fly (docs/65).
 *
 * `simulate-donations` is deliberately ABSENT. It exists as a route and
 * docs/26 mentions a 15-minute cadence, but it is not in `vercel.json`, and
 * it writes seed donations into public totals behind the fail-closed
 * `SEED_DONATIONS_OPT_IN` gate (docs/33, docs/41). Putting a money-writing
 * job on a schedule is an owner's decision, not a side effect of fixing the
 * scheduler.
 */
export const CRON_JOBS: readonly CronJob[] = [
  {
    job: 'update-phases',
    cron: '*/5 * * * *',
    isDue: () => true,
  },
  {
    job: 'ingest-news',
    cron: '*/30 * * * *',
    isDue: ({ minute }) => minute % 30 === 0,
  },
  {
    job: 'publish-campaigns',
    cron: '*/30 * * * *',
    isDue: ({ minute }) => minute % 30 === 0,
  },
  {
    job: 'fetch-news',
    cron: '0 */6 * * *',
    isDue: ({ minute, hour }) => minute === 0 && hour % 6 === 0,
  },
  {
    job: 'reconcile',
    cron: '0 4 * * *',
    isDue: ({ minute, hour }) => minute === 0 && hour === 4,
  },
  {
    job: 'blog-topics',
    cron: '0 6 * * *',
    isDue: ({ minute, hour }) => minute === 0 && hour === 6,
  },
  {
    job: 'blog-generate',
    cron: '0 8 * * *',
    isDue: ({ minute, hour }) => minute === 0 && hour === 8,
  },
  {
    job: 'send-newsletter',
    cron: '0 14 * * 4',
    isDue: ({ minute, hour, weekday }) =>
      minute === 0 && hour === 14 && weekday === 4,
  },
  {
    job: 'blog-refresh',
    cron: '0 10 * * 0',
    isDue: ({ minute, hour, weekday }) =>
      minute === 0 && hour === 10 && weekday === 0,
  },
];

/**
 * The jobs due at `date`, in UTC.
 *
 * Reads UTC getters explicitly. A Worker runs in UTC, but relying on that
 * implicitly would make the function untestable and would silently change
 * meaning if it ever ran anywhere else.
 */
export function dueJobs(date: Date): readonly CronJob[] {
  const utc = {
    minute: date.getUTCMinutes(),
    hour: date.getUTCHours(),
    weekday: date.getUTCDay(),
  };
  return CRON_JOBS.filter((j) => j.isDue(utc));
}
