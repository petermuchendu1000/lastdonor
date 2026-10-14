import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { donorCampaignSubscriptions, campaigns, users } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { subscribeCampaignSchema } from '@/lib/validators/verification';
import { auth } from '@/lib/auth';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import type { ApiError } from '@/types/api';

type RouteParams = { params: Promise<{ slug: string }> };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Campaign update subscriptions (audit P1-6).
 *
 * ## What was wrong
 *
 * `POST` and `DELETE` took an email address out of the request body and acted
 * on it with no authentication. `PUBLIC_API_PREFIXES` matched with
 * `startsWith('/api/v1/campaigns')`, so this sub-route inherited the public
 * status of the campaign listing and anyone could add a stranger to a
 * campaign's update mailing list, or remove them from it.
 *
 * ## How it is authorised now
 *
 * - `GET`    — unchanged. Reports the *caller's own* state; answers
 *              `subscribed: false` with no session and discloses nothing.
 * - `POST`   — requires a session, and the address must be the session's own.
 *              There is no legitimate anonymous caller: the only in-app
 *              subscribe surfaces (`SubscribeButton`, the subscriptions
 *              dashboard) render for signed-in users and send the session
 *              email. Opting a third party into mail on an anonymous caller's
 *              word is not a flow worth keeping.
 * - `DELETE` — a session owning the address, **or** an HMAC-signed token bound
 *              to (campaignId, email). Unsubscribe must keep working from an
 *              email link with no login (CAN-SPAM §316.5; GDPR Art. 7(3)
 *              requires withdrawal to be as easy as consent), so auth alone is
 *              not an acceptable fix here.
 *
 * ## The token
 *
 *   message = `campaign-unsubscribe:v1:<campaignId>:<normalised email>`
 *   token   = hex hmac-sha256(secret, message)
 *   secret  = CAMPAIGN_UNSUBSCRIBE_SECRET, else NEWSLETTER_UNSUBSCRIBE_SECRET
 *
 * The version and purpose prefix domain-separates the signature, so sharing
 * the newsletter secret as a fallback cannot be used to mint a token for the
 * other flow. A dedicated `CAMPAIGN_UNSUBSCRIBE_SECRET` is still preferred.
 *
 * Not single-use (persisting redemption needs a migration, and migrations are
 * frozen — see CLAUDE.md); replay is harmless because unsubscribing is
 * idempotent and terminal, and the token grants nothing else. Not expiring,
 * because an unsubscribe link that stops working is itself a compliance defect.
 *
 * ⚠️ The links in `src/lib/email-adaptive.ts` and the page at
 * `src/app/unsubscribe/` do not carry this token yet, and both are outside
 * this change's ownership. Until they are updated, campaign unsubscribe from
 * an email link answers 403. See the handover notes.
 */

const TOKEN_VERSION = 'campaign-unsubscribe:v1';

function errorResponse(
  code: ApiError['error']['code'],
  message: string,
  requestId: string,
  status: number,
): NextResponse {
  const body: ApiError = { ok: false, error: { code, message, requestId } };
  return NextResponse.json(body, { status });
}

function hexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

function unsubscribeSecret(): string | null {
  return (
    process.env.CAMPAIGN_UNSUBSCRIBE_SECRET?.trim() ||
    process.env.NEWSLETTER_UNSUBSCRIBE_SECRET?.trim() ||
    null
  );
}

/** Verify a campaign-unsubscribe token against (campaignId, email). */
function verifyCampaignUnsubscribeToken(
  token: string | null | undefined,
  campaignId: string,
  email: string,
): boolean {
  if (!token) return false;

  const secret = unsubscribeSecret();
  if (!secret) {
    // Fail closed. A missing secret must never degrade into "accept anything".
    console.error(
      '[campaigns/subscribe] neither CAMPAIGN_UNSUBSCRIBE_SECRET nor ' +
      'NEWSLETTER_UNSUBSCRIBE_SECRET is set; rejecting all unsubscribe tokens.',
    );
    return false;
  }

  const expected = createHmac('sha256', secret)
    .update(`${TOKEN_VERSION}:${campaignId}:${email}`)
    .digest('hex');

  return hexEquals(token.trim(), expected);
}

async function resolveCampaignId(idOrSlug: string): Promise<string | null> {
  const condition = UUID_REGEX.test(idOrSlug)
    ? eq(campaigns.id, idOrSlug)
    : eq(campaigns.slug, idOrSlug);

  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(condition)
    .limit(1);

  return campaign?.id ?? null;
}

/** The signed-in caller's own address, normalised, or null. */
async function sessionEmail(): Promise<string | null> {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (email) return email;

  // Fall back to the users table: the JWT may predate the email claim.
  const userId = session?.user?.id;
  if (!userId) return null;

  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user?.email?.trim().toLowerCase() ?? null;
}

/** Read `token` from the query string or a JSON body. */
function readToken(request: NextRequest, body: unknown): string | null {
  const fromQuery = request.nextUrl.searchParams.get('token');
  if (fromQuery) return fromQuery;
  const fromBody = (body as { token?: unknown } | null)?.token;
  return typeof fromBody === 'string' && fromBody ? fromBody : null;
}

/**
 * GET /api/v1/campaigns/[slug]/subscribe - Check subscription status for the current user
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const requestId = randomUUID();
  const { slug: idOrSlug } = await params;

  try {
    const email = await sessionEmail();
    if (!email) {
      return NextResponse.json({ ok: true, data: { subscribed: false } });
    }

    const campaignId = await resolveCampaignId(idOrSlug);
    if (!campaignId) {
      return errorResponse('NOT_FOUND', 'Campaign not found', requestId, 404);
    }

    const [sub] = await db
      .select({ subscribed: donorCampaignSubscriptions.subscribed })
      .from(donorCampaignSubscriptions)
      .where(
        and(
          eq(donorCampaignSubscriptions.campaignId, campaignId),
          eq(donorCampaignSubscriptions.donorEmail, email),
        ),
      )
      .limit(1);

    return NextResponse.json({
      ok: true,
      data: { subscribed: sub?.subscribed === true },
    });
  } catch (error) {
    console.error('[GET /api/v1/campaigns/[slug]/subscribe]', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to check subscription', requestId, 500);
  }
}

/**
 * POST /api/v1/campaigns/[slug]/subscribe - Subscribe to campaign updates
 *
 * Requires a session; the address must be the session's own.
 * Accepts both UUID and slug for the campaign identifier.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = randomUUID();
  const { slug: idOrSlug } = await params;

  try {
    const body = await request.json().catch(() => null);
    const parsed = subscribeCampaignSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Invalid request body',
        requestId,
        400,
      );
    }

    const { email } = parsed.data;

    const callerEmail = await sessionEmail();
    if (!callerEmail) {
      return errorResponse('UNAUTHORIZED', 'Sign in to follow this campaign.', requestId, 401);
    }
    if (callerEmail !== email.trim().toLowerCase()) {
      // Never opt a third party into mail on the caller's word (audit P1-6).
      return errorResponse(
        'FORBIDDEN',
        'You can only manage subscriptions for your own email address.',
        requestId,
        403,
      );
    }

    const campaignId = await resolveCampaignId(idOrSlug);
    if (!campaignId) {
      return errorResponse('NOT_FOUND', 'Campaign not found', requestId, 404);
    }

    const session = await auth();
    const userId = session?.user?.id ?? null;

    // Upsert subscription
    await db
      .insert(donorCampaignSubscriptions)
      .values({
        donorEmail: callerEmail,
        userId,
        campaignId: campaignId,
        subscribed: true,
      })
      .onConflictDoUpdate({
        target: [donorCampaignSubscriptions.donorEmail, donorCampaignSubscriptions.campaignId],
        set: {
          subscribed: true,
          unsubscribedAt: null,
          userId: userId ?? undefined,
        },
      });

    return NextResponse.json({ ok: true, data: { subscribed: true } }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/v1/campaigns/[slug]/subscribe]', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to subscribe', requestId, 500);
  }
}

/**
 * DELETE /api/v1/campaigns/[slug]/subscribe - Unsubscribe from campaign updates
 *
 * Authorised by a signed token (email-link flow, no login) or by a session
 * owning the address.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const requestId = randomUUID();
  const { slug: idOrSlug } = await params;

  try {
    const body = await request.json().catch(() => null);
    const parsed = subscribeCampaignSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Email is required',
        requestId,
        400,
      );
    }

    const email = parsed.data.email.trim().toLowerCase();

    const campaignId = await resolveCampaignId(idOrSlug);
    if (!campaignId) {
      return errorResponse('NOT_FOUND', 'Campaign not found', requestId, 404);
    }

    // Token first: this is the email-link path and must not require a session.
    const authorised =
      verifyCampaignUnsubscribeToken(readToken(request, body), campaignId, email) ||
      (await sessionEmail()) === email;

    if (!authorised) {
      return errorResponse(
        'FORBIDDEN',
        'Use the unsubscribe link from your email, or sign in to manage your subscriptions.',
        requestId,
        403,
      );
    }

    await db
      .update(donorCampaignSubscriptions)
      .set({
        subscribed: false,
        unsubscribedAt: new Date(),
      })
      .where(
        and(
          eq(donorCampaignSubscriptions.campaignId, campaignId),
          eq(donorCampaignSubscriptions.donorEmail, email),
        ),
      );

    return NextResponse.json({ ok: true, data: { subscribed: false } });
  } catch (error) {
    console.error('[DELETE /api/v1/campaigns/[slug]/subscribe]', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to unsubscribe', requestId, 500);
  }
}
