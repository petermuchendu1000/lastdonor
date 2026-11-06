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
  HERO_WIDTH,
  MAX_CARD_BYTES,
  MIN_EFFECTIVE_PX,
  FALLBACK_MARK_PX,
  OG_TYPE,
  PRIMARY_EFFECTIVE_PX,
  PRIMARY_KEYS,
  TITLE_SIZES,
  WORST_DOWNSCALE,
  cardPx,
  moneyLineSize,
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

describe('⛔ the money is never larger than the title beside it', () => {
  /*
    THE REPORTED DEFECT, as a rule rather than as a number.

    `fitTitle` steps the TITLE down through `TITLE_SIZES` until it fits;
    the money line was the fixed `OG_TYPE.headline`. So on a long title the
    card drew the amount raised LARGER than the appeal it belonged to -
    [VERIFIED by computing the fit for all ten live campaigns] on three of
    them, worst at title 42 against money 52.
  */
  for (const titlePx of TITLE_SIZES) {
    it(`a title fitted to ${titlePx}px keeps the money at or below it`, () => {
      const money = moneyLineSize(titlePx);
      expect(
        money,
        `title ${titlePx}px with money ${money}px: the money out-shouts the appeal`,
      ).toBeLessThanOrEqual(titlePx);
    });
  }

  it('the money never exceeds its own ceiling either', () => {
    for (const titlePx of TITLE_SIZES) {
      expect(moneyLineSize(titlePx)).toBeLessThanOrEqual(OG_TYPE.headline);
    }
  });

  it('⚠️ and the clamp is load-bearing, not decorative', () => {
    /*
      THE ANTI-VACUITY CONTROL. If every rung of the ladder were above the
      ceiling, `Math.min` would never bite and every test above would pass
      with the clamp deleted. The ladder floors at 24 against a ceiling of
      42, so it bites on five rungs - and no constant can hold the invariant
      while that is true.
    */
    const biting = TITLE_SIZES.filter((s) => s < OG_TYPE.headline);
    expect(biting.length, 'no title size is below the money ceiling').toBeGreaterThan(0);
    for (const titlePx of biting) {
      expect(moneyLineSize(titlePx)).toBe(titlePx);
    }
  });

  it('…and it does not shrink the money when there is room', () => {
    /*
      The other half of the control: "never larger than the title" is also
      satisfied by drawing the money at 1px. A title at the top of the
      ladder must leave the money at its full derived size.
    */
    expect(moneyLineSize(TITLE_SIZES[0])).toBe(OG_TYPE.headline);
    expect(moneyLineSize(OG_TYPE.headline)).toBe(OG_TYPE.headline);
  });

  it('the ceiling is the smallest size that still reads in a bubble', () => {
    /*
      The owner's decision ("keep the amount, shrink it") expressed as a
      DERIVATION rather than as the number 42: the money line is no longer
      primary, so it is held to `MIN_EFFECTIVE_PX` - but it is held to it at
      the WORST downscale, not the feed one, so it stays readable in the
      narrowest message bubble there is while no longer competing with the
      title. Change a downscale or the floor and this requirement moves with
      it; restore the old 52 and this fails.
    */
    expect(OG_TYPE.headline).toBe(cardPx(MIN_EFFECTIVE_PX, WORST_DOWNSCALE));
    expect(effective(OG_TYPE.headline, WORST_DOWNSCALE)).toBeGreaterThanOrEqual(MIN_EFFECTIVE_PX);
  });

  it('the previous constant would FAIL this rule', () => {
    /*
      52 was the money size until 2026-11-06, and `help-maksym-…` fits its
      title at 42. Asserted so the rule is shown to bite on the real case
      rather than merely to pass.
    */
    const maksymTitlePx = 42;
    expect(TITLE_SIZES).toContain(maksymTitlePx);
    expect(52).toBeGreaterThan(maksymTitlePx);
    expect(moneyLineSize(maksymTitlePx)).toBeLessThanOrEqual(maksymTitlePx);
  });
});

describe('the secondary text reads in a feed', () => {
  const secondary = (Object.keys(OG_TYPE) as (keyof typeof OG_TYPE)[])
    .filter((k) => !(PRIMARY_KEYS as readonly string[]).includes(k));

  it('every non-primary element is covered by this rule', () => {
    /*
      ⚠️ `headline` joined this list on 2026-11-06 and that is the owner's
      demotion of the money line, not drift. This assertion is the ANTI-VACUITY
      control for the whole file: every key of OG_TYPE must fall under exactly
      one of the two rules, so a key cannot be added - or moved between tiers -
      without somebody stating which legibility budget it is held to.
    */
    expect(secondary.sort()).toEqual(['context', 'headline', 'subline', 'trust', 'wordmark']);
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
      ⚠️ This used to COUNT `fontSize: OG_TYPE.` occurrences and require
      `keys - 1`. That broke the moment a size stopped being read straight off
      the scale - the money line is now `moneyLineSize(title.size)` - and a
      count cannot tell "correctly derived" from "quietly dropped".

      So the property is asserted directly instead: every key of OG_TYPE is
      named somewhere in the route. That still fails if a size is orphaned,
      and it no longer dictates HOW the route reaches it.
    */
    for (const key of Object.keys(OG_TYPE)) {
      expect(src, `OG_TYPE.${key} is never used by the route`).toContain(key);
    }
    expect(src).toContain('fontSize: title.size');
    // The two sizes that are DERIVED rather than read: the fitted title, and
    // the money line clamped to it.
    expect(src).toContain('fontSize: moneyLineSize(title.size)');
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

  it('⛔ the renderer is handed PIXELS, never the photograph URL', () => {
    /*
      Satori reads no EXIF, so whatever is passed as `src` is painted as the
      bytes lie. `heroPixels` is what applies the phone's rotation first -
      pointing this back at the URL restores a sideways card, and no
      assertion about the card's SIZES could see it.
    */
    expect(src).toContain('heroPixels(heroSrc)');
    expect(src).toContain('src={heroImage}');
    expect(src, 'the raw probed URL is drawn again').not.toContain('src={heroSrc}');
  });

  it('the photograph panel is one number, shared with the re-encoder', () => {
    // `og-hero-image.ts` crops to exactly this box; a literal here would let
    // the two drift and the image would be scaled twice.
    expect(src).toContain('${HERO_WIDTH}px');
    expect(src, 'a hard-coded panel width').not.toContain("'456px'");
    expect(HERO_WIDTH).toBeLessThan(CARD_WIDTH);
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
