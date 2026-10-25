/**
 * Every title fits the card.
 *
 * The rules are checked twice: once with a synthetic measurer so the logic
 * is exercised exactly, and once against the REAL DM Serif Display file,
 * because the reason this module exists is that a character count is wrong
 * by up to 2.8x in that face.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import opentype from '@shuding/opentype.js';

import { fitTitle, wrapLines, type Measure } from '@/lib/og-title-fit';
import {
  TITLE_BOX_HEIGHT,
  TITLE_BOX_WIDTH,
  TITLE_LINE_HEIGHT,
  TITLE_SIZES,
  OG_TYPE,
} from '@/lib/og-card-metrics';

/** Every character is exactly half the font size wide. */
const uniform: Measure = (t, size) => t.length * size * 0.5;

const fit = (text: string, measure: Measure) =>
  fitTitle({
    text,
    measure,
    maxWidth: TITLE_BOX_WIDTH,
    maxHeight: TITLE_BOX_HEIGHT,
    sizes: TITLE_SIZES,
    lineHeight: TITLE_LINE_HEIGHT,
  });

/** The real face, so the thresholds are tested against real advances. */
const font = opentype.parse(
  (() => {
    const b = readFileSync(join(process.cwd(), 'public/fonts/DMSerifDisplay-Regular.ttf'));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  })(),
);
const real: Measure = (t, size) => font.getAdvanceWidth(t, size);

describe('the ladder starts at the designed size', () => {
  it('a short title keeps the full 60px', () => {
    expect(fit('Help Amina', real).size).toBe(OG_TYPE.title);
    expect(TITLE_SIZES[0]).toBe(OG_TYPE.title);
  });

  it('sizes only ever come from the ladder', () => {
    for (const t of ['x', 'Help Amina Finish Her Cancer Treatment', 'y '.repeat(90)]) {
      expect(TITLE_SIZES as readonly number[]).toContain(fit(t, real).size);
    }
  });
});

describe('⛔ no title is ever cut off', () => {
  const longest = 'Help Marcus Delgado Fight Rare Cancer Diagnosed Just Weeks Before School Starts';

  it('the longest real production title fits whole', () => {
    const r = fit(longest, real);
    expect(r.truncated).toBe(false);
    expect(r.lines.join(' ')).toBe(longest);
  });

  it('a title at the validator maximum of 200 characters fits whole', () => {
    // src/lib/validators/campaign.ts:30 - `.max(200)`.
    const text = 'Help the Family of Jonathan Kiprotich Rebuild Their Home and Their Small '
      + 'Roadside Bakery After the Fire That Destroyed Both of Them Late Last Month in '
      + 'Nakuru County Kenya and Left Them All With Nothin';
    expect(text.length).toBe(200);

    const r = fit(text, real);
    expect(r.truncated, `needed to truncate at ${r.size}px`).toBe(false);
    expect(r.lines.join(' ')).toBe(text);
  });

  it('200 characters of the WIDEST letter still fits', () => {
    /*
      Measured, not assumed: `W` advances wider than `M` in this face, and
      200 of them is the worst string the validator can accept. It needs the
      bottom of the ladder - which is why the ladder has a bottom there.
    */
    for (const ch of ['W', 'M']) {
      const r = fit(ch.repeat(200), real);
      expect(r.truncated, `200 x ${ch} was cut off`).toBe(false);
    }
  });

  it('every reconstructed title fits, and never overflows the box', () => {
    const titles = [
      'Help Amina Finish Her Cancer Treatment',
      'Samuel Pierre Jr. Lies Exposed to the Elements in Baton Rouge Cemetery',
      'Maj. Sorffly Davius Collapse in Kuwait Leaves New York Family Reeling',
      'Help Danielle Sutton Care for Her Twins While Battling Aggressive MS',
      'Tucson, Arizona Honors Harold Jennings',
    ];
    for (const t of titles) {
      const r = fit(t, real);
      expect(r.truncated, t).toBe(false);
      expect(r.lines.join(' '), t).toBe(t);
      for (const line of r.lines) {
        expect(real(line, r.size), `"${line}" overflows`).toBeLessThanOrEqual(TITLE_BOX_WIDTH);
      }
      expect(r.lines.length * r.size * TITLE_LINE_HEIGHT).toBeLessThanOrEqual(TITLE_BOX_HEIGHT);
    }
  });
});

describe('it steps down only as far as it must', () => {
  it('a longer title gets a smaller size than a shorter one', () => {
    const short = fit('Help Amina', real).size;
    const mid = fit('Help Amina Finish Her Cancer Treatment Before the Term Ends', real).size;
    const long = fit('M'.repeat(200), real).size;
    expect(short).toBeGreaterThanOrEqual(mid);
    expect(mid).toBeGreaterThan(long);
  });

  it('a title may take MORE than three lines rather than shrink needlessly', () => {
    /*
      The fit is bounded by HEIGHT, not by a line count. A fixed three-line
      rule looks equivalent and is not: 200 characters of prose is five lines
      at 32px and 182px tall, well inside the 216px box, so it keeps a
      readable size. Under a three-line rule the same title would be driven
      to the bottom of the ladder for no reason.

      This assertion exists because a mutant that replaced the height test
      with `lines.length <= 3` passed every other test in this file.
    */
    const text = 'Help the Family of Jonathan Kiprotich Rebuild Their Home and Their Small '
      + 'Roadside Bakery After the Fire That Destroyed Both of Them Late Last Month in '
      + 'Nakuru County Kenya and Left Them All With Nothin';
    const r = fit(text, real);

    expect(r.lines.length).toBeGreaterThan(3);
    expect(r.size, 'a 200-character title was shrunk further than it had to be')
      .toBeGreaterThanOrEqual(28);
    expect(r.truncated).toBe(false);
  });

  it('picks the LARGEST size that fits, not merely one that does', () => {
    const text = 'Help Danielle Sutton Care for Her Twins While Battling Aggressive MS';
    const r = fit(text, real);
    const bigger = TITLE_SIZES.filter((s) => s > r.size);
    for (const s of bigger) {
      const lines = wrapLines(text, real, s, TITLE_BOX_WIDTH);
      expect(
        lines.length * s * TITLE_LINE_HEIGHT,
        `${s}px would have fitted and was skipped`,
      ).toBeGreaterThan(TITLE_BOX_HEIGHT);
    }
  });
});

describe('wrapLines', () => {
  it('breaks on words and keeps every one', () => {
    const lines = wrapLines('one two three four five six', uniform, 40, 200);
    expect(lines.join(' ')).toBe('one two three four five six');
    for (const l of lines) expect(uniform(l, 40)).toBeLessThanOrEqual(200);
  });

  it('⚠️ hard-breaks a single word too wide for the line', () => {
    /*
      Without this, one unbreakable word returns a line wider than the box,
      every size "overflows", the ladder bottoms out and the title runs off
      the card anyway.
    */
    const lines = wrapLines('Supercalifragilisticexpialidocious', uniform, 40, 200);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('Supercalifragilisticexpialidocious');
    for (const l of lines) expect(uniform(l, 40)).toBeLessThanOrEqual(200);
  });

  it('collapses runs of whitespace rather than emitting empty lines', () => {
    expect(wrapLines('  a   b  ', uniform, 40, 400)).toEqual(['a b']);
  });

  it('returns nothing for an empty title instead of one blank line', () => {
    expect(wrapLines('   ', uniform, 40, 400)).toEqual([]);
  });
});

describe('the last resort is reported, not silent', () => {
  it('flags truncation rather than overflowing the card', () => {
    // Forced with a box far too small for any ladder size.
    const r = fitTitle({
      text: 'a '.repeat(400),
      measure: uniform,
      maxWidth: 100,
      maxHeight: 40,
      sizes: TITLE_SIZES,
      lineHeight: TITLE_LINE_HEIGHT,
    });
    expect(r.truncated).toBe(true);
    expect(r.lines.length * r.size * TITLE_LINE_HEIGHT).toBeLessThanOrEqual(40);
    expect(r.lines.length).toBeGreaterThanOrEqual(1);
  });
});
