import { describe, it, expect, vi } from 'vitest';
import { onRadioGroupKeyDown, rovingTabIndex } from '@/lib/radio-group-keys';

/**
 * These test the helper against a real DOM rather than the component, because
 * the handler's whole design is that it works off the DOM and needs no refs -
 * so the DOM is the honest unit. `DonationForm`'s use of it is covered end to
 * end by `e2e/e2e-12-keyboard-a11y.spec.ts`, which is what found the defect.
 */
function makeGroup(count: number, opts: { disabledIndex?: number } = {}) {
  const group = document.createElement('div');
  group.setAttribute('role', 'radiogroup');
  const clicks: number[] = [];

  for (let i = 0; i < count; i++) {
    const radio = document.createElement('button');
    radio.setAttribute('role', 'radio');
    radio.type = 'button';
    radio.textContent = `option ${i}`;
    if (opts.disabledIndex === i) radio.setAttribute('disabled', '');
    radio.addEventListener('click', () => clicks.push(i));
    group.appendChild(radio);
  }

  document.body.appendChild(group);
  const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  return { group, radios, clicks };
}

/** A minimal stand-in for the React synthetic event the handler receives. */
function keyEvent(key: string, currentTarget: HTMLElement) {
  const preventDefault = vi.fn();
  return {
    key,
    currentTarget,
    preventDefault,
  } as unknown as React.KeyboardEvent<HTMLElement> & { preventDefault: typeof preventDefault };
}

describe('onRadioGroupKeyDown', () => {
  it('moves focus to the next option and selects it', () => {
    const { group, radios, clicks } = makeGroup(3);
    radios[0].focus();

    onRadioGroupKeyDown(keyEvent('ArrowRight', group));

    expect(document.activeElement).toBe(radios[1]);
    // Selection goes through the option's own onClick, not a second code path.
    expect(clicks).toEqual([1]);
  });

  it('wraps from the last option to the first', () => {
    const { group, radios } = makeGroup(3);
    radios[2].focus();

    onRadioGroupKeyDown(keyEvent('ArrowDown', group));

    expect(document.activeElement).toBe(radios[0]);
  });

  it('wraps backwards from the first to the last', () => {
    const { group, radios } = makeGroup(3);
    radios[0].focus();

    onRadioGroupKeyDown(keyEvent('ArrowLeft', group));

    expect(document.activeElement).toBe(radios[2]);
  });

  it('handles both axes, because a grid is navigable either way', () => {
    const { group, radios } = makeGroup(4);
    radios[0].focus();

    onRadioGroupKeyDown(keyEvent('ArrowDown', group));
    expect(document.activeElement).toBe(radios[1]);

    onRadioGroupKeyDown(keyEvent('ArrowUp', group));
    expect(document.activeElement).toBe(radios[0]);
  });

  it('jumps to the ends with Home and End', () => {
    const { group, radios } = makeGroup(5);
    radios[2].focus();

    onRadioGroupKeyDown(keyEvent('End', group));
    expect(document.activeElement).toBe(radios[4]);

    onRadioGroupKeyDown(keyEvent('Home', group));
    expect(document.activeElement).toBe(radios[0]);
  });

  it('enters at the start when focus is not on an option yet', () => {
    const { group, radios } = makeGroup(3);
    // Focus on the container, not a radio: `indexOf` returns -1, and naive
    // arithmetic would make ArrowRight land on index 0 by accident and
    // ArrowLeft wrap to a negative index.
    group.tabIndex = -1;
    group.focus();

    onRadioGroupKeyDown(keyEvent('ArrowRight', group));
    expect(document.activeElement).toBe(radios[0]);
  });

  it('skips a disabled option', () => {
    const { group, radios, clicks } = makeGroup(3, { disabledIndex: 1 });
    radios[0].focus();

    onRadioGroupKeyDown(keyEvent('ArrowRight', group));

    expect(document.activeElement).toBe(radios[2]);
    expect(clicks).toEqual([2]);
  });

  it('ignores keys it does not own, and does not preventDefault on them', () => {
    const { group, radios, clicks } = makeGroup(3);
    radios[0].focus();

    const event = keyEvent('PageDown', group);
    onRadioGroupKeyDown(event);

    // Still on the first option, nothing selected, and the browser keeps the
    // key - so the page can still scroll.
    expect(document.activeElement).toBe(radios[0]);
    expect(clicks).toEqual([]);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('claims the keys it does handle', () => {
    const { group, radios } = makeGroup(3);
    radios[0].focus();

    const event = keyEvent('ArrowRight', group);
    onRadioGroupKeyDown(event);

    // Otherwise ArrowDown scrolls the page out from under the donor while
    // they are choosing an amount.
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('does nothing on an empty group', () => {
    const group = document.createElement('div');
    document.body.appendChild(group);

    expect(() => onRadioGroupKeyDown(keyEvent('ArrowRight', group))).not.toThrow();
  });
});

describe('onRadioGroupKeyDown with selectOnMove: false', () => {
  it('moves focus WITHOUT selecting', () => {
    const { group, radios, clicks } = makeGroup(3);
    radios[0].focus();

    onRadioGroupKeyDown(keyEvent('ArrowRight', group), { selectOnMove: false });

    expect(document.activeElement).toBe(radios[1]);
    expect(clicks).toEqual([]);
  });

  it('lets a keyboard user cross the whole group before choosing', () => {
    /*
      THE REGRESSION THIS EXISTS FOR.

      `ShareYourStoryForm`'s review screen picks a category and then calls
      `setEditField(null)`, which unmounts the group. Under the default
      select-on-move, the first ArrowRight would commit a value and close
      the panel - so of 23 categories a keyboard user could only ever reach
      the one adjacent to the current selection. Those chips used to be 23
      separate tab stops, so "fixing" the group that way would have REDUCED
      their keyboard reach.

      Here: five arrow presses, nothing selected yet, and the fifth option
      is focused and ready for Space.
    */
    const { group, radios, clicks } = makeGroup(6);
    radios[0].focus();

    for (let i = 0; i < 5; i++) {
      onRadioGroupKeyDown(keyEvent('ArrowRight', group), { selectOnMove: false });
    }

    expect(document.activeElement).toBe(radios[5]);
    expect(clicks).toEqual([]);
  });

  it('still claims the arrow key, so the page does not scroll', () => {
    const { group, radios } = makeGroup(3);
    radios[0].focus();

    const event = keyEvent('ArrowDown', group);
    onRadioGroupKeyDown(event, { selectOnMove: false });

    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('selects on move when the option is omitted or true', () => {
    // The default must stay APG behaviour: a plain radio group selects as it
    // moves, and only the two review-screen editors opt out.
    const a = makeGroup(3);
    a.radios[0].focus();
    onRadioGroupKeyDown(keyEvent('ArrowRight', a.group));
    expect(a.clicks).toEqual([1]);

    const b = makeGroup(3);
    b.radios[0].focus();
    onRadioGroupKeyDown(keyEvent('ArrowRight', b.group), { selectOnMove: true });
    expect(b.clicks).toEqual([1]);
  });
});

describe('rovingTabIndex', () => {
  it('gives the tab stop to the selected option', () => {
    expect(rovingTabIndex({ isSelected: true, isFirst: false, anySelected: true })).toBe(0);
    expect(rovingTabIndex({ isSelected: false, isFirst: true, anySelected: true })).toBe(-1);
  });

  it('gives it to the FIRST option when nothing is selected', () => {
    /*
      The load-bearing case. The donate form starts with no amount chosen, so
      without this fallback every tile would be -1 and a keyboard donor could
      not reach the amounts at all - a worse bug than the nine tab stops this
      replaces.
    */
    expect(rovingTabIndex({ isSelected: false, isFirst: true, anySelected: false })).toBe(0);
    expect(rovingTabIndex({ isSelected: false, isFirst: false, anySelected: false })).toBe(-1);
  });

  it('never returns more than one tab stop for a group', () => {
    const presets = [0, 1, 2, 3, 4, 5, 6, 7, 8];

    for (const selected of [null, 0, 4, 8]) {
      const stops = presets.filter(
        (i) =>
          rovingTabIndex({
            isSelected: selected === i,
            isFirst: i === 0,
            anySelected: selected !== null,
          }) === 0,
      );
      expect(stops, `selected=${selected}`).toHaveLength(1);
    }
  });
});
