/**
 * WCAG contrast regression guard for the conversion path (audit docs/29 P2-4).
 *
 * The ratios are computed here from the real token values in `globals.css`, not
 * copied from a spreadsheet, so a token edit that breaks a pairing fails this
 * test instead of shipping. Thresholds:
 *   - 4.5:1  text (1.4.3 normal text — every pairing below is used at 20px or
 *            smaller, or at a weight/size that does not qualify as large text)
 *   - 3:1    non-text (1.4.11 — form-control boundaries, focus indicator,
 *            icon-only graphics, the CTA pill against the surface behind it)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(__dirname, 'globals.css'), 'utf8');

/** Pull `--name: #hex;` declarations out of one top-level rule block. */
function tokens(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const end = CSS.indexOf('\n}', start);
  const block = CSS.slice(start, end);
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{3,8})\s*;/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

const theme = tokens('@theme inline');
const light = tokens(':root');
const dark = tokens('.dark');

function channels(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = channels(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Composite `fg` at `alpha` over `bg` — what a `/10`-style modifier renders. */
function over(fg: string, bg: string, alpha: number): string {
  const f = channels(fg);
  const b = channels(bg);
  return (
    '#' +
    [0, 1, 2]
      .map((i) => Math.round(alpha * f[i] + (1 - alpha) * b[i]).toString(16).padStart(2, '0'))
      .join('')
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

const WHITE = '#FFFFFF';

describe('globals.css token values exist', () => {
  it.each([
    'cta-amber',
    'primary-foreground-muted',
    'primary-elevated',
    'primary-elevated-hover',
  ])('@theme defines --color-%s', (name) => {
    // primary-foreground-muted / primary-elevated* are declared as var() in
    // @theme and resolved per theme in :root / .dark.
    expect(CSS).toContain(`--color-${name}:`);
  });

  it.each(['primary-foreground-muted', 'primary-elevated', 'primary-elevated-hover', 'input'])(
    'both themes give --%s a literal colour',
    (name) => {
      expect(light[name], `:root --${name}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(dark[name], `.dark --${name}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    },
  );
});

type Case = [name: string, fg: string, bg: string, min: number];

function casesFor(t: Record<string, string>): Case[] {
  const chip = over(t['primary-foreground'], t['primary-elevated'], 0.1);
  return [
    // ── text on the bg-primary band (ImpactCounter, TrustBanner) ───────────
    ['band: primary-foreground on primary', t['primary-foreground'], t['primary'], 4.5],
    ['band: muted foreground on primary', t['primary-foreground-muted'], t['primary'], 4.5],
    ['card: primary-foreground on primary-elevated', t['primary-foreground'], t['primary-elevated'], 4.5],
    ['card: muted foreground on primary-elevated', t['primary-foreground-muted'], t['primary-elevated'], 4.5],
    ['card hover: primary-foreground on primary-elevated-hover', t['primary-foreground'], t['primary-elevated-hover'], 4.5],
    ['card hover: muted foreground on primary-elevated-hover', t['primary-foreground-muted'], t['primary-elevated-hover'], 4.5],
    // icon in the bg-primary-foreground/10 chip (non-text)
    ['chip: icon on primary-foreground/10 over primary-elevated', t['primary-foreground'], chip, 3],
    // the amber CTA pill on the teal band is identified by its ring (non-text)
    ['ring: primary-foreground against primary', t['primary-foreground'], t['primary'], 3],

    // ── amber CTAs ────────────────────────────────────────────────────────
    ['cta: white label on cta-amber surface', WHITE, theme['color-cta-amber'], 4.5],
    ['cta: cta-amber surface against page background', theme['color-cta-amber'], t['background'], 3],
    ['cta: accent-foreground label on accent surface', t['accent-foreground'], t['accent'], 4.5],
    ['cta: accent-foreground on accent/85 hover surface', t['accent-foreground'], over(t['accent'], t['background'], 0.85), 4.5],
    ['cta: accent surface against page background', t['accent'], t['background'], 3],
    // focus indicator (1.4.11)
    ['focus: accent outline against page background', t['accent'], t['background'], 3],

    // ── form controls (1.4.11) ────────────────────────────────────────────
    ['input: border against background', t['input'], t['background'], 3],
    ['input: border against card', t['input'], t['card'], 3],
    ['input: border against muted', t['input'], t['muted'], 3],
    ['input: border against secondary', t['input'], t['secondary'], 3],
    ['input: switch track against thumb', t['input'], t['background'], 3],

    // ── body text sanity ──────────────────────────────────────────────────
    ['body: foreground on background', t['foreground'], t['background'], 4.5],
    ['body: card-foreground on card', t['card-foreground'], t['card'], 4.5],
  ];
}

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme contrast', (_themeName, t) => {
  it.each(casesFor(t))('%s >= %s:1', (_name, fg, bg, min) => {
    expect(fg, 'foreground token resolved').toMatch(/^#/);
    expect(bg, 'background token resolved').toMatch(/^#/);
    expect(round(contrast(fg, bg))).toBeGreaterThanOrEqual(min);
  });
});

describe('light theme only: surfaces that inherit --foreground on hover', () => {
  // `hover:bg-accent` / `focus:bg-accent` without a matching foreground class
  // (src/components/campaign/MessageWall.tsx, DonationForm.tsx,
  // src/components/ui/dropdown-menu.tsx) paints the amber surface under text
  // that is still --foreground. Light mode passes at 5.47:1. Dark mode is
  // 1.52:1 — a pre-existing failure that predates this change and cannot be
  // fixed from a token: #FBBF24 cannot carry both #F1F5F9 (--foreground) and
  // #1A1A1A (--accent-foreground). It needs those call sites to set a
  // foreground class, so it is not asserted here. Recorded, not hidden.
  it('light: inherited foreground on an accent hover surface', () => {
    expect(round(contrast(light['foreground'], light['accent']))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the pairings this test was written to stop regressing', () => {
  it('no longer renders white on the brand amber surface', () => {
    // #D97706 + white = 3.19:1. The solid surface role is amber-700 instead.
    expect(round(contrast(WHITE, '#D97706'))).toBeLessThan(4.5);
    expect(CSS).toMatch(/\.bg-brand-amber\s*\{\s*background-color:\s*var\(--color-cta-amber\)/);
    expect(theme['color-cta-amber']).not.toBe('#D97706');
  });

  it('no longer pairs white with --primary in dark mode', () => {
    expect(round(contrast(WHITE, dark['primary']))).toBeLessThan(3);
    expect(dark['primary-foreground']).not.toBe('#FFFFFF');
  });

  it('keeps the brand amber hue available for the ink role', () => {
    // docs/02 lists #D97706 as the brand accent; only the surface role moved.
    expect(theme['color-brand-amber']).toBe('#D97706');
  });
});
