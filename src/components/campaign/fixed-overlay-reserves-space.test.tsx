/**
 * A fixed bottom overlay reserves space for itself.
 *
 * ── WHAT WENT WRONG ───────────────────────────────────────────────────────
 *
 * `StickyMobileDonateBar` is `position: fixed; bottom: 0`, so it is out of
 * flow and nothing below it moves aside - and **you cannot scroll past the
 * end of a document**, so the last 65px of every page carrying it were
 * permanently behind it. It renders only below `lg`, so the phone was the
 * only place it mattered, and `docs/151` §7 had recorded the campaign detail
 * page as never walked at 390px.
 *
 * [VERIFIED in a browser on production] at the bottom of
 * `/campaigns/harold-jennings` the bar sat on top of the footer's copyright
 * line and its "Switch to dark mode" button; a real click on that button
 * TIMED OUT, while the same click succeeded on `/campaigns` and `/about`,
 * which render no fixed bar. `docs/163`.
 *
 * ── WHY THESE RULES ARE SHAPED THIS WAY ───────────────────────────────────
 *
 * The rule DISCOVERS the overlays from disk rather than naming this file,
 * because the next fixed bar somebody adds is the one that will forget. And
 * it does not check a pixel value: the bar's height is content-driven, so a
 * hardcoded `pb-20` is a number that drifts. What it checks is that the
 * height comes from a MEASUREMENT of the bar.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { StickyMobileDonateBar } from './StickyMobileDonateBar';

const ROOT = process.cwd();

/** Strip comments, so prose describing the defect is not read as the defect. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(p) && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * Every component that pins itself to the bottom of the viewport. Matched on
 * the two properties that cause the problem together - out of flow, and
 * anchored to the bottom edge - in either class order.
 */
function fixedBottomOverlays(): { file: string; src: string; classString: string }[] {
  const hits: { file: string; src: string; classString: string }[] = [];
  for (const file of [...walk(join(ROOT, 'src/components')), ...walk(join(ROOT, 'src/app'))]) {
    const src = code(readFileSync(file, 'utf8'));
    /*
      ⚠️ The CLASS STRING is matched wherever it sits, not anchored to the
      `className=` that introduces it. My first version matched
      `(?:className|cn\()[^\n]*` and found ZERO overlays - including the one
      this file is about - because `className={cn(` and the string live on
      different LINES, and `[^\n]*` stops at the first newline. The
      anti-vacuity row below is what reported it; the two substantive rules
      had passed over an empty list. `docs/153` §5's trap in a new costume.
    */
    for (const m of src.matchAll(/(['"`])([^'"`\n]*)\1/g)) {
      const s = m[2];
      if (/\bfixed\b/.test(s) && /\bbottom-0\b/.test(s)) {
        hits.push({ file: file.slice(ROOT.length + 1), src, classString: s });
        break;
      }
    }
  }
  return hits;
}

describe('a fixed bottom overlay does not hide the end of the document', () => {
  const OVERLAYS = fixedBottomOverlays();

  it('ANTI-VACUITY: the sweep actually finds an overlay', () => {
    /*
      Without this, a regex that matched nothing would make every rule below
      pass against any codebase at all.
    */
    expect(OVERLAYS.length, 'found no fixed bottom overlay to check').toBeGreaterThan(0);
    expect(OVERLAYS.map((o) => o.file)).toContain(
      'src/components/campaign/StickyMobileDonateBar.tsx',
    );
  });

  it('⛔ each one reserves space ON THE DOCUMENT, from a MEASUREMENT', () => {
    for (const { file, src } of OVERLAYS) {
      /*
        ⚠️ `document.body`, not an in-flow spacer inside the component. My
        first fix rendered a spacer here and an A/B in ONE browser session
        reported the IDENTICAL covered count at 65px and at 0px - the footer
        is rendered after the page by the root layout, so a spacer in the
        page reserves room in the wrong place (`docs/163` §4.1).
      */
      expect(src, `${file}: does not reserve space on the document`).toMatch(
        /body\.style\.paddingBottom/,
      );
      /*
        Height driven by the element's own box, not by a written-down number.
        ⚠️ Any of the three ways of asking the browser counts: pinning
        `getBoundingClientRect().height` would reject an equally correct
        `offsetHeight`, which is `docs/160` §5.2's trap - a rule that checks
        today's spelling rather than the property.
      */
      expect(src, `${file}: height is not measured from the bar`).toMatch(
        /getBoundingClientRect\(\)\.height|\.offsetHeight|\.clientHeight/,
      );
      // ⛔ A hardcoded bottom padding is the drift this rule exists to stop.
      expect(src, `${file}: reserves space with a hardcoded padding class`).not.toMatch(
        /\bpb-(?:16|20|24|28|32)\b/,
      );
    }
  });

  it('⚠️ TRIPWIRE on the stated premise: the bar is mobile-only', () => {
    /*
      The component's own comment reasons that the measurement "carries the
      breakpoint for free" - above `lg` the bar is `display: none`, its height
      is 0, so the padding is 0 and there is no second place to keep in step.

      ⛔ That is a PREMISE, not an overlap rule. Injection row 6 removed
      `lg:hidden` and NOTHING fired, because the padding would still match the
      bar - the overlap does not return, the DESIGN changes. So this does not
      forbid the change; it fails so that whoever makes it re-reads the
      reasoning. `docs/148` §B.4's shape.
    */
    for (const { file, classString } of OVERLAYS) {
      expect(
        classString,
        `${file}: the bar is no longer mobile-only, so the comment's reasoning about the breakpoint is stale`,
      ).toContain('lg:hidden');
    }
  });

  it('⛔ the reservation is undone when the bar unmounts', () => {
    /*
      A page without the bar must be untouched. Without the cleanup, padding
      set on a campaign page would survive a client-side navigation anywhere
      else.
    */
    for (const { file, src } of OVERLAYS) {
      const effect = src.slice(src.indexOf('useEffect'));
      expect(effect, `${file}: no cleanup restoring the previous padding`).toMatch(
        /return\s*\(\)\s*=>[\s\S]*paddingBottom\s*=/,
      );
    }
  });

  it('EXECUTED: mounting reserves body padding, unmounting restores it', () => {
    /*
      jsdom reports a 0 height for every box, so the NUMBER cannot be checked
      here - that is what the browser A/B in `docs/163` §5 is for. What this
      proves is that the property is written and restored at all.
    */
    document.body.style.paddingBottom = '';
    const { unmount, container } = render(
      <StickyMobileDonateBar
        raisedAmount={0}
        goalAmount={1_500_000}
        currency="USD"
        donateHref="/campaigns/x/donate"
      />,
    );
    expect(document.body.style.paddingBottom, 'mounting must write a reservation').toMatch(
      /px$/,
    );

    const bar = container.querySelector('.fixed.bottom-0');
    expect(bar, 'the bar must still be fixed to the bottom').not.toBeNull();
    /*
      CONTROL: the bar still carries what it is FOR - a link to the donate
      page and the campaign's figure.

      ⚠️ This asserted the literal words "Be the first to donate", so
      rewording that sentence failed the test. `docs/160` §5.2's trap, made
      here minutes after loosening another rule for the same reason, and
      caught by injection row 9. A control pins the PROPERTY, never the copy.
    */
    expect(
      bar!.querySelector('a[href="/campaigns/x/donate"]'),
      'the bar must still link to the donate page',
    ).not.toBeNull();
    expect(bar!.textContent, 'the bar must still state the figure').toMatch(/[\d,]+/);

    unmount();
    expect(
      document.body.style.paddingBottom,
      'unmounting must restore the page it found',
    ).toBe('');
  });
});
