import { CRON_JOBS } from './cron-schedule';

/*
  ─────────────────────────────────────────────────────────────────────────
  THE OPERATOR'S VIEW OF THE SCHEDULE IS DERIVED FROM IT.          docs/138
  ─────────────────────────────────────────────────────────────────────────

  `/admin/settings` used to hold its own hand-written list of seven jobs. It
  matched neither `CRON_JOBS` (twelve, and the only list that is bundled into
  the Worker) nor `vercel.json` (nine, and inert on Fly since docs/65). It
  omitted six real jobs, and its seventh row - `Process Donations`, on a
  fifteen-minute cadence - was in neither other list: no such route exists, and
  `PipelineMonitor.tsx` maps `cron.simulate_donations` to that very label, so
  the row was the one job this project deliberately does NOT schedule
  (docs/33, docs/41, docs/66), badged "Active".

  Deriving is what makes a job added tomorrow appear here with nothing to
  remember, and what makes `simulate-donations` absent for free.

  ⚠️ This lives in its own module rather than in `cron-schedule.ts` because
  that file is bundled into the Cloudflare Worker at `wrangler deploy` time
  (docs/66), which runs under a 10ms CPU ceiling. Display code does not
  belong in that bundle.
*/

/** A label a person reads, from the job slug. `blog-topics` -> `Blog Topics`. */
function labelFor(job: string): string {
  return job
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * The jobs the cron Worker is configured to dispatch, in schedule order.
 *
 * ⛔ These rows say what is SCHEDULED, never what has RUN. Do not add a
 * per-job "last run" badge sourced from `audit_logs`: docs/136 §10 measured
 * that signal and it is unreliable per job - `update-phases` wrote 22 rows
 * against 288 dispatches because it audits only when it changed something,
 * and `screen-documents` deliberately writes nothing when its queue is
 * empty. A liveness badge built on it would report "never ran" on the two
 * jobs that run most often. Liveness is readable from the Worker's own
 * observability log (docs/136 §4.1), not from here.
 */
export function cronScheduleRows(): { name: string; schedule: string }[] {
  return CRON_JOBS.map((j) => ({ name: labelFor(j.job), schedule: j.cron }));
}
