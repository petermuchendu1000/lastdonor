/**
 * Which image stands in for a campaign, and whether it can ever be a
 * photograph of somebody else.
 *
 * The fixtures here are REAL PRODUCTION VALUES, read off the live
 * `/campaigns` listing on 2026-11-04. That is the point: the rule is checked
 * against the rows that were actually wrong, not against invented ones.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isOrganiserPhoto,
  categoryPanelPath,
  resolveCampaignHero,
  PUBLIC_MEDIA_PREFIX,
  FALLBACK_CATEGORY,
  firstPartyMediaPath,
  mediaObjectKey,
  isServableMediaKey,
  NEVER_PUBLIC_KEY_PREFIXES,
  plateVariant,
  PLATE_VARIANTS,
} from './campaign-hero';
import { CATEGORY_CONTENT } from './category-content';
import { CATEGORY_LABELS } from './categories';

/** Seven of the ten live campaigns stored one of these. */
const PRODUCTION_STOCK = [
  'https://images.unsplash.com/photo-1516627145497-ae6968895b74?w=800',
  'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=800',
  'https://images.unsplash.com/photo-1438032005730-c779502df39b?w=800',
  'https://images.unsplash.com/photo-1547683905-f686c993aae5?w=800',
];

/**
 * Live campaign titles, read off `/campaigns` on 2026-11-06.
 *
 * ⚠️ These are the real ones, NOT strings picked because they spread nicely
 * across the variants. A fixture chosen to make the anti-vacuity row pass
 * would be the row testing itself.
 */
const REAL_TITLES = [
  'Keisha Wallace Fights to Keep Her Four Kids Off Atlanta Streets',
  'Help Danielle Sutton Care for Her Twins While Battling Aggressive MS',
  'Help John Recover After a Car Accident',
  'Help Maksym Rebuild After the Strike',
  'Tuan Nguyen Needs Urgent Surgery',
];

/** The two campaigns whose organiser actually supplied a photograph. */
const PRODUCTION_UPLOAD =
  'https://vavxdjqufxrsbyohcwdh.supabase.co/storage/v1/object/public/media/campaign-photos/59171bbc-7077-485a-a432-b2546f156690.jpg';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('⛔ a stock photograph never stands in for a named person', () => {
  it('the production defect: every stored Unsplash hero resolves to a panel', () => {
    /*
      [VERIFIED 2026-11-04] 8 of 10 live campaigns rendered somebody who is
      not the person named beside them - a toddler with a toy camera under
      "Keisha Wallace Fights to Keep Her Four Kids Off Atlanta Streets", a
      male doctor under a woman's MS appeal.
    */
    for (const url of PRODUCTION_STOCK) {
      expect(isOrganiserPhoto(url), url).toBe(false);
      const hero = resolveCampaignHero({ heroImageUrl: url, category: 'medical', title: 'X' });
      expect(hero.isPanel, url).toBe(true);
      expect(hero.src, url).toMatch(/^\/images\/categories\/medical-panel-[1-3]\.webp$/);
    }
  });

  it('⚠️ CONTROL: an organiser\'s own upload is KEPT, and served first-party', () => {
    /*
      Two properties in one, and both are load-bearing.

      KEPT: without it, "always return a panel" would satisfy every other
      assertion in this file, and the two campaigns with a real photograph
      would silently lose it.

      FIRST-PARTY: this assertion used to read `toBe(PRODUCTION_UPLOAD)` -
      the stored Supabase URL. That was correct until the upstream host was
      measured sending `X-Robots-Tag: none`, which made the URL we published
      one Google is told to ignore. The test is REPOINTED, not deleted: the
      property it guards is unchanged, only the address is.
    */
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://vavxdjqufxrsbyohcwdh.supabase.co');
    expect(isOrganiserPhoto(PRODUCTION_UPLOAD)).toBe(true);

    const hero = resolveCampaignHero({
      heroImageUrl: PRODUCTION_UPLOAD,
      category: 'medical',
      title: 'Help John Recover After a Car Accident',
    });
    expect(hero.isPanel).toBe(false);
    expect(hero.alt).toBe('Help John Recover After a Car Accident');

    expect(hero.src).toBe('/media/campaign-photos/59171bbc-7077-485a-a432-b2546f156690.jpg');
    expect(hero.src).not.toMatch(/supabase/i);
    expect(hero.src.startsWith('/')).toBe(true);
  });

  it('refuses an upload-shaped path on a host that is not ours', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://vavxdjqufxrsbyohcwdh.supabase.co');
    expect(
      isOrganiserPhoto(`https://evil.example.com${PUBLIC_MEDIA_PREFIX}campaign-photos/a.jpg`),
    ).toBe(false);
  });

  it('refuses a host on our domain whose path is not the media bucket', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://vavxdjqufxrsbyohcwdh.supabase.co');
    expect(
      isOrganiserPhoto(
        'https://vavxdjqufxrsbyohcwdh.supabase.co/storage/v1/object/public/other/a.jpg',
      ),
    ).toBe(false);
  });

  it('fails toward the panel on anything it cannot read', () => {
    // The asymmetry the module header states: never a stranger's face.
    for (const bad of [
      null,
      undefined,
      '',
      '   ',
      'not a url',
      '/images/categories/veterans-default.svg',
      'http://insecure.example.com/storage/v1/object/public/media/a.jpg',
      'supabase-private://media/doc.pdf',
      'data:image/png;base64,AAAA',
    ]) {
      expect(isOrganiserPhoto(bad as string | null | undefined), String(bad)).toBe(false);
    }
  });
});

describe('the panel, and what it is called', () => {
  it('⚠️ a panel is NOT captioned with the named person\'s crisis', () => {
    /*
      The same inaccuracy one layer down: a teal graphic described as a
      photograph of a named person in trouble.
    */
    const hero = resolveCampaignHero({
      heroImageUrl: PRODUCTION_STOCK[0],
      category: 'medical',
      title: 'Keisha Wallace Fights to Keep Her Four Kids Off Atlanta Streets',
    });
    expect(hero.alt).toBe('LastDonor Medical campaign');
    expect(hero.alt).not.toContain('Keisha');
  });

  it('an unknown or missing category falls back to community', () => {
    // Variant 2 is what the empty key hashes to; the point here is the
    // CATEGORY half, which is why the variant is the same across all three.
    expect(categoryPanelPath('not-a-real-category')).toBe(
      `/images/categories/${FALLBACK_CATEGORY}-panel-2.webp`,
    );
    expect(categoryPanelPath(null)).toBe(`/images/categories/${FALLBACK_CATEGORY}-panel-2.webp`);
    expect(categoryPanelPath('')).toBe(`/images/categories/${FALLBACK_CATEGORY}-panel-2.webp`);
  });

  it('⛔ EVERY VARIANT of every category this build knows is a FILE on disk', () => {
    /*
      A path that resolves to a 404 is worse than the stock photo it
      replaced: the card renders an empty box. The generator derives its
      category list from the same constant AND imports `PLATE_VARIANTS` from
      the module under test, so neither a 24th category nor a 4th variant can
      be half-introduced - the one that is added first fails here.
    */
    expect(CATEGORY_CONTENT.length).toBeGreaterThan(0);
    expect(PLATE_VARIANTS).toBeGreaterThanOrEqual(1);
    for (const cat of CATEGORY_CONTENT) {
      for (let v = 1; v <= PLATE_VARIANTS; v += 1) {
        const rel = `/images/categories/${cat.slug}-panel-${v}.webp`;
        expect(existsSync(join(process.cwd(), 'public', rel)), `missing plate: ${rel}`).toBe(true);
      }
    }
  });

  it('⛔ the resolver only ever names a path the rule above covers', () => {
    /*
      The on-disk sweep proves the FILES exist; without this, a resolver that
      returned `-panel-9.webp` would sail past it, because that rule never
      asks what the resolver actually produces.
    */
    for (const cat of CATEGORY_CONTENT) {
      for (const title of REAL_TITLES) {
        const rel = categoryPanelPath(cat.slug, title);
        expect(rel, `${cat.slug}/${title}`).toBe(
          `/images/categories/${cat.slug}-panel-${plateVariant(title)}.webp`,
        );
        expect(existsSync(join(process.cwd(), 'public', rel)), `missing plate: ${rel}`).toBe(true);
      }
    }
  });

  it('every category resolves to a real label, so no alt reads "undefined"', () => {
    for (const cat of CATEGORY_CONTENT) {
      const hero = resolveCampaignHero({ heroImageUrl: null, category: cat.slug, title: 'T' });
      expect(hero.alt, cat.slug).toBe(`LastDonor ${CATEGORY_LABELS[cat.slug]} campaign`);
      expect(hero.alt, cat.slug).not.toContain('undefined');
    }
  });
});

describe('⚠️ one campaign keeps ONE plate, and campaigns do not all share it', () => {
  /*
    These two properties pull in opposite directions and both matter.

    STABLE: the same campaign is rendered on its card, its detail page, two
    dashboard lists and the sitemap. If the plate were picked at random, or
    from anything that varies between a server render and a client one, the
    picture would change as a visitor moved around the site. Hence FNV-1a
    over the campaign TITLE - no runtime hash seed, no `Math.random`, no
    `Date`.

    SPREAD: `medical` appears three times on the live listing [VERIFIED
    2026-11-06 by classifying every `<img>` on `/campaigns`], and three
    identical pictures side by side is the defect variants exist to fix.
  */
  it('the same title always resolves to the same plate', () => {
    for (const title of REAL_TITLES) {
      const first = categoryPanelPath('medical', title);
      for (let i = 0; i < 5; i += 1) {
        expect(categoryPanelPath('medical', title), title).toBe(first);
      }
    }
  });

  it('⛔ ANTI-VACUITY: real titles reach every variant, so a constant fails', () => {
    /*
      Without this row, `plateVariant = () => 1` satisfies every other
      assertion in this file - stability, the on-disk sweep, the shape regex.
      The titles are the real production ones, not strings chosen to spread.
    */
    const reached = new Set(REAL_TITLES.map((t) => plateVariant(t)));
    expect(reached.size, `only reached ${[...reached].join(',')}`).toBe(PLATE_VARIANTS);
  });

  it('is in range for anything, including the pathological', () => {
    for (const key of ['', ' ', 'a', '🙂', 'x'.repeat(5000), '\u0000']) {
      const v = plateVariant(key);
      expect(Number.isInteger(v), JSON.stringify(key)).toBe(true);
      expect(v, JSON.stringify(key)).toBeGreaterThanOrEqual(1);
      expect(v, JSON.stringify(key)).toBeLessThanOrEqual(PLATE_VARIANTS);
    }
  });

  it('⚠️ the hash is PINNED, so a "harmless" rewrite cannot reshuffle the site', () => {
    /*
      Changing the hash is not a refactor - every campaign's picture moves at
      once. These are hand-recorded outputs, so an edit to `plateVariant`
      fails here and somebody has to decide that the reshuffle is intended.
    */
    expect(plateVariant('')).toBe(2);
    expect(plateVariant('X')).toBe(3);
    expect(plateVariant('Keisha Wallace Fights to Keep Her Four Kids Off Atlanta Streets')).toBe(1);
    expect(plateVariant('Help John Recover After a Car Accident')).toBe(3);
    expect(plateVariant('Tuan Nguyen Needs Urgent Surgery')).toBe(2);
  });
});

describe('⚠️ the bucket segment is duplicated, so it is pinned', () => {
  it('PUBLIC_MEDIA_PREFIX names the same bucket supabase-storage.ts uploads to', () => {
    /*
      `campaign-hero.ts` cannot import `supabase-storage.ts` - that module
      builds a client and this one is reachable from a client component - so
      the bucket name is written out there and checked against the real
      constant here, read as TEXT to avoid importing the client.
    */
    const src = readFileSync(join(process.cwd(), 'src/lib/supabase-storage.ts'), 'utf8');
    const match = src.match(/export const BUCKET_NAME\s*=\s*'([^']+)'/);
    expect(match, 'BUCKET_NAME moved or changed shape - re-read this test').toBeTruthy();
    expect(PUBLIC_MEDIA_PREFIX).toBe(`/storage/v1/object/public/${match![1]}/`);
  });
});

describe('⛔ an organiser upload is served from OUR domain, never Supabase', () => {
  /*
    The defect this closes: Supabase Storage sends `X-Robots-Tag: none` on
    every public object - Google's own definition of `noindex, nofollow` -
    and `sitemap.ts` advertised exactly those URLs. [VERIFIED live, with our
    own `/images/...` panels returning no such header as the control.]
  */
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://vavxdjqufxrsbyohcwdh.supabase.co');
  });

  it('maps an upload to a first-party path under /media/', () => {
    expect(firstPartyMediaPath(PRODUCTION_UPLOAD)).toBe('/media/campaign-photos/59171bbc-7077-485a-a432-b2546f156690.jpg');
    expect(mediaObjectKey(PRODUCTION_UPLOAD)).toBe('campaign-photos/59171bbc-7077-485a-a432-b2546f156690.jpg');
  });

  it('⚠️ the mapping is TOTAL over what isOrganiserPhoto accepts', () => {
    /*
      Heroes are written to `campaign-photos/`, but `/api/v1/upload` takes a
      caller-supplied folder and the predicate accepts any object under the
      public media prefix. If the mapping only knew one folder, such a hero
      would pass the predicate with NO first-party path and quietly keep the
      Supabase URL - the third case this rules out.
    */
    for (const folder of ['campaign-photos', 'uploads', 'blog', 'deep/nested']) {
      const url = `https://vavxdjqufxrsbyohcwdh.supabase.co/storage/v1/object/public/media/${folder}/a1.jpg`;
      expect(isOrganiserPhoto(url), folder).toBe(true);
      expect(firstPartyMediaPath(url), folder).toBe(`/media/${folder}/a1.jpg`);
      expect(resolveCampaignHero({ heroImageUrl: url, category: 'medical', title: 'T' }).isPanel).toBe(false);
    }
  });

  it('⛔ refuses traversal and the private-document prefixes', () => {
    for (const key of [
      'verification-documents/passport.jpg',
      'info-request-responses/bank.png',
      '../secrets/x.jpg',
      'a//b.jpg',
      '/leading.jpg',
      'no-extension',
    ]) {
      expect(isServableMediaKey(key), key).toBe(false);
    }
    // And a refused key falls through to a PANEL, never to the stored URL.
    const privateUrl =
      'https://vavxdjqufxrsbyohcwdh.supabase.co/storage/v1/object/public/media/verification-documents/p.jpg';
    const hero = resolveCampaignHero({ heroImageUrl: privateUrl, category: 'medical', title: 'T' });
    expect(hero.isPanel).toBe(true);
    expect(hero.src).toMatch(/^\/images\/categories\/medical-panel-[1-3]\.webp$/);
  });

  it('⚠️ CONTROL: a servable key really is servable, so the rule can fail', () => {
    // Without this, `isServableMediaKey` returning false always would pass
    // the row above.
    expect(isServableMediaKey('campaign-photos/59171bbc-7077-485a-a432-b2546f156690.jpg')).toBe(true);
    expect(isServableMediaKey('uploads/a-b_c.webp')).toBe(true);
  });

  it('⛔ the duplicated private-prefix list equals the storage module\'s', async () => {
    /*
      `NEVER_PUBLIC_KEY_PREFIXES` is copied rather than imported, because this
      module is reachable from a client component and `supabase-storage.ts`
      pulls in the Supabase SDK. Copying is only safe while the two agree.
    */
    const { PRIVATE_PATH_PREFIXES } = await import('./supabase-storage');
    expect([...NEVER_PUBLIC_KEY_PREFIXES].sort()).toEqual([...PRIVATE_PATH_PREFIXES].sort());
  });

  it('a non-upload host still yields no first-party path', () => {
    expect(firstPartyMediaPath('https://images.unsplash.com/photo-123?w=800')).toBeNull();
    expect(firstPartyMediaPath(null)).toBeNull();
  });
});
