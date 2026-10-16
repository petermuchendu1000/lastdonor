/**
 * `/s/<token>` - the entry point of an attributed share link.
 *
 * Resolves the token, counts the visit, drops the attribution cookie and
 * redirects to the campaign. A Route Handler rather than a page because only
 * a handler can set a cookie and redirect in one response; a Server Component
 * can do neither.
 *
 * Deliberately NOT under `/api`, so it stays outside the default-deny
 * middleware matcher and needs no entry in `PUBLIC_API_ROUTES`. It is a
 * public link by definition - anyone with it is meant to follow it.
 *
 * Unknown, malformed and expired tokens all redirect to `/campaigns` rather
 * than erroring. Someone followed a link a friend sent them; a 404 punishes
 * them for the link having gone stale. See `docs/57`.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import {
  SHARE_ATTRIBUTION_COOKIE,
  SHARE_ATTRIBUTION_MAX_AGE_SECONDS,
  resolveShareLinkAndCountClick,
} from '@/lib/share-links';
import { logError } from '@/lib/errors';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const fallback = new URL('/campaigns', request.nextUrl.origin);

  try {
    const link = await resolveShareLinkAndCountClick(token);
    if (!link) return NextResponse.redirect(fallback, { status: 302 });

    const rows = await db
      .select({ slug: campaigns.slug })
      .from(campaigns)
      .where(eq(campaigns.id, link.campaignId))
      .limit(1);

    const slug = rows[0]?.slug;
    if (!slug) return NextResponse.redirect(fallback, { status: 302 });

    const destination = new URL(`/campaigns/${slug}`, request.nextUrl.origin);
    const response = NextResponse.redirect(destination, { status: 302 });

    response.cookies.set({
      name: SHARE_ATTRIBUTION_COOKIE,
      value: token,
      maxAge: SHARE_ATTRIBUTION_MAX_AGE_SECONDS,
      path: '/',
      /*
       * httpOnly: the browser never needs to read this. Only `create-checkout`
       * does, server-side.
       * sameSite 'lax': the whole point is that it survives arriving from
       * somewhere else, which 'strict' would defeat.
       */
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return response;
  } catch (error) {
    /*
     * A share link must never be a dead end. If the lookup fails, send the
     * visitor to the campaign list and lose only the attribution.
     */
    logError(error, 's/[token]');
    return NextResponse.redirect(fallback, { status: 302 });
  }
}
