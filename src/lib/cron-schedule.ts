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
    /*
      Exchange rates, once a day.

      02:00 UTC is deliberate. The primary provider publishes
      `time_last_update_utc` around 00:02 UTC and `time_next_update_utc`
      around 00:17 UTC (measured 2026-10-24), so 02:00 is comfortably after
      the new table exists without racing it. Running more often would spend
      requests against a rate-limited free endpoint for data that changes
      once a day - the provider's own documentation says an hourly request
      "will never get rate limited", and daily is well inside that.

      MAX_FX_AGE_HOURS is 48, so this cadence tolerates exactly one missed
      run before conversions stop being displayed. That relationship is the
      invariant: the refresh interval MUST be less than half the staleness
      tolerance, or a single failure takes the feature down.
    */
    job: 'refresh-fx-rates',
    cron: '0 2 * * *',
    isDue: ({ minute, hour }) => minute === 0 && hour === 2,
  },
  {
    /*
      Document pre-screening, every five minutes.

      Matched to the upload it follows, not to a provider's quota: an
      organiser who uploads a hospital bill should not wait an hour to find
      out it was read. The job takes a batch of five and does nothing at all
      when the queue is empty, so a five-minute cadence over an empty table
      costs one indexed query per tick.

      (Written in words, not as a cron expression: a slash-star comment cannot
      contain a star-slash, and the obvious spelling of this cadence ends the
      comment three lines early. It compiled as a syntax error here; in a
      place where the following lines happened to parse it would not have.)
    */
    job: 'screen-documents',
    cron: '*/5 * * * *',
    isDue: () => true,
  },
  {
    /*
      Verification reminders, once a day at 09:00 UTC.

      Daily, not hourly, and the cadence is a property of the DECISION not of
      the queue: `dueReminder` sends each of the four levels at most once per
      campaign for its whole life, and holds a 24-hour floor between any two
      sends to the same campaign. Running hourly would therefore send exactly
      the same emails, 23 times more often over an empty candidate set.

      09:00 UTC is noon in Nairobi and morning in most of the US daytime
      window - a reminder that asks somebody to find a photo ID is better
      read awake. Nothing depends on the hour; it is not racing another job.
    */
    job: 'verification-reminders',
    cron: '0 9 * * *',
    isDue: ({ minute, hour }) => minute === 0 && hour === 9,
  },
  {
    /*
      PayHero's fee float, hourly.

      The CHECK already existed in `/api/v1/health`, which could detect a low
      float and could not tell anybody - it reached whoever fetched the
      endpoint, plus a console line in Fly's log buffer, and [VERIFIED]
      `fly.toml:289` points Fly's own probe at `/api/v1/live` instead, so
      nothing escalated. This job evaluates the same predicate
      (`src/lib/payhero-float.ts`, read by both) and emails the
      administrators.

      Hourly, not daily, and the cadence follows from the arithmetic rather
      than from taste: the warn threshold is KES 500, the fee is a flat KES
      8.9, and the one drain rate ever measured is ~55 KES/hour (159.6 in
      2h53m on 2026-10-29, almost all of it the other company's traffic on the
      shared wallet - docs/147 §11.3). That is about nine hours from the
      threshold to empty, so a daily job could sleep through the entire
      window. Email volume is governed by LOW_FLOAT_EMAIL_COOLDOWN_HOURS, not
      by this cadence.
    */
    job: 'payhero-float',
    cron: '0 * * * *',
    isDue: ({ minute }) => minute === 0,
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
