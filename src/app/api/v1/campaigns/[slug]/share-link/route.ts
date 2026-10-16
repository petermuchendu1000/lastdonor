import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { auth } from '@/lib/auth';
import { mintShareLink, shareUrl } from '@/lib/share-links';
import { appBaseUrl } from '@/lib/unsubscribe-tokens';
import type { ApiError } from '@/types/api';

type RouteParams = { params: Promise<{ slug: string }> };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/v1/campaigns/[slug]/share-link` - this sharer's attributed link.
 *
 * ## Why this route exists
 *
 * GoFundMe's help-centre article "See your impact with unique share links"
 * (id 24972788571803, edited 2026-10-07, VERIFIED) states that a signed-in
 * user gets a unique link from **any** share option, not only after donating.
 * Ours minted one only on the post-donation screen, which left the main share
 * surface - the Share button in the campaign sidebar - handing out the plain
 * campaign URL.
 *
 * That is not a cosmetic gap. `/dashboard/impact` can only ever report what a
 * link carried, so without this route the impact page is structurally empty
 * for everyone who shares the way almost everyone shares. The stats surface
 * and the minting surface are one feature; shipping either alone ships
 * nothing.
 *
 * ## POST, and why repeating it is safe
 *
 * It creates a row the first time. `mintShareLink` is idempotent per
 * (campaign, signed-in user), so every later call returns the same token:
 * a sharer who taps Share ten times keeps one countable link instead of ten
 * links none of which shows their real total.
 *
 * ## Authorisation
 *
 * A session is required. An anonymous caller gets 401 and the client falls
 * back to the plain campaign URL, because a link minted with no `user_id` can
 * never be attributed to anybody - it would be a row of pure noise.
 *
 * No extra visibility check beyond resolving the campaign: the token
 * redirects to the same public campaign page the caller is already on, so it
 * cannot reach anything its holder could not already reach by copying the
 * address bar.
 *
 * Deliberately NOT rate-limited: the write is an idempotent upsert keyed on
 * (campaign, user), so the worst a loop achieves is one row per campaign that
 * already exists - bounded, and indistinguishable from a user who genuinely
 * shared everything.
 *
 * See `docs/58`.
 */

function errorResponse(
  code: ApiError['error']['code'],
  message: string,
  requestId: string,
  status: number,
): NextResponse {
  const body: ApiError = { ok: false, error: { code, message, requestId } };
  return NextResponse.json(body, { status });
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const requestId = randomUUID();
  const { slug: idOrSlug } = await params;

  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return errorResponse(
        'UNAUTHORIZED',
        'Sign in to get a share link that credits you.',
        requestId,
        401,
      );
    }

    const condition = UUID_REGEX.test(idOrSlug)
      ? eq(campaigns.id, idOrSlug)
      : eq(campaigns.slug, idOrSlug);

    const [campaign] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(condition)
      .limit(1);

    if (!campaign) {
      return errorResponse('NOT_FOUND', 'Campaign not found', requestId, 404);
    }

    const link = await mintShareLink({ campaignId: campaign.id, userId });

    // The canonical origin, never the request's own: behind Fly's proxy
    // `request.nextUrl.origin` is the container bind address, which once
    // shipped every share link as `https://0.0.0.0:3000/...`. See docs/57.
    return NextResponse.json({
      ok: true,
      data: { url: shareUrl(link.token, appBaseUrl()) },
    });
  } catch (error) {
    console.error('[POST /api/v1/campaigns/[slug]/share-link]', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to create a share link', requestId, 500);
  }
}
