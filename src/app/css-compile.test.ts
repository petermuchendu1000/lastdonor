/**
 * Compiled-CSS guards for audit docs/29 P2-1 (`prose` emitted no CSS) and
 * P2-2 (font variables referenced but never defined).
 *
 * These assertions run against the real PostCSS output, because both defects
 * were invisible in the source: `globals.css` *mentions* typography and fonts,
 * and the call sites *look* styled. Only the compiled sheet shows that
 * `.prose` produced zero rules and that every `font-family` resolved against
 * an undefined custom property.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const APP_DIR = __dirname;
const PROJECT_ROOT = join(APP_DIR, '..', '..');
const GLOBALS = join(APP_DIR, 'globals.css');
const LAYOUT = readFileSync(join(APP_DIR, 'layout.tsx'), 'utf8');

let css = '';

beforeAll(async () => {
  const source = readFileSync(GLOBALS, 'utf8');
  const result = await postcss([tailwind({ base: PROJECT_ROOT })]).process(source, {
    from: GLOBALS,
    to: undefined,
  });
  css = result.css;
}, 120_000);

describe('P2-1: the prose classes emit real CSS', () => {
  it('compiles a .prose rule', () => {
    // Before `@plugin "@tailwindcss/typography"` was added this count was 0.
    expect(css.match(/\.prose\b/g)?.length ?? 0).toBeGreaterThan(0);
  });

  it.each([
    ['paragraph spacing', /\.prose \{[\s\S]{0,4000}?:where\(p\)[\s\S]{0,200}?margin-top/],
    ['heading hierarchy', /\.prose \{[\s\S]{0,8000}?:where\(h2\)[\s\S]{0,300}?font-size/],
    ['list markers', /\.prose \{[\s\S]{0,12000}?:where\(ul\)[\s\S]{0,300}?list-style-type/],
  ])('restores %s inside .prose', (_what, pattern) => {
    expect(css).toMatch(pattern);
  });

  it.each(['.prose-sm', '.prose-neutral', '.dark\\:prose-invert'])(
    'compiles the %s modifier used by the call sites',
    (selector) => {
      expect(css).toContain(selector);
    },
  );

  it('emits .max-w-none after .prose so max-w-none still wins', () => {
    expect(css.indexOf('.max-w-none')).toBeGreaterThan(css.indexOf('.prose {'));
  });
});

describe('P2-2: every font-family resolves to a variable something defines', () => {
  /** Custom properties the compiled sheet itself defines. */
  const definedInCss = () =>
    new Set(Array.from(css.matchAll(/^\s*(--[\w-]+):/gm), (m) => m[1]));

  /** Custom properties next/font sets on <html> in layout.tsx. */
  const definedByNextFont = () =>
    new Set(Array.from(LAYOUT.matchAll(/variable:\s*'(--[\w-]+)'/g), (m) => m[1]));

  it('layout.tsx declares the three --font-dm-* variables globals.css reads', () => {
    const nextFont = definedByNextFont();
    expect(nextFont).toContain('--font-dm-serif-display');
    expect(nextFont).toContain('--font-dm-sans');
    expect(nextFont).toContain('--font-dm-mono');
  });

  it('leaves no font-family pointing at an undefined custom property', () => {
    const known = new Set([...definedInCss(), ...definedByNextFont()]);
    const unresolved = new Set<string>();
    for (const decl of css.matchAll(/font-family:\s*([^;}]+)/g)) {
      for (const ref of decl[1].matchAll(/var\((--[\w-]+)(\s*,)?/g)) {
        // A var() with its own fallback degrades safely; a bare one does not.
        if (!ref[2] && !known.has(ref[1])) unresolved.add(ref[1]);
      }
    }
    expect(Array.from(unresolved)).toEqual([]);
  });

  it('applies all three downloaded families — none is dead weight', () => {
    // --default-font-family drives preflight's html rule; --font-display backs
    // the `font-display` utility used ~180 times; --font-mono backs `font-mono`.
    expect(css).toMatch(/--default-font-family:\s*var\(--font-dm-sans\)/);
    expect(css).toMatch(/--font-display:\s*var\(--font-dm-serif-display\)/);
    expect(css).toMatch(/--font-mono:\s*var\(--font-dm-mono\)/);
    for (const family of ['DM_Serif_Display', 'DM_Sans', 'DM_Mono']) {
      expect(LAYOUT).toContain(family);
    }
  });

  it('does not use a font-body class, which was never a generated utility', () => {
    expect(LAYOUT).not.toMatch(/className="[^"]*\bfont-body\b/);
    expect(css).not.toContain('.font-body');
  });
});

describe('P2-4: the amber CTA surface rule survives compilation', () => {
  it('redirects the solid bg-brand-amber utility to the AA-safe shade', () => {
    const override = css.lastIndexOf('.bg-brand-amber {');
    const utility = css.indexOf('.bg-brand-amber {');
    expect(override).toBeGreaterThan(utility);
    expect(css.slice(override, override + 120)).toContain('var(--color-cta-amber)');
  });

  it('keeps the brand hue for the amber tint utilities', () => {
    expect(css).toMatch(/\.bg-brand-amber\\\/10 \{[^}]*#D97706/);
  });
});
