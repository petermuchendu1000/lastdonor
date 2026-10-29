import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { verifyCronAuth } from '@/lib/cron-auth';
import { acquireCronLock, CRON_LOCKS, lockSkipPayload } from '@/lib/locks';
import { logError } from '@/lib/errors';
import { getWalletBalance, isPayHeroConfigured } from '@/lib/payhero';
import { assessFloat, LOW_FLOAT_EMAIL_COOLDOWN_HOURS } from '@/lib/payhero-float';
import { notifyAdminsPayHeroFloatLow } from '@/lib/notifications';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EVENT = 'cron.payhero_float';

/**
 * Tell somebody when PayHero's fee float is running out.
 *
 * ── WHY THIS JOB EXISTS WHEN THE CHECK ALREADY DID ──────────────────────────
 *
 * `/api/v1/health:111-128` has read this balance and judged it for weeks. What
 * it cannot do is reach anybody: the verdict goes to whoever fetches the
 * endpoint, plus a `console.error` into a log buffer nobody tails, and
 * [VERIFIED 2026-10-29] `fly.toml:289` points Fly's own probe at
 * `/api/v1/live` rather than here - correctly, since the health route's own
 * header forbids pointing a restart-capable probe at it, but it also means
 * nothing at all escalates on a low float.
 *
 * ⛔ WHAT RUNNING OUT COSTS: the float pays PayHero's flat fee per collection,
 * so at zero this platform cannot take an M-Pesa donation - which is the only
 * rail that has ever worked (`docs/72`, `docs/92`). And [VERIFIED by execution,
 * `docs/147` §11.2] PayHero returns NO failure reason: a failed collection
 * carries no reason, description or result-code field, so an empty float is
 * indistinguishable from the two unexplained failures of 2026-10-29. The
 * wallet is shared with BETWOIN LTD, so it can empty with nothing happening on
 * this platform at all.
 *
 * ── THE PREDICATE IS SHARED, DELIBERATELY ───────────────────────────────────
 *
 * The threshold and the arithmetic live in `src/lib/payhero-float.ts` and are
 * read by BOTH this job and the health route. `docs/146` is about exactly this
 * shape - the predicate that counts a thing must be the predicate that reports
 * it - and `docs/138` found a third, hand-written cron list on a settings
 * screen because nobody had applied that rule to operations copy.
 *
 * ── WHY IT WRITES AN AUDIT ROW EVERY RUN, EVEN WHEN HEALTHY ─────────────────
 *
 * `docs/123` requires a scheduled job that decides to do nothing to say so,
 * because the Worker logs only the HTTP status and never reads the body. And
 * `docs/136` §10 measured the cost of the opposite choice: `update-phases`
 * audits only when it changed something, which wrote 22 rows against 288
 * dispatches and made `/admin/simulation`'s staleness signal read "nothing is
 * driving any schedule" 40% of the time.
 *
 * There is a second reason here, specific to this job: nobody has ever had the
 * float's history. It read 2,239 on 2026-10-21, 182.9 on the morning of
 * 2026-10-29 and 2,027.6 that afternoon, and all three figures exist only
 * because somebody happened to probe it by hand. An hourly row makes the drain
 * rate - currently ONE measurement - a thing that can actually be queried.
 *
 * ⚠️ NOT a notification: `createAndEmail` would insert an in-app row, and
 * every value in `NotificationType` is campaign, donor or verification
 * shaped. There is no honest type for an operational alert, and minting a new
 * pgEnum value means a migration against a live money database for a
 * cron's convenience. So this emails directly - and the body still comes from
 * `email-templates`, so it stays inside the plain-language and dark-mode
 * sweeps (`docs/123` §4).
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();

  if (!verifyCronAuth(request.headers.get('authorization'))) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret', requestId } },
      { status: 401 },
    );
  }

  const lockSpec = CRON_LOCKS['payhero-float'];
  const lock = await acquireCronLock(lockSpec);
  if (!lock.ok) {
    return NextResponse.json(lockSkipPayload(lockSpec, lock.reason));
  }

  try {
    /*
      Not configured is a REPORTED state, not a silent one (`docs/123`): the
      health route already says the KES rail is down, but a row here means the
      scheduler's own history shows why no balance was recorded, rather than a
      gap somebody has to explain later.

      ⚠️ INSIDE the try, deliberately. As an early return above it, this path
      exited while holding the lock - and `locks.test.ts` could not have seen
      that, because it checks for the `finally` shape and not for which
      branches reach it.
    */
    if (!isPayHeroConfigured()) {
      await db.insert(auditLogs).values({
        eventType: EVENT,
        targetType: 'payhero_wallet',
        severity: 'warning',
        details: { skipped: true, reason: 'PayHero is not configured; no wallet to read' },
      });
      return NextResponse.json({
        ok: true,
        data: { skipped: true, reason: 'PayHero is not configured' },
      });
    }

    // External GET, no database.
    const wallet = await getWalletBalance();
    const float = assessFloat(wallet.availableBalance);

    let emailed = 0;
    let recipients = 0;
    let emailSkippedReason: string | null = null;

    if (float.isLow) {
      /*
        Cooldown, read from this job's OWN history rather than kept in a
        separate store. `audit_logs` is indexed on both `event_type` and
        `timestamp` (`schema.ts:901-902`), so this is one indexed lookup, and
        it only runs when the float is actually low.
      */
      const since = new Date(Date.now() - LOW_FLOAT_EMAIL_COOLDOWN_HOURS * 3_600_000);
      const [recent] = await db
        .select({ timestamp: auditLogs.timestamp })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.eventType, EVENT),
            gte(auditLogs.timestamp, since),
            inArray(auditLogs.severity, ['warning', 'error']),
          ),
        )
        .orderBy(desc(auditLogs.timestamp))
        .limit(1);

      if (recent) {
        emailSkippedReason = `a low-float alert was already recorded within ${LOW_FLOAT_EMAIL_COOLDOWN_HOURS}h`;
      } else {
        const sent = await notifyAdminsPayHeroFloatLow({
          balanceKes: float.balanceKes,
          collectionsRemaining: float.collectionsRemaining,
          isExhausted: float.isExhausted,
        });
        emailed = sent.emailed;
        recipients = sent.recipients;
        /*
          ⚠️ Distinguished on purpose. "No administrators exist" and "the sends
          failed" are different facts, and an audit row reading `emailed: 0`
          without saying which is the kind of entry somebody later cannot use.
        */
        if (sent.recipients === 0) emailSkippedReason = 'no administrator accounts exist';
        else if (sent.emailed === 0) emailSkippedReason = 'every send was rejected by the mail provider';
      }
    }

    /*
      ⚠️ `severity` is what the cooldown above reads back, so it is the field
      that makes the cooldown work: a healthy run writes `info` and therefore
      never suppresses a later alert.
    */
    await db.insert(auditLogs).values({
      eventType: EVENT,
      targetType: 'payhero_wallet',
      severity: float.isExhausted ? 'error' : float.isLow ? 'warning' : 'info',
      details: {
        // Major KES, as PayHero reports it. See the unit note in payhero-float.ts.
        balanceKes: float.balanceKes,
        collectionsRemaining: float.collectionsRemaining,
        isLow: float.isLow,
        isExhausted: float.isExhausted,
        walletCurrency: wallet.currency,
        /*
          Recorded but NOT read as a health signal: `wallet_status` is PENDING
          even on successful collections (`docs/147` §11.3), so it marks
          nothing.
        */
        walletStatus: wallet.walletStatus,
        emailed,
        recipients,
        emailSkippedReason,
      },
    });

    return NextResponse.json({
      ok: true,
      data: {
        balanceKes: float.balanceKes,
        collectionsRemaining: float.collectionsRemaining,
        isLow: float.isLow,
        isExhausted: float.isExhausted,
        emailed,
        recipients,
        emailSkippedReason,
      },
    });
  } catch (err) {
    logError(err, { route: 'cron/payhero-float', requestId });

    await db
      .insert(auditLogs)
      .values({
        eventType: EVENT,
        targetType: 'payhero_wallet',
        severity: 'error',
        details: {
          failed: true,
          error: err instanceof Error ? err.message : String(err),
        },
      })
      .catch(() => {
        /* the audit write must not mask the original failure */
      });

    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'FLOAT_CHECK_FAILED',
          message: 'Could not read the PayHero wallet balance',
          requestId,
        },
      },
      { status: 500 },
    );
    /*
      ⛔ The release below was MISSING and `locks.test.ts` caught it, not me.
      Without it the lock is held for its whole TTL (maxDuration + 30s) after
      any throw, which turns one failure into a blocked schedule.
    */
  } finally {
    await lock.lock.release();
  }
}
