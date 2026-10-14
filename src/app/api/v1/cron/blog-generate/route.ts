import { NextRequest, NextResponse } from 'next/server';
import { runBlogPipeline } from '@/lib/blog/blog-pipeline';
import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { verifyCronAuth } from '@/lib/cron-auth';
import { acquireCronLock, CRON_LOCKS, lockSkipPayload } from '@/lib/locks';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Daily cron: Run the blog generation pipeline.
 * Schedule: 8:00 AM UTC daily
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing authorization' } }, { status: 401 });
  }

  // Allow disabling via env
  if (process.env.BLOG_PIPELINE_ENABLED !== 'true') {
    console.warn('[blog-generate cron] BLOG_PIPELINE_ENABLED is not set to "true" - pipeline skipped. Set BLOG_PIPELINE_ENABLED=true in Vercel env vars to enable blog auto-generation.');
    return NextResponse.json({ ok: true, skipped: true, reason: 'Pipeline disabled - set BLOG_PIPELINE_ENABLED=true in environment variables' });
  }

  // ── Overlap guard (P1-11, docs/26 §4) ──────────────────────────────────
  // TTL is derived from this route's maxDuration; see CRON_LOCKS for this job's
  // lock-backend-unavailable policy and why.
  const lockSpec = CRON_LOCKS['blog-generate'];
  const lock = await acquireCronLock(lockSpec);
  if (!lock.ok) {
    return NextResponse.json(lockSkipPayload(lockSpec, lock.reason));
  }

  try {
    const maxPosts = parseInt(process.env.BLOG_MAX_POSTS_PER_DAY ?? '1', 10);
    const autoPublish = process.env.BLOG_AUTO_PUBLISH === 'true';
    const minPriority = parseInt(process.env.BLOG_MIN_PRIORITY_SCORE ?? '50', 10);

    const result = await runBlogPipeline({
      maxPosts,
      autoPublish,
      minPriorityScore: minPriority,
    });

    await db.insert(auditLogs).values({
      eventType: 'blog_pipeline_completed',
      targetType: 'system',
      details: {
        source: 'cron',
        topicsProcessed: result.topicsProcessed,
        postsCreated: result.postsCreated,
        postsPublished: result.postsPublished,
        errors: result.errors,
      },
      severity: result.errors.length > 0 ? 'warning' : 'info',
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[blog-generate cron]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await lock.lock.release();
  }
}
