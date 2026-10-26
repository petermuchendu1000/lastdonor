/**
 * Where an organiser sends their campaign's money (`docs/113` §11, B1-B4).
 *
 * ⛔ SEALED AGAINST COLLABORATORS. `change_payout_account` is in
 * `NEVER_DELEGATED` (`docs/111`), and this route is the thing that entry is
 * about. It is creator-only and must never consult `canCollaborate` -
 * `collaborator-call-sites.test.ts` fails the build if it does. A helper who
 * could set the destination could point a family's money anywhere.
 *
 * ── WHAT THIS GRANTS: NOTHING ───────────────────────────────────────────────
 *
 * Creating a designation takes a capability AWAY (the organiser can no longer
 * withdraw, enforced in `withdraw/route.ts`) and confers none. It does not
 * verify, publish, release or lift the raise cap - see `NEVER_GRANTED` in
 * `src/lib/institutional-payout/decide.ts`.
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import {
  auditLogs,
  campaignPayoutDesignations,
  campaigns,
  institutionPayoutAccounts,
  trustedInstitutions,
} from '@/db/schema';
import { auth } from '@/lib/auth';
import { getClientIp } from '@/lib/rate-limit';
import { decideDesignation, type DesignationRefusal } from '@/lib/institutional-payout/decide';
import { activeDesignation } from '@/lib/institutional-payout/designation.server';
import { designatePayoutSchema } from '@/lib/validators/payout-designation';
import type { ApiError } from '@/types/api';

/** One sentence per refusal, in the organiser's words rather than ours. */
const REFUSAL_MESSAGE: Record<DesignationRefusal, string> = {
  campaign_status_forbids: 'This campaign is closed, so you cannot change where its money goes.',
  already_designated: 'You have already chosen where this money goes. Remove that choice first.',
  locked_money_already_sent:
    'Money has already gone to this place, so it cannot be changed. Email support@lastdonor.org if something is wrong.',
  currency_mismatch: 'That account cannot take the kind of money this campaign raises.',
  account_not_active: 'We are not using that account any more. Please choose another.',
  institution_not_active: 'We are not sending money to that place at the moment.',
};

type ErrorCode = ApiError['error']['code'];

function fail(code: ErrorCode, message: string, status: number, requestId: string) {
  return NextResponse.json(
    { ok: false, error: { code, message, requestId } } satisfies ApiError,
    { status },
  );
}

/**
 * POST — choose a destination.
 *
 * ⚠️ Queries run in SEQUENCE, and each one gates the next: the pool is
 * `max: 5` and `docs/87` caps a request at three concurrent queries. Nothing
 * here is parallelisable anyway, because the decision needs both rows.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    const session = await auth();
    if (!session?.user?.id) return fail('UNAUTHORIZED', 'Sign in to continue', 401, requestId);

    const { id: campaignId } = await params;
    const parsed = designatePayoutSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message || 'Invalid input', 400, requestId);
    }
    const input = parsed.data;

    const [campaign] = await db
      .select({
        id: campaigns.id,
        creatorId: campaigns.creatorId,
        status: campaigns.status,
        currency: campaigns.currency,
      })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign) return fail('NOT_FOUND', 'Campaign not found', 404, requestId);

    /*
      ⛔ Creator only. NOT `canCollaborate` - see the module header. This
      comparison is the whole authorisation for a route that decides where a
      campaign's money lands.
    */
    if (campaign.creatorId !== session.user.id) {
      return fail('FORBIDDEN', 'You do not own this campaign', 403, requestId);
    }

    const [account] = await db
      .select({
        id: institutionPayoutAccounts.id,
        currency: institutionPayoutAccounts.currency,
        status: institutionPayoutAccounts.status,
        institutionName: trustedInstitutions.name,
        institutionStatus: trustedInstitutions.status,
      })
      .from(institutionPayoutAccounts)
      .innerJoin(
        trustedInstitutions,
        eq(trustedInstitutions.id, institutionPayoutAccounts.institutionId),
      )
      .where(eq(institutionPayoutAccounts.id, input.payoutAccountId))
      .limit(1);

    if (!account) return fail('NOT_FOUND', 'We do not know that place', 404, requestId);

    const existing = await activeDesignation(db, campaignId);

    const decision = decideDesignation({
      campaignStatus: campaign.status,
      campaignCurrency: campaign.currency,
      existing: existing ? { lockedAt: null } : null,
      account: {
        currency: account.currency,
        status: account.status as 'active' | 'retired',
        institutionStatus: account.institutionStatus as 'active' | 'suspended',
      },
    });

    if (!decision.allowed) {
      return fail('CONFLICT', REFUSAL_MESSAGE[decision.reason], 409, requestId);
    }

    /*
      The partial unique index is the real guard against two live
      destinations - two requests can both pass the check above and only one
      can insert. This catch turns 23505 into a sentence rather than a 500.
    */
    let created: { id: string } | undefined;
    try {
      [created] = await db
        .insert(campaignPayoutDesignations)
        .values({
          campaignId,
          payoutAccountId: account.id,
          currency: campaign.currency,
          accountReference: input.accountReference,
          designatedBy: session.user.id,
        })
        .returning({ id: campaignPayoutDesignations.id });
    } catch (e) {
      if (String((e as { code?: string }).code) === '23505') {
        return fail('CONFLICT', REFUSAL_MESSAGE.already_designated, 409, requestId);
      }
      throw e;
    }

    await db.insert(auditLogs).values({
      eventType: 'campaign.payout_designated',
      actorId: session.user.id,
      actorRole: session.user.role ?? 'donor',
      actorIp: getClientIp(request.headers),
      targetType: 'campaign',
      targetId: campaignId,
      severity: 'warning',
      details: {
        designationId: created!.id,
        payoutAccountId: account.id,
        institutionName: account.institutionName,
        currency: campaign.currency,
      },
    });

    return NextResponse.json(
      { ok: true, data: { id: created!.id, institutionName: account.institutionName } },
      { status: 201 },
    );
  } catch (error) {
    console.error('POST payout-designation error:', error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500, requestId);
  }
}

/**
 * DELETE — take the choice back, before any money has moved.
 *
 * ⛔ Refused once `locked_at` is set. After the first payment we cannot pull
 * it back, so changing the destination would mean the campaign's money went
 * to two places while its page named one (`docs/113` §11.1 #6).
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    const session = await auth();
    if (!session?.user?.id) return fail('UNAUTHORIZED', 'Sign in to continue', 401, requestId);

    const { id: campaignId } = await params;

    const [campaign] = await db
      .select({ creatorId: campaigns.creatorId })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign) return fail('NOT_FOUND', 'Campaign not found', 404, requestId);
    if (campaign.creatorId !== session.user.id) {
      return fail('FORBIDDEN', 'You do not own this campaign', 403, requestId);
    }

    /*
      `isNull(lockedAt)` is in the WHERE rather than read-then-write: a
      payment landing between the read and the update would otherwise let a
      locked designation be revoked. No rows updated means either nothing was
      designated or it is locked, and the follow-up read says which.
    */
    const [revoked] = await db
      .update(campaignPayoutDesignations)
      .set({ status: 'revoked', revokedAt: new Date(), revokedBy: session.user.id, updatedAt: new Date() })
      .where(
        and(
          eq(campaignPayoutDesignations.campaignId, campaignId),
          eq(campaignPayoutDesignations.status, 'active'),
          isNull(campaignPayoutDesignations.lockedAt),
        ),
      )
      .returning({ id: campaignPayoutDesignations.id });

    if (!revoked) {
      const still = await activeDesignation(db, campaignId);
      if (still) return fail('CONFLICT', REFUSAL_MESSAGE.locked_money_already_sent, 409, requestId);
      return fail('NOT_FOUND', 'Nothing was chosen for this campaign', 404, requestId);
    }

    await db.insert(auditLogs).values({
      eventType: 'campaign.payout_designation_revoked',
      actorId: session.user.id,
      actorRole: session.user.role ?? 'donor',
      actorIp: getClientIp(request.headers),
      targetType: 'campaign',
      targetId: campaignId,
      severity: 'warning',
      details: { designationId: revoked.id },
    });

    return NextResponse.json({ ok: true, data: { id: revoked.id } });
  } catch (error) {
    console.error('DELETE payout-designation error:', error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500, requestId);
  }
}
