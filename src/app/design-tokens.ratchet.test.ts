/**
 * A design token is used in the form the token is DEFINED in.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ──────────────────────────────────────────
 *
 * [VERIFIED 2026-10-25] Every chart in `/admin` drew in the wrong colour, and
 * the bar chart on `/admin/reports` drew **solid black**. The cause:
 *
 *   fill="hsl(var(--chart-1))"      and      --chart-1: #0F766E;
 *
 * `hsl(#0F766E)` is not a colour. The browser discards the declaration and
 * falls back - to black for a `fill`, and to nothing at all for a gradient
 * stop, which is why the area chart's fill was simply absent.
 *
 * The `hsl(var(--token))` form is correct in the shadcn/ui convention this
 * markup was copied from, where tokens are bare HSL triplets (`173 80% 26%`).
 * This project's tokens are **hex**, in `src/app/globals.css`, and have been
 * since the brand work. The two conventions are indistinguishable at the call
 * site and the wrapper reads like care rather than a bug.
 *
 * ⚠️ Nothing could see it. There is no type for a CSS colour string, an
 * invalid one throws nothing, and a chart that renders in the wrong colour
 * still renders. `/admin/reports` in particular answered **500 on every load**
 * (`docs/107`), so the black bar had never been looked at by anyone.
 *
 * ⛔ If the tokens are ever moved to bare HSL triplets, this rule inverts -
 * change the tokens and this test together, in one commit.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const GLOBALS = join(SRC, 'app/globals.css');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const files = walk(SRC);

describe('design tokens are hex, so they are never wrapped in hsl()', () => {
  it('the tokens really are hex, which is what makes the rule below right', () => {
    /*
      The premise, checked rather than assumed. If this fails, the project has
      moved to HSL triplets and the rule in the next test is backwards.
    */
    const css = readFileSync(GLOBALS, 'utf8');
    const charts = [...css.matchAll(/^\s*--chart-[1-5]:\s*([^;]+);/gm)].map((m) => m[1].trim());
    expect(charts.length).toBeGreaterThanOrEqual(5);
    for (const value of charts) {
      expect(value, `--chart token "${value}" is not a hex colour`).toMatch(/^#[0-9A-Fa-f]{3,8}$/);
    }
  });

  it('⛔ no file wraps a CSS variable in hsl(), rgb() or hsla()', () => {
    const offences: string[] = [];
    for (const file of files) {
      if (file.endsWith('design-tokens.ratchet.test.ts')) continue;
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        const m = /\b(hsl|hsla|rgb|rgba)\(\s*var\(--[A-Za-z0-9-]+\)/.exec(line);
        if (m) offences.push(`${relative(ROOT, file)}:${i + 1}  ${m[0]}`);
      });
    }

    expect(
      offences,
      offences.length === 0
        ? ''
        : `This project's CSS variables hold complete colours (#0F766E), so\n` +
            `hsl(var(--token)) produces hsl(#0F766E), which is not a colour - the\n` +
            `browser silently falls back, to black for a fill and to nothing for a\n` +
            `gradient stop. Use var(--token) on its own.\n\n` +
            offences.join('\n'),
    ).toEqual([]);
  });

  it('scanned a meaningful number of files', () => {
    // A walk that quietly returned nothing would pass the rule vacuously.
    expect(files.length).toBeGreaterThan(300);
  });
});
