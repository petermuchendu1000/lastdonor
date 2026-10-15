import { NextRequest, NextResponse } from 'next/server';
import { runNewsPipeline } from '@/lib/news/news-pipeline';
import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { logError, safeCronError } from '@/lib/errors';
import { verifyCronAuth } from '@/lib/cron-auth';
import { randomUUID } from 'crypto';
import { acquireCronLock, CRON_LOCKS, lockSkipPayload } from '@/lib/locks';

export const dynamic = 'force-dynamic';
/**
 * 300, raised from 120 on 2026-10-15.
 *
 * Despite the name this route runs the FULL pipeline (`runNewsPipeline`), and
 * in `fetch-rss` mode it reads 125 feeds rather than `ingest-news`'s 3 API
 * sources - strictly more work than `ingest-news`, which was already budgeted
 * 300. At 120 a run that got as far as classification was being killed
 * mid-flight, after the article bodies had been paid for and written.
 *
 * `CRON_LOCKS['fetch-news'].maxDurationSeconds` mirrors this number and
 * `locks.test.ts:232` asserts they match, so the two cannot drift.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  if (!verifyCronAuth(request.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid cron authorization.', requestId } }, { status: 401 });
  }

  // ── Overlap guard (P1-11, docs/26 §4) ──────────────────────────────────
  // TTL is derived from this route's maxDuration; see CRON_LOCKS for why this
  // job fails closed when the lock backend is unreachable.
  const lockSpec = CRON_LOCKS['fetch-news'];
  const lock = await acquireCronLock(lockSpec);
  if (!lock.ok) {
    return NextResponse.json(lockSkipPayload(lockSpec, lock.reason));
  }

  try {
    const result = await runNewsPipeline('fetch-rss');

    await db.insert(auditLogs).values({
      eventType: 'cron.fetch_news',
      severity: result.errors.length > 0 ? 'warning' : 'info',
      details: result,
    });

    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    logError(error, { requestId, route: '/api/v1/cron/fetch-news', method: 'GET' });

    await db.insert(auditLogs).values({
      eventType: 'cron.fetch_news',
      severity: 'error',
      details: { error: safeCronError(error), requestId },
    }).catch(() => {});

    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'News fetch processing failed.', requestId } },
      { status: 500 },
    );
  } finally {
    await lock.lock.release();
  }
}
