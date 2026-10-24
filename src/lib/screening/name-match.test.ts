/**
 * Name matching, anchored on a real OCR failure rather than on imagination.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';

import {
  matchNames,
  normaliseName,
  nameTokens,
  boundedLevenshtein,
  NEAR_MATCH_MAX_DISTANCE,
} from './name-match';

describe('the OCR error that was actually observed', () => {
  it('treats the dropped space in "ASHAW. MUTISO" as an exact match', () => {
    /*
      [VERIFIED 2026-10-24] The image read `ASHA W. MUTISO`.
      `nvidia/nemotron-3.5-super-vl:free` returned `ASHAW. MUTISO`.
      Every other field on that document came back perfect.

      This is the reported symptom, and it is the reason the comparison strips
      separators instead of comparing strings.
    */
    const m = matchNames('ASHA W. MUTISO', 'ASHAW. MUTISO');
    expect(m.kind).toBe('exact');
    expect(m.score).toBe(1);
    expect(m.distance).toBe(0);
  });

  it('is unmoved by any amount of separator noise', () => {
    for (const variant of [
      'ASHA W MUTISO', 'ASHA  W.  MUTISO', 'ASHA-W-MUTISO', 'ASHA.W.MUTISO',
      'ASHAWMUTISO', 'asha w. mutiso', '  ASHA W. MUTISO  ',
    ]) {
      expect(matchNames('ASHA W. MUTISO', variant).kind, variant).toBe('exact');
    }
  });
});

describe('normalisation', () => {
  it('folds accents, because an ID and a billing system disagree about them', () => {
    expect(normaliseName('JOSÉ MARÍA')).toBe('JOSEMARIA');
    expect(matchNames('José María Otieno', 'JOSE MARIA OTIENO').kind).toBe('exact');
  });

  it('drops honorifics when comparing words', () => {
    expect(nameTokens('Dr. Asha W. Mutiso')).toEqual(['ASHA', 'W', 'MUTISO']);
    expect(nameTokens('Bw. John Otieno Jr')).toEqual(['JOHN', 'OTIENO']);
  });

  it('survives an honorific appearing on only one side', () => {
    expect(matchNames('Asha Mutiso', 'Dr Asha Mutiso').kind).toBe('tokens_reordered');
  });
});

describe('the shapes a real pair of names takes', () => {
  it('recognises surname-first ordering', () => {
    const m = matchNames('Asha Mutiso', 'MUTISO ASHA');
    expect(m.kind).toBe('tokens_reordered');
    expect(m.score).toBeGreaterThan(0.9);
  });

  it('recognises a dropped middle name as a subset, NOT as exact', () => {
    const m = matchNames('Asha Wanjiru Mutiso', 'Asha Mutiso');
    expect(m.kind).toBe('subset');
    // Deliberately not auto-approvable: it is also what a near-miss forgery
    // looks like. `decide.ts` sends it to a person.
    expect(m.score).toBeLessThan(0.95);
  });

  it('calls a different person a mismatch', () => {
    const m = matchNames('Asha W. Mutiso', 'Peter Kamau Njoroge');
    expect(m.kind).toBe('mismatch');
    expect(m.score).toBeLessThan(0.6);
  });

  it('does not let a shared surname pass as a match', () => {
    // The realistic fraud: a relative's bill under the organiser's surname.
    const m = matchNames('Asha Mutiso', 'Brian Mutiso');
    expect(m.kind).toBe('mismatch');
  });
});

describe('the near band, and its boundary', () => {
  it('allows a single character slip in a long name', () => {
    const m = matchNames('Wanjiru Muthoni Kamau', 'Wanjiru Muthoni Kamao');
    expect(m.kind).toBe('near');
    expect(m.distance).toBe(1);
  });

  it('does NOT allow a slip in a short name, where one character is a big claim', () => {
    // OTIENO -> OTIENA is 1 edit of 6 characters: 17%, over the ratio.
    const m = matchNames('Otieno', 'Otiena');
    expect(m.kind).toBe('mismatch');
  });

  it('never allows more than the hard cap, however long the name', () => {
    const long = 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const corrupted = `XYZ${long.slice(3)}`; // 3 edits
    expect(NEAR_MATCH_MAX_DISTANCE).toBe(2);
    expect(matchNames(long, corrupted).kind).toBe('mismatch');
  });
});

describe('indeterminate, which is not a match and not a mismatch', () => {
  it('reports absence on either side', () => {
    expect(matchNames(null, 'Asha Mutiso').kind).toBe('indeterminate');
    expect(matchNames('Asha Mutiso', null).kind).toBe('indeterminate');
    expect(matchNames(null, null).kind).toBe('indeterminate');
    expect(matchNames('', '').kind).toBe('indeterminate');
    expect(matchNames(undefined, undefined).kind).toBe('indeterminate');
  });

  it('scores zero and explains which side was missing', () => {
    expect(matchNames(null, 'X').reason).toMatch(/no verified name/i);
    expect(matchNames('X', null).reason).toMatch(/no name could be read/i);
    expect(matchNames(null, 'X').score).toBe(0);
  });

  it('treats punctuation-only input as absence', () => {
    expect(matchNames('...', '---').kind).toBe('indeterminate');
  });
});

describe('boundedLevenshtein', () => {
  it('computes small distances exactly', () => {
    expect(boundedLevenshtein('kitten', 'sitting', 10)).toBe(3);
    expect(boundedLevenshtein('abc', 'abc', 10)).toBe(0);
    expect(boundedLevenshtein('', 'abc', 10)).toBe(3);
  });

  it('gives up rather than grinding, which is the point of the bound', () => {
    // The input is OCR of an attacker-supplied upload. An unbounded O(n*m)
    // over two large strings is a denial of service, not a comparison.
    const a = 'a'.repeat(5000);
    const b = 'b'.repeat(5000);
    const t = Date.now();
    expect(boundedLevenshtein(a, b, 2)).toBe(3);
    expect(Date.now() - t).toBeLessThan(200);
  });

  it('short-circuits on a length difference beyond the bound', () => {
    expect(boundedLevenshtein('ab', 'abcdefghij', 2)).toBe(3);
  });
});
