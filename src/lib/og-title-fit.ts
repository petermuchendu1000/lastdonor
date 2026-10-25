/**
 * Choosing a title size that always fits the card.
 *
 * ## Why this is not a character count
 *
 * The title is set in DM Serif Display, a proportional face. Measured from
 * the real font file at 60px: `M` advances **47.5px** and `i` advances
 * **16.8px** - a factor of 2.8. A rule like "over 60 characters, go smaller"
 * is wrong by nearly three times at the extremes, so this measures the
 * actual advance widths instead.
 *
 * ## Why it has to fit at all
 *
 * The title clamped to three lines with an ellipsis, which meant a long
 * appeal lost the end of its own sentence in every share of it. The campaign
 * validator allows **200 characters**
 * (`src/lib/validators/campaign.ts:30`), and the longest real title in
 * production is 79. Both must fit without truncation.
 *
 * Everything here is pure: the caller supplies a `measure` function, so a
 * test can run every rule with a fake one and the real font never has to be
 * loaded to check the logic.
 */

/** Measures the advance width of `text` at `size` px. */
export type Measure = (text: string, size: number) => number;

export interface FitTitleInput {
  text: string;
  measure: Measure;
  /** Usable width inside the panel's padding. */
  maxWidth: number;
  /** Vertical space the title block may occupy. */
  maxHeight: number;
  /** Sizes to try, largest first. */
  sizes: readonly number[];
  lineHeight: number;
}

export interface FitTitleResult {
  size: number;
  lines: string[];
  /** True when even the smallest size overflowed and lines were dropped. */
  truncated: boolean;
}

/**
 * Greedy word wrap, with a hard break for a single word too long for the
 * line.
 *
 * ⚠️ The hard break is not hypothetical: a word that cannot fit would
 * otherwise return a line wider than the box, every size in the ladder would
 * "overflow", and the title would silently drop to the smallest size and
 * still run off the card. The route sets `wordBreak: 'break-word'` so the
 * renderer breaks it the same way this does.
 */
export function wrapLines(
  text: string,
  measure: Measure,
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  const pushHardBroken = (word: string) => {
    let chunk = '';
    for (const ch of word) {
      if (chunk && measure(chunk + ch, size) > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    line = chunk;
  };

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || measure(candidate, size) <= maxWidth) {
      if (measure(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      // First word on the line and still too wide: break it.
      pushHardBroken(word);
      continue;
    }
    lines.push(line);
    if (measure(word, size) > maxWidth) {
      line = '';
      pushHardBroken(word);
    } else {
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines;
}

/**
 * The largest size in `sizes` at which the whole title fits the box.
 *
 * Falls back to the smallest size and reports `truncated: true` rather than
 * overflowing the card, so the failure is visible to the caller and to a
 * test instead of silently drawing over the money.
 */
export function fitTitle(input: FitTitleInput): FitTitleResult {
  const { text, measure, maxWidth, maxHeight, sizes, lineHeight } = input;
  const ordered = [...sizes].sort((a, b) => b - a);

  for (const size of ordered) {
    const lines = wrapLines(text, measure, size, maxWidth);
    if (lines.length * size * lineHeight <= maxHeight) {
      return { size, lines, truncated: false };
    }
  }

  const size = ordered[ordered.length - 1];
  const lines = wrapLines(text, measure, size, maxWidth);
  const allowed = Math.max(1, Math.floor(maxHeight / (size * lineHeight)));
  return {
    size,
    lines: lines.slice(0, allowed),
    truncated: lines.length > allowed,
  };
}
