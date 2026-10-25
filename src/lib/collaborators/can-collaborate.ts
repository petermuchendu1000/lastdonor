import 'server-only';

import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { campaignCollaborators } from '@/db/schema';
import { isDelegatable, type Capability } from '@/lib/collaborators/capabilities';

/**
 * Is this user allowed to do `capability` on this campaign as a collaborator?
 *
 * ── HOW TO USE IT, AND HOW NOT TO ───────────────────────────────────────────
 *
 * This answers ONE question: is there a live, accepted collaborator row. It
 * is not an ownership check and it is not a replacement for one. The call
 * sites read:
 *
 *     const isOwner = campaign.creatorId === session.user.id;
 *     if (!isOwner && !isStaff && !(await canCollaborate(id, uid, 'post_update'))) {
 *       throw new ForbiddenError();
 *     }
 *
 * ⚠️ The short-circuit order is deliberate and load-bearing for a different
 * reason than it looks: `canCollaborate` issues a query, and every route in
 * this codebase is capped at three concurrent database queries
 * (`src/db/pool-fanout.ratchet.test.ts`, pool is `max: 5`, `docs/87`).
 * Evaluating it only after `isOwner` fails keeps the owner's path - the
 * overwhelmingly common one - at exactly the cost it had before.
 *
 * ⛔ Never call this for anything in `NEVER_DELEGATED`. It would return false
 * anyway (`isDelegatable` fails closed), but a call site that asks the
 * question at all reads as though the answer could one day be yes. Money and
 * identity routes must keep comparing `creatorId` and nothing else - see the
 * header of `capabilities.ts` for the traced reason.
 */
export async function canCollaborate(
  campaignId: string,
  userId: string | null | undefined,
  capability: Capability,
): Promise<boolean> {
  // Fail closed before touching the database.
  if (!userId) return false;
  if (!isDelegatable(capability)) return false;

  const [row] = await db
    .select({ id: campaignCollaborators.id })
    .from(campaignCollaborators)
    .where(
      and(
        eq(campaignCollaborators.campaignId, campaignId),
        eq(campaignCollaborators.userId, userId),
        /*
          BOTH conditions are required and neither is redundant.

          `accepted_at is not null` - a PENDING invite grants nothing. The row
          exists from the moment the organiser sends it, and `user_id` is null
          until acceptance, so without this a future change that back-fills
          `user_id` early would silently grant access to an unaccepted invite.

          `revoked_at is null` - revocation is immediate. The partial unique
          index is keyed on the same predicate, so a revoked row stays in the
          table as history without blocking a re-invite.
        */
        isNotNull(campaignCollaborators.acceptedAt),
        isNull(campaignCollaborators.revokedAt),
      ),
    )
    .limit(1);

  return Boolean(row);
}
