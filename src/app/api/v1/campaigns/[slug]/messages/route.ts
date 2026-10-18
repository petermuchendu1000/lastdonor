import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { insertCampaignMessage } from '@/lib/echo-counters';
import { campaigns, campaignMessages, users } from '@/db/schema';
import { publicMessageSelect } from '@/db/public-select';
import { eq, and, desc, gte, sql, or } from 'drizzle-orm';
import { withApiHandler } from '@/lib/api-handler';
import { parsePagination, requireAuth, redactAnonymousDonor, parseBody } from '@/lib/api-helpers';
import { apiError } from '@/lib/errors';
import { messageSchema } from '@/lib/validators/message';

const RATE_LIMIT_PER_DAY = 5;
const DEDUP_WINDOW_MS = 30_000;

export const GET = withApiHandler(async (request, { requestId, params }) => {
  const slug = params!.slug;

  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.slug, slug),
        or(
          eq(campaigns.status, 'active'),
          eq(campaigns.status, 'last_donor_zone'),
          eq(campaigns.status, 'completed'),
        ),
      ),
    )
    .limit(1);

  if (!campaign) {
    return apiError('NOT_FOUND', 'Campaign not found.', requestId);
  }

  const { limit, offset } = parsePagination(request.nextUrl.searchParams);

  const messages = await db
    .select(publicMessageSelect)
    .from(campaignMessages)
    .where(
      and(
        eq(campaignMessages.campaignId, campaign.id),
        eq(campaignMessages.hidden, false),
      ),
    )
    .orderBy(desc(campaignMessages.createdAt))
    .offset(offset)
    .limit(limit + 1);

  const hasMore = messages.length > limit;
  const data = messages.slice(0, limit).map(redactAnonymousDonor);

  return NextResponse.json({
    ok: true,
    data,
    meta: { cursor: hasMore ? String(offset + limit) : undefined, hasMore },
  });
});

export const POST = withApiHandler(async (request, { requestId, session, params }) => {
  const slug = params!.slug;

  const auth = requireAuth(session, requestId);
  if ('error' in auth) return auth.error;

  const parsed = await parseBody(request, messageSchema, requestId);
  if ('error' in parsed) return parsed.error;

  const [campaign] = await db
    .select({ id: campaigns.id, status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.slug, slug))
    .limit(1);

  if (!campaign || !['active', 'last_donor_zone', 'completed'].includes(campaign.status)) {
    return apiError('NOT_FOUND', 'Campaign not found.', requestId);
  }

  // Rate limiting: 5 messages per user per campaign per day
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [recentCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaignMessages)
    .where(
      and(
        eq(campaignMessages.campaignId, campaign.id),
        eq(campaignMessages.userId, auth.session.user.id),
        gte(campaignMessages.createdAt, oneDayAgo),
      ),
    );

  if (recentCount.count >= RATE_LIMIT_PER_DAY) {
    return apiError('RATE_LIMITED', 'Rate limit exceeded. Maximum 5 messages per campaign per day.', requestId);
  }

  const [userProfile] = await db
    .select({ name: users.name, location: users.location })
    .from(users)
    .where(eq(users.id, auth.session.user.id))
    .limit(1);

  const donorName = parsed.data.isAnonymous
    ? 'Anonymous'
    : (userProfile?.name ?? 'Donor');
  const donorLocation = parsed.data.isAnonymous
    ? null
    : (userProfile?.location ?? null);

  // Idempotency: reject duplicate messages within 30 seconds
  const dedupWindow = new Date(Date.now() - DEDUP_WINDOW_MS);
  const [existingMsg] = await db
    .select({ id: campaignMessages.id, createdAt: campaignMessages.createdAt })
    .from(campaignMessages)
    .where(
      and(
        eq(campaignMessages.campaignId, campaign.id),
        eq(campaignMessages.userId, auth.session.user.id),
        eq(campaignMessages.message, parsed.data.message),
        gte(campaignMessages.createdAt, dedupWindow),
      ),
    )
    .limit(1);

  if (existingMsg) {
    return NextResponse.json({
      ok: true,
      data: { id: existingMsg.id, createdAt: existingMsg.createdAt },
    }, { status: 200 });
  }

  const message = await insertCampaignMessage({
    campaignId: campaign.id,
    userId: auth.session.user.id,
    donorName,
    donorLocation,
    message: parsed.data.message,
    isAnonymous: parsed.data.isAnonymous,
  });

  // Best-effort: drop this instance's ISR entry for the campaign page so the
  // crawler-visible HTML and a no-JS reload pick the message up. It is NOT
  // sufficient on its own: with no shared cache handler deployed, this only
  // invalidates the instance that served the POST (docs/26 section 5), which is
  // why MessageWall also re-reads this endpoint on mount. See docs/43.
  revalidatePath(`/campaigns/${slug}`);

  return NextResponse.json({
    ok: true,
    data: { id: message.id, createdAt: message.createdAt },
  }, { status: 201 });
});
