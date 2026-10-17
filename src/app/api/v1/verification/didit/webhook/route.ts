import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns, auditLogs, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDiditDecision, mapDiditStatus, DiditNotConfiguredError } from '@/lib/didit';
import { notifyCreatorVerificationApproved, notifyCreatorVerificationRejected } from '@/lib/notifications';
import type { ApiError } from '@/types/api';

/**
 * POST /api/v1/verification/didit/webhook
 *
 * Didit tells us a session changed. See `docs/81`.
 *
 * ── Why this route needs no shared secret ─────────────────────────────────
 *
 * The usual design verifies an HMAC over the request body and then trusts
 * the body's contents. That needs a webhook secret shared with the
 * provider, and it makes the body the input to a state change about
 * someone's identity.
 *
 * This route does neither. It reads ONE value from the body - a session id
 * - and then calls Didit's decision endpoint with our own API key to ask
 * what the status actually is. The body is a hint that something happened;
 * the answer comes from an authenticated call we make ourselves.
 *
 * What that buys:
 *   - no secret to configure, rotate, or leave unset (the failure mode
 *     where an unset secret silently disables verification cannot happen);
 *   - a forged request cannot assert an outcome. The worst an attacker can
 *     do by posting a real session id is make us re-read a decision we are
 *     entitled to read, and arrive at the same answer;
 *   - a session id that is not ours, or not known to Didit, changes
 *     nothing.
 *
 * What it costs: one extra outbound call per webhook. For an event that
 * fires a handful of times per verification, that is the right trade.
 *
 * Deliberately returns 200 for anything it chooses not to act on. A
 * provider that receives a 4xx will retry, and retrying will not change an
 * unknown session id into a known one.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    // Didit has used both spellings across API versions; accept either and
    // nothing else.
    const sessionId =
      typeof body?.session_id === 'string'
        ? body.session_id
        : typeof body?.sessionId === 'string'
          ? body.sessionId
          : null;

    if (!sessionId) {
      console.warn('[didit/webhook] no session id in payload', { requestId });
      return NextResponse.json({ ok: true, data: { ignored: 'no session id' } });
    }

    // The authenticated read. Everything below comes from this, not the body.
    const decision = await getDiditDecision(sessionId);

    const [campaign] = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        slug: campaigns.slug,
        creatorId: campaigns.creatorId,
        verificationStatus: campaigns.verificationStatus,
      })
      .from(campaigns)
      .where(eq(campaigns.diditSessionId, decision.sessionId))
      .limit(1);

    if (!campaign) {
      console.warn(`[didit/webhook] no campaign for session ${decision.sessionId}`, { requestId });
      return NextResponse.json({ ok: true, data: { ignored: 'unknown session' } });
    }

    const next = mapDiditStatus(decision.status);

    /*
      Nothing to do while Didit is still working, including "In Review",
      which is their manual queue. Treating that as a pass would mark an
      identity verified that no one has finished checking.
    */
    if (next === 'pending') {
      return NextResponse.json({ ok: true, data: { status: decision.status, changed: false } });
    }

    /*
      Idempotent. Webhooks arrive more than once, and a decision that has
      already been recorded must not re-send the email or re-write the
      audit trail.
    */
    if (campaign.verificationStatus === next || campaign.verificationStatus === 'fully_verified') {
      return NextResponse.json({ ok: true, data: { status: decision.status, changed: false } });
    }

    await db
      .update(campaigns)
      .set({ verificationStatus: next, updatedAt: new Date() })
      .where(eq(campaigns.id, campaign.id));

    await db.insert(auditLogs).values({
      eventType: 'identity_verification_decided',
      actorRole: 'admin',
      targetType: 'campaign',
      targetId: campaign.id,
      severity: next === 'rejected' ? 'warning' : 'info',
      details: { provider: 'didit', diditStatus: decision.status, verificationStatus: next },
    });

    if (campaign.creatorId) {
      const [creator] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, campaign.creatorId))
        .limit(1);

      if (creator?.email) {
        const shared = {
          creatorId: campaign.creatorId,
          creatorEmail: creator.email,
          creatorName: creator.name ?? 'Campaigner',
          campaignId: campaign.id,
          campaignTitle: campaign.title,
        };

        const sent =
          next === 'identity_verified'
            ? // Tier 1 is identity. Document review is tier 2 and is decided
              // by an admin, not by Didit.
              notifyCreatorVerificationApproved({ ...shared, tier: 1 })
            : notifyCreatorVerificationRejected({
                ...shared,
                // Didit's own wording for why is not exposed on the decision
                // payload we read, so the person is pointed at a human rather
                // than given a reason we would be inventing.
                reason:
                  'The identity check did not pass. Email support@lastdonor.org and we will tell you what to do next.',
              });

        sent.catch((err) => console.error('[didit/webhook] notification error:', err));
      }
    }

    return NextResponse.json({ ok: true, data: { status: decision.status, changed: true } });
  } catch (error) {
    if (error instanceof DiditNotConfiguredError) {
      console.error('[didit/webhook] DIDIT_API_KEY is not set; cannot verify the decision.', { requestId });
      return NextResponse.json(
        { ok: false, error: { code: 'VERIFICATION_UNAVAILABLE', message: 'Verification provider is not configured.', requestId } } satisfies ApiError,
        { status: 503 },
      );
    }
    // A failed decision read is worth a retry, so this one IS a 5xx.
    console.error('[didit/webhook]', error, { requestId });
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Could not process the verification update.', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
