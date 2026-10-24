/**
 * Comparing a name read off a document against a name we actually trust.
 *
 * ── WHY THIS IS NOT A STRING EQUALITY CHECK ─────────────────────────────────
 *
 * [VERIFIED 2026-10-24] A synthetic hospital bill reading `ASHA W. MUTISO` was
 * sent to `nvidia/nemotron-3.5-super-vl:free`, which returned:
 *
 *   {"person_name": "ASHAW. MUTISO", ...}
 *
 * One lost space. Every other field on that document came back perfect. That
 * was a machine-rendered, high-contrast, perfectly square PNG - the easiest
 * input this will ever see; a photographed, creased, skewed bill will be
 * worse. So the comparison has to survive OCR noise in the one field the whole
 * screening decision rests on, or it will flag correct documents and train
 * reviewers to click through warnings.
 *
 * The trick that kills that specific failure: compare with ALL separators
 * removed. `ASHA W. MUTISO` and `ASHAW. MUTISO` both normalise to
 * `ASHAWMUTISO`, so a dropped or inserted space costs nothing.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * It returns a SCORE and a reason, never a verdict about a person. The
 * decision - and whether a human looks - belongs to `decide.ts`, which treats
 * a missing trusted name as "cannot judge" rather than "no mismatch found".
 */

/** Honorifics and suffixes that appear on bills and not on IDs, or vice versa. */
const DROPPABLE_TOKENS = new Set([
  'MR', 'MRS', 'MS', 'MISS', 'DR', 'PROF', 'REV', 'FR', 'SR', 'HON', 'ENG',
  'JR', 'II', 'III', 'IV',
  // Swahili / Kenyan forms that show up on official letters.
  'BW', 'BWANA', 'BI', 'MWALIMU', 'DKT',
]);

/**
 * Upper-case, strip accents, drop everything that is not a letter or digit.
 *
 * Accent folding matters because an ID may carry `JOSÉ` while a billing system
 * that cannot store non-ASCII prints `JOSE`.
 */
export function normaliseName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** The same normalisation, but keeping word boundaries, for token comparison. */
export function nameTokens(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length > 0 && !DROPPABLE_TOKENS.has(t));
}

/**
 * Levenshtein distance, iterative with two rows.
 *
 * Bounded by `max`: once every cell in a row exceeds it the answer cannot come
 * back under it, so we stop. Names are short, but the input is attacker-
 * supplied via OCR of an uploaded file, and an unbounded O(n*m) over two
 * megabyte strings is a denial-of-service waiting to happen.
 */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length];
}

export type NameMatchKind =
  /** Identical once separators and accents are removed. */
  | 'exact'
  /** Same set of name words, in any order (surname-first vs surname-last). */
  | 'tokens_reordered'
  /** Every word of the shorter name appears in the longer one (middle name dropped). */
  | 'subset'
  /** Close enough that OCR noise explains the difference. */
  | 'near'
  /** Not close. */
  | 'mismatch'
  /** One side was empty, so no comparison happened. */
  | 'indeterminate';

export interface NameMatch {
  kind: NameMatchKind;
  /** 0..1. A reported figure, not a threshold: `decide.ts` owns the cut-off. */
  score: number;
  /** Edit distance on the separator-free forms, or null when indeterminate. */
  distance: number | null;
  /** Plain-language reason, safe to show a reviewer. */
  reason: string;
  /**
   * Which side was unusable, when `kind` is `indeterminate`.
   *
   * Exists because the caller cannot work this out from the raw inputs: a
   * trusted name of `"  -- .. "` is a truthy string that normalises to
   * nothing, and testing it for truthiness told a reviewer "no name on the
   * document" when the truth was "no verified name on file". Those are
   * different problems with different fixes.
   */
  missing?: 'trusted' | 'extracted' | 'both';
}

/**
 * Names are short. Capping the length before computing an edit distance keeps
 * the comparison O(1) in the size of an attacker-supplied upload while leaving
 * every real name untouched.
 */
const MAX_COMPARED_LENGTH = 128;

/**
 * ⚠️ THE `near` BAND IS PROVISIONAL AND SAMPLED FROM ONE OBSERVATION.
 *
 * One real OCR error has been measured (the dropped space above), and that one
 * is handled exactly by the separator-free comparison, at distance 0. So this
 * allowance covers errors nobody here has seen yet: a single substituted or
 * dropped character in a name of reasonable length.
 *
 * It is expressed as a RATIO rather than a fixed count so it does not become
 * more permissive as names get shorter - one wrong character in `OTIENO` is a
 * much bigger claim than one wrong character in `WANJIRU MUTHONI KAMAU`.
 *
 * ⛔ Do NOT raise this to make a document pass. The correct response to a
 * near-miss is a human looking at it, which is what `decide.ts` does.
 */
export const NEAR_MATCH_MAX_DISTANCE_RATIO = 0.12;

/** Never allow more than this many edits, however long the name. */
export const NEAR_MATCH_MAX_DISTANCE = 2;

/**
 * Compare a name extracted from a document against a name we trust.
 *
 * `trusted` is expected to come from an identity provider's decision, never
 * from `users.name` - a self-declared name compared against a document the
 * same person uploaded proves nothing at all.
 */
export function matchNames(trusted: string | null | undefined, extracted: string | null | undefined): NameMatch {
  const trustedNorm = trusted ? normaliseName(trusted) : '';
  const extractedNorm = extracted ? normaliseName(extracted) : '';

  if (!trustedNorm || !extractedNorm) {
    const missing = !trustedNorm && !extractedNorm ? 'both' : !trustedNorm ? 'trusted' : 'extracted';
    return {
      kind: 'indeterminate',
      score: 0,
      distance: null,
      missing,
      reason: missing === 'extracted'
        ? 'No name could be read from this document.'
        : 'No verified name is on file for this organiser, so the document name could not be checked.',
    };
  }

  if (trustedNorm === extractedNorm) {
    return {
      kind: 'exact',
      score: 1,
      distance: 0,
      reason: 'The name on the document matches the verified name.',
    };
  }

  const trustedTokens = nameTokens(trusted!);
  const extractedTokens = nameTokens(extracted!);
  const trustedSet = new Set(trustedTokens);
  const extractedSet = new Set(extractedTokens);

  const sameTokens =
    trustedSet.size === extractedSet.size &&
    [...trustedSet].every((t) => extractedSet.has(t));
  if (sameTokens) {
    return {
      kind: 'tokens_reordered',
      score: 0.95,
      distance: boundedLevenshtein(trustedNorm, extractedNorm, 64),
      reason: 'The same names appear in a different order.',
    };
  }

  const [smaller, larger] =
    trustedSet.size <= extractedSet.size ? [trustedSet, extractedSet] : [extractedSet, trustedSet];
  if (smaller.size > 0 && [...smaller].every((t) => larger.has(t))) {
    return {
      kind: 'subset',
      score: 0.8,
      distance: boundedLevenshtein(trustedNorm, extractedNorm, 64),
      reason: 'One name has an extra part, such as a middle name, that the other does not.',
    };
  }

  /*
    The distance is computed to its TRUE value, not to a bound.

    The first version bounded it at `allowance + 1` and then derived the score
    from whatever came back - so a bail-out sentinel became a similarity
    figure, and `ASHA W. MUTISO` vs `PETER KAMAU NJOROGE` reported 0.765. A
    reviewer shown that number would reasonably read it as "nearly the same
    person". A score that is cheaper to compute than to trust is worse than no
    score. Length is capped instead, which costs nothing on real names.
  */
  const a = trustedNorm.slice(0, MAX_COMPARED_LENGTH);
  const b = extractedNorm.slice(0, MAX_COMPARED_LENGTH);
  const longest = Math.max(a.length, b.length);
  const distance = boundedLevenshtein(a, b, longest);

  const allowance = Math.min(
    NEAR_MATCH_MAX_DISTANCE,
    Math.floor(longest * NEAR_MATCH_MAX_DISTANCE_RATIO),
  );

  if (allowance > 0 && distance <= allowance) {
    return {
      kind: 'near',
      score: Math.max(0, 1 - distance / longest),
      distance,
      reason: `The names differ by ${distance} character${distance === 1 ? '' : 's'}, which may be a reading error.`,
    };
  }

  return {
    kind: 'mismatch',
    score: Math.max(0, 1 - distance / longest),
    distance,
    reason: 'The name on the document is not the verified name.',
  };
}
