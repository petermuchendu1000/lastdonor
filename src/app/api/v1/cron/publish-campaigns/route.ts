import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { newsItems, campaigns, auditLogs } from '@/db/schema';
import { eq, and, gte, desc } from 'drizzle-orm';
import {
  publishCampaignFromNewsItem,
  selectBalancedCandidates,
} from '@/lib/news/campaign-publisher';
import { logError } from '@/lib/errors';
import { verifyCronAuth } from '@/lib/cron-auth';
import { randomUUID } from 'crypto';
import type { StoryPattern } from '@/lib/ai/prompts/story-structures';
import { acquireCronLock, CRON_LOCKS, lockSkipPayload } from '@/lib/locks';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  if (!verifyCronAuth(request.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid cron authorization.', requestId } }, { status: 401 });
  }

  // ── Overlap guard (P1-11, docs/26 §4) ──────────────────────────────────
  // TTL is derived from this route's maxDuration; see CRON_LOCKS for this job's
  // lock-backend-unavailable policy and why.
  const lockSpec = CRON_LOCKS['publish-campaigns'];
  const lock = await acquireCronLock(lockSpec);
  if (!lock.ok) {
    return NextResponse.json(lockSkipPayload(lockSpec, lock.reason));
  }

  try {
    // Find high-scoring news items that haven't created campaigns yet.
    // Balance: at most 2 of the 5 slots go to military-sourced items (40%).
    const MILITARY_SOURCES = ['DVIDS', 'Defense.gov', 'Stars and Stripes', 'Military Times'];
    const MAX_PER_RUN = 5;
    const MAX_MILITARY_PER_RUN = 2;

    const allCandidates = await db
      .select()
      .from(newsItems)
      .where(
        and(
          eq(newsItems.campaignCreated, false),
          gte(newsItems.relevanceScore, 70),
        ),
      )
      .orderBy(desc(newsItems.relevanceScore))
      .limit(20);

    // Take up to 2 military, then fill the REMAINING slots from the others.
    // The previous expression capped others at 3 independently, so a candidate
    // set with 0 or 1 military item could only ever publish 3 or 4 - see
    // `selectBalancedCandidates` for the observed consequence.
    const qualifiedItems = selectBalancedCandidates(allCandidates, {
      isMilitary: (i) =>
        MILITARY_SOURCES.includes(i.source) || i.category === 'military',
      maxTotal: MAX_PER_RUN,
      maxMilitary: MAX_MILITARY_PER_RUN,
    });

    let published = 0;
    let volumeLimited = 0;
    /** Per-item volume-guard refusals. Reported, never counted as failures. */
    const rateLimited: string[] = [];
    const errors: string[] = [];

    // Shared state across the batch for anti-repetition
    const recentStoryPatterns: StoryPattern[] = [];

    /*
      Ordered by `createdAt`, not `publishedAt`: since docs/79 a generated
      campaign is queued unpublished, so ordering by `publishedAt` would
      hide every campaign still awaiting review from this anti-repetition
      window.
    */
    const recentCampaigns = await db
      .select({ title: campaigns.title })
      .from(campaigns)
      .orderBy(desc(campaigns.createdAt))
      .limit(15);
    const recentTitles = recentCampaigns.map((c) => c.title);

    for (const item of qualifiedItems) {
      try {
        const result = await publishCampaignFromNewsItem(item.id, {
          recentStoryPatterns,
          recentTitles,
          // Drafted into the review queue, not published: a person
          // approves it in /admin/campaigns. See docs/79.
          auditEventType: 'campaign.auto_drafted',
        });

        if (result.ok) {
          published++;
        } else if (result.error.code === 'VOLUME_LIMIT') {
          // A volume guard refused (daily limit / max concurrent / phase-out).
          // For a job that runs every 30 minutes against a daily limit this is
          // the expected steady state, not a fault, so it is reported on its
          // own axis and kept out of `errors` - which also keeps the audit row
          // at severity 'info' instead of warning on every rate-limited run.
          //
          // The batch does NOT abort. The guards are checked before the
          // article fetch and every AI call (`campaign-publisher.ts` step 1b),
          // so each remaining item costs three aggregate queries and no AI
          // spend; in exchange every candidate gets an outcome in the summary
          // rather than the tail being silently dropped. `max_concurrent` can
          // also free up mid-run, which a `break` could never notice.
          volumeLimited++;
          rateLimited.push(`${item.title}: ${result.error.message}`);
        } else {
          // ALREADY_CREATED and DUPLICATE_SUBJECT are expected dedup outcomes, not errors
          if (result.error.code !== 'ALREADY_CREATED' && result.error.code !== 'DUPLICATE_SUBJECT') {
            errors.push(`${item.title}: ${result.error.message}`);
          }
        }
      } catch (error) {
        errors.push(`Publish error for "${item.title}": ${String(error)}`);
      }
    }

    await db.insert(auditLogs).values({
      eventType: 'cron.publish_campaigns',
      severity: errors.length > 0 ? 'warning' : 'info',
      details: {
        qualifiedItems: qualifiedItems.length,
        published,
        volumeLimited,
        rateLimited,
        errors,
      },
    });

    return NextResponse.json({
      ok: true,
      data: {
        qualifiedItems: qualifiedItems.length,
        published,
        volumeLimited,
        rateLimited,
        errors,
      },
    });
  } catch (error) {
    logError(error, { requestId, route: '/api/v1/cron/publish-campaigns', method: 'GET' });

    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Campaign publishing failed.', requestId } },
      { status: 500 },
    );
  } finally {
    await lock.lock.release();
  }
}
