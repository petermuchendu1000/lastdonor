import { NextRequest, NextResponse } from 'next/server';
import {
  runSimulation,
  seedDonationsOptedIn,
  SEED_DONATIONS_REFUSAL_REASON,
} from '@/lib/seed/simulation-engine';
import { calculateAutoVolume } from '@/lib/seed/phase-out';
import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { getSetting } from '@/lib/settings.server';
import { logError, safeCronError } from '@/lib/errors';
import { verifyCronAuth } from '@/lib/cron-auth';
import { randomUUID } from 'crypto';
import { acquireCronLock, CRON_LOCKS, lockSkipPayload } from '@/lib/locks';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid cron authorization.' } }, { status: 401 });
  }

  // ── Structural refusal (docs/33) ────────────────────────────────
  // This job fabricates donation rows that are deliberately indistinguishable
  // from real ones in public campaign totals. docs/33 §3 records that it was
  // not built, over an owner instruction to build it; what actually stopped it
  // was a default-false setting and a missing scheduler, both of which an
  // admin-UI toggle or a Vercel deploy could supply.
  //
  // So the refusal is enforced here, ahead of the lock, the settings reads and
  // every DB write: nothing an admin can click is sufficient. 403 rather than
  // 200-with-skipped, because a deployment that schedules this job without the
  // environment opt-in is misconfigured and should be noticed, not quietly
  // no-op for months.
  if (!seedDonationsOptedIn()) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'FORBIDDEN', message: SEED_DONATIONS_REFUSAL_REASON },
      },
      { status: 403 },
    );
  }

  // ── Overlap guard (P1-11, docs/26 §4) ──────────────────────────────────
  // The highest-risk job on the schedule: a run that overlaps its own next
  // invocation doubles donation volume and breaches the 150% overfund cap,
  // because each run carries its own in-memory campaign total. Fails CLOSED
  // when the lock backend is unreachable - see CRON_LOCKS.
  //
  // Taken before the settings guards below (rather than after) so that the
  // lock, not a settings read, is the first thing a second concurrent run
  // meets. The guards therefore moved inside the try/finally, which also means
  // a failing `getSetting` now returns a logged 500 instead of an unhandled
  // rejection.
  const lockSpec = CRON_LOCKS['simulate-donations'];
  const lock = await acquireCronLock(lockSpec);
  if (!lock.ok) {
    return NextResponse.json(lockSkipPayload(lockSpec, lock.reason));
  }

  try {
    // Guard: only run if simulation is enabled via settings
    const enabled = await getSetting('simulation.enabled');
    if (!enabled) {
      return NextResponse.json({
        ok: true,
        data: { skipped: true, reason: 'simulation.enabled is false' },
      });
    }

    // Check global pause
    const pauseAll = await getSetting('simulation.pause_all');
    if (pauseAll) {
      return NextResponse.json({
        ok: true,
        data: { skipped: true, reason: 'simulation.pause_all is true' },
      });
    }

    const manualVolume = await getSetting('simulation.volume_multiplier');
    const autoVolume = await calculateAutoVolume();

    // Use the lower of manual and auto-computed volume
    const effectiveVolume = autoVolume >= 0 ? Math.min(manualVolume, autoVolume) : manualVolume;

    if (effectiveVolume === 0) {
      return NextResponse.json({
        ok: true,
        data: { skipped: true, reason: 'Effective volume is 0 (phase-out or manual)' },
      });
    }

    const result = await runSimulation(effectiveVolume);

    await db.insert(auditLogs).values({
      eventType: 'cron.simulate_donations',
      severity: result.errors.length > 0 ? 'warning' : 'info',
      details: result,
    });

    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    const requestId = randomUUID();
    logError(error, { requestId, route: '/api/v1/cron/simulate-donations', method: 'GET' });

    await db.insert(auditLogs).values({
      eventType: 'cron.simulate_donations',
      severity: 'error',
      details: { error: safeCronError(error), requestId },
    }).catch(() => {});

    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Donation simulation processing failed.', requestId } },
      { status: 500 },
    );
  } finally {
    await lock.lock.release();
  }
}
