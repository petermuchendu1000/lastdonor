import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { campaignCollaborators } from '@/db/schema';

/**
 * Minting, accepting and revoking collaborator invitations.
 *
 * ⛔ This module writes `campaign_collaborators` and nothing else. The
 * boundary test in this directory reads its `.update()` / `.insert()` targets
 * and fails the build otherwise. See `docs/111` §1 for why the line is here.
 *
 * ── TOKENS ──────────────────────────────────────────────────────────────────
 *
 * 32 random bytes, SHA-256 at rest. The raw token exists in the invitation
 * email and nowhere else, so a database leak does not yield working invites.
 *
 * ⚠️ A plain SHA-256 and not the HMAC used for phone codes, deliberately.
 * A phone code is SIX DIGITS - a million possibilities, so the hash must be
 * keyed with a pepper or the whole space is precomputable. This is 256 bits
 * of entropy from `randomBytes`, where a plain digest is already not
 * brute-forceable and a pepper would add a deployment dependency for nothing.
 * `docs/85` records the opposite call for the opposite reason.
 */

/** How long an unaccepted invitation stays usable. */
export const INVITE_TTL_HOURS = 168; // 7 days

/**
 * The most people one campaign may have live at once.
 *
 * ⚠️ This is the real abuse control, not the rate limit. The `collab` tier
 * bounds how fast one IP can send (5/60 s); this bounds how many an account
 * can send AT ALL, which is what stops a campaign being used as a mailing
 * list. Same division of labour as `docs/85`: an IP limit bounds the spray,
 * the per-subject counter bounds what gets past it.
 *
 * Ten is above a family and far below a mailing list. ⛔ Raising it is a
 * decision about how much of our sending reputation one account may spend.
 */
export const MAX_LIVE_COLLABORATORS = 10;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** A URL-safe token. Returned ONCE; only its hash is stored. */
export function mintInviteToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

/**
 * Compare a presented token against a stored hash in constant time.
 *
 * The lookup below is by hash and therefore already an equality in the
 * database, which leaks nothing useful; this exists for the second
 * comparison a caller may want and keeps the pattern consistent with
 * `verifyCronAuth`.
 */
export function tokenMatchesHash(raw: string, hash: string): boolean {
  const a = Buffer.from(hashToken(raw), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface InviteRow {
  id: string;
  campaignId: string;
  invitedEmail: string;
  userId: string | null;
  acceptedAt: Date | null;
  createdAt: Date;
}

/** How many live (unrevoked) rows a campaign has, invited or accepted. */
export async function countLiveCollaborators(campaignId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(campaignCollaborators)
    .where(
      and(
        eq(campaignCollaborators.campaignId, campaignId),
        isNull(campaignCollaborators.revokedAt),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Record an invitation and return the raw token for the email.
 *
 * The caller is responsible for having established that the requester is the
 * campaign's CREATOR. ⛔ This function does not check that, and must not be
 * called from anywhere that has not: a collaborator inviting further
 * collaborators is `invite_collaborator`, which is in `NEVER_DELEGATED`.
 *
 * Returns `null` when the campaign is already at `MAX_LIVE_COLLABORATORS`, so
 * the caller can answer with a specific message rather than a generic error.
 *
 * ⚠️ A duplicate invitation is refused by the partial unique index
 * `idx_campaign_collaborators_live`, not by a prior SELECT. Checking first
 * would be a race; the constraint is the authority (and the integration test
 * proves it fires).
 */
export async function createInvite(p: {
  campaignId: string;
  invitedEmail: string;
  invitedBy: string;
}): Promise<{ row: InviteRow; token: string } | null> {
  if ((await countLiveCollaborators(p.campaignId)) >= MAX_LIVE_COLLABORATORS) {
    return null;
  }

  const { raw, hash } = mintInviteToken();
  const [row] = await db
    .insert(campaignCollaborators)
    .values({
      campaignId: p.campaignId,
      // Lower-cased here AND enforced by a CHECK, so two cases cannot both be
      // live for one person (see `docs/111` §4).
      invitedEmail: p.invitedEmail.trim().toLowerCase(),
      invitedBy: p.invitedBy,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3600_000),
    })
    .returning({
      id: campaignCollaborators.id,
      campaignId: campaignCollaborators.campaignId,
      invitedEmail: campaignCollaborators.invitedEmail,
      userId: campaignCollaborators.userId,
      acceptedAt: campaignCollaborators.acceptedAt,
      createdAt: campaignCollaborators.createdAt,
    });

  return { row, token: raw };
}

export type AcceptOutcome =
  | { ok: true; campaignId: string }
  /** No live row for this token. Covers wrong, consumed and revoked alike. */
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'expired' }
  /** Already accepted - by this user or another. Idempotent for the same user. */
  | { ok: false; reason: 'already_accepted' };

/**
 * Accept an invitation on behalf of a signed-in user.
 *
 * ⚠️ The update is keyed on `accepted_at IS NULL`, so two simultaneous
 * accepts cannot both succeed: the second updates zero rows and reports
 * `already_accepted`. Checking-then-writing would be a race, and the race
 * would attach a campaign to whichever account happened to win.
 *
 * ⚠️ The invited EMAIL is deliberately not required to match the accepting
 * account's email. The token is the credential - it was sent to that address
 * and nowhere else - and a family member forwarding their invitation to the
 * account they actually use is the common case, not an attack. Requiring a
 * match would also leak whether an address has an account. What the token
 * cannot do is anything beyond the content capabilities in `capabilities.ts`.
 */
export async function acceptInvite(p: {
  token: string;
  userId: string;
}): Promise<AcceptOutcome> {
  const hash = hashToken(p.token);

  const [found] = await db
    .select({
      id: campaignCollaborators.id,
      campaignId: campaignCollaborators.campaignId,
      expiresAt: campaignCollaborators.expiresAt,
      acceptedAt: campaignCollaborators.acceptedAt,
      userId: campaignCollaborators.userId,
    })
    .from(campaignCollaborators)
    .where(
      and(
        eq(campaignCollaborators.tokenHash, hash),
        isNull(campaignCollaborators.revokedAt),
      ),
    )
    .limit(1);

  if (!found) return { ok: false, reason: 'not_found' };

  if (found.acceptedAt) {
    // Accepting twice from the same account is success, not an error - a
    // double-clicked link must not read as a failure.
    return found.userId === p.userId
      ? { ok: true, campaignId: found.campaignId }
      : { ok: false, reason: 'already_accepted' };
  }

  if (found.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  const updated = await db
    .update(campaignCollaborators)
    .set({ userId: p.userId, acceptedAt: new Date() })
    .where(
      and(
        eq(campaignCollaborators.id, found.id),
        // The race guard. See the note above.
        isNull(campaignCollaborators.acceptedAt),
      ),
    )
    .returning({ id: campaignCollaborators.id });

  if (updated.length === 0) return { ok: false, reason: 'already_accepted' };
  return { ok: true, campaignId: found.campaignId };
}

/**
 * Revoke a membership or a pending invitation.
 *
 * The row is kept and stamped rather than deleted: it is the record that
 * somebody had access, which is worth more than a tidy table. The partial
 * unique index is keyed on `revoked_at IS NULL`, so the same person can be
 * invited again afterwards.
 *
 * Returns false when nothing live matched, so the caller can answer 404
 * rather than reporting a revocation that did not happen.
 */
export async function revokeCollaborator(p: {
  campaignId: string;
  collaboratorId: string;
}): Promise<boolean> {
  const updated = await db
    .update(campaignCollaborators)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(campaignCollaborators.id, p.collaboratorId),
        // Scoped to the campaign the caller proved they own, so one
        // organiser cannot revoke another campaign's collaborator by id.
        eq(campaignCollaborators.campaignId, p.campaignId),
        isNull(campaignCollaborators.revokedAt),
      ),
    )
    .returning({ id: campaignCollaborators.id });

  return updated.length > 0;
}

/** The live team for a campaign, pending invitations included. */
export async function listCollaborators(campaignId: string): Promise<InviteRow[]> {
  return db
    .select({
      id: campaignCollaborators.id,
      campaignId: campaignCollaborators.campaignId,
      invitedEmail: campaignCollaborators.invitedEmail,
      userId: campaignCollaborators.userId,
      acceptedAt: campaignCollaborators.acceptedAt,
      createdAt: campaignCollaborators.createdAt,
    })
    .from(campaignCollaborators)
    .where(
      and(
        eq(campaignCollaborators.campaignId, campaignId),
        isNull(campaignCollaborators.revokedAt),
      ),
    )
    .orderBy(campaignCollaborators.createdAt);
}
