/**
 * The card's measurements, checked by recomputing them.
 *
 * ⚠️ These tests deliberately do NOT pin today's numbers. Pinning
 * `title === 60` would pass forever and say nothing; the question that
 * matters is whether the title still reads in a message bubble. So each
 * test derives the requirement from the downscale factors and compares.
 * Change a downscale and the requirement changes with it.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CARD_HEIGHT,
  CARD_JPEG_QUALITY,
  CARD_WIDTH,
  FEED_DOWNSCALE,
  MAX_CARD_BYTES,
  MIN_EFFECTIVE_PX,
  FALLBACK_MARK_PX,
  OG_TYPE,
  PRIMARY_EFFECTIVE_PX,
  PRIMARY_KEYS,
  TITLE_SIZES,
  WORST_DOWNSCALE,
  cardPx,
} from '@/lib/og-card-metrics';

const effective = (size: number, downscale: number) => size / downscale;

describe('the downscale factors describe real renderings', () => {
  it('the worst case is a message bubble, not a feed', () => {
    // iMessage gives the card 290px; a feed gives ~400px. If these ever
    // invert, every size below was computed against the wrong constraint.
    expect(WORST_DOWNSCALE).toBeGreaterThan(FEED_DOWNSCALE);
    expect(WORST_DOWNSCALE).toBeCloseTo(1200 / 290, 2);
    expect(FEED_DOWNSCALE).toBeCloseTo(1200 / 400, 2);
  });

  it('cardPx inverts the downscale', () => {
    expect(effective(cardPx(12, WORST_DOWNSCALE), WORST_DOWNSCALE))
      .toBeGreaterThanOrEqual(12);
  });
});

describe('⛔ the primary text reads in a message bubble', () => {
  for (const key of PRIMARY_KEYS) {
    it(`"${key}" clears ${PRIMARY_EFFECTIVE_PX}px at ${WORST_DOWNSCALE.toFixed(2)}x`, () => {
      const got = effective(OG_TYPE[key], WORST_DOWNSCALE);
      expect(
        got,
        `${key} is ${OG_TYPE[key]}px on the card = ${got.toFixed(1)}px in an iMessage bubble; `
        + `it needs at least ${cardPx(PRIMARY_EFFECTIVE_PX, WORST_DOWNSCALE)}px`,
      ).toBeGreaterThanOrEqual(PRIMARY_EFFECTIVE_PX);
    });
  }

  it('the title is the largest thing on the card', () => {
    // It is the one element the whole card exists to carry. Anything that
    // outgrew it would mean the hierarchy had been lost.
    const others = Object.entries(OG_TYPE).filter(([k]) => k !== 'title');
    for (const [k, v] of others) {
      expect(OG_TYPE.title, `${k} is not smaller than the title`).toBeGreaterThan(v);
    }
  });

  it('the previous scale would FAIL this rule', () => {
    /*
      The scale before this change: title 44, headline 42. Asserted here so
      the rule is shown to bite rather than merely to pass - 44/4.14 is
      10.6px, under the 12px a title needs.
    */
    expect(effective(44, WORST_DOWNSCALE)).toBeLessThan(PRIMARY_EFFECTIVE_PX);
    expect(effective(42, WORST_DOWNSCALE)).toBeLessThan(PRIMARY_EFFECTIVE_PX);
  });
});

describe('the secondary text reads in a feed', () => {
  const secondary = (Object.keys(OG_TYPE) as (keyof typeof OG_TYPE)[])
    .filter((k) => !(PRIMARY_KEYS as readonly string[]).includes(k));

  it('every non-primary element is covered by this rule', () => {
    expect(secondary.sort()).toEqual(['context', 'subline', 'trust', 'wordmark']);
  });

  for (const key of secondary) {
    it(`"${key}" clears ${MIN_EFFECTIVE_PX}px at ${FEED_DOWNSCALE.toFixed(2)}x`, () => {
      expect(effective(OG_TYPE[key], FEED_DOWNSCALE)).toBeGreaterThanOrEqual(MIN_EFFECTIVE_PX);
    });
  }
});

describe('the route uses the scale rather than its own numbers', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/app/api/v1/og/campaign/[slug]/route.tsx'),
    'utf8',
  );

  it('every fontSize is read from OG_TYPE', () => {
    /*
      A literal `fontSize: 44` next to `fontSize: OG_TYPE.title` would make
      the tests above true and the card wrong - the `docs/109` shape, where
      one file held both halves of a contradiction.
    */
    const literals = [...src.matchAll(/fontSize:\s*(\d+)/g)].map((m) => m[1]);
    expect(literals, `hard-coded font sizes: ${literals.join(', ')}`).toEqual([]);
    /*
      Five of the six come straight from OG_TYPE. The title is the exception
      and deliberately so: it is SIZED TO FIT by `fitTitle`, with
      `OG_TYPE.title` as the top of the ladder rather than a fixed value, so
      a long appeal is never cut off (`docs/112` §9).
    */
    expect([...src.matchAll(/fontSize:\s*OG_TYPE\./g)]).toHaveLength(
      Object.keys(OG_TYPE).length - 1,
    );
    expect(src).toContain('fontSize: title.size');
    expect(src).not.toContain('WebkitLineClamp');
    expect(TITLE_SIZES[0]).toBe(OG_TYPE.title);
    // The one sized thing that is a mark rather than text.
    expect(src).toContain('fontSize: FALLBACK_MARK_PX');
    expect(FALLBACK_MARK_PX).toBeGreaterThan(OG_TYPE.title);
  });

  it('the card dimensions come from one place', () => {
    expect(src).toContain('width: CARD_WIDTH');
    expect(src).toContain('height: CARD_HEIGHT');
    expect(CARD_WIDTH / CARD_HEIGHT).toBeCloseTo(1.905, 2);
  });

  it('⛔ the card is emitted as JPEG, under the size target', () => {
    // PNG is what ImageResponse produces and what put 798-928KB cards into
    // production. The conversion is the whole point of the pipeline.
    expect(src).toContain("'Content-Type': 'image/jpeg'");
    expect(src).toContain('CARD_JPEG_QUALITY');
    expect(CARD_JPEG_QUALITY).toBeGreaterThanOrEqual(80);
    expect(CARD_JPEG_QUALITY).toBeLessThanOrEqual(95);
    expect(MAX_CARD_BYTES).toBe(307_200);
  });
});
