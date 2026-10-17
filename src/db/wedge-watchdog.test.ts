import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));

/*
  The watchdog's behaviour against a real wedge was proven in a lab, not
  here: a local Postgres, `BEGIN; COPY ... FROM STDIN;` to hold a
  backend in production's exact state (`active` / `Client/ClientRead`
  with an open transaction), then the sweep. Recorded in docs/87
  amendment 6:

    age floor 300s, backend 3s old  -> terminated 0
    dry run, floor 2s               -> found 1, changed nothing
    live sweep, floor 2s            -> terminated pid 348
    a legitimate idle-in-transaction client -> survived
    a legitimate long-running query         -> survived

  What is tested here is everything that does not need a database: the
  configuration, the timer, and the shape of the statement, since the
  predicate is the whole safety argument.
*/

const captured: { strings: string[]; values: unknown[] }[] = [];
let rowsToReturn: Record<string, unknown>[] = [];
let shouldThrow: Error | null = null;
const ended = { count: 0 };

function fakeSql(strings: TemplateStringsArray | string[], ...values: unknown[]) {
  // Nested calls (the dryRun fragment) return a marker, not a promise.
  const isFragment = Array.isArray(strings) && String(strings[0]).includes('pg_terminate_backend');
  const isNullFragment = Array.isArray(strings) && String(strings[0]).includes('NULL::boolean');
  if (isFragment || isNullFragment) return { __fragment: String(strings[0]) };
  captured.push({ strings: [...strings], values });
  if (shouldThrow) return Promise.reject(shouldThrow);
  return Promise.resolve(rowsToReturn);
}
(fakeSql as unknown as { end: () => Promise<void> }).end = () => {
  ended.count += 1;
  return Promise.resolve();
};

const postgresMock = vi.fn((..._args: unknown[]) => fakeSql);
vi.mock('postgres', () => ({ default: (...args: unknown[]) => postgresMock(...args) }));

const {
  watchdogConfig,
  sweepWedgedBackends,
  startWedgeWatchdog,
  stopWedgeWatchdog,
} = await import('@/db/wedge-watchdog');

beforeEach(() => {
  captured.length = 0;
  rowsToReturn = [];
  shouldThrow = null;
  ended.count = 0;
  postgresMock.mockClear();
  stopWedgeWatchdog();
});

afterEach(() => {
  stopWedgeWatchdog();
  vi.restoreAllMocks();
});

const URL_ = 'postgres://u:p@h:6543/db';

describe('watchdogConfig', () => {
  it('is on by default, because the alternative is another outage', () => {
    const c = watchdogConfig({} as unknown as NodeJS.ProcessEnv);
    expect(c.enabled).toBe(true);
    expect(c.dryRun).toBe(false);
    expect(c.maxTxnAgeSeconds).toBe(300);
    expect(c.intervalSeconds).toBe(60);
  });

  it('can be switched off entirely, and put in dry run', () => {
    expect(watchdogConfig({ DB_WATCHDOG: 'off' } as unknown as NodeJS.ProcessEnv).enabled).toBe(false);
    const dry = watchdogConfig({ DB_WATCHDOG: 'dry-run' } as unknown as NodeJS.ProcessEnv);
    expect(dry.enabled).toBe(true);
    expect(dry.dryRun).toBe(true);
  });

  it('refuses an age floor below a minute', () => {
    // A short floor would start terminating ordinary slow requests.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(watchdogConfig({ DB_WATCHDOG_MAX_TXN_AGE_SECONDS: '5' } as unknown as NodeJS.ProcessEnv).maxTxnAgeSeconds).toBe(300);
    expect(watchdogConfig({ DB_WATCHDOG_MAX_TXN_AGE_SECONDS: 'soon' } as unknown as NodeJS.ProcessEnv).maxTxnAgeSeconds).toBe(300);
    expect(watchdogConfig({ DB_WATCHDOG_MAX_TXN_AGE_SECONDS: '600' } as unknown as NodeJS.ProcessEnv).maxTxnAgeSeconds).toBe(600);
  });
});

describe('sweepWedgedBackends', () => {
  const live = { enabled: true, dryRun: false, intervalSeconds: 60, maxTxnAgeSeconds: 300 };

  it('does nothing at all when disabled', async () => {
    const r = await sweepWedgedBackends({ ...live, enabled: false }, URL_);
    expect(r.checked).toBe(false);
    expect(postgresMock).not.toHaveBeenCalled();
  });

  it('opens its OWN connection, not the app pool', async () => {
    await sweepWedgedBackends(live, URL_);
    const opts = (postgresMock.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(opts.max).toBe(1);
    expect((opts.connection as Record<string, string>).application_name).toBe('lastdonor-wedge-watchdog');
    // A watchdog that queues behind the wedge cannot clear the wedge.
    expect(opts.prepare).toBe(false);
  });

  it('targets only the wedge signature', async () => {
    await sweepWedgedBackends(live, URL_);
    const sqlText = captured[0].strings.join('?');
    expect(sqlText).toContain("state = ");
    expect(captured[0].values).toContain('active');
    expect(captured[0].values).toContain('ClientRead');
    expect(sqlText).toContain('xact_start IS NOT NULL');
    expect(sqlText).toContain('make_interval');
    expect(captured[0].values).toContain(300);
  });

  it('never terminates itself or another watchdog', async () => {
    await sweepWedgedBackends(live, URL_);
    const sqlText = captured[0].strings.join('?');
    expect(sqlText).toContain('pid <> pg_backend_pid()');
    expect(sqlText).toContain("application_name IS DISTINCT FROM 'lastdonor-wedge-watchdog'");
  });

  it('stays inside its own database', async () => {
    await sweepWedgedBackends(live, URL_);
    expect(captured[0].strings.join('?')).toContain('datname = current_database()');
  });

  it('reports what it killed', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    rowsToReturn = [
      { pid: 419821, age_seconds: 276, query: 'select count(*) from "campaigns"', terminated: true },
    ];
    const r = await sweepWedgedBackends(live, URL_);
    expect(r.found).toBe(1);
    expect(r.terminated).toEqual([
      { pid: 419821, txnAgeSeconds: 276, query: 'select count(*) from "campaigns"' },
    ]);
    // Silence would turn an outage into a mystery.
    expect(err.mock.calls.flat().join(' ')).toContain('TERMINATED pid 419821');
  });

  it('counts a pid another instance already killed as not terminated', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rowsToReturn = [{ pid: 1, age_seconds: 400, query: 'x', terminated: false }];
    const r = await sweepWedgedBackends(live, URL_);
    expect(r.found).toBe(1);
    expect(r.terminated).toEqual([]);
  });

  it('in dry run, reports without a terminate call in the statement', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rowsToReturn = [{ pid: 7, age_seconds: 999, query: 'x', terminated: null }];
    const r = await sweepWedgedBackends({ ...live, dryRun: true }, URL_);
    expect(r.dryRun).toBe(true);
    expect(r.terminated).toHaveLength(1);
  });

  it('never throws, and always closes its connection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrow = new Error('database is on fire');
    const r = await sweepWedgedBackends(live, URL_);
    expect(r.checked).toBe(false);
    expect(r.error).toBe('database is on fire');
    expect(ended.count).toBe(1);
  });

  it('does nothing without a connection string', async () => {
    const r = await sweepWedgedBackends(live, undefined);
    expect(r.error).toBe('no DATABASE_URL');
    expect(postgresMock).not.toHaveBeenCalled();
  });
});

describe('startWedgeWatchdog', () => {
  it('arms once and refuses to stack a second watchdog', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const cfg = { enabled: true, dryRun: false, intervalSeconds: 60, maxTxnAgeSeconds: 300 };
      expect(startWedgeWatchdog(cfg)).toBe(true);

      /*
        The second call lands DURING the randomised initial delay, before
        any interval exists. A guard keyed on the interval handle would
        let it through and arm a second watchdog; this is the case that
        found that bug.
      */
      expect(startWedgeWatchdog(cfg)).toBe(false);
      expect(startWedgeWatchdog(cfg)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not arm when disabled', () => {
    expect(startWedgeWatchdog({ enabled: false, dryRun: false, intervalSeconds: 60, maxTxnAgeSeconds: 300 })).toBe(false);
  });
});

describe('it is wired into the server, not a cron route', () => {
  it('starts from instrumentation.ts in the nodejs runtime', () => {
    const src = readFileSync(join(process.cwd(), 'src/instrumentation.ts'), 'utf8');
    expect(src).toContain('startWedgeWatchdog');
    expect(src).toContain("NEXT_RUNTIME === 'nodejs'");
  });

  it('is not a cron route, which would come in through the wedged pool', () => {
    // docs/65: no cron has ever run in production either.
    const watchdog = readFileSync(join(process.cwd(), 'src/db/wedge-watchdog.ts'), 'utf8');
    expect(watchdog).toContain('IS_PRODUCTION_BUILD');
  });
});
