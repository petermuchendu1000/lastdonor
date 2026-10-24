import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { verifyCronAuth } from '@/lib/cron-auth';
import { acquireCronLock, CRON_LOCKS, lockSkipPayload } from '@/lib/locks';
import { logError } from '@/lib/errors';
import { fetchFxSnapshot } from '@/lib/money/fx-providers';
import { writeFxSnapshot } from '@/lib/money/fx-store.server';
import { fxAgeHours, MAX_FX_AGE_HOURS } from '@/lib/money/fx-convert';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Refresh the cached exchange-rate snapshot. Daily at 02:00 UTC
 * (`src/lib/cron-schedule.ts`).
 *
 * Writes exactly one row of `site_settings` and no money. Rates are display
 * only - see the boundary note at the top of `src/lib/money/fx-convert.ts`.
 *
 * A DEGRADED FETCH IS RECORDED, NOT SWALLOWED. When the primary provider
 * fails and the fallback answers, the run still succeeds but writes an
 * audit row at `warning` naming what failed. docs/90 found
 * `fetchGNewsArticles` swallowing every error and returning `[]`, which made
 * its blackout detection dead code for the platform's whole life; the point
 * of recording the errors here is that a provider that has been failing for
 * a month should be visible before it is the last one standing.
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();

  if (!verifyCronAuth(request.headers.get('authorization'))) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid cron authorization.', requestId } },
      { status: 401 },
    );
  }

  const lockSpec = CRON_LOCKS['refresh-fx-rates'];
  const lock = await acquireCronLock(lockSpec);
  if (!lock.ok) {
    return NextResponse.json(lockSkipPayload(lockSpec, lock.reason));
  }

  try {
    const { snapshot, errors } = await fetchFxSnapshot();
    await writeFxSnapshot(snapshot);

    const ageHours = fxAgeHours(snapshot);

    await db.insert(auditLogs).values({
      eventType: 'cron.refresh_fx_rates',
      targetType: 'site_settings',
      // `warning` when we only got a snapshot because the primary failed, or
      // when what we got is already close to the staleness limit.
      severity: errors.length > 0 || ageHours > MAX_FX_AGE_HOURS / 2 ? 'warning' : 'info',
      details: {
        provider: snapshot.provider,
        asOf: snapshot.asOf,
        ageHours: Math.round(ageHours * 100) / 100,
        currencies: Object.keys(snapshot.rates).sort(),
        /*
          The rates themselves are recorded. They are three numbers, not a
          redistribution of the provider's table, and when a figure on the
          site looks wrong the first question is always "what rate was in
          force at the time" - which is unanswerable if only the timestamp
          is kept.
        */
        rates: snapshot.rates,
        providerErrors: errors,
      },
    });

    return NextResponse.json({
      ok: true,
      data: {
        provider: snapshot.provider,
        asOf: snapshot.asOf,
        ageHours: Math.round(ageHours * 100) / 100,
        currencies: Object.keys(snapshot.rates).sort(),
        degraded: errors.length > 0,
        requestId,
      },
    });
  } catch (err) {
    logError(err, { requestId, route: 'cron/refresh-fx-rates' });

    /*
      Every provider failed. The previous snapshot is deliberately LEFT IN
      PLACE rather than cleared: it is still within MAX_FX_AGE_HOURS for up to
      48 hours and a slightly old rate shown as approximate is better than a
      page that loses its converted figures the first time a CDN has a bad
      minute. Past that window `convertMinor` refuses on its own.
    */
    await db.insert(auditLogs).values({
      eventType: 'cron.refresh_fx_rates_failed',
      targetType: 'site_settings',
      severity: 'error',
      details: { message: err instanceof Error ? err.message : String(err) },
    }).catch(() => { /* the audit write must not mask the original failure */ });

    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Exchange-rate refresh failed.', requestId } },
      { status: 500 },
    );
  } finally {
    await lock.lock.release();
  }
}
