import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { resolve } from 'node:path';
import { CRON_JOBS } from '@/lib/cron-schedule';
import { cronScheduleRows } from '@/lib/cron-schedule-display';

/*
  ─────────────────────────────────────────────────────────────────────────
  THE SETTINGS SCREEN MAY NOT CLAIM MORE THAN THE SYSTEM DOES.    docs/138
  ─────────────────────────────────────────────────────────────────────────

  Two defects, both on `/admin/settings`:

  1. A key saved through "Environment Configuration" is encrypted into
     `site_settings` as `env.<KEY>` and read by NOTHING. `resolveEnvVar`
     (`settings.server.ts`) is its only reader, and its only call site is the
     GET that draws this very screen; the consumers take `process.env`
     directly (`stripe.ts`, `resend.ts`), and nothing copies the database
     value into `process.env` at boot. The badge nevertheless said "Custom"
     in a PRIMARY variant, which reads as "this is what the platform uses".

     ⛔ An owner fixing the dead Stripe credential of `docs/72` through this
     screen would have seen it go green and believed it fixed.

  2. Both settings routes wrote `audit_logs.actor_ip` from the RAW
     `x-forwarded-for`, whose left-most entry is whatever the caller typed -
     on the most sensitive write in the product. `getClientIp` exists for
     exactly this (`docs/105`) and 8 of the 10 `actorIp` sites already used
     it.

  ⚠️ Rule 1 is written to AUTO-RELAX: it only demands the honest label while
  no consumer reads the stored value. Wire one and the rule stops applying,
  so it can never block the real fix.
*/

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SETTINGS_ROUTE_DIR = 'src/app/api/v1/admin/settings';
const PANEL = 'src/components/admin/SystemSettings.tsx';

/** Modules that call `resolveEnvVar` OUTSIDE the settings routes. */
function realConsumersOfStoredEnv(): string[] {
  return globSync('src/**/*.{ts,tsx}', { cwd: ROOT })
    .filter((f) => !/\.test\.(ts|tsx)$/.test(f))
    .filter((f) => !f.startsWith(SETTINGS_ROUTE_DIR))
    .filter((f) => f !== 'src/lib/settings.server.ts')
    .filter((f) => /resolveEnvVar\s*\(/.test(strip(read(f))));
}

describe('the settings screen does not overstate what saving a key does', () => {
  /*
    ── ANTI-VACUITY CONTROL ──
    If the scan could not see the panel or the routes, every rule below would
    pass over nothing.
  */
  it('⚠️ the files under audit exist and are non-trivial', () => {
    expect(read(PANEL).length).toBeGreaterThan(5000);
    const routes = globSync(`${SETTINGS_ROUTE_DIR}/**/route.ts`, { cwd: ROOT });
    expect(routes.length).toBe(4);
  });

  /*
    ── RULE 1, AUTO-RELAXING ──
    What would prove this wrong: a module outside the settings routes calling
    `resolveEnvVar`. Then the stored value IS in use and the honest label
    changes - so the rule steps aside rather than fighting the fix.
  */
  it('⛔ while nothing reads a stored env key, the badge must not call it active', () => {
    const consumers = realConsumersOfStoredEnv();
    if (consumers.length > 0) {
      // The feature got wired. This rule no longer applies - and the comment
      // in SystemSettings.tsx that says "not in use" is now the stale thing.
      expect(strip(read(PANEL))).not.toMatch(/Saved · not in use/);
      return;
    }

    const panel = strip(read(PANEL));
    expect(panel, 'the db-sourced badge must not read as the active source')
      .not.toMatch(/source === 'db' \? 'Custom'/);
    expect(panel, 'the badge must say the value is not in use')
      .toMatch(/not in use/);
  });

  /*
    ── RULE 2 ──
    The screen must state the consequence, not only label the badge.
  */
  it('⛔ the panel tells the operator that saving does not change the running app', () => {
    const panel = strip(read(PANEL));
    expect(panel).toMatch(/does not\s+read it yet|still take their credentials/);
    expect(panel, 'and what to do instead').toMatch(/redeploy/i);
  });

  /*
    ── RULE 3 ──
    `audit_logs.actor_ip` must come from a value the caller cannot choose.
  */
  it('⛔ no settings route builds actorIp from a raw forwarded header', () => {
    const offenders: string[] = [];
    for (const f of globSync(`${SETTINGS_ROUTE_DIR}/**/route.ts`, { cwd: ROOT })) {
      const src = strip(read(f));
      if (!/actorIp/.test(src)) continue;
      if (/headers\.get\(['"]x-forwarded-for['"]\)/.test(src)) offenders.push(f);
    }
    expect(
      offenders,
      `these write an attacker-suppliable IP into an audit row:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  /*
    ── RULE 4, THE CONTROL ──
    Without this, deleting the audit rows entirely would satisfy rule 3.
  */
  it('⚠️ CONTROL: both writing routes still record an actor IP, via getClientIp', () => {
    for (const f of [
      `${SETTINGS_ROUTE_DIR}/route.ts`,
      `${SETTINGS_ROUTE_DIR}/environment/route.ts`,
    ]) {
      const src = strip(read(f));
      expect(src, `${f} must still write actorIp`).toMatch(/actorIp/);
      expect(src, `${f} must use getClientIp`).toMatch(/getClientIp\(request\.headers\)/);
    }
  });
});

/*
  ─────────────────────────────────────────────────────────────────────────
  THE SCHEDULE THE OPERATOR SEES IS THE SCHEDULE THAT RUNS.        docs/138
  ─────────────────────────────────────────────────────────────────────────

  `/admin/settings` held a hand-written list of SEVEN jobs. It matched
  neither `CRON_JOBS` (twelve, the only list bundled into the Worker) nor
  `vercel.json` (nine, inert on Fly - docs/65). Six real jobs were missing,
  and the seventh row, `Process Donations` on a fifteen-minute cadence, was in
  neither other list: no such route exists, and `PipelineMonitor.tsx` maps
  `cron.simulate_donations` to that exact label - so the one job this project
  deliberately does not schedule was shown badged "Active".
*/
const SETTINGS_PAGE = 'src/app/admin/settings/page.tsx';

describe('the settings screen shows the schedule that actually runs', () => {
  /*
    ── RULE 5 ──
    Derived, not enumerated. docs/110, docs/119, docs/137: a hand-written
    list is only as good as whoever remembered to extend it.
  */
  it('⛔ the settings page does not keep its own list of cron jobs', () => {
    const page = strip(read(SETTINGS_PAGE));
    expect(page, 'a cron schedule literal means a second list to drift')
      .not.toMatch(/schedule:\s*['"][\d*/ ,-]+['"]/);
  });

  /*
    ── RULE 6, DERIVED BOTH ENDS ──
    Not "the list has 12 entries" - that would need editing when a job is
    added. The rendered rows must BE the schedule.
  */
  it('⛔ the rendered rows are exactly the jobs the Worker dispatches', () => {
    const rows = cronScheduleRows();
    expect(rows.map((r) => r.schedule)).toEqual(CRON_JOBS.map((j) => j.cron));
    expect(rows).toHaveLength(CRON_JOBS.length);

    // And the deliberately-unscheduled seed job is absent for free (docs/136).
    expect(rows.map((r) => r.name)).not.toContain('Simulate Donations');
    expect(rows.map((r) => r.name)).not.toContain('Process Donations');
  });

  /*
    ── RULE 7 ──
    Two claims the screen cannot substantiate.
  */
  it('⛔ the panel names neither vercel.json as the source nor a row as active', () => {
    const panel = strip(read(PANEL));
    const cronSection = panel.slice(panel.indexOf('Scheduled Cron Jobs'));
    expect(cronSection, 'vercel.json has never scheduled anything here (docs/65)')
      .not.toMatch(/vercel\.json/);
    expect(cronSection, 'a scheduled job is not a job that ran (docs/136 §10)')
      .not.toMatch(/>Active</);
  });

  /*
    ── RULE 8, THE CONTROL ──
    Without this, deleting the whole section would satisfy rules 5 and 7.
  */
  it('⚠️ CONTROL: the section still renders a row per job, and the page still feeds it', () => {
    const panel = strip(read(PANEL));
    expect(panel).toMatch(/stats\.cronJobs\.map/);
    expect(panel).toMatch(/job\.name/);
    expect(panel).toMatch(/job\.schedule/);
    expect(strip(read(SETTINGS_PAGE)), 'the page must derive the rows')
      .toMatch(/cronJobs:\s*cronScheduleRows\(\)/);
  });
});
