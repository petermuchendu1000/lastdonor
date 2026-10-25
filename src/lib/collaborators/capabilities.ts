/**
 * What a campaign collaborator may do, and what one may never do.
 *
 * ── THE WHOLE SAFETY ARGUMENT, IN ONE FILE ──────────────────────────────────
 *
 * A collaborator is a helper the organiser invited: a cousin posting updates
 * while another runs the page. Added 2026-10-25, see `docs/111`.
 *
 * This module is PURE and has no database in it, so the rules can be tested
 * directly and so the delegable set can be read at a glance by anybody
 * deciding whether to widen it.
 *
 * ⛔ `NEVER_DELEGATED` is not documentation. `isDelegatable` fails CLOSED on
 * anything outside `DELEGATABLE`, and `collaborator-boundary.test.ts` fails
 * the build if the two lists ever overlap or if this directory gains the
 * ability to write a money column. Moving an entry from one list to the other
 * REOPENS the decision in `docs/111` §1 and must not be done to make a
 * feature work.
 *
 * ── WHY MONEY IS EXCLUDED, TRACED RATHER THAN ASSUMED ───────────────────────
 *
 * [VERIFIED 2026-10-25] `user-campaigns/[id]/withdraw/route.ts:146-154`
 * resolves the payout destination with `eq(users.id, session.user.id)` - the
 * CALLER's Stripe Connect account - and passes it to `createTransfer` at line
 * 405-408. A grep of lines 155-405 for `creatorId` returns nothing: there is
 * no later re-check that the destination belongs to the campaign's creator.
 *
 * So the invariant *"the credited account belongs to the person the funds are
 * owed to"* holds ONLY because line 138 enforces
 * `campaign.creatorId !== session.user.id -> 403` eight lines earlier.
 * Delegating ownership would pay a family's crisis funds into a helper's bank
 * account, silently and with no error anywhere.
 *
 * ── WHY IDENTITY IS EXCLUDED ────────────────────────────────────────────────
 *
 * `verification/documents/route.ts:63` is creator-gated. The platform's claim
 * is that a person has checked who the ORGANISER is. A helper uploading their
 * own ID makes that claim false while every status column still reads
 * verified - the same reasoning `docs/108` used to refuse `fully_verified`
 * for an institutional vouch.
 *
 * ── WHY A COLLABORATOR CANNOT INVITE ────────────────────────────────────────
 *
 * The trust root is the creator. If a collaborator could invite, one
 * compromised helper account grows the blast radius without the organiser
 * ever seeing it, which is the `docs/108` "no self-serve signup" argument
 * applied one level down.
 */

/**
 * Capabilities a collaborator CAN hold.
 *
 * Each one is wired to a surface that already exists. ⛔ Do not add a
 * capability for a surface that does not - `docs/76`, `docs/77` and `docs/81`
 * are three separate docs about shipping a promise with no code behind it.
 *
 * Deliberately NOT here:
 *   `reply_to_message` - there is no organiser message-reply route at all.
 *      `campaigns/[slug]/messages/route.ts` is the public wall and has no
 *      ownership check; moderation is admin/editor only. [VERIFIED
 *      2026-10-25] So the capability would name nothing.
 */
export const DELEGATABLE = [
  /** Post an organiser update. Surface: `user-campaigns/[id]/updates` POST. */
  'post_update',
  /**
   * Edit the campaign's CONTENT. Surface: `user-campaigns/[id]` PUT.
   *
   * Safe to delegate because that route applies an explicit allowlist at
   * `[id]/route.ts:151-163` - title, category, heroImageUrl, galleryImages,
   * subjectHometown, story - and writes no `status`, `goalAmount`, `slug` or
   * `subjectName`. [VERIFIED 2026-10-25 by reading the handler.] It is
   * therefore NOT a route into the `docs/78`/`docs/79` review gate, and not a
   * way to move the goal a raise cap is measured against.
   */
  'edit_content',
] as const;

export type Capability = (typeof DELEGATABLE)[number];

/**
 * Capabilities that may NEVER be delegated, named so the exclusion is a
 * decision on the record rather than an absence somebody fills in later.
 *
 * These strings are not accepted by `isDelegatable` and are not wired to
 * anything. They exist to be asserted against.
 */
export const NEVER_DELEGATED = [
  /** Money out. See the module header. */
  'withdraw',
  /** Where the money goes. `dashboard/payout-settings`. */
  'change_payout_account',
  /** The organiser's ID. `verification/submit`, `verification/documents`. */
  'upload_identity',
  /** Destroys the campaign and its history. */
  'delete_campaign',
  /** Privilege escalation. The trust root is the creator. */
  'invite_collaborator',
  /** Only an admin refuses or publishes a campaign (`docs/78`, `docs/93`). */
  'change_status',
] as const;

export type NeverDelegated = (typeof NEVER_DELEGATED)[number];

/**
 * Whether a capability may be held by a collaborator at all.
 *
 * ⚠️ Fails CLOSED: an unrecognised string is refused rather than allowed.
 * The type already constrains well-behaved callers; this is for the case
 * where a capability name arrives as a plain string from a route and the
 * compiler is no longer watching.
 */
export function isDelegatable(capability: string): capability is Capability {
  return (DELEGATABLE as readonly string[]).includes(capability);
}
