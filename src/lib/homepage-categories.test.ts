import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATEGORY_CARDS,
  MAX_SHOWCASE_CARDS,
  selectShowcaseCategories,
  type CategoryCount,
} from './homepage-categories';
import { ALL_CATEGORY_SLUGS } from './category-content';

/**
 * The homepage category grid promotes categories that HAVE campaigns.
 *
 * ## The defect this encodes (docs/143 §4, docs/144)
 *
 * `CategoryShowcase` rendered a hand-curated array of eight. Measured against
 * production: `family` and `education` were on it with **0** live campaigns
 * each, so every visitor who pressed them landed on "No active campaigns
 * right now"; while `military` (**3**, tied for the most on the platform) and
 * `essential-needs` (**1**) were on no page of the site at all. That
 * component is the ONLY place in the repo that links
 * `/campaigns/category/*`, so the curated list was the entire internal link
 * graph for 23 URLs.
 *
 * ## Why these rules and not "the output equals this list"
 *
 * Pinning today's eight would be the curated list again, in a test. Every
 * rule below is a PROPERTY of the selection, so it stays true as campaigns
 * are published and withdrawn - and rules 2 and 3 are stated with the exact
 * four categories that were wrong, so the production defect is what fails.
 */

const SRC = join(__dirname, '..');
const SHOWCASE = join(SRC, 'components/homepage/CategoryShowcase.tsx');
const SITEMAP = join(SRC, 'app/sitemap.ts');

/** Production's distribution on 2026-10-29, as the `GROUP BY` returns it. */
const PRODUCTION: CategoryCount[] = [
  { category: 'medical', count: 3 },
  { category: 'military', count: 3 },
  { category: 'veterans', count: 2 },
  { category: 'emergency', count: 2 },
  { category: 'disaster', count: 1 },
  { category: 'memorial', count: 1 },
  { category: 'community', count: 1 },
  { category: 'essential-needs', count: 1 },
];

/** The eight the hand-curated list promoted, for the before/after rules. */
const OLD_CURATION = [
  'medical',
  'emergency',
  'memorial',
  'disaster',
  'family',
  'veterans',
  'education',
  'community',
];

describe('rule 1: every category the enum has can be rendered', () => {
  it('has card metadata for all 23 slugs', () => {
    // The `Record<CampaignCategory, …>` type already forces this at compile
    // time. Asserted at runtime too, because widening the union is not the
    // only way a hole appears - `ALL_CATEGORY_SLUGS` is derived from
    // CATEGORY_CONTENT, which is a different file with its own list.
    expect(ALL_CATEGORY_SLUGS.length).toBe(23);
    const missing = ALL_CATEGORY_SLUGS.filter((s) => !(s in CATEGORY_CARDS));
    expect(missing).toEqual([]);
  });

  it('gives each card a non-empty gloss and an icon', () => {
    for (const slug of ALL_CATEGORY_SLUGS) {
      const meta = CATEGORY_CARDS[slug];
      expect(meta.gloss.length, slug).toBeGreaterThan(3);
      expect(typeof meta.Icon, slug).toBe('function');
    }
  });
});

describe('rule 2: a category with no campaigns is never promoted', () => {
  it('drops the two the curated list promoted while empty', () => {
    /*
      ⚠️ A SHORT tally on purpose. Written first against the full production
      set of eight, this test passed with the zero filter deleted - adding two
      zero-count rows made ten, and `.slice(0, 8)` cut the two zeros off
      because they sort last. The cap was silently standing in for the filter.
      Caught by injection 3; three live categories leave the cap no part to
      play, so only the filter can make this pass.
    */
    const cards = selectShowcaseCategories([
      { category: 'medical', count: 3 },
      { category: 'military', count: 3 },
      { category: 'veterans', count: 2 },
      { category: 'family', count: 0 },
      { category: 'education', count: 0 },
    ]);

    expect(cards.map((c) => c.slug)).toEqual(['medical', 'military', 'veterans']);
    expect(cards.length).toBeLessThan(MAX_SHOWCASE_CARDS);
  });

  it('drops a category absent from the tally entirely', () => {
    // A `GROUP BY` returns no row at all for a category with no campaigns,
    // which is how production actually answers.
    const slugs = selectShowcaseCategories(PRODUCTION).map((c) => c.slug);
    for (const s of ALL_CATEGORY_SLUGS) {
      if (!PRODUCTION.some((p) => p.category === s)) expect(slugs).not.toContain(s);
    }
  });

  it('ignores a negative, non-numeric, null or unknown row rather than throwing', () => {
    const slugs = selectShowcaseCategories([
      ...PRODUCTION,
      { category: 'family', count: -4 },
      { category: 'education', count: Number.NaN },
      { category: null, count: 9 },
      { category: 'not-a-category', count: 9 },
    ]).map((c) => c.slug);

    expect(slugs).not.toContain('family');
    expect(slugs).not.toContain('education');
    expect(slugs).not.toContain('not-a-category');
    expect(slugs.length).toBe(PRODUCTION.length);
  });
});

describe('rule 3: a category WITH campaigns is promoted even if nobody curated it', () => {
  it('promotes military and essential-needs, which were linked from nowhere', () => {
    const slugs = selectShowcaseCategories(PRODUCTION).map((c) => c.slug);
    expect(slugs).toContain('military');
    expect(slugs).toContain('essential-needs');
    // And the pair is genuinely new - the old list had neither.
    expect(OLD_CURATION).not.toContain('military');
    expect(OLD_CURATION).not.toContain('essential-needs');
  });

  it('promotes a category no curated list would ever have guessed', () => {
    // The anti-hardcoding control for rule 3: it must not be satisfied by
    // naming `military` anywhere in the implementation.
    const slugs = selectShowcaseCategories([{ category: 'wishes', count: 1 }]).map((c) => c.slug);
    expect(slugs).toEqual(['wishes']);
  });
});

describe('rule 4: the grid stays inside the height budget docs/60 measured', () => {
  it('never returns more cards than the cap', () => {
    const every = ALL_CATEGORY_SLUGS.map((category, i) => ({ category, count: 23 - i }));
    expect(every.length).toBe(23);
    expect(selectShowcaseCategories(every).length).toBe(MAX_SHOWCASE_CARDS);
  });

  it('keeps the cap at 8', () => {
    // docs/60 measured this grid at eight cards (1,944px for 81 words at one
    // column on a 390px phone, which is why it is two columns). Raising this
    // re-opens that measurement rather than merely showing more.
    expect(MAX_SHOWCASE_CARDS).toBe(8);
  });

  it('takes the BUSIEST categories when it has to choose', () => {
    const every = ALL_CATEGORY_SLUGS.map((category, i) => ({ category, count: 23 - i }));
    const chosen = selectShowcaseCategories(every);
    const counts = chosen.map((c) => c.count);
    expect(counts).toEqual([23, 22, 21, 20, 19, 18, 17, 16]);
  });
});

describe('rule 5: the order is deterministic', () => {
  it('sorts by live campaign count, descending', () => {
    const counts = selectShowcaseCategories(PRODUCTION).map((c) => c.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(counts[0]).toBe(3);
  });

  it('resolves a tie the same way whatever order the database returns rows in', () => {
    // Four production categories sit on one campaign each and `GROUP BY`
    // promises nothing about row order, so without a second key the grid
    // would reshuffle between cache revalidations for no visible reason.
    const shuffled = [...PRODUCTION].reverse();
    const a = selectShowcaseCategories(PRODUCTION).map((c) => c.slug);
    const b = selectShowcaseCategories(shuffled).map((c) => c.slug);
    expect(b).toEqual(a);
  });

  it('reads a bigint count returned as a string', () => {
    // postgres-js hands `COUNT(*)` back as a string. Comparing those with `>`
    // would sort '10' before '9'.
    const asStrings = PRODUCTION.map((p) => ({ category: p.category, count: String(p.count) }));
    expect(selectShowcaseCategories(asStrings).map((c) => c.slug)).toEqual(
      selectShowcaseCategories(PRODUCTION).map((c) => c.slug),
    );
    const mixed = selectShowcaseCategories([
      { category: 'medical', count: '9' },
      { category: 'military', count: '10' },
    ]);
    expect(mixed.map((c) => c.slug)).toEqual(['military', 'medical']);
  });
});

describe('rule 6: the selection is not vacuous', () => {
  it('returns the full production set, labelled from category-content', () => {
    // Without this, `return []` satisfies rules 2, 4 and 5 outright.
    const cards = selectShowcaseCategories(PRODUCTION);
    expect(cards.length).toBe(8);
    expect(cards.map((c) => c.slug).sort()).toEqual(
      PRODUCTION.map((p) => p.category).sort(),
    );
    // Labels come from the category page's own content, never re-typed here,
    // so the grid and the page it links cannot disagree about a name.
    expect(cards.find((c) => c.slug === 'disaster')?.label).toBe('Disaster Relief');
    expect(cards.find((c) => c.slug === 'essential-needs')?.label).toBe('Essential Needs');
  });
});

describe('rule 7: all 23 category URLs stay in the sitemap', () => {
  it('maps ALL_CATEGORY_SLUGS, so promotion and advertisement stay separate', () => {
    /*
      The owner's instruction was explicit: make the grid data-driven AND keep
      the 23 in the sitemap. The obvious tidy-up after this change is to drop
      the empty ones, and that is a different decision - a category page with
      nothing in it today is a real page that fills later, and
      `generateStaticParams` builds all 23.
    */
    const sitemap = readFileSync(SITEMAP, 'utf8');
    expect(sitemap).toContain('ALL_CATEGORY_SLUGS.map(');
    expect(sitemap).toContain('/campaigns/category/${slug}');
    expect(ALL_CATEGORY_SLUGS.length).toBe(23);
  });
});

describe('rule 8: the component carries no list of its own', () => {
  const showcase = readFileSync(SHOWCASE, 'utf8');
  // Comments explain the defect and necessarily name the categories that were
  // wrong, so they are stripped first - docs/116 §4's lesson, where a
  // raw-source sweep reported the fix as the defect.
  const code = showcase.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('builds the href from the data, not from a literal slug', () => {
    expect(code).toContain('/campaigns/category/${slug}');
    for (const slug of ALL_CATEGORY_SLUGS) {
      expect(code, `${slug} is hardcoded in CategoryShowcase`).not.toContain(
        `/campaigns/category/${slug}`,
      );
    }
  });

  it('names no category slug at all', () => {
    const named = ALL_CATEGORY_SLUGS.filter((s) => new RegExp(`['"\`]${s}['"\`]`).test(code));
    expect(named).toEqual([]);
  });

  it('takes its categories as a prop', () => {
    expect(code).toMatch(/categories\s*\}\s*:\s*\{\s*categories:/);
    expect(code).toContain('categories.map(');
  });
});
