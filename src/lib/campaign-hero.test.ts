/**
 * Which image stands in for a campaign, and whether it can ever be a
 * photograph of somebody else.
 *
 * The fixtures here are REAL PRODUCTION VALUES, read off the live
 * `/campaigns` listing on 2026-11-04. That is the point: the rule is checked
 * against the rows that were actually wrong, not against invented ones.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isOrganiserPhoto,
  categoryPanelPath,
  resolveCampaignHero,
  PUBLIC_MEDIA_PREFIX,
  FALLBACK_CATEGORY,
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
      expect(hero.src, url).toBe('/images/categories/medical-panel.webp');
    }
  });

  it('⚠️ CONTROL: an organiser\'s own upload passes through untouched', () => {
    /*
      Without this, "always return a panel" would satisfy every other
      assertion in this file, and the two campaigns with a real photograph
      would silently lose it.
    */
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://vavxdjqufxrsbyohcwdh.supabase.co');
    expect(isOrganiserPhoto(PRODUCTION_UPLOAD)).toBe(true);

    const hero = resolveCampaignHero({
      heroImageUrl: PRODUCTION_UPLOAD,
      category: 'medical',
      title: 'Help John Recover After a Car Accident',
    });
    expect(hero.isPanel).toBe(false);
    expect(hero.src).toBe(PRODUCTION_UPLOAD);
    expect(hero.alt).toBe('Help John Recover After a Car Accident');
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
    expect(categoryPanelPath('not-a-real-category')).toBe(
      `/images/categories/${FALLBACK_CATEGORY}-panel.webp`,
    );
    expect(categoryPanelPath(null)).toBe(`/images/categories/${FALLBACK_CATEGORY}-panel.webp`);
    expect(categoryPanelPath('')).toBe(`/images/categories/${FALLBACK_CATEGORY}-panel.webp`);
  });

  it('⛔ every category this build knows has a panel FILE on disk', () => {
    /*
      A path that resolves to a 404 is worse than the stock photo it
      replaced: the card renders an empty box. The generator derives its
      list from the same constant, so a 24th category fails here until it
      is generated.
    */
    expect(CATEGORY_CONTENT.length).toBeGreaterThan(0);
    for (const cat of CATEGORY_CONTENT) {
      const rel = categoryPanelPath(cat.slug);
      expect(rel, cat.slug).toBe(`/images/categories/${cat.slug}-panel.webp`);
      expect(existsSync(join(process.cwd(), 'public', rel)), `missing panel: ${rel}`).toBe(true);
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
