/**
 * Every select and menu trigger has an accessible name.
 *
 * ── WHY A RATCHET ───────────────────────────────────────────────────────────
 *
 * `docs/155` §6 found seven admin controls that a screen reader announces as
 * a bare "combobox" or "button" - five row action menus, a campaign filter and
 * the audit-log event filter - and §6.4 enumerated the rest without gating
 * them, because with offenders still on the board a general rule either fails
 * the build or needs an exception per offender, and `docs/152` is this
 * project's record of what falls through an allowlist. So the sweep came
 * first. There are now **no exceptions in this file**, and there must not be:
 * adding one is the failure mode it exists to prevent.
 *
 * ⚠️ What makes this worth a build gate rather than an axe run: `role` is a
 * promise, and a `SelectTrigger` renders `<button role="combobox">`, for which
 * **name-from-content is prohibited** - the contents are the VALUE. So
 * `/admin/audit-log`'s filter displayed the words "All events" and was
 * nameless anyway. A control can show text, look completely fine in a
 * screenshot, and have no name at all. Nothing in the type system or in a
 * visual review can see that.
 *
 * ── THE FOUR MECHANISMS ─────────────────────────────────────────────────────
 *
 * A name may legitimately come from any of these, and this accepts all four,
 * because a rule that knows fewer fires on correct code:
 *
 *   1. `aria-label` / `aria-labelledby` on the control
 *   2. an `id` paired with a `<Label htmlFor="same-id">`
 *   3. text content - but ONLY where the role permits it (see rule 3)
 *   4. a `<label>` that WRAPS the control, including through a component
 *      boundary such as `<Field label="Currency">`
 *
 * ⛔ Mechanism 4 is not hypothetical and not a nicety. The first version of
 * this sweep knew only the first three and flagged all four native `<select>`s
 * in `docs/155` §6.4 - every one of which was already named, three through a
 * local `<Field label>` wrapper. Had the rule shipped that way, satisfying it
 * meant putting an `aria-label` on a control that already shows a visible
 * label, and `aria-label` OVERRIDES visible text: a WCAG 2.5.3 Label-in-Name
 * failure. The guard would have made the pages worse. [VERIFIED in a browser:
 * those controls compute as `combobox "Currency"`, `combobox "Rail"` and
 * `combobox "Which organisation?"`.]
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');

/** The elements this rule governs, and whether their role names from content. */
const CONTROLS = [
  { tag: 'select', namesFromContent: false, selfClosing: true },
  // Radix `SelectTrigger` -> <button role="combobox">: name-from-content is
  // PROHIBITED for that role.
  { tag: 'SelectTrigger', namesFromContent: false, selfClosing: false },
  // Radix `DropdownMenuTrigger` -> a plain button with aria-haspopup, i.e.
  // role=button, where name-from-content IS permitted.
  { tag: 'DropdownMenuTrigger', namesFromContent: true, selfClosing: false },
] as const;

/** Blank comments, keeping newlines so reported line numbers stay real. */
export function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

/**
 * The whole opening tag containing position `at`.
 *
 * ⛔ Not a regex. `[^>]*` stops at the first `>`, which JSX routinely has
 * inside `onChange={(e) => …}` - `docs/153` §5 and `docs/155` §5.1 both record
 * that trap, and it cost this family of rules twice. Scan backwards to `<`,
 * then forwards to the first `>` at brace depth 0 and outside a string.
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

/** Mechanism 4a: is the control at `at` inside a literal `<label>`? */
export function wrappedInLabel(code: string, at: number): boolean {
  const opens = [...code.matchAll(/<[Ll]abel\b/g)].map((m) => m.index!).filter((i) => i < at);
  if (!opens.length) return false;
  const between = code.slice(opens[opens.length - 1], at);
  return !between.includes('</label>') && !between.includes('</Label>');
}

/**
 * Mechanism 4b: local components that render a `<label>` WRAPPING `{children}`.
 *
 * ⚠️ BOTH conditions are load-bearing, and rule 4 proves it: a component that
 * renders a label NEXT TO its children does not name them, and a wrapper used
 * without a `label` prop supplies no text. Accepting "is called Field" would
 * make this mechanism a hole rather than a mechanism.
 */
export function labellingWrappers(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/function ([A-Z]\w*)\s*\(/g)) {
    const body = code.slice(m.index! + m[0].length, m.index! + m[0].length + 4000);
    const lab = body.indexOf('<label');
    if (lab === -1) continue;
    const end = body.indexOf('</label>', lab);
    if (end !== -1 && body.slice(lab, end).includes('{children}')) out.push(m[1]);
  }
  return out;
}

export function insideLabellingWrapper(code: string, at: number, wrappers: string[]): boolean {
  for (const w of wrappers) {
    for (const m of code.matchAll(new RegExp(`<${w}\\b`, 'g'))) {
      const tag = openingTagAround(code, m.index!) ?? '';
      if (!tag.includes('label=')) continue;
      const close = code.indexOf(`</${w}>`, m.index!);
      if (close !== -1 && m.index! < at && at < close) return true;
    }
  }
  return false;
}

function sourceFiles(): string[] {
  return globSync('src/**/*.tsx', { cwd: ROOT })
    .filter((f) => !/\.(test|spec)\.tsx?$/.test(f))
    .map((f) => f.replace(/\\/g, '/'));
}

/** Every `<Label htmlFor>` target anywhere in src - mechanism 2's other half. */
function labelledIds(): Set<string> {
  const ids = new Set<string>();
  for (const f of sourceFiles()) {
    for (const m of readFileSync(resolve(ROOT, f), 'utf8').matchAll(/htmlFor="([^"]+)"/g)) {
      ids.add(m[1]);
    }
  }
  return ids;
}

export type Finding = { file: string; line: number; tag: string; via: string | null };

/** Analyse one file. Exported so the synthetic rules below can drive it. */
export function analyse(code: string, ids: Set<string>, file = '<sample>'): Finding[] {
  const out: Finding[] = [];
  const wrappers = labellingWrappers(code);
  for (const { tag, namesFromContent, selfClosing } of CONTROLS) {
    for (const m of code.matchAll(new RegExp(`<${tag}\\b`, 'g'))) {
      const at = m.index!;
      const open = openingTagAround(code, at) ?? '';
      let block = open;
      if (!selfClosing) {
        const close = code.indexOf(`</${tag}>`, at);
        if (close !== -1) block = code.slice(at, close + tag.length + 3);
      }
      const text = block.replace(/<[^>]*>/g, ' ').replace(/\{[^{}]*\}/g, ' ').trim();
      let via: string | null = null;
      if (/aria-label(?:ledby)?=/.test(block)) via = 'aria-label';
      else if (open.includes('title=')) via = 'title';
      else if ([...ids].some((i) => open.includes(`id="${i}"`))) via = 'htmlFor/id';
      else if (wrappedInLabel(code, at)) via = 'wrapping label';
      else if (insideLabellingWrapper(code, at, wrappers)) via = 'wrapper component';
      else if (namesFromContent && text.length > 1) via = 'text content';
      out.push({ file, line: code.slice(0, at).split('\n').length, tag, via });
    }
  }
  return out;
}

function sweep(): Finding[] {
  const ids = labelledIds();
  return sourceFiles().flatMap((f) =>
    analyse(stripComments(readFileSync(resolve(ROOT, f), 'utf8')), ids, f),
  );
}

describe('⛔ every select and menu trigger has an accessible name', () => {
  it('no control in src/ is nameless', () => {
    const offenders = sweep().filter((c) => c.via === null);
    expect(
      offenders.map((c) => `${c.file}:${c.line}  <${c.tag}>`),
      'A control with no accessible name is announced as a bare "combobox" or ' +
        '"button", so a screen-reader user is told a control exists and not ' +
        'what it does. Give it one of: aria-label; an id matching a ' +
        '<Label htmlFor>; or a <label> (or <Field label>) that WRAPS it. ' +
        '⛔ Do NOT add an exception here - docs/155 §6.4.\n' +
        offenders.map((c) => `${c.file}:${c.line} <${c.tag}>`).join('\n'),
    ).toEqual([]);
  });

  it('⚠️ anti-vacuity: the sweep actually finds the controls, by every mechanism', () => {
    const all = sweep();
    expect(all.length, 'the sweep found almost nothing - the glob or the tag list broke')
      .toBeGreaterThanOrEqual(40);
    /*
      Each mechanism must still be exercised by real code. If one stops being
      used, that is worth knowing: an unexercised branch in a build gate is
      the shape docs/76, docs/77 and docs/81 are all about.
    */
    const byVia = new Map<string, number>();
    for (const c of all) byVia.set(c.via ?? 'NONE', (byVia.get(c.via ?? 'NONE') ?? 0) + 1);
    for (const mech of ['aria-label', 'htmlFor/id', 'text content', 'wrapper component']) {
      expect(byVia.get(mech) ?? 0, `no control is named by "${mech}" any more: ${JSON.stringify([...byVia])}`)
        .toBeGreaterThan(0);
    }
  });
});

describe('⛔ rule 3: the role decides whether text content is a name', () => {
  /*
    The single most "simplifiable" line in this file, and the one that would
    silently un-gate the original defect. docs/155 §6: /admin/audit-log's
    filter rendered the visible text "All events" and was STILL nameless.
  */
  const ids = new Set<string>();

  it('text content names a DropdownMenuTrigger (role=button)', () => {
    const sample = '<DropdownMenuTrigger asChild><button>Actions</button></DropdownMenuTrigger>';
    expect(analyse(sample, ids)[0].via).toBe('text content');
  });

  it('⛔ text content does NOT name a SelectTrigger (role=combobox)', () => {
    const sample = '<SelectTrigger><SelectValue />All events</SelectTrigger>';
    expect(
      analyse(sample, ids)[0].via,
      'name-from-content is PROHIBITED for role=combobox - the contents are ' +
        'the value, not the label. Accepting it here re-opens docs/155 §6.',
    ).toBeNull();
  });

  it('⛔ a SelectValue placeholder is not a name either', () => {
    const sample = '<SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>';
    expect(analyse(sample, ids)[0].via).toBeNull();
  });

  it('a native <select> is not named by its options', () => {
    const sample = '<select><option>Medical</option></select>';
    expect(analyse(sample, ids)[0].via).toBeNull();
  });
});

describe('⛔ rule 4: the wrapping-label mechanism, and its two conditions', () => {
  const ids = new Set<string>();
  const WRAPS = 'function Field({ label, children }) { return (<label><span>{label}</span>{children}</label>); }\n';
  const BESIDE = 'function Field({ label, children }) { return (<div><label>{label}</label>{children}</div>); }\n';

  it('a component that WRAPS its children in a label names them', () => {
    const got = analyse(`${WRAPS}<Field label="Currency"><select /></Field>`, ids);
    expect(got.find((c) => c.tag === 'select')!.via).toBe('wrapper component');
  });

  it('⚠️ a component that renders the label BESIDE its children does not', () => {
    // Without this, the mechanism would accept any wrapper with a label prop.
    const got = analyse(`${BESIDE}<Field label="Currency"><select /></Field>`, ids);
    expect(
      got.find((c) => c.tag === 'select')!.via,
      'a sibling <label> with no htmlFor names nothing',
    ).toBeNull();
  });

  it('⚠️ the wrapper must actually be passed a label', () => {
    const got = analyse(`${WRAPS}<Field><select /></Field>`, ids);
    expect(got.find((c) => c.tag === 'select')!.via).toBeNull();
  });

  it('a directly wrapping <label> names the control', () => {
    const sample = '<label><span>Which organisation?</span><select name="x" /></label>';
    expect(analyse(sample, ids)[0].via).toBe('wrapping label');
  });

  it('⚠️ and a CLOSED label before the control does not', () => {
    const sample = '<label htmlFor="other">Other</label><select name="x" />';
    expect(analyse(sample, ids)[0].via).toBeNull();
  });
});

describe('⚠️ the scanner itself', () => {
  it('survives a `>` inside an arrow function (docs/153 §5)', () => {
    /*
      The control on the tool. A regex of the form `<SelectTrigger[^>]*>`
      truncates at the `>` in `onChange`, so the aria-label after it is
      invisible and a NAMED control reads as nameless - the rule would fire on
      correct code and the obvious fix would be to delete the rule.
    */
    const sample = '<select\n  onChange={(e) => setX(e.target.value)}\n  aria-label="Currency"\n/>';
    const tag = openingTagAround(sample, sample.indexOf('<select'));
    expect(tag, 'the scanner lost the tag').not.toBeNull();
    expect(tag!, 'the scanner stopped at the arrow function').toContain('aria-label');
    /*
      ⚠️ The naive regex does MATCH here - it just matches the WRONG thing,
      stopping at the arrow's own `>`. That is the whole trap and my first
      version of this control asserted the opposite (that it would not match
      at all), which is true only when the pattern requires an attribute
      sitting after the arrow. Assert the truncation, which is the defect.
    */
    const naive = sample.match(/<select[^>]*>/);
    expect(naive, 'the naive regex matched nothing, so it cannot truncate').not.toBeNull();
    expect(naive![0], 'the naive regex should truncate at the arrow function').not.toContain('aria-label');
    expect(naive![0]).toContain('=>');
    expect(analyse(sample, new Set())[0].via).toBe('aria-label');
  });

  it('strips comments while KEEPING line numbers', () => {
    /*
      Not cosmetic. The scratchpad version of this collapsed each multi-line
      comment to one space, so every line number it reported after the first
      comment was wrong - and docs/155 §6.4's list of sites was recorded from
      that output.
    */
    const src = 'a\n/* one\n   two\n   three */\n<select aria-label="x" />\n';
    const stripped = stripComments(src);
    expect(stripped.split('\n').length).toBe(src.split('\n').length);
    expect(stripped).not.toContain('two');
    expect(analyse(stripped, new Set())[0].line).toBe(5);
  });
});
