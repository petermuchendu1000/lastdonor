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

  /*
    Disabled via env - and the SKIP IS RECORDED, which it was not.

    ⛔ This returned HTTP 200 with `skipped: true` and wrote nothing. The cron
    Worker logs the status and deliberately never reads the body (`docs/66`),
    so it logged `blog-generate ok 200` every day at 08:00 while the pipeline
    did nothing - and `blog_pipeline_completed` was never written, so there was
    no row anywhere saying why. [VERIFIED 2026-10-27] eleven
    `blog_topics_discovered` rows, 28 queued topics, and **zero blog posts
    ever**, across nine days of apparently-healthy runs.

    Its sibling `send-newsletter` gets this right: it refuses for a missing
    `MAILING_POSTAL_ADDRESS` and writes an audit row saying so, which is how
    that refusal is discoverable at all. This now matches it. The `docs/106`
    "exit 0 is not success" family, at the cron layer.

    ⚠️ The old message said to set the variable "in Vercel env vars". This
    platform runs on Fly (`docs/26`, `docs/35`); there is no Vercel console to
    go to.
  */
  if (process.env.BLOG_PIPELINE_ENABLED !== 'true') {
    const reason =
      'BLOG_PIPELINE_ENABLED is not "true", so no post was generated. ' +
      'Set it on the Fly app to enable blog auto-generation.';
    console.warn(`[blog-generate cron] ${reason}`);
    await db.insert(auditLogs).values({
      eventType: 'blog_pipeline_skipped',
      targetType: 'system',
      details: { source: 'cron', reason, postsCreated: 0 },
      severity: 'warning',
    });
    return NextResponse.json({ ok: true, skipped: true, reason });
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
    /*
      ⛔ This path was as silent as the disabled one above: a `console.error`
      and a 500, with no row anywhere. The Worker records the status
      (`docs/66`), so a failing run IS visible in its log as a 500 - but the
      log says only that, and it is a Cloudflare tail nobody is watching,
      while the three ways this route can do nothing (flag off, lock held,
      pipeline threw) were indistinguishable from each other in the database.
      That is why the diagnosis in `docs/123` had to be made by elimination
      rather than read off a row.
    */
    const message = error instanceof Error ? error.message : String(error);
    console.error('[blog-generate cron]', message);
    await db.insert(auditLogs).values({
      eventType: 'blog_pipeline_failed',
      targetType: 'system',
      details: { source: 'cron', error: message, postsCreated: 0 },
      severity: 'error',
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await lock.lock.release();
  }
}
