/**
 * Which campaign statuses an organiser may still edit.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * `src/lib/organiser-journey.ts` built its `write` step **unconditionally**:
 *
 *     state: 'done',
 *     detail: 'Done. You can still edit it.',
 *     href: `/dashboard/campaigns/${f.campaignId}/edit`,
 *     action: 'Edit',
 *
 * with no reference to the campaign's status - while
 * `dashboard/campaigns/[id]/edit/page.tsx` redirects anything outside
 * `['draft', 'active']`. Both renderers show a step's button on
 * `step.href && step.action` (`JourneyChecklist.tsx:92`,
 * `NextStepRow.tsx:121`), and both were always truthy.
 *
 * So an organiser whose campaign was `under_review` read **"Write your
 * campaign - Done. You can still edit it. [Edit]"** and the button bounced
 * them silently back to the page they came from. Every campaign a person
 * submits is `under_review` (`docs/78`, `docs/79`), so this is the state they
 * are in for the whole time they are waiting.
 *
 * ⚠️ This is the inverse of `docs/83`. There, a working route had no door.
 * Here a door is always shown and the room refuses to open - which is the
 * same defect as `docs/117` §3.3 ("a control that can only fail is worse than
 * no control"), reached from the other side.
 *
 * ── WHY A SHARED CONSTANT ───────────────────────────────────────────────────
 *
 * The rule was written out **twice** - `edit/page.tsx:63` and
 * `[id]/page.tsx:150` - and a third place (the journey) decided not to
 * consult it at all. `campaign-editability.test.ts` asserts this list is
 * exactly what the edit page enforces, parsed from its source, so the two
 * cannot drift. That is the `docs/109` pattern: derive both ends rather than
 * pin today's answer.
 *
 * ⛔ NOT the same list as `createCampaignSchema`'s
 * `status: z.enum(['draft', 'active'])` in `src/lib/validators/campaign.ts`.
 * That is which status an ADMIN may create a campaign IN, and it happens to
 * hold the same two values for unrelated reasons. Folding them together would
 * mean a change to what an admin can create silently changing what an
 * organiser can edit.
 */

/** Statuses whose campaign the organiser may still open in the editor. */
export const ORGANISER_EDITABLE_STATUSES = ['draft', 'active'] as const;

/**
 * May the organiser edit a campaign in this status?
 *
 * Use this before rendering ANY link or button to
 * `/dashboard/campaigns/<id>/edit`. An unknown status answers `false`: the
 * failure mode of hiding an edit button is a missing convenience, and the
 * failure mode of showing one is a silent redirect that reads as the product
 * being broken.
 */
export function isOrganiserEditable(status: string | null | undefined): boolean {
  if (!status) return false;
  return (ORGANISER_EDITABLE_STATUSES as readonly string[]).includes(status);
}
