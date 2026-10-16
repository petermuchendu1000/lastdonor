/**
 * The icon system's contract.
 *
 * These are the invariants that were violated before the layer existed: five
 * stroke widths, three icon sets, ten-plus ad hoc sizes, and seventeen files
 * of hand-rolled SVG. Each one is now a test, so the next violation fails
 * rather than merely looking slightly wrong.
 *
 * The final test is a ratchet on the migration itself, which is the only
 * kind of guard that works while 80 files still import heroicons directly.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import * as Icons from './index';
import { ICON_SIZES, STROKE_WIDTH } from './createIcon';
import * as Brand from './brand';

type IconComponent = (props: { size?: Icons.IconSize; label?: string; className?: string }) => React.ReactElement;

const ALL = Object.entries(Icons).filter(
  ([name, v]) => typeof v === 'function' && name.endsWith('Icon') && name !== 'createIcon',
) as [string, IconComponent][];

const BRAND = Object.entries(Brand) as [string, IconComponent][];

function svgOf(el: HTMLElement) {
  const svg = el.querySelector('svg');
  if (!svg) throw new Error('no svg rendered');
  return svg;
}

describe('the set is not empty and is discoverable', () => {
  it('exports a meaningful number of icons', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(25);
  });

  it('includes the brand icons the product needs', () => {
    for (const n of [
      'ReviewedIcon',
      'ImpactUpdateIcon',
      'ZeroFeeIcon',
      'ReceiptIcon',
      'PayoutIcon',
      'LastDonorIcon',
      'FirstDonationIcon',
    ]) {
      expect(Object.keys(Icons)).toContain(n);
    }
  });
});

describe('one grid, one stroke', () => {
  it.each(ALL)('%s draws on the 24x24 grid', (_name, Icon) => {
    const { container } = render(<Icon />);
    expect(svgOf(container).getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it.each(ALL)('%s uses the brand stroke width', (_name, Icon) => {
    const { container } = render(<Icon />);
    expect(svgOf(container).getAttribute('stroke-width')).toBe(String(STROKE_WIDTH));
  });

  it('has exactly one stroke width in the whole system', () => {
    const widths = new Set(
      ALL.map(([, Icon]) => {
        const { container } = render(<Icon />);
        return svgOf(container).getAttribute('stroke-width');
      }),
    );
    expect([...widths]).toEqual([String(STROKE_WIDTH)]);
  });
});

describe('the size scale', () => {
  it.each(Object.entries(ICON_SIZES))('size %s renders at %ipx square', (size, px) => {
    const { container } = render(<Icons.CheckIcon size={size as Icons.IconSize} />);
    const svg = svgOf(container);
    expect(svg.getAttribute('width')).toBe(String(px));
    expect(svg.getAttribute('height')).toBe(String(px));
  });

  it('defaults to md, so an unspecified icon is never accidentally huge', () => {
    const { container } = render(<Icons.CheckIcon />);
    expect(svgOf(container).getAttribute('width')).toBe(String(ICON_SIZES.md));
  });

  it('applies the same scale to brand and wrapped icons alike', () => {
    const brand = render(<Icons.ReviewedIcon size="lg" />);
    const wrapped = render(<Icons.CheckIcon size="lg" />);
    expect(svgOf(brand.container).getAttribute('width')).toBe(
      svgOf(wrapped.container).getAttribute('width'),
    );
  });
});

describe('accessibility is the default, not an option', () => {
  it.each(ALL)('%s is hidden from assistive tech unless labelled', (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = svgOf(container);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
  });

  it.each(ALL)('%s becomes an image with a title when labelled', (_name, Icon) => {
    const { container } = render(<Icon label="Open menu" />);
    const svg = svgOf(container);
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-hidden')).toBeNull();
    expect(svg.getAttribute('aria-label')).toBe('Open menu');
  });

  it.each(ALL)('%s is never a tab stop', (_name, Icon) => {
    const { container } = render(<Icon />);
    expect(svgOf(container).getAttribute('focusable')).toBe('false');
  });
});

describe('colour comes from the caller', () => {
  it.each(BRAND)('%s carries no colour of its own', (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = svgOf(container);
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('fill')).toBe('none');
    // No hardcoded hex anywhere in the artwork.
    expect(svg.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

describe('SortIcon replaces three local copies', () => {
  it('points up when ascending and down when descending', () => {
    const asc = render(<Icons.SortIcon direction="asc" />);
    const desc = render(<Icons.SortIcon direction="desc" />);
    expect(svgOf(asc.container).innerHTML).not.toBe(svgOf(desc.container).innerHTML);
  });

  it('shows a dimmed indicator when unsorted, so the header never reflows', () => {
    const { container } = render(<Icons.SortIcon direction={null} />);
    expect(svgOf(container).getAttribute('class')).toContain('opacity-30');
  });
});

describe('migration ratchet', () => {
  /*
    80 files still import heroicons directly and 16 contain hand-rolled
    <svg>. Failing on any occurrence would mean rewriting all of them in one
    commit, which is how migrations get abandoned. These assert the counts
    do not GROW, so the number can only come down.

    When a number drops, lower the baseline in the same commit.
  */
  const SRC = path.resolve(__dirname, '../../..');
  const ICON_DIR = path.resolve(__dirname);

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (full.startsWith(ICON_DIR)) continue;
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx$/.test(full) && !/\.test\.tsx$/.test(full)) out.push(full);
    }
    return out;
  }

  const files = walk(SRC);

  it('no NEW file imports heroicons directly', () => {
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('@heroicons/react'));
    expect(offenders.length).toBeLessThanOrEqual(80);
  });

  it('no NEW file hand-rolls an inline svg', () => {
    const offenders = files.filter((f) => /<svg[\s>]/.test(readFileSync(f, 'utf8')));
    expect(offenders.length).toBeLessThanOrEqual(16);
  });
});
