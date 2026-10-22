/**
 * Keyboard behaviour for a hand-rolled `role="radiogroup"`.
 *
 * ## Why this exists
 *
 * Several groups in this codebase are built from `<button role="radio">`
 * inside a `<div role="radiogroup">` rather than from native `<input
 * type="radio">`, because the tiles carry two lines of content and a badge
 * that a native radio cannot style. That is a reasonable trade, but it comes
 * with an obligation that was not met: **an ARIA role is a promise about
 * behaviour, not a label.**
 *
 * A radio group is ONE tab stop. Tab enters it, arrow keys move between the
 * options and select as they go, Home and End jump to the ends, and Tab
 * leaves. That is what a screen reader tells its user to expect the moment it
 * announces "radio button, 2 of 9".
 *
 * `DonationForm`'s amount group announced exactly that and did none of it.
 * Every tile was a plain `<button>` with the default `tabindex="0"` and there
 * was no key handler anywhere, so:
 *
 * - arrow keys did nothing at all, which is the one interaction a
 *   screen-reader user is told to use;
 * - a keyboard donor had to press Tab **nine times** to cross the amounts,
 *   plus twice more for the frequency toggle, before reaching anything else
 *   in the form.
 *
 * Found by `e2e-12-keyboard-a11y.spec.ts`, which asserted the documented
 * pattern and got `Expected: focused, Received: inactive` — on both the
 * desktop and mobile legs. The group had never been exercised by a keyboard
 * in a test, because the suite had never run (`docs/50`).
 *
 * Fixing it by removing the roles was the alternative. Rejected: the roles
 * carry real information (these nine buttons are one choice, and one of them
 * is selected) that a row of plain buttons cannot convey. Better to make the
 * promise true.
 *
 * ## How
 *
 * `onRadioGroupKeyDown` goes on the group container and works off the DOM,
 * so it needs no refs and no per-option wiring: it finds the `[role="radio"]`
 * descendants, moves focus, and **clicks** the target. Clicking is what
 * selects, which keeps selection in exactly one place — each option's
 * existing `onClick` — rather than duplicating the state update here where it
 * could drift. Selecting on arrow is also what the pattern specifies, not a
 * shortcut.
 *
 * `rovingTabIndex` is the other half. Without it the group is still nine tab
 * stops, since every `<button>` is focusable by default.
 */

/** Keys this handler claims. Anything else is left to the browser. */
const NAVIGATION_KEYS = new Set([
  'ArrowRight',
  'ArrowDown',
  'ArrowLeft',
  'ArrowUp',
  'Home',
  'End',
]);

export interface RadioGroupKeyOptions {
  /**
   * Whether an arrow key also SELECTS the option it moves to.
   *
   * `true` (the default) is what APG specifies and what every ordinary radio
   * group should do: focus and selection move together, so a keyboard user
   * never has to press a second key to choose.
   *
   * `false` is "manual activation": arrows move focus only, and the user
   * presses Space or Enter to choose. That exists for one specific case, and
   * it is not a style preference — **set it when selecting an option DESTROYS
   * the group.**
   *
   * `ShareYourStoryForm`'s review screen has two such groups: picking a
   * category or a relationship there calls `setEditField(null)` in the same
   * handler, which unmounts the whole editor. With selection on move, the
   * first ArrowRight would commit a value and close the panel, so a keyboard
   * user could never reach any option except the one next to the current
   * selection — out of 23 categories. Those chips are currently 23 separate
   * tab stops, so select-on-move would have REDUCED their keyboard reach
   * while appearing to fix the group. See `docs/100`.
   *
   * The trade-off accepted: with manual activation the roving tab stop still
   * follows SELECTION, not focus, so tabbing away and back returns to the
   * selected chip rather than to the one last arrowed to. That is acceptable
   * here because both groups are transient — they close as soon as a choice
   * is made — and it keeps the guarantee that matters, which is exactly one
   * tab stop per group and never a trap.
   */
  selectOnMove?: boolean;
}

/**
 * Put on the element carrying `role="radiogroup"`.
 *
 * Both axes are handled. A group laid out as a row and one laid out as a
 * column are the same widget to a keyboard user, and `DonationForm`'s amounts
 * are a 3-column grid where "next" is meaningful horizontally AND vertically.
 */
export function onRadioGroupKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
  options: RadioGroupKeyOptions = {},
): void {
  if (!NAVIGATION_KEYS.has(event.key)) return;

  const radios = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'),
  ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true');

  if (radios.length === 0) return;

  const current = radios.indexOf(document.activeElement as HTMLElement);
  const last = radios.length - 1;

  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = last;
  else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    // From outside the group (focus on the container itself), enter at the
    // start rather than wrapping from -1 to 0 by accident.
    next = current < 0 ? 0 : (current + 1) % radios.length;
  } else {
    next = current < 0 ? last : (current - 1 + radios.length) % radios.length;
  }

  // Only now, so an unhandled key still scrolls the page as the user expects.
  event.preventDefault();
  radios[next].focus();

  if (options.selectOnMove === false) return;

  /*
    `click()`, not a state setter. Each option already owns its selection in
    its own `onClick`; calling it is what keeps arrow-selection and
    click-selection from being two implementations that can disagree.

    Under manual activation we have already returned, and Space/Enter are
    left to the browser: these options are real `<button>`s, which activate
    on both, firing the same `onClick`. So there is still exactly one code
    path that selects.
  */
  radios[next].click();
}

/**
 * The `tabIndex` for one option in a roving group.
 *
 * `isSelected` wins when anything is selected. When nothing is — which is the
 * donate form's initial state, deliberately, so no amount is pre-chosen — the
 * FIRST option takes the tab stop. Without that fallback every option would
 * be `-1` and the group would be unreachable by keyboard entirely, which is
 * worse than the defect being fixed.
 */
export function rovingTabIndex(opts: {
  isSelected: boolean;
  isFirst: boolean;
  anySelected: boolean;
}): 0 | -1 {
  if (opts.anySelected) return opts.isSelected ? 0 : -1;
  return opts.isFirst ? 0 : -1;
}
