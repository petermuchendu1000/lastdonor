/**
 * What a donor is told about where their money goes (`docs/113` §11.3).
 *
 * ── THE SENTENCE THIS WHOLE FEATURE RESTS ON ────────────────────────────────
 *
 * The feature's entire value is a donor believing *"this money is not touching
 * the family's account."* That is a factual assertion about where funds land,
 * and CLAUDE.md is explicit that this platform does not make claims it cannot
 * substantiate.
 *
 * So the copy says **what was checked and what was not**, the same shape
 * `docs/108` used for `VouchedByBadge`:
 *
 *   checked     - an admin confirmed this account belongs to the institution
 *   NOT checked - the bill number, which the organiser typed and nothing can
 *                 verify; and, separately, whether we have seen their ID
 *
 * ⛔ `institutionalPayoutCopy` is the only place this wording lives, and
 * `public.test.ts` forbids the words that would over-claim. One edit to
 * "Verified by LastDonor" makes it a claim the platform cannot keep, and
 * nothing else in the codebase would notice.
 */

export interface PayoutDisclosure {
  institutionName: string;
  /** The institution's kind label, e.g. "Hospital or clinic". */
  institutionKindLabel: string;
  /** Whether a person has checked the organiser's identity. */
  organiserIdentityChecked: boolean;
}

export interface PayoutCopy {
  /** Short badge, for a card or a hero. */
  badge: string;
  /** The claim itself. */
  headline: string;
  /** What the money does. */
  body: string;
  /** What we checked and what we did not. One sentence each. */
  checked: string;
  notChecked: string;
}

/**
 * ⚠️ Plain language, to the `docs/94` budget: short sentences, and the words
 * a reader would use. "Paybill", "designation" and "disbursement" are ours,
 * not theirs.
 */
export function institutionalPayoutCopy(d: PayoutDisclosure): PayoutCopy {
  return {
    badge: `Paid to ${d.institutionName}`,
    headline: 'Your money goes straight to them',
    body: `We send what you give to ${d.institutionName}. It does not pass through the family's own account.`,
    checked: `We checked that this account belongs to ${d.institutionName}.`,
    /*
      Two different gaps, and the ID one is the bigger of the two, so it is
      named first when it applies. Never collapse them into "some things are
      unchecked" - a donor cannot act on that.
    */
    notChecked: d.organiserIdentityChecked
      ? 'We have not checked the bill number the organiser gave us.'
      : "We have not seen the organiser's ID yet, and we have not checked the bill number they gave us.",
  };
}
