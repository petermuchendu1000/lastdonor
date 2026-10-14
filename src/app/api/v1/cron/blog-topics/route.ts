import { NextRequest, NextResponse } from 'next/server';
import { discoverTopics } from '@/lib/blog/topic-discovery';
import { rescoreAllTopics } from '@/lib/blog/topic-scorer';
import { fetchRedditTopics } from '@/lib/blog/reddit-listener';
import { markStaleTopics } from '@/lib/blog/publishing-guardrails';
import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { verifyCronAuth } from '@/lib/cron-auth';
import { acquireCronLock, CRON_LOCKS, lockSkipPayload } from '@/lib/locks';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Daily cron: Discover new blog topics and rescore existing ones.
 * Schedule: 6:00 AM UTC daily
 *
 * Pipeline order:
 *  1. Reddit listener (fetches external data, inserts into newsItems + topic queue)
 *  2. Keyword bank + news discovery (fills remaining slots from static bank)
 *  3. Rescore all pending topics (updates priority with fresh seasonal data)
 *
 * Reddit runs FIRST so that:
 *  - Fresh Reddit posts are available in newsItems for the news cross-pollination step
 *  - Reddit-sourced topics participate in the rescore immediately
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing authorization' } }, { status: 401 });
  }

  // ── Overlap guard (P1-11, docs/26 §4) ──────────────────────────────────
  // TTL is derived from this route's maxDuration; see CRON_LOCKS for this job's
  // lock-backend-unavailable policy and why.
  const lockSpec = CRON_LOCKS['blog-topics'];
  const lock = await acquireCronLock(lockSpec);
  if (!lock.ok) {
    return NextResponse.json(lockSkipPayload(lockSpec, lock.reason));
  }

  try {
    // Step 0: Expire stale topics to free up category slots for fresh ones.
    await markStaleTopics();
    // Stale topic count logged server-side only (no console.log in production)

    // Step 1: Discover topics from Reddit communities (complaints + compliments)
    // Runs first so Reddit-sourced newsItems are available for Step 2's news cross-pollination.
    // Isolated in try/catch so Reddit failures don't block keyword-based discovery.
    let redditTopics: Awaited<ReturnType<typeof fetchRedditTopics>> = [];
    try {
      redditTopics = await fetchRedditTopics(2);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[blog-topics cron] Reddit listener failed (non-blocking):', msg);
    }

    // Step 2: Discover topics from keyword bank + seasonal calendar + news
    const newTopics = await discoverTopics(3);

    // Step 3: Rescore all pending topics with latest seasonal data
    const rescored = await rescoreAllTopics();

    await db.insert(auditLogs).values({
      eventType: 'blog_topics_discovered',
      targetType: 'system',
      details: {
        source: 'cron',
        newTopicsCount: newTopics.length + redditTopics.length,
        newTopicIds: newTopics,
        redditTopics: redditTopics.map((r) => ({
          topicId: r.topicId,
          keyword: r.keyword,
          category: r.category,
          sentiment: r.sentiment,
          relevance: r.relevanceScore,
          url: r.redditUrl,
        })),
        rescoredCount: rescored.length,
      },
      severity: 'info',
    });

    return NextResponse.json({
      ok: true,
      newTopics: newTopics.length,
      redditTopics: redditTopics.length,
      rescored: rescored.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[blog-topics cron]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await lock.lock.release();
  }
}
