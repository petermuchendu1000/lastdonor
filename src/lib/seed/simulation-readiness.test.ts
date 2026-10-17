import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));

import {
  getSimulationReadiness,
  SCHEDULER_STALE_AFTER_MS,
  SIMULATION_JOB,
} from '@/lib/seed/simulation-readiness';
import { SEED_DONATIONS_OPT_IN_SENTINEL } from '@/lib/seed/simulation-engine';
import { CRON_JOBS } from '@/lib/cron-schedule';

/*
  docs/88 F9. The panel offered a master switch, a volume slider and a
  badge reading "Active" for something that has never produced a single
  seed donation, and said so nowhere.
*/

const NOW = new Date('2026-10-17T22:00:00.000Z');
const OPTED_IN = { SEED_DONATIONS_OPT_IN: SEED_DONATIONS_OPT_IN_SENTINEL } as NodeJS.ProcessEnv;
const NOT_OPTED_IN = {} as NodeJS.ProcessEnv;
const JUST_RAN = new Date(NOW.getTime() - 60_000);
const LONG_AGO = new Date(NOW.getTime() - SCHEDULER_STALE_AFTER_MS - 1);

function ids(r: ReturnType<typeof getSimulationReadiness>) {
  return r.blockers.map((b) => b.id);
}

describe('getSimulationReadiness', () => {
  it('reports production as it actually is: three independent blockers', () => {
    const r = getSimulationReadiness(null, NOW, NOT_OPTED_IN);
    expect(ids(r)).toEqual(['not-opted-in', 'not-scheduled', 'no-scheduler']);
    expect(r.canRun).toBe(false);
  });

  it('still refuses to say it can run when only the opt-in is cleared', () => {
    // The audit named two reasons. Clearing either one alone changes
    // nothing, which is the point of listing all three.
    const r = getSimulationReadiness(JUST_RAN, NOW, OPTED_IN);
    expect(ids(r)).toEqual(['not-scheduled']);
    expect(r.canRun).toBe(false);
  });

  it('treats a scheduler that has not ticked in three intervals as dead', () => {
    const r = getSimulationReadiness(LONG_AGO, NOW, OPTED_IN);
    expect(ids(r)).toContain('no-scheduler');
    expect(r.blockers.find((b) => b.id === 'no-scheduler')?.detail).toContain(
      LONG_AGO.toISOString(),
    );
  });

  it('says plainly when no cron has ever run, rather than printing a null date', () => {
    const r = getSimulationReadiness(null, NOW, NOT_OPTED_IN);
    expect(r.blockers.find((b) => b.id === 'no-scheduler')?.detail).toBe(
      'No cron job has ever recorded a run.',
    );
    expect(r.schedulerLastRunAt).toBeNull();
  });

  it('a live scheduler inside the window is not a blocker', () => {
    const r = getSimulationReadiness(JUST_RAN, NOW, OPTED_IN);
    expect(ids(r)).not.toContain('no-scheduler');
  });

  it('never leaks the opt-in value, only whether it is present', () => {
    const r = getSimulationReadiness(null, NOW, {
      SEED_DONATIONS_OPT_IN: 'some-other-value',
    } as NodeJS.ProcessEnv);
    const text = JSON.stringify(r);
    expect(text).not.toContain('some-other-value');
    expect(ids(r)).toContain('not-opted-in');
  });

  it('every blocker says what would clear it and who can do it', () => {
    for (const b of getSimulationReadiness(null, NOW, NOT_OPTED_IN).blockers) {
      expect(b.fix.length).toBeGreaterThan(40);
      expect(b.fix).toMatch(/docs\/\d+/);
    }
  });

  it('is derived from the real schedule table, not from copied prose', () => {
    // If simulate-donations is ever scheduled, this blocker must stop
    // appearing by itself. A hardcoded warning would not.
    expect(CRON_JOBS.some((j) => j.job === SIMULATION_JOB)).toBe(false);
    expect(ids(getSimulationReadiness(JUST_RAN, NOW, OPTED_IN))).toContain('not-scheduled');
  });
});

describe('the simulation panel states its real status (docs/88 F9)', () => {
  const panel = readFileSync(
    join(process.cwd(), 'src/components/admin/SimulationControlPanel.tsx'),
    'utf8',
  );

  it('does not call itself Active on the setting alone', () => {
    expect(panel).toMatch(/const reallyActive = settings\.enabled && readiness\.canRun/);
    expect(panel).not.toMatch(/\{settings\.enabled \? 'Active' : 'Inactive'\}/);
  });

  it('renders the blockers', () => {
    expect(panel).toMatch(/readiness\.blockers\.map/);
    expect(panel).toContain('Nothing on this screen will produce a donation');
  });

  it('says so again when the master switch is turned on while blocked', () => {
    expect(panel).toMatch(/if \(v && !readiness\.canRun\)/);
  });
});

describe('the simulation page cannot exhaust the connection pool (docs/87)', () => {
  const page = readFileSync(join(process.cwd(), 'src/app/admin/simulation/page.tsx'), 'utf8');

  /*
    The sixth pool wedge, 2026-10-17, was found holding
    `select count(*)::int from "campaigns" where "simulation_flag" = $1`,
    which exists only on this page. It issued more concurrent queries
    than `src/db/index.ts` has connections (max: 5).
  */
  it('loads settings before the fan-out, so autoVolume costs no queries', () => {
    expect(page).toMatch(/const settings = await getAllSettings\(\);/);
    expect(page).toMatch(/calculateAutoVolume\(settings\)/);
  });

  it('keeps every Promise.all batch within the pool', () => {
    const POOL_MAX = 5;
    // Count the top-level entries of each `await Promise.all([...])`.
    // Comments carry unbalanced brackets and commas of their own, so
    // strip them before counting anything.
    const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const batches = [...code.matchAll(/await Promise\.all\(\[([\s\S]*?)\n  \]\)/g)];
    expect(batches.length).toBeGreaterThan(0);
    for (const [, body] of batches) {
      let depth = 0;
      let entries = 1;
      for (const ch of body) {
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) depth--;
        else if (ch === ',' && depth === 0) entries++;
      }
      expect(entries).toBeLessThanOrEqual(POOL_MAX - 1); // leave room for auth()
    }
  });
});
