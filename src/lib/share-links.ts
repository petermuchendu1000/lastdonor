/**
 * Attributed share links.
 *
 * `docs/30` §1 records that GoFundMe's growth comes from an attributed share
 * loop rather than from a share button: every donor gets a link of their own,
 * and an organizer can see which supporter actually reached people. A plain
 * share button is explicitly NOT parity, because nothing it produces is
 * countable.
 *
 * Shape of the loop:
 *
 *   1. `mintShareLink()` issues `/s/<token>` for a (campaign, sharer) pair.
 *   2. `/s/<token>` resolves it, counts the visit, drops a short-lived cookie
 *      and redirects to the campaign.
 *   3. `create-checkout` reads that cookie and puts the token on the Stripe
 *      PaymentIntent's metadata.
 *   4. The webhook resolves the token back to a row and stores
 *      `donations.share_link_id`.
 *
 * Stripe metadata is the carrier on purpose: `CLAUDE.md` records it as the
 * disaster-recovery substrate, so attribution survives anything that can be
 * rebuilt from Stripe alone.
 *
 * TOKENS ARE RANDOM, NOT SIGNED. Every use looks the row up, so a signature
 * would cost verification without buying anything. This is the opposite of
 * `unsubscribe-tokens.ts`, which must be verifiable with no row to check
 * against and is therefore HMAC'd. See `docs/57`.
 */
import { randomBytes } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { campaignShareLinks } from '@/db/schema';

/** Cookie that carries a pending attribution from `/s/<token>` to checkout. */
export const SHARE_ATTRIBUTION_COOKIE = 'ld_via';

/**
 * How long a click stays attributable.
 *
 * Seven days: long enough that "saw it Friday, gave on Sunday" still credits
 * the sharer, short enough that a shared device does not attribute a stranger's
 * unrelated donation months later. Not a measured figure - no attribution
 * window ever is - so it is one constant rather than a scatter of literals.
 */
export const SHARE_ATTRIBUTION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** 16 bytes of randomness, base64url. 22 chars, no padding, URL-safe. */
export function generateShareToken(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Tokens are opaque. Validate the shape before touching the database so a
 * junk path segment cannot turn into a query.
 */
export function isWellFormedShareToken(token: string | null | undefined): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(token);
}

export function shareUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/s/${token}`;
}

/**
 * Return this sharer's existing link for the campaign, or make one.
 *
 * Idempotent per (campaign, user) so a signed-in donor who shares twice keeps
 * one countable link instead of splitting their own total. Guests get a fresh
 * link each time: with no identity there is nothing to deduplicate against.
 */
export async function mintShareLink(params: {
  campaignId: string;
  userId?: string | null;
}): Promise<{ id: string; token: string }> {
  const { campaignId, userId = null } = params;

  if (userId) {
    const existing = await db
      .select({ id: campaignShareLinks.id, token: campaignShareLinks.token })
      .from(campaignShareLinks)
      .where(
        and(
          eq(campaignShareLinks.campaignId, campaignId),
          eq(campaignShareLinks.userId, userId),
        ),
      )
      .limit(1);
    if (existing.length > 0) return existing[0];
  }

  const token = generateShareToken();
  const inserted = await db
    .insert(campaignShareLinks)
    .values({ campaignId, token, userId })
    .returning({ id: campaignShareLinks.id, token: campaignShareLinks.token });

  return inserted[0];
}

/**
 * Resolve a token and count the visit.
 *
 * The click count is incremented in the same statement that reads the row, so
 * two simultaneous visitors cannot read-then-write the same value. Returns
 * null for anything unknown, which the route turns into an ordinary redirect
 * rather than an error: a stale or mistyped share link should still land the
 * visitor somewhere useful.
 */
export async function resolveShareLinkAndCountClick(
  token: string,
): Promise<{ id: string; campaignId: string } | null> {
  if (!isWellFormedShareToken(token)) return null;

  const rows = await db
    .update(campaignShareLinks)
    .set({ clickCount: sql`${campaignShareLinks.clickCount} + 1` })
    .where(eq(campaignShareLinks.token, token))
    .returning({
      id: campaignShareLinks.id,
      campaignId: campaignShareLinks.campaignId,
    });

  return rows[0] ?? null;
}

/**
 * Resolve a token to a link id, without counting a visit.
 *
 * Used at checkout, where the cookie is being cashed in rather than followed.
 * The campaign is checked too: a token minted for another campaign must not
 * attribute a donation here, which is what stops a cookie left over from one
 * campaign crediting a sharer on the next.
 */
export async function resolveShareLinkForCampaign(
  token: string | null | undefined,
  campaignId: string,
): Promise<string | null> {
  if (!isWellFormedShareToken(token)) return null;

  const rows = await db
    .select({ id: campaignShareLinks.id })
    .from(campaignShareLinks)
    .where(
      and(
        eq(campaignShareLinks.token, token),
        eq(campaignShareLinks.campaignId, campaignId),
      ),
    )
    .limit(1);

  return rows[0]?.id ?? null;
}
