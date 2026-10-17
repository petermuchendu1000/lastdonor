import 'server-only';

import postgres from 'postgres';
import { IS_PRODUCTION_BUILD } from './build-phase';

/**
 * Terminates backends stuck in the wedge state (`docs/87` amendment 3).
 *
 * ── Why this exists ──────────────────────────────────────────────────
 *
 * Seven times on 2026-10-17, production stopped answering because
 * backends sat in `state = 'active'` with `wait_event = 'Client/ClientRead'`
 * and a transaction open for minutes to hours. Postgres itself was
 * healthy throughout. **Nothing in PostgreSQL bounds that state**
 * (`docs/87` amendment 2, verified):
 *
 *   - `statement_timeout` is not armed while a backend waits on client
 *     input, so it never fires;
 *   - `idle_in_transaction_session_timeout` only fires on
 *     `idle in transaction`, and these read `active`;
 *   - TCP keepalives see a live Supavisor peer, so the socket looks fine.
 *
 * The only remedy that has ever worked during an incident is
 * `pg_terminate_backend` by transaction age, run by hand. Three times.
 * This is that remedy, on a timer.
 *
 * ── Why it opens its own connection ──────────────────────────────────
 *
 * It must work when the app pool is the thing that is broken. A
 * watchdog that borrows from `src/db/index.ts`'s pool would queue
 * behind the very wedge it exists to clear, and would be unable to run
 * at exactly the moment it is needed. So: a dedicated client,
 * `max: 1`, opened per sweep and closed after, with its own short
 * timeouts. One connection is a cheap standing cost against a total
 * outage.
 *
 * It is also why this is NOT a cron route. `docs/65` records that no
 * cron has ever run in production, and a cron route would come in
 * through the same wedged pool even once one does.
 *
 * ── Why the predicate is safe ────────────────────────────────────────
 *
 * `state = 'active'` AND `wait_event = 'ClientRead'` means the server
 * finished its work and is waiting for the client to send the next
 * message. A migration doing work is never in that state: it is either
 * executing (a different wait event, or none) or `idle in transaction`
 * between statements. Migrations also connect on port 5432 in session
 * mode (`docs/34`), not through the pooler these backends come from.
 *
 * The age threshold is the second guard. A healthy request holds a
 * transaction for milliseconds; the default floor here is five minutes,
 * and the floor cannot be configured below one minute.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────
 *
 * It does not touch `idle in transaction` backends, which Postgres can
 * already bound with `idle_in_transaction_session_timeout`, and it does
 * not touch long-running `active` backends that are actually executing
 * a query, however slow. Killing a slow report is a different decision
 * from clearing an abandoned transaction, and only the second one is
 * provably safe.
 */

/** Only this exact state is ever terminated. */
const WEDGE_STATE = 'active';
const WEDGE_WAIT_EVENT = 'ClientRead';

const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_MAX_TXN_AGE_SECONDS = 300;
const MIN_MAX_TXN_AGE_SECONDS = 60;

function intFromEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    console.error(`[db-watchdog] "${raw}" is not an integer in ${min}..${max}; using ${fallback}.`);
    return fallback;
  }
  return Math.floor(n);
}

export interface WatchdogConfig {
  /** Master switch. Set `DB_WATCHDOG=off` to disable entirely. */
  readonly enabled: boolean;
  /** Report what it would terminate without terminating it. */
  readonly dryRun: boolean;
  readonly intervalSeconds: number;
  readonly maxTxnAgeSeconds: number;
}

export function watchdogConfig(env: NodeJS.ProcessEnv = process.env): WatchdogConfig {
  return {
    enabled: env.DB_WATCHDOG !== 'off',
    dryRun: env.DB_WATCHDOG === 'dry-run',
    intervalSeconds: intFromEnv(env.DB_WATCHDOG_INTERVAL_SECONDS, DEFAULT_INTERVAL_SECONDS, 10, 3600),
    maxTxnAgeSeconds: intFromEnv(
      env.DB_WATCHDOG_MAX_TXN_AGE_SECONDS,
      DEFAULT_MAX_TXN_AGE_SECONDS,
      MIN_MAX_TXN_AGE_SECONDS,
      86_400,
    ),
  };
}

export interface TerminatedBackend {
  readonly pid: number;
  readonly txnAgeSeconds: number;
  /** Truncated, and only ever the statement text, never its parameters. */
  readonly query: string;
}

export interface SweepResult {
  readonly checked: boolean;
  readonly found: number;
  readonly terminated: TerminatedBackend[];
  readonly dryRun: boolean;
  readonly error?: string;
}

/**
 * One pass. Exported so a test can drive it, and so an operator can run
 * it on demand without waiting for the timer.
 *
 * `connectionString` defaults to the app's, but the client is its own:
 * see the comment above about not borrowing the pool it is rescuing.
 */
export async function sweepWedgedBackends(
  config: WatchdogConfig = watchdogConfig(),
  connectionString: string | undefined = process.env.DATABASE_URL,
): Promise<SweepResult> {
  if (!config.enabled) return { checked: false, found: 0, terminated: [], dryRun: config.dryRun };
  if (!connectionString) {
    return { checked: false, found: 0, terminated: [], dryRun: config.dryRun, error: 'no DATABASE_URL' };
  }

  const sql = postgres(connectionString, {
    prepare: false,
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    // Named so the backend is identifiable in pg_stat_activity, and so
    // the sweep can exclude itself by more than just its pid.
    connection: { application_name: 'lastdonor-wedge-watchdog' },
  });

  try {
    /*
      One statement: find and terminate in the same pass, so nothing can
      change between the look and the kill. `pg_terminate_backend`
      returns false for a pid that has already gone, which is fine -
      another instance's watchdog may have got there first.
    */
    const rows = await sql<{ pid: number; age_seconds: number; query: string; terminated: boolean | null }[]>`
      SELECT
        pid,
        floor(extract(epoch FROM (now() - xact_start)))::int AS age_seconds,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 120) AS query,
        ${config.dryRun ? sql`NULL::boolean` : sql`pg_terminate_backend(pid)`} AS terminated
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND application_name IS DISTINCT FROM 'lastdonor-wedge-watchdog'
        AND state = ${WEDGE_STATE}
        AND wait_event = ${WEDGE_WAIT_EVENT}
        AND xact_start IS NOT NULL
        AND now() - xact_start > make_interval(secs => ${config.maxTxnAgeSeconds})
    `;

    const terminated = rows
      .filter((r) => config.dryRun || r.terminated === true)
      .map((r) => ({ pid: r.pid, txnAgeSeconds: r.age_seconds, query: r.query }));

    if (rows.length > 0) {
      /*
        Always logged, never silent. A watchdog that clears an outage
        without saying so turns an incident into a mystery: the symptom
        disappears and no one learns the pool wedged at all.
      */
      for (const t of terminated) {
        console.error(
          `[db-watchdog] ${config.dryRun ? 'WOULD TERMINATE' : 'TERMINATED'} pid ${t.pid}, ` +
            `transaction open ${t.txnAgeSeconds}s in ${WEDGE_STATE}/${WEDGE_WAIT_EVENT}: ${t.query}`,
        );
      }
      console.error(
        `[db-watchdog] swept ${rows.length} wedged backend(s); see docs/87. ` +
          `This is an outage being cleared, not routine maintenance.`,
      );
    }

    return { checked: true, found: rows.length, terminated, dryRun: config.dryRun };
  } catch (err) {
    // The watchdog must never take the process down with it.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[db-watchdog] sweep failed: ${message}`);
    return { checked: false, found: 0, terminated: [], dryRun: config.dryRun, error: message };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
/*
  Set the instant arming begins, not when the interval is created. The
  first sweep is deliberately delayed by a random slice of the period,
  so a guard keyed on `timer` alone would let a second call during that
  window arm a second watchdog.
*/
let arming = false;

/**
 * Starts the timer. Idempotent, and inert during `next build`.
 *
 * Every instance runs its own watchdog. That is deliberate: a lock
 * would be one more thing to wedge, and a second terminate on a pid
 * that is already gone is a no-op. The first sweep is delayed by a
 * random slice of the interval so instances do not all sweep together.
 */
export function startWedgeWatchdog(config: WatchdogConfig = watchdogConfig()): boolean {
  if (IS_PRODUCTION_BUILD || !config.enabled || arming) return false;
  arming = true;

  const periodMs = config.intervalSeconds * 1000;
  const sweep = () => {
    void sweepWedgedBackends(config);
  };

  setTimeout(() => {
    sweep();
    timer = setInterval(sweep, periodMs);
    timer.unref?.();
  }, Math.floor(Math.random() * periodMs)).unref?.();

  console.log(
    `[db-watchdog] armed: terminating ${WEDGE_STATE}/${WEDGE_WAIT_EVENT} backends with a ` +
      `transaction older than ${config.maxTxnAgeSeconds}s, every ${config.intervalSeconds}s` +
      `${config.dryRun ? ' (DRY RUN: reporting only)' : ''}.`,
  );
  return true;
}

/** Test helper: stops the timer and allows a fresh start. */
export function stopWedgeWatchdog(): void {
  if (timer) clearInterval(timer);
  timer = null;
  arming = false;
}
