/**
 * A horizontal scroll container must be a containing block.
 *
 * ── THE DEFECT, AND WHY IT WENT UNEXPLAINED FOR DAYS ────────────────────────
 *
 * `docs/128` §5 reported four admin tables sliding sideways at a 390px
 * viewport (+124/+90/+73/+46) with `/admin/campaigns` at 0 as its control,
 * formed two hypotheses, REFUTED both by measurement, and left the root cause
 * **[UNKNOWN]**. It recorded three things it could not reconcile:
 *
 *   - `body.scrollWidth` was 390 while `documentElement.scrollWidth` was 514;
 *   - a scan for elements past the viewport that are NOT inside a clipping
 *     ancestor found **zero** on all four pages;
 *   - a minimal reproduction of the same markup produced **0px**, so the
 *     pattern was sound and the browser was not at fault.
 *
 * The cause (`docs/154`, verified by execution): Tailwind's `.sr-only` is
 * `position: absolute`, 1x1px, and every admin table renders one as its last
 * `<th>` - the "Actions" column header. The scroll wrapper was
 * `position: static`, so that span's **containing block was the initial
 * containing block (`<html>`), not the wrapper**. An absolutely positioned box
 * whose containing block lies outside a scroll container is **not clipped by
 * that container**, and it contributes to the scrollable overflow of its own
 * containing block - which is `html`, never `body`. Its static position is
 * wherever the wide table puts it, i.e. off screen.
 *
 * That predicts every observation above, including the two that made it look
 * unexplainable: the span is **1x1**, and the scan skipped sub-2px boxes (my
 * own first probe had the identical skip); and the minimal reproduction had no
 * `.sr-only` in it. `docs/128`'s "control" was never structurally different -
 * its table is simply narrow enough that the escaped span lands on screen, at
 * a margin of 32px. `/admin/blog`'s margin is **1px**.
 *
 * ── WHY THIS RULE, AND NOT THE OBVIOUS FIXES ────────────────────────────────
 *
 * `position: relative` on the wrapper makes it the containing block, so the
 * span is clipped again. It changes **no geometry** (`relative` with
 * `z-index: auto` creates no stacking context and does not move the box), and
 * it is proven safe: across 33 walked pages there are 7 abs/fixed boxes inside
 * a horizontal scroller and **0 are anything but `.sr-only`**, so nothing's
 * positioning or clipping can change.
 *
 * ⛔ `table-layout: fixed` was rejected by `docs/128` itself - it redistributes
 * every column to fix a symptom. `contain: paint` also measures 0 but clips
 * ink overflow, so it would clip a focus ring. `relative` on each of the eight
 * `<th>`s would be a hand-maintained per-site list, the shape this project has
 * been burned by in `docs/119`, `/124`, `/144`, `/146` and `/147`.
 *
 * ⚠️ `src/components/ui/table.tsx` already wrote `relative w-full
 * overflow-auto`. The library's own container was right the whole time; the 40
 * hand-rolled wrappers were not. That file is the premise tripwire below.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');

/** A Tailwind utility that makes the box a horizontal scroll container. */
const SCROLLER = /overflow-(?:x-)?(?:auto|scroll)/;

/**
 * An UNPREFIXED `relative`.
 *
 * ⛔ The lookbehind for `:` is load-bearing. `md:relative` or `lg:relative`
 * would satisfy a naive `includes('relative')` while applying at no phone
 * width at all - which is the only width where this defect shows.
 */
const RELATIVE = /(?<![\w:-])relative(?![\w-])/;

/** Blank comments, keeping line count so reported numbers are trustworthy. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

interface Hit {
  file: string;
  line: number;
  text: string;
}

function scrollerLines(): Hit[] {
  const hits: Hit[] = [];
  const files = globSync('src/**/*.{ts,tsx}', { cwd: ROOT })
    .filter((f) => !/\.(test|spec)\.tsx?$/.test(f))
    .map((f) => f.replace(/\\/g, '/'));
  for (const file of files) {
    /*
      ⚠️ Comments stripped FIRST - `docs/116` §4. `ImpactUpdateQueue.tsx`
      carries a comment about this very defect that necessarily quotes
      `overflow-x-auto`, and a raw-source sweep would demand `relative` inside
      a sentence.
    */
    const stripped = stripComments(readFileSync(resolve(ROOT, file), 'utf8'));
    stripped.split('\n').forEach((line, i) => {
      if (SCROLLER.test(line)) hits.push({ file, line: i + 1, text: line.trim() });
    });
  }
  return hits;
}

const show = (hits: Hit[]) => hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n');

describe('the sweep can see the code (anti-vacuity)', () => {
  it('finds the scroll containers', () => {
    // Without this, the rule below passes against an empty scan.
    const hits = scrollerLines();
    expect(hits.length, show(hits)).toBeGreaterThan(30);
    expect(hits.some((h) => h.file === 'src/components/admin/DonationsList.tsx')).toBe(true);
    expect(hits.some((h) => h.file === 'src/components/ui/table.tsx')).toBe(true);
  });

  it('⚠️ the PREMISE still holds: these tables render an abs-positioned header', () => {
    /*
      This rule only matters while something absolutely positioned lives inside
      a scroller. If every `.sr-only` actions header were ever replaced (say by
      `aria-label` on the `<th>`), the rule would still be correct but would no
      longer be load-bearing, and somebody should re-read `docs/154` before
      assuming it is protecting anything.
    */
    const srOnlyHeaders = globSync('src/components/admin/*.tsx', { cwd: ROOT })
      .filter((f) => /sr-only/.test(readFileSync(resolve(ROOT, f), 'utf8')));
    expect(
      srOnlyHeaders.length,
      'no .sr-only remains in admin - re-read docs/154 before trusting this rule',
    ).toBeGreaterThanOrEqual(5);
  });

  it('⛔ the library container is still the precedent', () => {
    // The premise tripwire. If shadcn's own wrapper loses `relative`, the
    // argument "the library already did this" stops being true.
    const src = readFileSync(resolve(ROOT, 'src/components/ui/table.tsx'), 'utf8');
    const line = src.split('\n').find((l) => SCROLLER.test(l) && l.includes('className'));
    expect(line, 'the table container is gone').toBeDefined();
    expect(RELATIVE.test(line!), line).toBe(true);
  });
});

describe('⛔ every horizontal scroll container is a containing block', () => {
  it('carries an unprefixed `relative`', () => {
    const offenders = scrollerLines().filter((h) => !RELATIVE.test(h.text));
    expect(
      offenders,
      'A horizontally scrolling box must be `relative`. Otherwise an ' +
        'absolutely positioned descendant - every admin table renders a 1x1 ' +
        '`.sr-only` "Actions" header - has the INITIAL containing block, so the ' +
        'scroller cannot clip it and it extends `html`\'s scroll area off ' +
        'screen. That is the root cause of docs/128 §5. A responsive variant ' +
        `(md:relative) does NOT count. docs/154.\n${show(offenders)}`,
    ).toEqual([]);
  });
});
