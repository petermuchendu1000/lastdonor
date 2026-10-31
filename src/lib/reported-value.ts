/**
 * Preparing a caller-supplied value to be shown back to the visitor.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * `docs/45`'s rule is that a filter value we cannot apply is REPORTED rather
 * than dropped — *"category 'x' is not one we recognize, so it was not
 * applied"*. That sentence quotes the URL back, so every surface obeying the
 * rule renders a string a stranger chose, on a public indexable page.
 *
 * It was implemented three times with three different answers: no cap on
 * `/campaigns` (`docs/45`), 60 on `/completed-campaigns` (`docs/165`), 40 on
 * `/blog` (`docs/164`). [VERIFIED live on v171 at 390px with a 500-character
 * value] the page slid **4,520px / 239px / 36px** sideways respectively, with
 * a short value and no param both at 0px as the controls.
 *
 * ⛔ So a cap alone is NOT the fix, and the two I wrote were half-fixes: a
 * 60-character unbroken run still overflows a phone. The missing property is
 * that the value must be allowed to WRAP. Both halves are needed —
 * `reportedValue` here, and `wrap-anywhere` where it is rendered.
 *
 * ⚠️ Escaping is NOT this module's job and never was. React escapes a text
 * child, which is [VERIFIED by execution]: `<img src=x onerror=alert(1)>` in
 * the URL renders as literal text — 0 dialogs, 0 page errors, 0 injected
 * elements. Do not add HTML stripping here; it would imply the renderer needs
 * it, and the one thing that must stay true is that this value is only ever a
 * text child.
 */

/**
 * The longest value any surface could actually recognise, today.
 *
 * ⛔ The cap must EXCEED this, or a visitor who typed something nearly right
 * is shown their own near-miss truncated and cannot see what they got wrong.
 * `first-responders` is 16 characters; `MAX_REPORTED_VALUE_LENGTH` is 40, so
 * there is room for a guess well longer than anything real. A test derives
 * this floor from the live category list rather than restating it.
 */
export const MAX_REPORTED_VALUE_LENGTH = 40;

/** Rendered in place of the characters removed. */
export const TRUNCATION_MARK = '…';

/**
 * Trim a raw param value and cap it for display.
 *
 * Returns the empty string for a value that is nothing but whitespace, so a
 * caller can treat "there is something to report" as a truthiness check.
 */
export function reportedValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= MAX_REPORTED_VALUE_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_REPORTED_VALUE_LENGTH)}${TRUNCATION_MARK}`;
}
