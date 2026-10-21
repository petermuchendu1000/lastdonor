/**
 * Every colour an email template hardcodes has a dark-mode answer.
 *
 * ## The defect this exists to stop
 *
 * The shell's dark-mode block recolours five CLASSES. Templates do not use
 * those classes; they write colour inline on the element:
 * `<h1 style="color: #0F766E">`, `<p style="color: #666">`,
 * `<ol style="color: #333">`. Inheritance stops at a child that declares
 * its own colour, so in dark mode those stayed exactly as they are on
 * white, on a near-black card.
 *
 * Measured in Chromium (`scripts/email-contrast.ts`), across six
 * representative templates:
 *
 *   light:  0 elements below WCAG AA
 *   dark:  45 elements below WCAG AA, worst 1.31:1 where 4.5:1 is required
 *
 * The worst of it was the numbered "how to get your money" steps and every
 * row label on a donation receipt. Nobody had looked, because nothing
 * rendered the mail and looked at it.
 *
 * ## Why a source check and not the browser
 *
 * The browser measurement is the real one, but it needs Chromium and can
 * only cover templates this file can supply arguments for. This test is
 * cheap, runs in the normal unit suite, and covers EVERY colour literal in
 * both template files — so a new one cannot be introduced without a
 * matching dark rule, which is the actual failure mode.
 *
 * Run the deep check with:
 *   npx tsx scripts/email-contrast.ts
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SHELL = readFileSync(join(ROOT, 'src/lib/email-shell.ts'), 'utf8');
const TEMPLATE_FILES = ['src/lib/email-templates.ts', 'src/lib/email-adaptive.ts'];
const TEMPLATES = TEMPLATE_FILES.map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');

/** The `@media (prefers-color-scheme: dark)` block of the shell. */
function darkBlock(): string {
  const start = SHELL.indexOf('@media (prefers-color-scheme: dark)');
  expect(start, 'the shell has no dark-mode block at all').toBeGreaterThan(-1);
  // Walk braces so the whole block is captured, comments and all.
  let depth = 0;
  let i = SHELL.indexOf('{', start);
  const from = i;
  for (; i < SHELL.length; i++) {
    if (SHELL[i] === '{') depth++;
    else if (SHELL[i] === '}') {
      depth--;
      if (depth === 0) return SHELL.slice(from, i + 1);
    }
  }
  throw new Error('unterminated dark-mode block');
}

const DARK = darkBlock();

/** Distinct `color: #xxx` values written inline in the templates. */
function inlineColours(prop: 'color' | 'background'): string[] {
  const re =
    prop === 'color'
      ? /(?:^|["; ])color: ?(#[0-9A-Fa-f]{3,6})/g
      : /background: ?(#[0-9A-Fa-f]{3,6})/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(TEMPLATES)) !== null) found.add(m[1]);
  return [...found];
}

describe('dark mode covers every colour the templates hardcode', () => {
  it('reads a dark-mode block that actually contains rules', () => {
    // Guards against the brace walk silently returning something empty,
    // which would make every assertion below vacuously true.
    expect(DARK.length).toBeGreaterThan(200);
    expect(DARK).toContain('!important');
  });

  it('overrides every inline text colour', () => {
    const missing = inlineColours('color').filter((c) => {
      // The rule may be written with or without the space after the colon.
      const needle = c.toLowerCase();
      return !DARK.toLowerCase().includes(`color: ${needle}"`)
        && !DARK.toLowerCase().includes(`color:${needle}"`);
    });
    expect(
      missing,
      'These colours are written inline on elements in the email templates ' +
        'and have no dark-mode override, so they will render as-is on a ' +
        'near-black card. Add a rule to the dark block in email-shell.ts, ' +
        'then verify with: npx tsx scripts/email-contrast.ts',
    ).toEqual([]);
  });

  it('overrides every inline panel background', () => {
    const missing = inlineColours('background').filter((c) => {
      // A panel tint needs darkening; a solid brand fill (the teal used
      // for progress bars and buttons) is already dark-safe.
      if (c.toLowerCase() === '#0f766e') return false;
      return !DARK.toLowerCase().includes(`background: ${c.toLowerCase()}"`);
    });
    expect(
      missing,
      'A pale panel background does not inherit, so lightening the text ' +
        'inside it leaves light-on-light. This is exactly how the first ' +
        'fix turned 45 contrast failures into 4 new ones.',
    ).toEqual([]);
  });

  it('keeps the call to action visible on a dark card', () => {
    // White on brand teal passes AA, but the fill recedes into the card.
    expect(DARK).toContain('.ld-btn');
    expect(SHELL).toContain('class="ld-btn"');
  });

  it('still recolours the semantic classes it always did', () => {
    for (const cls of ['.ld-canvas', '.ld-card', '.ld-text', '.ld-muted', '.ld-heading']) {
      expect(DARK, `${cls} lost its dark-mode rule`).toContain(cls);
    }
  });
});
