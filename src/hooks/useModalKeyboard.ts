'use client';

/**
 * The keyboard contract of a hand-rolled modal dialog.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `docs/155`. The create-campaign wizard renders two dialogs by hand - the
 * media picker and the seven inline "Edit" editors on the review screen - as
 * `<div role="dialog" aria-modal="true" onClick={close} onKeyDown={trapFocus}>`.
 *
 * [VERIFIED by execution, with a Radix sheet in the same product as the
 * control] none of the three things that markup promises was true:
 *
 *   - focus did NOT move into the dialog when it opened; it stayed on the
 *     "Edit" button, and a hit test at that button's own centre returned the
 *     OVERLAY - so a keyboard user was focused on a control painted
 *     underneath the modal;
 *   - Tab therefore walked them through the page BEHIND the backdrop (27
 *     presses, focus never inside);
 *   - Escape did nothing, because the file contained no Escape handler at all.
 *
 * ⛔ And the Tab trap was DEAD CODE rather than broken code. `onKeyDown` on
 * the overlay is a React handler, so it only fires for keydowns bubbling up
 * from inside the dialog - and nothing ever focused inside. One missing line
 * (initial focus) disabled the trap that was written to contain it.
 *
 * `aria-modal="true"` is a statement to assistive technology that everything
 * outside the dialog is inert. That is worse than saying nothing when the
 * page outside is in fact where the focus ring is.
 *
 * ── WHY A HOOK, AND NOT THE RADIX DIALOG ────────────────────────────────────
 *
 * `src/components/ui/dialog.tsx` exists and Radix gets all of this right - the
 * `/campaigns` Filters sheet was the control that proved it. Converting is the
 * better end state and is recorded as such in `docs/155`; it was not done in
 * that pass because it is a markup rewrite of two dialogs inside a
 * 2,450-line form that `docs/153` had just changed.
 *
 * What this hook IS, is the implementation `FundraiserPreviewModal.tsx` had
 * already written correctly one file away - lifted so there is ONE decider
 * instead of one correct copy and two absent ones.
 */
import { useEffect, type RefObject } from 'react';

/**
 * Candidates for focus. Kept identical to the selector
 * `FundraiserPreviewModal` used, so lifting it changed no behaviour there.
 *
 * ⛔ This selector alone is NOT the tab order - see `tabbablesIn`.
 */
export const MODAL_FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

/**
 * The elements Tab can actually land on, in order.
 *
 * ⛔ WHY THIS IS NOT JUST `querySelectorAll(MODAL_FOCUSABLE)`.
 *
 * `button:not([disabled])` matches a `<button role="radio" tabindex="-1">`.
 * Every hand-rolled radiogroup in this product uses ROVING tabIndex
 * (`docs/100`), so 22 of the 23 category options are matched by that selector
 * and are **not tabbable**. The wrap condition is `activeElement === last`,
 * and `last` was then an option Tab can never reach - so the trap never
 * fired and focus escaped the modal.
 *
 * [VERIFIED by execution, `docs/155`: 27 Tab presses with the Edit-category
 * dialog open ended on "Go back", a control behind the overlay - AFTER the
 * initial-focus fix had made the trap reachable at all.]
 *
 * The selector says what MIGHT take focus; `tabIndex >= 0` says what the
 * browser will Tab to. A modal trap needs the second.
 */
export function tabbablesIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE)].filter(
    (el) => el.tabIndex >= 0,
  );
}

export interface ModalKeyboardOptions {
  /** Whether the dialog is mounted/open. Nothing is bound while false. */
  open: boolean;
  /** The dialog's CONTENT box - the panel, not the full-screen overlay. */
  contentRef: RefObject<HTMLElement | null>;
  /** Called on Escape. */
  onClose: () => void;
  /**
   * When false, Escape is ignored - for a dialog mid-submit, where dismissing
   * would strand an in-flight request. `FundraiserPreviewModal` passes
   * `!launching` here, which is the only reason this option exists.
   */
  canClose?: boolean;
}

export function useModalKeyboard({
  open,
  contentRef,
  onClose,
  canClose = true,
}: ModalKeyboardOptions): void {
  useEffect(() => {
    if (!open) return;
    const container = contentRef.current;
    /*
      Captured BEFORE focus is moved, and restored on unmount. Without this the
      focus ring is left wherever the dialog happened to put it, and a keyboard
      user loses their place in a six-screen form.
    */
    const previouslyFocused = document.activeElement as HTMLElement | null;

    /*
      ⛔ A DOCUMENT listener, not a React `onKeyDown` on the overlay. That was
      the defect: a handler on the overlay only sees keydowns bubbling from
      inside it, so it cannot be what moves focus in, and it never fires while
      focus is outside. Escape in particular must work from wherever focus is.
    */
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (canClose) onClose();
        return;
      }
      if (e.key !== 'Tab' || !container) return;
      const tabbable = tabbablesIn(container);
      if (tabbable.length === 0) return;
      const first = tabbable[0];
      const last = tabbable[tabbable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      /*
        ⛔ `indexOf` and not just the two boundary comparisons. Focus can sit
        on an element that is INSIDE the dialog and absent from the tab order -
        a roving radiogroup option reached with an arrow key is exactly that
        (`docs/100`). From there the browser's next Tab target is computed from
        its document position and lands OUTSIDE the panel, and neither
        boundary test is true, so nothing stops it.
      */
      const idx = active ? tabbable.indexOf(active) : -1;
      if (idx === -1) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && idx === 0) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && idx === tabbable.length - 1) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    /*
      Move focus INTO the dialog. This is the line whose absence made the Tab
      trap unreachable. Falling back to the container itself matters: an editor
      whose only control is a radiogroup rendered with nothing selected has no
      element matching MODAL_FOCUSABLE at mount.
    */
    if (container) {
      const firstFocusable = tabbablesIn(container)[0];
      if (firstFocusable) {
        firstFocusable.focus();
      } else {
        if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
        container.focus();
      }
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, contentRef, onClose, canClose]);
}
