/**
 * A hand-rolled modal uses `useModalKeyboard`.
 *
 * ── WHY A RATCHET ───────────────────────────────────────────────────────────
 *
 * `docs/155`. This product had three hand-rolled `role="dialog"` elements:
 * ONE implemented the keyboard contract correctly and TWO implemented none of
 * it, one file apart. The two broken ones even carried a focus trap - dead
 * code, because it was a React `onKeyDown` on the overlay, which only fires
 * for keydowns bubbling from inside, and nothing ever focused inside.
 *
 * The unit tests beside this file prove the hook behaves. This rule is the
 * other half: that the dialogs actually use it. Nothing in the type system
 * notices a modal with no keyboard handling - it renders perfectly.
 *
 * ⚠️ The boundary is clean rather than an allowlist: `src/components/ui/`
 * wraps Radix, which sets `role="dialog"` at RUNTIME and handles focus and
 * Escape itself (the `/campaigns` Filters sheet was the control that proved
 * it). So a LITERAL `role="dialog"` in the source means somebody built a
 * modal by hand, and that is exactly the set this rule governs. Rule 4 pins
 * that premise.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

/** Blank comments, keeping line count so reported numbers are trustworthy. */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

function sourceFiles(): string[] {
  return globSync('src/**/*.{ts,tsx}', { cwd: ROOT })
    .filter((f) => !/\.(test|spec)\.tsx?$/.test(f))
    .map((f) => f.replace(/\\/g, '/'));
}

/**
 * The whole opening tag containing the attribute at `at`.
 *
 * ⛔ NOT a regex, and the reason is a defect this very rule had. The first
 * version matched `<[A-Za-z][^<>]*role="dialog"[^<>]*>`, and an injection
 * adding `onKeyDown={(e) => e.stopPropagation()}` DID NOT FIRE - because
 * `[^<>]*` stops at the first `>`, and JSX routinely has one inside an arrow
 * function. `docs/153` §5 recorded exactly that trap one day earlier and it
 * still caught me, which is why this scans instead: backwards to the opening
 * `<`, then forwards to the first `>` that is at brace depth 0 and outside a
 * string.
 */
export function openingTagAround(code: string, at: number): string | null {
  let start = at;
  while (start >= 0 && code[start] !== '<') start -= 1;
  if (start < 0) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < code.length; i += 1) {
    const c = code[i];
    if (quote) {
      if (c === quote && code[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return code.slice(start, i + 1);
  }
  return null;
}

/** Files that build a modal BY HAND, i.e. write the role as a literal. */
function handRolledDialogFiles(): { file: string; code: string }[] {
  const out: { file: string; code: string }[] = [];
  for (const file of sourceFiles()) {
    if (file === 'src/hooks/useModalKeyboard.ts') continue; // the hook itself
    /*
      ⚠️ Comments stripped FIRST - `docs/116` §4, and not hypothetically: the
      hook's own header quotes `role="dialog"` and `onKeyDown={trapFocus}`
      while explaining the defect, so a raw-source sweep reports the fix as
      the defect.
    */
    const code = stripComments(readFileSync(resolve(ROOT, file), 'utf8'));
    if (/role="dialog"/.test(code)) out.push({ file, code });
  }
  return out;
}

describe('the sweep can see the code (anti-vacuity)', () => {
  it('finds the hand-rolled dialogs', () => {
    const found = handRolledDialogFiles();
    expect(found.length, `hand-rolled dialog files: ${found.map((f) => f.file).join(', ')}`)
      .toBeGreaterThanOrEqual(2);
    expect(found.map((f) => f.file)).toContain('src/app/share-your-story/ShareYourStoryForm.tsx');
  });

  it('⚠️ the scanner survives a `>` inside an arrow function (docs/153 §5)', () => {
    /*
      The control on the tool itself. A regex of the form
      `<[A-Za-z][^<>]*role="dialog"[^<>]*>` returns null here, which is how an
      injection adding an overlay onKeyDown passed the first version of the
      rule below.
    */
    const sample = `<div\n  onKeyDown={(e) => e.stopPropagation()}\n  role="dialog"\n  aria-modal="true"\n>`;
    const tag = openingTagAround(sample, sample.indexOf('role="dialog"'));
    expect(tag, 'the scanner lost the tag').not.toBeNull();
    expect(tag!, 'the scanner stopped at the arrow function').toContain('onKeyDown');
    expect(tag!).toContain('aria-modal');
    // and the naive regex really does fail on it, which is why this exists
    expect(/<[A-Za-z][^<>]*role="dialog"[^<>]*>/.test(sample)).toBe(false);
  });

  it('⚠️ rule 4, the PREMISE: the Radix wrappers still set no literal role', () => {
    /*
      This rule's whole scope rests on "a literal role=dialog means
      hand-rolled". If the ui/ wrappers ever write the attribute themselves,
      they would be swept in and the boundary would need re-deciding.
    */
    for (const f of ['src/components/ui/dialog.tsx', 'src/components/ui/sheet.tsx']) {
      const code = stripComments(readFileSync(resolve(ROOT, f), 'utf8'));
      expect(code, `${f} now writes role="dialog" literally - re-read docs/155`)
        .not.toMatch(/role="dialog"/);
    }
  });
});

describe('⛔ every hand-rolled modal uses the hook', () => {
  it('each file with a literal role="dialog" calls useModalKeyboard', () => {
    const offenders = handRolledDialogFiles()
      .filter((f) => !/useModalKeyboard\(/.test(f.code))
      .map((f) => f.file);
    expect(
      offenders,
      'A `role="dialog" aria-modal="true"` promises assistive technology that ' +
        'focus is inside and the rest of the page is inert. Call ' +
        'useModalKeyboard({ open, contentRef, onClose }) so that is true: it ' +
        'moves focus in, contains Tab, closes on Escape and restores focus. ' +
        `docs/155.\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('⛔ no element carries both role="dialog" and its own onKeyDown', () => {
    /*
      The exact shape of the defect. An overlay-level React `onKeyDown` cannot
      be the trap: it only sees keydowns bubbling from inside the dialog, so
      while focus is outside - which is where it stays unless something moves
      it - the handler never runs at all. Escape in particular has to be bound
      at the document.
    */
    const offenders: string[] = [];
    for (const { file, code } of handRolledDialogFiles()) {
      for (const m of code.matchAll(/role="dialog"/g)) {
        const tag = openingTagAround(code, m.index!);
        if (tag && /onKeyDown/.test(tag)) {
          offenders.push(`${file}: ${tag.replace(/\s+/g, ' ').slice(0, 100)}`);
        }
      }
    }
    expect(
      offenders,
      `A trap on the overlay is dead code - see docs/155.\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the hook IS called, so the rules above are not satisfied by deleting the dialogs', () => {
    // The control. Without it, removing every modal passes everything above.
    const calls = sourceFiles()
      .map((f) => ({ f, n: (stripComments(readFileSync(resolve(ROOT, f), 'utf8')).match(/useModalKeyboard\(/g) || []).length }))
      .filter((x) => x.n > 0);
    const total = calls.reduce((a, c) => a + c.n, 0);
    expect(total, `call sites: ${calls.map((c) => `${c.f}x${c.n}`).join(', ')}`).toBeGreaterThanOrEqual(3);
  });
});

describe('⛔ the trap distinguishes TABBABLE from focusable', () => {
  it('the Tab path goes through tabbablesIn, never the raw selector', () => {
    /*
      The second-order defect, and the one a unit test without a roving
      radiogroup inside the dialog cannot see: `button:not([disabled])` matches
      a `<button role="radio" tabindex="-1">`, so `last` was an option Tab can
      never land on and the wrap never fired. [VERIFIED in a browser.]
    */
    const code = stripComments(readFileSync(resolve(ROOT, 'src/hooks/useModalKeyboard.ts'), 'utf8'));
    expect(code, 'tabbablesIn is gone - the trap is back to matching non-tabbable options')
      .toMatch(/function tabbablesIn/);
    expect(code, 'tabbablesIn must filter on the browser-visible tab order')
      .toMatch(/tabIndex\s*>=\s*0/);
    // the Tab branch must not query the selector directly any more
    const tabBranch = code.slice(code.indexOf("e.key !== 'Tab'"));
    expect(tabBranch.slice(0, 400), 'the Tab branch queries MODAL_FOCUSABLE directly again')
      .not.toMatch(/querySelectorAll<HTMLElement>\(MODAL_FOCUSABLE\)/);
    expect(tabBranch.slice(0, 400)).toMatch(/tabbablesIn\(container\)/);
  });

  it('⚠️ focus sitting OUTSIDE the tab order is handled, not just the two boundaries', () => {
    // An arrow-reached roving option is exactly that case.
    const code = stripComments(readFileSync(resolve(ROOT, 'src/hooks/useModalKeyboard.ts'), 'utf8'));
    expect(code, 'the trap compares only first/last again - a roving option escapes')
      .toMatch(/indexOf\(active\)/);
  });
});
