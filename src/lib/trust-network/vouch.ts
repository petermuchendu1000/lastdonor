/**
 * Recording and revoking an institutional vouch, against the database.
 *
 * The decisions live in `decide.ts` and have no database in them. This file is
 * the part that cannot be unit-tested away: the row lock, the transaction, the
 * audit row, and the one status write.
 *
 * ── WHY EVERYTHING IS IN ONE TRANSACTION, ON A LOCKED CAMPAIGN ROW ──────────
 *
 * A vouch lifts the pre-verification raise cap (`docs/101`), which is a money
 * control. Two admins recording two vouches for the same campaign at the same
 * moment must not both read `unverified`, both write `identity_verified` and
 * leave the platform unable to say which vouch did it - so the campaign row is
 * taken `FOR UPDATE` before anything is read from it, exactly as the admin
 * verification route does before releasing funds.
 *
 * ⚠️ The budget check has the same shape as `docs/92`'s per-phone limit: it is
 * counted IN THE DATABASE inside the locked transaction, not in memory. A
 * budget enforced from a process-local counter is not a budget on a platform
 * that runs more than one machine.
 */

import { and, eq, gte, isNull, ne, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  auditLogs,
  campaigns,
  institutionVouches,
  trustedInstitutions,
  verificationDocuments,
} from '@/db/schema';
import {
  canCampaignBeVouched,
  canInstitutionVouch,
  outcomeOfRevocation,
  VOUCH_GRANTS_STATUS,
  VOUCH_WINDOW_DAYS,
  type RefusalCode,
} from './decide';

export interface RecordVouchInput {
  institutionId: string;
  campaignId: string;
  representativeName: string;
  representativeRole: string;
  representativeEmail: string;
  relationship: string;
  statement: string;
  /** The LastDonor admin recording it. */
  recordedBy: string;
  actorIp?: string | null;
}

export type VouchResult =
  | {
      ok: true;
      vouchId: string;
      /** True when this vouch is what verified the campaign. */
      liftedRaiseCap: boolean;
      /**
       * The campaign's slug, so the caller can revalidate its public page.
       *
       * Returned rather than looked up again by the route: a vouch changes
       * what `/campaigns/[slug]` says, that page is ISR with
       * `revalidate = 60`, and every other admin write that changes it
       * (suspend, resume, edit) already calls `revalidatePath`. Without it
       * the donor-facing banner lags by up to a minute - measured in a real
       * browser, which is the only way this class of gap shows up (docs/104).
       */
      slug: string;
    }
  | { ok: false; code: RefusalCode | 'NOT_FOUND'; message: string };

/** The start of the rolling budget window. */
function windowStart(now: Date): Date {
  return new Date(now.getTime() - VOUCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Record a vouch, and verify the campaign if nothing else had.
 *
 * Returns a refusal rather than throwing for every expected "no": the caller
 * turns the code into an HTTP status and shows `message` to an admin.
 */
export async function recordVouch(input: RecordVouchInput, now: Date = new Date()): Promise<VouchResult> {
  return db.transaction(async (tx) => {
    // The lock comes FIRST, before any decision is made on what it protects.
    const [campaign] = await tx
      .select({
        id: campaigns.id,
        slug: campaigns.slug,
        status: campaigns.status,
        verificationStatus: campaigns.verificationStatus,
        verificationSource: campaigns.verificationSource,
      })
      .from(campaigns)
      .where(eq(campaigns.id, input.campaignId))
      .for('update')
      .limit(1);

    if (!campaign) {
      return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Campaign not found.' };
    }

    const [institution] = await tx
      .select({
        id: trustedInstitutions.id,
        name: trustedInstitutions.name,
        status: trustedInstitutions.status,
        monthlyVouchLimit: trustedInstitutions.monthlyVouchLimit,
      })
      .from(trustedInstitutions)
      .where(eq(trustedInstitutions.id, input.institutionId))
      .limit(1);

    if (!institution) {
      return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Organisation not found.' };
    }

    /*
      Counted inside the transaction, and counting REVOKED vouches too - see
      `canInstitutionVouch`. An attacker who could reclaim budget by revoking
      their own assertions would have no budget at all.
    */
    const [{ used }] = await tx
      .select({ used: sql<number>`count(*)::int` })
      .from(institutionVouches)
      .where(
        and(
          eq(institutionVouches.institutionId, input.institutionId),
          gte(institutionVouches.createdAt, windowStart(now)),
        ),
      );

    const [existing] = await tx
      .select({ id: institutionVouches.id })
      .from(institutionVouches)
      .where(
        and(
          eq(institutionVouches.institutionId, input.institutionId),
          eq(institutionVouches.campaignId, input.campaignId),
          isNull(institutionVouches.revokedAt),
        ),
      )
      .limit(1);

    const institutionCheck = canInstitutionVouch({
      status: institution.status,
      monthlyVouchLimit: institution.monthlyVouchLimit,
      vouchesInWindow: used,
    });
    if (!institutionCheck.ok) {
      return { ok: false as const, code: institutionCheck.code, message: institutionCheck.message };
    }

    const campaignCheck = canCampaignBeVouched({
      status: campaign.status,
      verificationStatus: campaign.verificationStatus,
      alreadyVouchedByThisInstitution: Boolean(existing),
    });
    if (!campaignCheck.ok) {
      return { ok: false as const, code: campaignCheck.code, message: campaignCheck.message };
    }

    const [vouch] = await tx
      .insert(institutionVouches)
      .values({
        institutionId: input.institutionId,
        campaignId: input.campaignId,
        representativeName: input.representativeName,
        representativeRole: input.representativeRole,
        representativeEmail: input.representativeEmail,
        relationship: input.relationship,
        statement: input.statement,
        recordedBy: input.recordedBy,
        createdAt: now,
      })
      .returning({ id: institutionVouches.id });

    /*
      ⛔ `VOUCH_GRANTS_STATUS`, never a literal and never `fully_verified`.
      That status releases money in the admin verification route, and the
      boundary test reads this file as text to make sure nothing here writes
      it.
    */
    await tx
      .update(campaigns)
      .set({
        verificationStatus: VOUCH_GRANTS_STATUS,
        verificationSource: 'institution_vouch',
        verificationReviewedAt: now,
        updatedAt: now,
      })
      .where(eq(campaigns.id, input.campaignId));

    await tx.insert(auditLogs).values({
      eventType: 'institution.vouch_recorded',
      actorId: input.recordedBy,
      actorRole: 'admin',
      actorIp: input.actorIp ?? null,
      targetType: 'campaign',
      targetId: input.campaignId,
      severity: 'warning',
      details: sql`${JSON.stringify({
        vouchId: vouch.id,
        institutionId: institution.id,
        institutionName: institution.name,
        representativeName: input.representativeName,
        representativeRole: input.representativeRole,
        relationship: input.relationship,
        verificationStatusBefore: campaign.verificationStatus,
        verificationStatusAfter: VOUCH_GRANTS_STATUS,
        vouchesUsedInWindow: used + 1,
        monthlyVouchLimit: institution.monthlyVouchLimit,
      })}::jsonb`,
    });

    return { ok: true as const, vouchId: vouch.id, liftedRaiseCap: true, slug: campaign.slug };
  });
}

export interface RevokeVouchInput {
  vouchId: string;
  revokedBy: string;
  reason: string;
  actorIp?: string | null;
}

export type RevokeResult =
  | {
      ok: true;
      campaignId: string;
      /** For `revalidatePath` - see the note on `VouchResult.slug`. */
      slug: string;
      /** True when the campaign went back under its raise cap. */
      unverified: boolean;
      /** Plain-language account of what happened to the campaign. */
      effect: string;
    }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_REVOKED'; message: string };

/**
 * Revoke a vouch, and un-verify the campaign only if this vouch was the sole
 * thing verifying it. `outcomeOfRevocation` owns that judgement.
 */
export async function revokeVouch(input: RevokeVouchInput, now: Date = new Date()): Promise<RevokeResult> {
  return db.transaction(async (tx) => {
    const [vouch] = await tx
      .select({
        id: institutionVouches.id,
        campaignId: institutionVouches.campaignId,
        institutionId: institutionVouches.institutionId,
        revokedAt: institutionVouches.revokedAt,
      })
      .from(institutionVouches)
      .where(eq(institutionVouches.id, input.vouchId))
      .for('update')
      .limit(1);

    if (!vouch) {
      return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Vouch not found.' };
    }
    if (vouch.revokedAt) {
      return {
        ok: false as const,
        code: 'ALREADY_REVOKED' as const,
        message: 'This vouch was already revoked.',
      };
    }

    const [campaign] = await tx
      .select({
        slug: campaigns.slug,
        verificationStatus: campaigns.verificationStatus,
        verificationSource: campaigns.verificationSource,
      })
      .from(campaigns)
      .where(eq(campaigns.id, vouch.campaignId))
      .for('update')
      .limit(1);

    const [{ others }] = await tx
      .select({ others: sql<number>`count(*)::int` })
      .from(institutionVouches)
      .where(
        and(
          eq(institutionVouches.campaignId, vouch.campaignId),
          ne(institutionVouches.id, vouch.id),
          isNull(institutionVouches.revokedAt),
        ),
      );

    await tx
      .update(institutionVouches)
      .set({ revokedAt: now, revokedBy: input.revokedBy, revokedReason: input.reason })
      .where(eq(institutionVouches.id, vouch.id));

    const outcome = outcomeOfRevocation({
      verificationStatus: campaign?.verificationStatus ?? 'unverified',
      verificationSource: campaign?.verificationSource ?? null,
      otherLiveVouches: others,
    });

    if (outcome.verificationStatus) {
      await tx
        .update(campaigns)
        .set({
          verificationStatus: outcome.verificationStatus,
          verificationSource: outcome.verificationSource,
          updatedAt: now,
        })
        .where(eq(campaigns.id, vouch.campaignId));
    }

    await tx.insert(auditLogs).values({
      eventType: 'institution.vouch_revoked',
      actorId: input.revokedBy,
      actorRole: 'admin',
      actorIp: input.actorIp ?? null,
      targetType: 'campaign',
      targetId: vouch.campaignId,
      severity: 'warning',
      details: sql`${JSON.stringify({
        vouchId: vouch.id,
        institutionId: vouch.institutionId,
        reason: input.reason,
        otherLiveVouches: others,
        verificationStatusBefore: campaign?.verificationStatus ?? null,
        verificationStatusAfter: outcome.verificationStatus ?? campaign?.verificationStatus ?? null,
        effect: outcome.reason,
      })}::jsonb`,
    });

    return {
      ok: true as const,
      campaignId: vouch.campaignId,
      slug: campaign?.slug ?? '',
      unverified: outcome.verificationStatus !== null,
      effect: outcome.reason,
    };
  });
}

export interface CampaignVouch {
  id: string;
  institutionId: string;
  institutionName: string;
  institutionKind: string;
  institutionCountry: string;
  institutionStatus: string;
  institutionWebsite: string | null;
  representativeName: string;
  representativeRole: string;
  representativeEmail: string;
  relationship: string;
  statement: string;
  createdAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

/** Every vouch for a campaign, live and revoked, newest first. */
export async function listCampaignVouches(campaignId: string): Promise<CampaignVouch[]> {
  return db
    .select({
      id: institutionVouches.id,
      institutionId: trustedInstitutions.id,
      institutionName: trustedInstitutions.name,
      institutionKind: trustedInstitutions.kind,
      institutionCountry: trustedInstitutions.country,
      institutionStatus: trustedInstitutions.status,
      institutionWebsite: trustedInstitutions.website,
      representativeName: institutionVouches.representativeName,
      representativeRole: institutionVouches.representativeRole,
      representativeEmail: institutionVouches.representativeEmail,
      relationship: institutionVouches.relationship,
      statement: institutionVouches.statement,
      createdAt: institutionVouches.createdAt,
      revokedAt: institutionVouches.revokedAt,
      revokedReason: institutionVouches.revokedReason,
    })
    .from(institutionVouches)
    .innerJoin(trustedInstitutions, eq(trustedInstitutions.id, institutionVouches.institutionId))
    .where(eq(institutionVouches.campaignId, campaignId))
    .orderBy(sql`${institutionVouches.createdAt} desc`);
}

/**
 * How many verification documents a campaign has, by status.
 *
 * Read by the admin screens so an administrator deciding on a payout can see
 * that a vouched campaign has NO documents. Showing `identity_verified`
 * without that would let the vouch read as a document review that happened.
 */
export async function countCampaignDocuments(campaignId: string): Promise<{
  total: number;
  approved: number;
}> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      approved: sql<number>`count(*) FILTER (WHERE ${verificationDocuments.status} = 'approved')::int`,
    })
    .from(verificationDocuments)
    .where(eq(verificationDocuments.campaignId, campaignId));
  return row ?? { total: 0, approved: 0 };
}
