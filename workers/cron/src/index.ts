/**
 * LastDonor cron dispatcher.
 *
 * Replaces `vercel.json`'s `crons` array, which is Vercel-only and therefore
 * never ran a single job on Fly. See `docs/65` for how that was found and
 * `docs/66` for this design.
 *
 * ## Shape
 *
 * ONE Cloudflare trigger at `* / 5 * * * *`. The nine job schedules are
 * reproduced in `dueJobs()`, which is imported from the application's own
 * `src/lib/cron-schedule.ts` so `npm run test:unit` covers the deployed
 * behaviour rather than a copy of it.
 *
 * Nine native triggers is not an option: Cloudflare's limits page (VERIFIED
 * 2026-10-16) caps Cron Triggers at **5 per account** on the free plan, and
 * the cap is per account rather than per Worker.
 *
 * ## Why it targets `lastdonor.fly.dev`
 *
 * `docs/26` §4 specifies a grey-cloud `origin.lastdonor.com`. That hostname
 * does not resolve (checked 2026-10-16: connection failure, while
 * `lastdonor.fly.dev` answers 200 on `/api/v1/live`). Going straight to the
 * Fly hostname achieves what the grey cloud was for - it bypasses
 * Cloudflare's 100s proxy ceiling, which would otherwise truncate the seven
 * routes declared `maxDuration = 300`.
 *
 * ## Why the responses are not awaited
 *
 * The free plan allows **10 ms of CPU per cron trigger**. Waiting on a
 * socket is I/O and costs no CPU, but parsing bodies does. Each request is
 * handed to `waitUntil` and only its status line is read.
 *
 * Overlapping runs are safe: every cron handler takes an Upstash lock
 * (`src/lib/locks.ts`) and exits early if a previous invocation still holds
 * it.
 */
import { dueJobs } from '../../../src/lib/cron-schedule';

export interface Env {
  /** Origin to dispatch to, e.g. `https://lastdonor.fly.dev`. No trailing slash. */
  ORIGIN: string;
  /** Must equal the `CRON_SECRET` the Fly app verifies. */
  CRON_SECRET: string;
}

async function dispatch(env: Env, job: string): Promise<void> {
  const url = `${env.ORIGIN}/api/v1/cron/${job}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${env.CRON_SECRET}`,
        'User-Agent': 'lastdonor-cron-worker/1',
      },
    });

    if (res.status === 401 || res.status === 403) {
      // Loud on purpose: this is the failure that looks like "nothing is
      // happening" rather than like an error, which is exactly how the
      // scheduler stayed broken for so long.
      console.error(`[cron] ${job} REJECTED ${res.status} - CRON_SECRET mismatch between this Worker and Fly`);
      return;
    }
    if (!res.ok) {
      console.error(`[cron] ${job} failed ${res.status}`);
      return;
    }
    console.log(`[cron] ${job} ok ${res.status}`);
  } catch (err) {
    console.error(`[cron] ${job} threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export default {
  async scheduled(
    event: { scheduledTime: number },
    env: Env,
    ctx: { waitUntil: (p: Promise<unknown>) => void },
  ): Promise<void> {
    if (!env.CRON_SECRET || !env.ORIGIN) {
      console.error('[cron] missing CRON_SECRET or ORIGIN binding; dispatching nothing');
      return;
    }

    const now = new Date(event.scheduledTime);
    const jobs = dueJobs(now);
    console.log(`[cron] ${now.toISOString()} dispatching ${jobs.length}: ${jobs.map((j) => j.job).join(', ')}`);

    ctx.waitUntil(Promise.allSettled(jobs.map((j) => dispatch(env, j.job))));
  },
};
