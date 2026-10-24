/**
 * Whether a screened document may be approved without a person looking at it.
 *
 * ── THE SHAPE OF THE DECISION ───────────────────────────────────────────────
 *
 * Two outcomes only: `auto_approve`, or `needs_human`. There is deliberately
 * no `auto_reject`.
 *
 * Refusing someone's hospital bill is an adverse decision about a person in a
 * medical emergency, taken on the strength of an OCR read that has already
 * been observed mangling a name (`name-match.ts`). A false auto-approval costs
 * a review that should have happened; a false auto-rejection costs someone
 * their appeal while they are in hospital. Those are not symmetric, so the
 * machine is allowed to say "fine" and never allowed to say "no".
 *
 * ── WHAT APPROVAL HERE DOES AND DOES NOT DO ─────────────────────────────────
 *
 * [VERIFIED 2026-10-24] It sets `verification_documents.status`, and nothing
 * else. `src/app/api/v1/admin/verification-documents/[documentId]/route.ts`
 * writes only that table, and every writer of `campaigns.verification_status`
 * was enumerated: the Didit session/status/webhook routes, the two
 * info-request routes, and the admin `approve_t1`/`approve_t2` action. **No
 * path advances a campaign's verification status from document approval.**
 *
 * So this cannot authorise a payout (`withdraw/route.ts:272` requires
 * `fully_verified`) and cannot lift the pre-verification raise cap
 * (`docs/101`). A person still makes the campaign-level decision. That
 * separation is what makes auto-approval of a document tolerable, and anything
 * that couples the two reopens the whole question.
 *
 * ── FAIL CLOSED, ALWAYS ─────────────────────────────────────────────────────
 *
 * Every unknown is `needs_human`. In particular a MISSING trusted name is
 * "cannot judge", never "no mismatch found" - the single most dangerous
 * confusion available here, because today there is no verified name on file
 * for anybody (no Didit session has ever been created), so a rule that treated
 * absence as agreement would auto-approve every document on the platform.
 */

import { matchNames, type NameMatch } from './name-match';

/**
 * Document types this function may approve on its own.
 *
 * ⛔ `government_id` and `selfie` are ABSENT ON PURPOSE. Those are the
 * identity evidence itself; deciding they are genuine is the identity
 * decision, which belongs to the provider (`docs/81`) and a person - not to a
 * model reading a photograph of a photograph. `other` is absent because its
 * contents are by definition unspecified, so there is nothing to check against.
 */
export const SCREENABLE_DOCUMENT_TYPES = [
  'hospital_letter',
  'receipt',
  'utility_bill',
  'bank_statement',
  'official_letter',
] as const;

export type ScreenableDocumentType = (typeof SCREENABLE_DOCUMENT_TYPES)[number];

export function isScreenableType(value: string): value is ScreenableDocumentType {
  return (SCREENABLE_DOCUMENT_TYPES as readonly string[]).includes(value);
}

/** Why a document is going to a person. One flag per distinct reason. */
export type ScreeningFlag =
  | 'extraction_failed'
  | 'type_not_screenable'
  | 'no_trusted_name'
  | 'no_name_on_document'
  | 'name_mismatch'
  | 'name_close_not_exact'
  | 'no_issuer_found'
  | 'no_amount_found'
  | 'model_not_approved'
  | 'low_text_yield'
  /**
   * Raised by `run.ts`, not by `decideScreening`: only page 1 of a multi-page
   * document is ever rendered, so an otherwise-clean multi-page document is
   * still only partly read.
   */
  | 'pages_not_read';

/** What the vision step managed to read. Every field may be absent. */
export interface ExtractedFields {
  issuer: string | null;
  personName: string | null;
  totalAmountText: string | null;
  currency: string | null;
  reference: string | null;
  /** Characters of text the model reported reading, used as a sanity floor. */
  textLength: number;
}

export interface ScreeningInput {
  documentType: string;
  /** Null when the vision call failed outright - NOT an empty extraction. */
  extracted: ExtractedFields | null;
  /** From the identity provider's decision. Null is the normal case today. */
  trustedName: string | null;
  /** The model that produced `extracted`, as the provider reported it. */
  modelUsed: string | null;
  /** Models permitted to produce an auto-approval. */
  approvedModels: readonly string[];
}

export interface ScreeningDecision {
  action: 'auto_approve' | 'needs_human';
  flags: ScreeningFlag[];
  nameMatch: NameMatch;
  /** One line a reviewer reads first. */
  summary: string;
}

/**
 * A document with almost no text on it is either blank, a photograph of a
 * wall, or a scan that failed. [VERIFIED] a blank page and a shopping list
 * both came back with every field null, so the model does not invent content -
 * but "nothing read" must still not be mistaken for "nothing wrong".
 */
export const MIN_TEXT_LENGTH = 24;

export function decideScreening(input: ScreeningInput): ScreeningDecision {
  const flags: ScreeningFlag[] = [];

  // The vision call itself failed (provider error, timeout, 200-with-error).
  if (!input.extracted) {
    const nameMatch = matchNames(input.trustedName, null);
    return {
      action: 'needs_human',
      flags: ['extraction_failed'],
      nameMatch,
      summary: 'The document could not be read automatically. Please review it.',
    };
  }

  if (!isScreenableType(input.documentType)) {
    flags.push('type_not_screenable');
  }

  if (!input.modelUsed || !input.approvedModels.includes(input.modelUsed)) {
    // A model swap must not silently acquire approval authority.
    flags.push('model_not_approved');
  }

  if (input.extracted.textLength < MIN_TEXT_LENGTH) {
    flags.push('low_text_yield');
  }

  if (!input.extracted.issuer) flags.push('no_issuer_found');
  if (!input.extracted.totalAmountText) flags.push('no_amount_found');

  const nameMatch = matchNames(input.trustedName, input.extracted.personName);
  switch (nameMatch.kind) {
    case 'exact':
    case 'tokens_reordered':
      break;
    case 'subset':
    case 'near':
      flags.push('name_close_not_exact');
      break;
    case 'mismatch':
      flags.push('name_mismatch');
      break;
    case 'indeterminate':
      flags.push(nameMatch.missing === 'extracted' ? 'no_name_on_document' : 'no_trusted_name');
      break;
  }

  /*
    ONE mechanism decides this, deliberately.

    An earlier version also kept an `AUTO_APPROVABLE_MATCH_KINDS` set beside
    the switch above. Mutation testing showed it was DEAD: adding `near` and
    `subset` to it changed no behaviour, because the switch already pushes
    `name_close_not_exact` for both and a non-empty `flags` is what blocks
    approval. Two guards where one does nothing is worse than one guard - the
    next reader may delete the live one trusting the dead one. So the flag list
    is the whole rule: NO FLAGS means approvable, and every path that could
    matter pushes a flag.
  */
  if (flags.length === 0) {
    return {
      action: 'auto_approve',
      flags: [],
      nameMatch,
      summary: `Checked automatically: ${input.extracted.issuer}, ${input.extracted.totalAmountText ?? 'amount unread'}, name matches.`,
    };
  }

  return {
    action: 'needs_human',
    flags,
    nameMatch,
    summary: summarise(flags, nameMatch),
  };
}

function summarise(flags: ScreeningFlag[], nameMatch: NameMatch): string {
  // Ordered by what a reviewer most needs to know first.
  if (flags.includes('name_mismatch')) return 'The name on this document is not the verified name. Please review.';
  if (flags.includes('no_trusted_name')) return 'There is no verified name to check this against. Please review.';
  if (flags.includes('name_close_not_exact')) return `${nameMatch.reason} Please confirm.`;
  if (flags.includes('no_name_on_document')) return 'No name could be read from this document. Please review.';
  if (flags.includes('type_not_screenable')) return 'This kind of document is always reviewed by a person.';
  if (flags.includes('low_text_yield')) return 'Hardly any text could be read from this document. Please review.';
  if (flags.includes('model_not_approved')) return 'This document was read by a model that cannot approve on its own. Please review.';
  if (flags.includes('no_issuer_found')) return 'No issuer could be read from this document. Please review.';
  if (flags.includes('no_amount_found')) return 'No amount could be read from this document. Please review.';
  return 'Please review this document.';
}
