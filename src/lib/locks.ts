/**
 * Distributed mutex for scheduled work.
 *
 * Implements the overlap guard prescribed by `docs/26` §4 and required by
 * remediation item P1-11 (`docs/31` §2.4). Before this module there were **no
 * lock primitives anywhere in `src/`**, so a slow cron run could overlap its
 * own next invocation: `update-phases` runs every 5 minutes with
 * `maxDuration = 120`, and `simulate-donations` every 15 minutes, so a run that
 * stalls on AI or Postgres is still in flight when the dispatcher fires again.
 *
 * Mechanism: `SET <key> <token> NX EX <ttl>` against Upstash Redis — the same
 * instance the rate limiter uses (`src/lib/rate-limit.ts`). The TTL is the only
 * thing that releases a lock held by a machine that was killed mid-run, which is
 * why every TTL here is derived from the route's declared `maxDuration` rather
 * than guessed. Release is **owner-checked** via a Lua script that compares the
 * stored token before deleting, so a run that overshot its TTL (and whose lock
 * has since been taken by the next invocation) cannot delete the new owner's
 * lock.
 *
 * ── Degradation policy (the decision this module exists to record) ──────────
 *
 * Two failure situations are deliberately kept distinct:
 *
 *  1. **The lock is held** by a live run. Every job exits early, always. That is
 *     the entire point of the lock and is not configurable.
 *
 *  2. **The lock backend is unreachable** — `UPSTASH_REDIS_REST_*` unset (dev,
 *     or a misconfigured deploy) or the Upstash request threw. Here there is no
 *     safe default, so the choice is per job via `onBackendUnavailable`:
 *
 *     - `'skip'` (fail closed) — the job's side effects are irreversible or
 *       costly: money-shaped rows, published public appeals, sent email, or paid
 *       AI tokens. Running twice is worse than not running, so an unverifiable
 *       lock means "do not run". Nine of the ten jobs are `'skip'`.
 *     - `'run'` (fail open) — the job is convergent and self-healing, so running
 *       it twice reaches the same state, while *not* running it silently extends
 *       the drift it exists to repair. Only `reconcile` is `'run'`.
 *
 * A `'skip'` on backend-unavailable is visible, not silent: the route returns
 * `skipped: true` with the reason, and `CRON_LOCKS` carries the rationale so the
 * trade-off is reviewable in one table instead of being re-litigated per route.
 */

import { Redis } from '@upstash/redis';
import { randomUUID } from 'crypto';

// ─── Redis client (memoised, shared with the health probe) ──────────────────

let redisClient: Redis | null = null;
let redisInitAttempted = false;

/**
 * Lazily construct the Upstash client. Returns `null` when the credentials are
 * absent, which callers must treat as "backend unavailable" rather than
 * "lock free".
 */
function getRedis(): Redis | null {
  if (redisInitAttempted) return redisClient;
  redisInitAttempted = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[locks] UPSTASH_REDIS_REST_URL/TOKEN not set. Cron overlap protection ' +
        'is unavailable; jobs with onBackendUnavailable="skip" will not run.',
      );
    }
    return null;
  }

  try {
    redisClient = new Redis({ url, token });
  } catch (err) {
    console.error('[locks] Failed to initialise Upstash client:', err);
    redisClient = null;
  }
  return redisClient;
}

/** @internal Test seam — drops the memoised client so env changes take effect. */
export function __resetLockBackendForTests(): void {
  redisClient = null;
  redisInitAttempted = false;
}

// ─── Types ──────────────────────────────────────────────────────────────────

/** What a job does when the lock backend itself cannot be reached. */
export type LockUnavailablePolicy = 'run' | 'skip';

export interface LockHandle {
  readonly key: string;
  /**
   * `true` when a real Upstash lock is held. `false` when the backend was
   * unreachable and the job's policy is `'run'` — nothing is actually holding
   * anyone off, and `release()` is a no-op.
   */
  readonly distributed: boolean;
  /** Owner-checked release. Never throws. */
  release(): Promise<void>;
}

export type LockAcquisition =
  | { ok: true; lock: LockHandle; degraded: boolean }
  | { ok: false; reason: 'held' | 'backend-unavailable' };

// ─── Core primitive ─────────────────────────────────────────────────────────

const KEY_PREFIX = 'lock:lastdonor:cron:';

/**
 * Delete the key only if we still own it. A run that overran its TTL must not
 * release the lock that the next invocation legitimately acquired.
 */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const NOOP_RELEASE = async (): Promise<void> => {};

function degradedResult(
  key: string,
  policy: LockUnavailablePolicy,
): LockAcquisition {
  if (policy === 'skip') {
    return { ok: false, reason: 'backend-unavailable' };
  }
  return {
    ok: true,
    degraded: true,
    lock: { key, distributed: false, release: NOOP_RELEASE },
  };
}

/**
 * Acquire a named mutex.
 *
 * @param opts.name  Lock name; namespaced under `lock:lastdonor:cron:`.
 * @param opts.ttlSeconds  Expiry, which must exceed the holder's worst-case
 *   runtime (for a route, its `maxDuration`) or a slow run will lose its own
 *   lock mid-flight and let a second run in.
 * @param opts.onBackendUnavailable  See the degradation policy above.
 */
export async function acquireLock(opts: {
  name: string;
  ttlSeconds: number;
  onBackendUnavailable: LockUnavailablePolicy;
}): Promise<LockAcquisition> {
  const key = `${KEY_PREFIX}${opts.name}`;
  const ttl = Math.max(1, Math.floor(opts.ttlSeconds));
  const redis = getRedis();

  if (!redis) return degradedResult(key, opts.onBackendUnavailable);

  const token = randomUUID();

  let result: unknown;
  try {
    result = await redis.set(key, token, { nx: true, ex: ttl });
  } catch (err) {
    console.error(`[locks] Upstash SET NX failed for "${key}":`, err);
    return degradedResult(key, opts.onBackendUnavailable);
  }

  // Upstash returns null when NX was not satisfied, i.e. someone holds it.
  if (result === null) return { ok: false, reason: 'held' };

  return {
    ok: true,
    degraded: false,
    lock: {
      key,
      distributed: true,
      async release() {
        try {
          await redis.eval(RELEASE_SCRIPT, [key], [token]);
        } catch (err) {
          // The TTL is the backstop; a failed release is not worth failing the
          // job that already did its work.
          console.error(`[locks] Failed to release "${key}":`, err);
        }
      },
    },
  };
}

/**
 * Liveness of the lock/rate-limit backend, for the deep health probe.
 *
 * Exported from here because this module owns the only raw Redis client in
 * `src/` (`rate-limit.ts` wraps its own inside `Ratelimit`). Deliberately never
 * called from `/api/v1/live`, which must stay dependency-free.
 */
export async function pingRedis(): Promise<
  { configured: boolean; ok: boolean; error?: string }
> {
  const redis = getRedis();
  if (!redis) return { configured: false, ok: false, error: 'Redis not configured' };
  try {
    await redis.ping();
    return { configured: true, ok: true };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── The cron lock registry ─────────────────────────────────────────────────

export type CronJobName =
  | 'blog-generate'
  | 'blog-refresh'
  | 'blog-topics'
  | 'fetch-news'
  | 'ingest-news'
  | 'payhero-float'
  | 'publish-campaigns'
  | 'reconcile'
  | 'refresh-fx-rates'
  | 'screen-documents'
  | 'send-newsletter'
  | 'simulate-donations'
  | 'update-phases'
  | 'verification-reminders';

export interface CronLockSpec {
  name: CronJobName;
  /**
   * The route's declared `maxDuration`, in seconds. Kept next to the TTL so a
   * test can assert the TTL still exceeds it when a route's budget changes.
   */
  maxDurationSeconds: number;
  ttlSeconds: number;
  onBackendUnavailable: LockUnavailablePolicy;
  /** Why this job fails open or closed. */
  rationale: string;
}

/** TTL headroom above `maxDuration`: the platform kills the run first. */
const TTL_HEADROOM_SECONDS = 30;

function spec(
  name: CronJobName,
  maxDurationSeconds: number,
  onBackendUnavailable: LockUnavailablePolicy,
  rationale: string,
): CronLockSpec {
  return {
    name,
    maxDurationSeconds,
    ttlSeconds: maxDurationSeconds + TTL_HEADROOM_SECONDS,
    onBackendUnavailable,
    rationale,
  };
}

/**
 * One reviewable table of every scheduled job's overlap policy.
 *
 * `maxDurationSeconds` mirrors the `maxDuration` export in each route handler.
 * NOTE (verified 2026-10-14 by reading the route): `simulate-donations`
 * declares `maxDuration = 120`, not the 300 that `docs/26` §4 states. The TTL
 * here follows the code, since that is what the platform enforces.
 */
export const CRON_LOCKS: Record<CronJobName, CronLockSpec> = {
  'simulate-donations': spec(
    'simulate-donations', 120, 'skip',
    'Writes donation rows and campaign tallies. Overlap doubles volume and ' +
    'breaches the 150% overfund cap (docs/29 P1-11). Double-running is ' +
    'unrecoverable without a reconciliation pass, so fail closed.',
  ),
  'update-phases': spec(
    'update-phases', 120, 'skip',
    'Generates organizer updates on public campaign pages; overlap posts ' +
    'duplicates that are visible to donors. Runs every 5 minutes, so a skipped ' +
    'window costs almost nothing.',
  ),
  'publish-campaigns': spec(
    'publish-campaigns', 300, 'skip',
    'Publishes public appeals and spends AI tokens (3 callAI per story, 5 ' +
    'stories). Duplicate campaigns are a trust problem, not just a cost one.',
  ),
  'send-newsletter': spec(
    'send-newsletter', 300, 'skip',
    'Sends email. A duplicate send cannot be retracted and burns sender ' +
    'reputation; the job is weekly, so deferring one window is cheap.',
  ),
  'blog-generate': spec(
    'blog-generate', 300, 'skip',
    'Spends AI tokens and publishes posts. Daily, so a skipped window is ' +
    'recovered on the next run.',
  ),
  'blog-topics': spec(
    'blog-topics', 300, 'skip',
    'Spends AI tokens and inserts topic-queue rows; overlap double-fills ' +
    'category slots.',
  ),
  'screen-documents': spec(
    'screen-documents', 300, 'skip',
    'Reads uploaded documents with a vision model and may set ONE document ' +
    'to approved. Fails CLOSED. Overlap is already impossible to get wrong - ' +
    'document_screenings.document_id is UNIQUE and the approval is keyed on ' +
    'the document still being pending - but two runs would still pay for the ' +
    'same provider calls twice and hold two database connections across a ' +
    '30-second HTTP call each, against a pool of 5 (docs/87). Skipping costs ' +
    'five minutes of latency on a queue that has never had an item in it.',
  ),
  'payhero-float': spec(
    'payhero-float', 60, 'skip',
    'Reads PayHero\'s wallet balance, writes one audit row and possibly one ' +
    'email per administrator. Fails CLOSED: two overlapping runs would send ' +
    'the same low-float alert twice, and the cost of a skipped run is one ' +
    'hour of delay on a threshold that leaves roughly nine hours of runway ' +
    '(docs/147 §11.3). It moves no money and the wallet read is a GET.',
  ),
  'refresh-fx-rates': spec(
    'refresh-fx-rates', 60, 'skip',
    'Writes ONE cached rate snapshot to site_settings and no money, so it ' +
    'converges and a fail-open policy would be defensible. It fails CLOSED ' +
    'anyway, because the cost of skipping is the mildest in the table: a ' +
    'missed run ages the snapshot, and once it passes MAX_FX_AGE_HOURS the ' +
    'display component renders nothing at all rather than a stale figure. ' +
    'Nobody is paid wrongly and no page breaks - approximate equivalents ' +
    'just stop appearing. "reconcile" remains the only job worth arguing ' +
    'fail-open for.',
  ),
  'blog-refresh': spec(
    'blog-refresh', 300, 'skip',
    'Queues refresh topics; overlap queues each stale post twice.',
  ),
  'ingest-news': spec(
    'ingest-news', 300, 'skip',
    'Row inserts dedupe via onConflictDoNothing, but the AI classification and ' +
    'entity-extraction spend happens *before* the insert, so overlap pays twice ' +
    'for nothing.',
  ),
  'fetch-news': spec(
    // Raised 120 -> 300 on 2026-10-15 together with the route's own
    // `maxDuration`; it does strictly more work than `ingest-news` (125 RSS
    // feeds vs. 3 API sources) and was the only AI job budgeted below 300.
    'fetch-news', 300, 'skip',
    'Despite the name this runs the full pipeline after the RSS fetch, ' +
    'including a body fetch and an AI classification for every new article ' +
    '(capped at MAX_NEW_ARTICLES_PER_RUN), so overlap is a real cost. Fail ' +
    'closed like the other AI jobs.',
  ),
  'verification-reminders': spec(
    'verification-reminders', 300, 'skip',
    'SENDS EMAIL. Send-once is tracked by an audit row written AFTER the ' +
    'send, so two concurrent runs can both read "not sent yet" and both ' +
    'mail the same organiser - the one duplicate this ledger cannot ' +
    'prevent on its own. A mailed duplicate cannot be retracted; the job ' +
    'runs daily, so deferring one window costs a day of latency on a ' +
    'reminder that is not time-critical by construction (it is keyed on ' +
    'consequence, not on a clock). Fail closed.',
  ),
  reconcile: spec(
    'reconcile', 300, 'run',
    'THE ONE FAIL-OPEN JOB. Steps 4-5 are convergent and self-healing ' +
    '(docs/29 §7) and it is what bounds echo-column drift to ~24h, so ' +
    'skipping it extends the very drift it repairs. Two concurrent runs ' +
    'converge on the same state; the only non-idempotent effect is a ' +
    'duplicated admin fund-pool notification row, which is harmless.',
  ),
};

/** Acquire the lock for a registered cron job. */
export function acquireCronLock(spec: CronLockSpec): Promise<LockAcquisition> {
  return acquireLock({
    name: spec.name,
    ttlSeconds: spec.ttlSeconds,
    onBackendUnavailable: spec.onBackendUnavailable,
  });
}

/**
 * Body for the early-exit response when a job does not get the lock. Shaped to
 * fit the existing `{ ok: true, data: { skipped, reason } }` cron convention and
 * returned with HTTP 200 — a held lock is the guard working, not an error, and a
 * non-2xx would make the dispatcher and uptime monitors alarm on normal
 * operation.
 */
export function lockSkipPayload(
  spec: CronLockSpec,
  reason: 'held' | 'backend-unavailable',
): { ok: true; data: { skipped: true; reason: string } } {
  return {
    ok: true,
    data: {
      skipped: true,
      reason:
        reason === 'held'
          ? `Another ${spec.name} run holds the lock; exiting to avoid overlap.`
          : `Lock backend unavailable and ${spec.name} fails closed; exiting without running.`,
    },
  };
}
