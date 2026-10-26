/**
 * The institution kinds the database accepts and the ones a screen can offer
 * must be the same set.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `funeral_home` was added to the `institution_kind` database enum for
 * `docs/113` and `INSTITUTION_KINDS` was not updated. Typecheck stayed green,
 * every test passed, and the result was a value the database would accept
 * that **no admin could select** - the admin form maps over the constant.
 *
 * Same family as the seven drifted status maps in `docs/110` §4, and the fix
 * is the same: DERIVE the expectation from the enum instead of retyping the
 * list, so the next addition cannot drift either.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { institutionKindEnum } from '@/db/schema';
import { INSTITUTION_KINDS, INSTITUTION_KIND_LABELS } from '@/lib/validators/trust-network';

describe('institution kinds', () => {
  it('⛔ offers exactly the kinds the database accepts', () => {
    expect([...INSTITUTION_KINDS].sort()).toEqual([...institutionKindEnum.enumValues].sort());
  });

  it('⛔ labels every kind, because a missing label renders the raw value', () => {
    /*
      `docs/110` §4: a missing key is not a blank - the map falls back to the
      raw value, so drift reaches the reader as `funeral_home`.
    */
    for (const kind of institutionKindEnum.enumValues) {
      const label = INSTITUTION_KIND_LABELS[kind as keyof typeof INSTITUTION_KIND_LABELS];
      expect(label, kind).toBeTruthy();
      expect(label, kind).not.toBe(kind);
    }
  });

  it('reads a non-trivial enum, so the comparison cannot pass vacuously', () => {
    expect(institutionKindEnum.enumValues.length).toBeGreaterThanOrEqual(8);
  });
});
