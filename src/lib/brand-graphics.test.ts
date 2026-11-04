/**
 * The brand explainer graphics: that they exist, that they are on a page, and
 * that what they assert is true.
 *
 * These are PUBLISHED images about a platform holding other people's money,
 * and an image is harder to audit than a sentence - nothing greps a .webp. So
 * the copy lives in source, and these rules hold it there.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BRAND_GRAPHICS,
  brandGraphicPath,
  brandGraphicsFor,
  pagesWithBrandGraphics,
} from './brand-graphics';

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** The generator's source, which holds every word rendered INTO the images. */
const generatorSrc = read('scripts/generate-brand-graphics.ts');

/** Comments quote the forbidden claims in order to explain them (docs/116 §4). */
const generatorCode = generatorSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('the graphics exist and are reachable', () => {
  it('⛔ every registered graphic has a generated FILE', () => {
    expect(BRAND_GRAPHICS.length).toBeGreaterThan(0);
    for (const g of BRAND_GRAPHICS) {
      const rel = brandGraphicPath(g.slug);
      expect(rel, g.slug).toBe(`/images/explainers/${g.slug}.webp`);
      expect(existsSync(join(root, 'public', rel)), `missing file: ${rel}`).toBe(true);
    }
  });

  it('⛔ every graphic names a page that EXISTS on disk', () => {
    /*
      An image on no page is never indexed - the whole premise. A registry
      entry pointing at a route that was renamed or deleted is a graphic that
      silently reaches nobody.
    */
    for (const g of BRAND_GRAPHICS) {
      const page = join(root, 'src/app', g.page.replace(/^\//, ''), 'page.tsx');
      expect(existsSync(page), `${g.slug} names ${g.page}, which has no page.tsx`).toBe(true);
    }
  });

  it('⛔ every named page actually RENDERS its graphics', () => {
    // The registry claiming a page is not the page rendering it.
    for (const page of pagesWithBrandGraphics()) {
      const src = read(join('src/app', page.replace(/^\//, ''), 'page.tsx'));
      expect(src, `${page} does not render <BrandGraphicsFor>`).toMatch(/<BrandGraphicsFor\b/);
      expect(src, `${page} renders BrandGraphicsFor for a different page`).toContain(
        `page="${page}"`,
      );
    }
  });

  it('⛔ every page with a graphic is ADVERTISED in the sitemap', () => {
    /*
      The sitemap attaches images by matching a page's path. A page carrying
      graphics but absent from the sitemap means Google is never told the
      images belong to it.
    */
    const sitemap = read('src/app/sitemap.ts');
    for (const page of pagesWithBrandGraphics()) {
      const needle = page === '/' ? 'url: BASE_URL' : `BASE_URL}${page}\``;
      expect(sitemap, `${page} carries graphics but is not in the sitemap`).toContain(needle);
    }
  });

  it('the sitemap derives the pairing rather than listing it', () => {
    const sitemap = read('src/app/sitemap.ts');
    expect(sitemap).toMatch(/brandGraphicsFor\s*\(/);
    expect(sitemap).toMatch(/brandGraphicPath\s*\(/);
  });

  it('a campaign URL advertises the image its page really renders', () => {
    // Not the stored column: for most campaigns that still holds a
    // third-party photograph the page no longer shows (docs/170).
    const sitemap = read('src/app/sitemap.ts');
    expect(sitemap).toMatch(/resolveCampaignHero\s*\(/);
  });
});

describe('the registry is coherent', () => {
  it('slugs and captions are unique', () => {
    const slugs = BRAND_GRAPHICS.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const captions = BRAND_GRAPHICS.map((g) => g.caption);
    expect(new Set(captions).size).toBe(captions.length);
  });

  it('the generator draws exactly what the registry publishes', () => {
    /*
      Drift either way is a defect: a design with no registry entry is on no
      page, and a registry entry with no design renders a 404 box.
    */
    const drawn = [...generatorSrc.matchAll(/^\s*slug: '([a-z0-9-]+)',$/gm)].map((m) => m[1]);
    expect(new Set(drawn)).toEqual(new Set(BRAND_GRAPHICS.map((g) => g.slug)));
  });

  it('⚠️ alt text DESCRIBES the image rather than sloganeering', () => {
    for (const g of BRAND_GRAPHICS) {
      // Long enough to say what is depicted; a slogan is never this long.
      expect(g.alt.length, `${g.slug} alt is too short to describe anything`).toBeGreaterThan(80);
      expect(g.caption.length, `${g.slug} caption is too short`).toBeGreaterThan(30);
    }
  });

  it('brandGraphicsFor returns only that page, and nothing for an unknown one', () => {
    for (const page of pagesWithBrandGraphics()) {
      const got = brandGraphicsFor(page);
      expect(got.length).toBeGreaterThan(0);
      expect(got.every((g) => g.page === page)).toBe(true);
    }
    expect(brandGraphicsFor('/not-a-real-page')).toEqual([]);
  });
});

describe('⛔ what the images may not claim', () => {
  /** Everything a reader sees: the drawn copy plus the alt and captions. */
  const published = [
    generatorCode,
    ...BRAND_GRAPHICS.map((g) => `${g.alt} ${g.caption}`),
  ].join('\n');

  it('no percent-plus-fixed processing rate, anywhere', () => {
    /*
      docs/116 §5 banned these outright and fee-claims.test.ts enforces it
      over src/. An image lives outside that glob, so the rule is restated
      here rather than left to the gap.
    */
    expect(published).not.toMatch(/\d+(\.\d+)?\s*%\s*(\+|plus)\s*[$€£]?\s*\d/i);
    expect(published).not.toMatch(/30\s*(cents|¢)/i);
    expect(published).not.toMatch(/2\.9\s*%/);
  });

  it('⛔ nothing offers payment by card', () => {
    // create-checkout answers 503 for every campaign on dead Stripe
    // credentials (docs/161), so it is false today on every live campaign.
    expect(published).not.toMatch(/\b(credit|debit)\s+card\b/i);
    expect(published).not.toMatch(/\bpay (?:by|with) card\b/i);
  });

  it('⛔ nothing claims a completed payout', () => {
    /*
      Money has never left this platform: 0 withdrawals, 0 Connect accounts,
      and the payout rail is the same dead Stripe (docs/113, docs/121). The
      release GATE is real and is what the graphics state.
    */
    expect(published).not.toMatch(/\bwe send the money\b/i);
    expect(published).not.toMatch(/\breaches the family\b/i);
    expect(published).not.toMatch(/\bthe family receives\b/i);
  });

  it('⛔ nothing claims donors receive impact updates', () => {
    // impact_updates holds 0 rows; docs/142 already deleted this from llms.txt.
    expect(published).not.toMatch(/donors receive impact updates/i);
  });

  it('⚠️ CONTROL: the rules can see the drawn copy at all', () => {
    /*
      Anti-vacuity. Every rule above is a `not.toMatch`, so an empty haystack
      would satisfy all of them - which is exactly how a stripped-comment
      sweep silently passes (docs/163 §5.1).
    */
    expect(published).toMatch(/We take 0%/);
    expect(published).toMatch(/M-Pesa/);
    expect(published.length).toBeGreaterThan(3000);
    // And the comment stripper must actually be removing something.
    expect(generatorSrc.length - generatorCode.length).toBeGreaterThan(2000);
  });

  it('⚠️ every graphic records WHAT MAKES ITS COPY TRUE', () => {
    // The facts list is the record a later reader needs to re-check a claim.
    const factBlocks = [...generatorSrc.matchAll(/facts: \[([\s\S]*?)\n    \],/g)];
    expect(factBlocks.length).toBe(BRAND_GRAPHICS.length);
    for (const [, block] of factBlocks) {
      expect(block.trim().length).toBeGreaterThan(80);
    }
  });
});
