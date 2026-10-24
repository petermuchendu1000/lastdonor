import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { verifyCronAuth } from '@/lib/cron-auth';
import { acquireCronLock, CRON_LOCKS, lockSkipPayload } from '@/lib/locks';
import { logError } from '@/lib/errors';
import { findUnscreenedDocuments, screenDocument } from '@/lib/screening/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Pre-screen uploaded verification documents. Every 5 minutes
 * (`src/lib/cron-schedule.ts`).
 *
 * ── WHY A BATCH OF FIVE, AND WHY SEQUENTIAL ─────────────────────────────────
 *
 * [VERIFIED 2026-10-24] one read took 3.4s-29.5s, and 27.5s for a PDF through
 * the rasteriser. Five sequentially is ~150s worst case, inside this route's
 * 300s ceiling with room to spare. Running them concurrently would be faster
 * and is deliberately not done: each document holds a database connection
 * across a half-minute HTTP call to a third party, and the pool is `max: 5`
 * shared by every request on the machine (`docs/87` - seven pool wedges in one
 * day). A backlog clears at 60 documents an hour, which is faster than this
 * platform has ever received them.
 *
 * ── THE JOB CANNOT APPROVE A CAMPAIGN ───────────────────────────────────────
 *
 * It writes `document_screenings`, and at most flips one
 * `verification_documents.status` to `approved`. It never touches
 * `campaigns.verification_status`, so no payout gate and no raise cap moves -
 * see `src/lib/screening/decide.ts`.
 */
const BATCH_SIZE = 5;

export async function GET(request: NextRequest) {
  const requestId = randomUUID();

  if (!verifyCronAuth(request.headers.get('authorization'))) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid cron authorization.', requestId } },
      { status: 401 },
    );
  }

  const lockSpec = CRON_LOCKS['screen-documents'];
  const lock = await acquireCronLock(lockSpec);
  if (!lock.ok) {
    return NextResponse.json(lockSkipPayload(lockSpec, lock.reason));
  }

  try {
    const pending = await findUnscreenedDocuments(BATCH_SIZE);
    if (pending.length === 0) {
      // No audit row for an idle run. This fires every five minutes; a row
      // each time would bury the rows that mean something (docs/66).
      return NextResponse.json({ ok: true, data: { screened: 0, requestId } });
    }

    const results = [];
    for (const doc of pending) {
      // Sequential on purpose - see the note above about the connection pool.
      results.push(await screenDocument(doc.documentId));
    }

    const approved = results.filter((r) => r.approved).length;
    const failed = results.filter((r) => r.error).length;

    await db.insert(auditLogs).values({
      eventType: 'cron.screen_documents',
      targetType: 'verification_document',
      severity: failed > 0 ? 'warning' : 'info',
      details: {
        screened: results.length,
        autoApproved: approved,
        needsHuman: results.length - approved,
        failed,
        // Per document: what was decided and why. No extracted content and no
        // names - this row is read far more widely than the screening table.
        outcomes: results.map((r) => ({
          documentId: r.documentId,
          action: r.action,
          flags: r.flags,
          error: r.error,
        })),
      },
    });

    return NextResponse.json({
      ok: true,
      data: {
        screened: results.length,
        autoApproved: approved,
        needsHuman: results.length - approved,
        failed,
        requestId,
      },
    });
  } catch (err) {
    logError(err, { requestId, route: 'cron/screen-documents' });

    /*
      A failure here leaves documents at `pending` with no screening row, so
      the next run simply picks them up again. Nothing is half-approved: the
      screening row and the approval happen in that order, and the approval is
      keyed on the document still being `pending`.
    */
    await db.insert(auditLogs).values({
      eventType: 'cron.screen_documents_failed',
      targetType: 'verification_document',
      severity: 'error',
      details: { message: err instanceof Error ? err.message : String(err) },
    }).catch(() => { /* must not mask the original failure */ });

    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Document screening failed.', requestId } },
      { status: 500 },
    );
  } finally {
    await lock.lock.release();
  }
}
