/**
 * The keyboard contract of a modal, executed.
 *
 * `docs/155`. These assert the three WAI-ARIA requirements that the wizard's
 * two hand-rolled dialogs promised with `role="dialog" aria-modal="true"` and
 * did not keep, plus the roving-tabIndex case that defeated the first fix.
 *
 * ⚠️ Why the roving case has its own test: the trap's selector matched
 * `button:not([disabled])`, which a `<button role="radio" tabindex="-1">`
 * satisfies. Every hand-rolled radiogroup in this product uses roving tabIndex
 * (`docs/100`), so `last` was an option Tab can never reach and the wrap never
 * fired. [VERIFIED in a browser: focus escaped to a control behind the
 * overlay.] A test without a roving group inside the dialog passes against
 * that defect - which is exactly why `FundraiserPreviewModal` looked correct.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useRef } from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { useModalKeyboard, tabbablesIn } from './useModalKeyboard';

afterEach(cleanup);

function Dialog({
  onClose,
  canClose,
  roving,
}: {
  onClose: () => void;
  canClose?: boolean;
  roving?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModalKeyboard({ open: true, contentRef: ref, onClose, canClose });
  return (
    <div role="dialog" aria-modal="true">
      <div ref={ref}>
        <button type="button">Close</button>
        {roving && (
          <div role="radiogroup" aria-label="Campaign category">
            {/* roving tabIndex: one tabbable option, the rest reachable only by arrow key */}
            <button type="button" role="radio" aria-checked="true" tabIndex={0}>Medical</button>
            <button type="button" role="radio" aria-checked="false" tabIndex={-1}>Memorial</button>
            <button type="button" role="radio" aria-checked="false" tabIndex={-1}>Education</button>
          </div>
        )}
        <button type="button">Save</button>
      </div>
    </div>
  );
}

describe('useModalKeyboard', () => {
  it('⛔ D1: moves focus INTO the dialog when it opens', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Edit';
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    render(<Dialog onClose={() => {}} />);
    expect((document.activeElement as HTMLElement).textContent).toBe('Close');
    opener.remove();
  });

  it('⛔ D3: Escape calls onClose', () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('⛔ D3: restores focus to whatever was focused before, on unmount', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const view = render(<Dialog onClose={() => {}} />);
    expect(document.activeElement).not.toBe(opener);
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('⚠️ canClose:false ignores Escape (a dialog mid-submit must not vanish)', () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} canClose={false} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('⚠️ the control: a key that is neither Tab nor Escape is ignored', () => {
    /*
      Without this, a handler that called onClose on every keydown would pass
      the Escape test.
    */
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    for (const key of ['a', 'Enter', 'ArrowRight', ' ']) {
      fireEvent.keyDown(document, { key });
    }
    expect(onClose).not.toHaveBeenCalled();
  });

  it('⛔ D2: Tab on the LAST tabbable wraps to the first', () => {
    render(<Dialog onClose={() => {}} />);
    const buttons = [...document.querySelectorAll('button')];
    const last = buttons[buttons.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect((document.activeElement as HTMLElement).textContent).toBe('Close');
  });

  it('⛔ D2: Shift+Tab on the FIRST tabbable wraps to the last', () => {
    render(<Dialog onClose={() => {}} />);
    const first = document.querySelector('button')!;
    (first as HTMLElement).focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect((document.activeElement as HTMLElement).textContent).toBe('Save');
  });

  it('⛔ D2 THE REAL DEFECT: Tab from a roving radio that is NOT tabbable stays inside', () => {
    /*
      This is the case the browser caught and the first fix did not. The
      arrow-reached option has tabIndex -1, so it is absent from the tab
      order; neither boundary comparison is true and the browser would move
      focus to the next tabbable in the DOCUMENT - outside the panel.
    */
    render(<Dialog onClose={() => {}} roving />);
    const memorial = [...document.querySelectorAll('[role="radio"]')].find(
      (b) => b.textContent === 'Memorial',
    ) as HTMLElement;
    memorial.focus();
    expect(document.activeElement).toBe(memorial);
    expect(memorial.tabIndex).toBe(-1);

    fireEvent.keyDown(document, { key: 'Tab' });
    const panel = document.querySelector('[role="dialog"] > div')!;
    expect(
      panel.contains(document.activeElement),
      `focus left the dialog: now on "${(document.activeElement as HTMLElement)?.textContent}"`,
    ).toBe(true);
  });

  it('⚠️ tabbablesIn excludes a focusable-but-not-tabbable option', () => {
    /*
      The unit of the defect, asserted directly: the SELECTOR matches all three
      radios; only one is in the tab order.
    */
    render(<Dialog onClose={() => {}} roving />);
    const panel = document.querySelector('[role="dialog"] > div') as HTMLElement;
    const matched = panel.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
    ).length;
    const tabbable = tabbablesIn(panel).length;
    expect(matched, 'the selector should match all three radios plus Close/Save').toBe(5);
    expect(tabbable, 'only one radio is in the tab order').toBe(3);
    expect(tabbable).toBeLessThan(matched);
  });

  it('⚠️ binds nothing while closed', () => {
    const onClose = vi.fn();
    function Closed() {
      const ref = useRef<HTMLDivElement>(null);
      useModalKeyboard({ open: false, contentRef: ref, onClose });
      return <div ref={ref} />;
    }
    render(<Closed />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
