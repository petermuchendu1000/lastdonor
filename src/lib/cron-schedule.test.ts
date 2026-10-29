/**
 * Cron dispatch table.
 *
 * The scheduler reproduces nine `vercel.json` schedules from a single
 * 5-minute Cloudflare trigger (docs/65, docs/66). A predicate that drifts
 * would not throw; a job would simply run at the wrong rate, or stop. So the
 * tests here count ACTUAL firings across a simulated week and compare them
 * to the count the cron expression mandates, rather than spot-checking a
 * couple of timestamps.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { CRON_JOBS, dueJobs, TICK_MINUTES } from './cron-schedule';

/** Every tick in one UTC week, starting Sunday 2026-03-01T00:00Z. */
function weekOfTicks(): Date[] {
  const start = Date.UTC(2026, 2, 1, 0, 0, 0); // a Sunday
  const ticks: Date[] = [];
  const total = (7 * 24 * 60) / TICK_MINUTES;
  for (let i = 0; i < total; i++) {
    ticks.push(new Date(start + i * TICK_MINUTES * 60_000));
  }
  return ticks;
}

function firingsPerWeek(job: string): number {
  return weekOfTicks().filter((t) => dueJobs(t).some((j) => j.job === job)).length;
}

describe('the tick itself', () => {
  it('visits 2016 instants in a week', () => {
    expect(weekOfTicks()).toHaveLength(2016);
  });

  it('starts on a Sunday, so the weekly jobs are both exercised', () => {
    expect(weekOfTicks()[0].getUTCDay()).toBe(0);
  });
});

describe('each job fires exactly as often as its cron expression says', () => {
  // Hand-derived from the expression, NOT from the implementation.
  const EXPECTED: Record<string, number> = {
    'update-phases': 2016, //   */5    -> every tick
    'screen-documents': 2016, // */5  -> every tick
    'ingest-news': 336, //      */30   -> 48/day x 7
    'publish-campaigns': 336, // */30  -> 48/day x 7
    'fetch-news': 28, //        0 */6  -> 4/day x 7
    reconcile: 7, //            0 4    -> 1/day x 7
    'refresh-fx-rates': 7, //   0 2    -> 1/day x 7
    'verification-reminders': 7, // 0 9 -> 1/day x 7
    'payhero-float': 168, //   0 *    -> 1/hour x 24 x 7
    'blog-topics': 7, //        0 6    -> 1/day x 7
    'blog-generate': 7, //      0 8    -> 1/day x 7
    'send-newsletter': 1, //    0 14 * * 4 -> 1 Thursday
    'blog-refresh': 1, //       0 10 * * 0 -> 1 Sunday
  };

  for (const [job, expected] of Object.entries(EXPECTED)) {
    it(`${job} fires ${expected}x per week`, () => {
      expect(firingsPerWeek(job)).toBe(expected);
    });
  }

  it('covers every job in the table, so none is left unasserted', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(
      CRON_JOBS.map((j) => j.job).sort(),
    );
  });
});

describe('the weekly jobs land on the right day and hour', () => {
  it('send-newsletter fires on Thursday at 14:00 UTC', () => {
    const hit = weekOfTicks().find((t) =>
      dueJobs(t).some((j) => j.job === 'send-newsletter'),
    )!;
    expect(hit.getUTCDay()).toBe(4);
    expect(hit.getUTCHours()).toBe(14);
    expect(hit.getUTCMinutes()).toBe(0);
  });

  it('blog-refresh fires on Sunday at 10:00 UTC', () => {
    const hit = weekOfTicks().find((t) =>
      dueJobs(t).some((j) => j.job === 'blog-refresh'),
    )!;
    expect(hit.getUTCDay()).toBe(0);
    expect(hit.getUTCHours()).toBe(10);
  });
});

describe('the half-hourly jobs land only on :00 and :30', () => {
  it('never fires at :05, :10, :15, :20, :25 and so on', () => {
    const minutes = new Set(
      weekOfTicks()
        .filter((t) => dueJobs(t).some((j) => j.job === 'ingest-news'))
        .map((t) => t.getUTCMinutes()),
    );
    expect([...minutes].sort((a, b) => a - b)).toEqual([0, 30]);
  });
});

describe('fetch-news lands on the six-hour boundaries', () => {
  it('fires at 00, 06, 12 and 18 UTC only', () => {
    const hours = new Set(
      weekOfTicks()
        .filter((t) => dueJobs(t).some((j) => j.job === 'fetch-news'))
        .map((t) => t.getUTCHours()),
    );
    expect([...hours].sort((a, b) => a - b)).toEqual([0, 6, 12, 18]);
  });
});

describe('what is deliberately not scheduled', () => {
  /*
    simulate-donations writes seed donations into public totals behind the
    fail-closed SEED_DONATIONS_OPT_IN gate (docs/33, docs/41). It is a route
    and docs/26 mentions a cadence for it, but it is absent from vercel.json
    and must stay absent here: putting a money-writing job on a schedule is
    an owner's decision, not a side effect of repairing the scheduler.
  */
  it('never dispatches simulate-donations', () => {
    const everFired = weekOfTicks().some((t) =>
      dueJobs(t).some((j) => j.job === 'simulate-donations'),
    );
    expect(everFired).toBe(false);
  });
});

describe('UTC is read explicitly', () => {
  it('does not depend on the host timezone', () => {
    // 04:00 UTC is reconcile's slot whatever the machine's local offset is.
    const at4 = new Date('2026-03-02T04:00:00.000Z');
    expect(dueJobs(at4).map((j) => j.job)).toContain('reconcile');
    const at3 = new Date('2026-03-02T03:00:00.000Z');
    expect(dueJobs(at3).map((j) => j.job)).not.toContain('reconcile');
  });
});
