/**
 * The screening decision, and the one invariant that matters.
 *
 * THE MONEY-SAFETY INVARIANT, stated once: a document may be approved without
 * a person ONLY when every check passed. Every unknown, every absence and
 * every provider failure must come back `needs_human`. The specific confusion
 * this file exists to prevent is treating a MISSING trusted name as "no
 * mismatch found" - today no campaign has a verified name on file, so that one
 * mistake would auto-approve every document on the platform.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';

import {
  decideScreening,
  isScreenableType,
  SCREENABLE_DOCUMENT_TYPES,
  MIN_TEXT_LENGTH,
  type ExtractedFields,
  type ScreeningInput,
} from './decide';
import { DOCUMENT_TYPES } from '@/lib/validators/verification';
import { downgradeForUnreadPages } from './run';

const MODEL = 'nvidia/nemotron-3.5-super-vl:free';
const APPROVED = [MODEL] as const;

/** A clean read of a real-looking bill. */
function goodFields(over: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    issuer: 'KENYATTA MEMORIAL HOSPITAL',
    personName: 'ASHA W. MUTISO',
    totalAmountText: 'KES 205,555',
    currency: 'KES',
    reference: 'INV-2026-77310',
    textLength: 400,
    ...over,
  };
}

function input(over: Partial<ScreeningInput> = {}): ScreeningInput {
  return {
    documentType: 'hospital_letter',
    extracted: goodFields(),
    trustedName: 'Asha W. Mutiso',
    modelUsed: MODEL,
    approvedModels: APPROVED,
    ...over,
  };
}

describe('the only path to auto-approval', () => {
  it('approves a clean, screenable document whose name matches', () => {
    const d = decideScreening(input());
    expect(d.action).toBe('auto_approve');
    expect(d.flags).toEqual([]);
    expect(d.nameMatch.kind).toBe('exact');
  });

  it('REQUIRES every condition: breaking any one sends it to a human', () => {
    /*
      Stated as a loop rather than nine separate tests, so adding a condition
      to `decideScreening` without adding a case here is visible: the count is
      asserted at the end.
    */
    const breakers: [string, Partial<ScreeningInput>][] = [
      ['extraction failed', { extracted: null }],
      ['type not screenable', { documentType: 'government_id' }],
      ['no trusted name', { trustedName: null }],
      ['no name on document', { extracted: goodFields({ personName: null }) }],
      ['name mismatch', { trustedName: 'Someone Else Entirely' }],
      ['name only close', { trustedName: 'Asha W. Mutisa' }],
      ['no issuer', { extracted: goodFields({ issuer: null }) }],
      ['no amount', { extracted: goodFields({ totalAmountText: null }) }],
      ['unapproved model', { modelUsed: 'some/other-model' }],
      ['low text yield', { extracted: goodFields({ textLength: MIN_TEXT_LENGTH - 1 }) }],
      ['model not reported', { modelUsed: null }],
    ];

    for (const [label, over] of breakers) {
      const d = decideScreening(input(over));
      expect(d.action, `"${label}" must not auto-approve`).toBe('needs_human');
      expect(d.flags.length, `"${label}" must name a reason`).toBeGreaterThan(0);
      expect(d.summary.length, `"${label}" must explain itself`).toBeGreaterThan(0);
    }
    expect(breakers).toHaveLength(11);
  });
});

describe('absence is never agreement', () => {
  it('a MISSING trusted name flags no_trusted_name, not a pass', () => {
    /*
      The defect this whole file is built around. Today `campaigns` has 20 rows
      and `didit_session_id` is NULL on all of them, so no verified name exists
      anywhere - a rule that read absence as agreement would auto-approve
      every document on the platform on day one.
    */
    const d = decideScreening(input({ trustedName: null }));
    expect(d.action).toBe('needs_human');
    expect(d.flags).toContain('no_trusted_name');
    expect(d.nameMatch.kind).toBe('indeterminate');
    expect(d.nameMatch.score).toBe(0);
  });

  it('distinguishes "no name on file" from "no name on the document"', () => {
    expect(decideScreening(input({ trustedName: null })).flags).toContain('no_trusted_name');
    expect(
      decideScreening(input({ extracted: goodFields({ personName: null }) })).flags,
    ).toContain('no_name_on_document');
  });

  it('an empty-string trusted name is absence, not a match against empty', () => {
    const d = decideScreening(input({ trustedName: '', extracted: goodFields({ personName: '' }) }));
    expect(d.action).toBe('needs_human');
    expect(d.nameMatch.kind).toBe('indeterminate');
  });

  it('a whitespace-and-punctuation-only name is still absence', () => {
    const d = decideScreening(input({ trustedName: '  -- .. ' }));
    expect(d.action).toBe('needs_human');
    expect(d.flags).toContain('no_trusted_name');
  });
});

describe('the provider failing is not the same as the document being fine', () => {
  it('a null extraction is needs_human with extraction_failed', () => {
    const d = decideScreening(input({ extracted: null }));
    expect(d.action).toBe('needs_human');
    expect(d.flags).toEqual(['extraction_failed']);
  });

  it('an EMPTY extraction is not mistaken for a failed one, and still blocks', () => {
    // A blank page genuinely reads as all-nulls: [VERIFIED] against the live
    // model, a blank PNG and a shopping list both returned five nulls. That is
    // a successful read of nothing, which must still reach a person.
    const empty: ExtractedFields = {
      issuer: null, personName: null, totalAmountText: null,
      currency: null, reference: null, textLength: 0,
    };
    const d = decideScreening(input({ extracted: empty }));
    expect(d.action).toBe('needs_human');
    expect(d.flags).not.toContain('extraction_failed');
    expect(d.flags).toContain('no_issuer_found');
    expect(d.flags).toContain('low_text_yield');
  });
});

describe('identity documents are never machine-approved', () => {
  it('government_id and selfie are absent from the screenable list', () => {
    expect(SCREENABLE_DOCUMENT_TYPES).not.toContain('government_id');
    expect(SCREENABLE_DOCUMENT_TYPES).not.toContain('selfie');
    expect(SCREENABLE_DOCUMENT_TYPES).not.toContain('other');
  });

  it('every type in the uploader validator is classified one way or the other', () => {
    // Stops a new document type silently becoming screenable, or silently
    // becoming unreachable, when someone edits DOCUMENT_TYPES.
    for (const t of DOCUMENT_TYPES) {
      expect(typeof isScreenableType(t), t).toBe('boolean');
    }
    const screenable = DOCUMENT_TYPES.filter(isScreenableType);
    expect(screenable).toEqual([
      'hospital_letter', 'receipt', 'utility_bill', 'bank_statement', 'official_letter',
    ]);
  });

  it('a perfect read of a government ID still goes to a person', () => {
    const d = decideScreening(input({ documentType: 'government_id' }));
    expect(d.action).toBe('needs_human');
    expect(d.flags).toContain('type_not_screenable');
  });
});

describe('a model cannot grant itself approval authority', () => {
  it('refuses a model outside the approved list', () => {
    const d = decideScreening(input({ modelUsed: 'attacker/pliable-model' }));
    expect(d.action).toBe('needs_human');
    expect(d.flags).toContain('model_not_approved');
  });

  it('refuses when the approved list is empty', () => {
    const d = decideScreening(input({ approvedModels: [] }));
    expect(d.action).toBe('needs_human');
    expect(d.flags).toContain('model_not_approved');
  });
});

describe('there is no auto-rejection', () => {
  it('even a flat name mismatch only asks for a person', () => {
    /*
      Deliberate asymmetry. Refusing a hospital bill is an adverse decision
      about someone mid-emergency, taken on an OCR read already observed
      mangling a name. The machine may say "fine"; it may never say "no".
    */
    const d = decideScreening(input({ trustedName: 'Completely Different Person' }));
    expect(d.action).toBe('needs_human');
    expect(['auto_approve', 'needs_human']).toContain(d.action);
  });

  it('no input produces any action other than the two', () => {
    const variants: Partial<ScreeningInput>[] = [
      {}, { extracted: null }, { trustedName: null }, { documentType: 'selfie' },
      { documentType: 'nonsense-type' }, { modelUsed: null },
      { extracted: goodFields({ textLength: 0 }) },
    ];
    for (const v of variants) {
      expect(['auto_approve', 'needs_human']).toContain(decideScreening(input(v)).action);
    }
  });
});

describe('the reviewer-facing summary', () => {
  it('leads with the name mismatch when there is one', () => {
    const d = decideScreening(input({ trustedName: 'Completely Different Person' }));
    expect(d.summary).toMatch(/not the verified name/i);
  });

  it('says so plainly when there is nothing to check against', () => {
    const d = decideScreening(input({ trustedName: null }));
    expect(d.summary).toMatch(/no verified name/i);
  });

  it('names the issuer and amount when it approves, so the row is auditable', () => {
    const d = decideScreening(input());
    expect(d.summary).toContain('KENYATTA MEMORIAL HOSPITAL');
    expect(d.summary).toContain('KES 205,555');
  });
});

describe('a multi-page document is only partly read', () => {
  /*
    Only page 1 is ever rendered (`rasterise.ts`), so an otherwise-clean
    9-page document has NOT been checked. This rule lives in `run.ts` because
    it depends on the rasteriser's output, and it is tested here because it is
    the difference between "the document was checked" and "a fragment of it
    was" - exactly the kind of distinction that vanishes into an inline
    conditional and never gets asserted.
  */
  it('downgrades a clean approval when pages were not read', () => {
    const clean = decideScreening(input());
    expect(clean.action).toBe('auto_approve');

    const d = downgradeForUnreadPages(clean, true, 9);
    expect(d.action).toBe('needs_human');
    expect(d.flags).toContain('pages_not_read');
    expect(d.summary).toContain('page 1 of 9');
  });

  it('leaves a single-page document exactly as decided', () => {
    const clean = decideScreening(input());
    const d = downgradeForUnreadPages(clean, false, 1);
    expect(d.action).toBe('auto_approve');
    expect(d.flags).toEqual([]);
    expect(d.summary).toBe(clean.summary);
  });

  it('does not overwrite a more specific reason it was already going to a person', () => {
    const mismatch = decideScreening(input({ trustedName: 'Someone Else' }));
    const d = downgradeForUnreadPages(mismatch, true, 4);
    expect(d.action).toBe('needs_human');
    expect(d.flags).toContain('name_mismatch');
    expect(d.summary).toMatch(/not the verified name/i);
  });

  it('copes with an unknown page count rather than printing null', () => {
    const d = downgradeForUnreadPages(decideScreening(input()), true, null);
    expect(d.summary).not.toContain('null');
    expect(d.summary).toContain('several');
  });
});
