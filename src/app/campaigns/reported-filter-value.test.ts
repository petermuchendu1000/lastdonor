/**
 * A filter value we quote back to the visitor is capped, wraps, and never
 * reaches the canonical.
 *
 * ── WHAT WENT WRONG ───────────────────────────────────────────────────────
 *
 * `docs/45`'s rule is that an unapplied filter value is REPORTED rather than
 * dropped, so three public pages render a string a stranger put in the URL.
 * Measured on production v171 at 390px with a 500-character value:
 *
 *   /campaigns            no cap    4,520px of horizontal overflow
 *   /completed-campaigns  cap 60      239px
 *   /blog                 cap 40       36px
 *   /campaigns  short value                0px   <- control
 *   /campaigns  no param                   0px   <- control
 *
 * ⛔ So a cap alone is NOT the fix, and the two caps written in `docs/164`
 * and `docs/165` were half-fixes. Both halves are needed: one shared cap, and
 * `wrap-anywhere` where it is rendered.
 *
 * ⛔ And separately, the page asked to be INDEXED under that value:
 * [VERIFIED live] `/campaigns?category=garbage-not-real` answered
 * `index, follow` with a canonical pointing at itself, over the UNFILTERED
 * listing — so any string mints another indexable URL on this domain. The
 * canonical is now built from resolved params only.
 *
 * ── WHY THE RULES ARE SHAPED THIS WAY ─────────────────────────────────────
 *
 * The caps and the canonical are EXECUTED, never read. A text rule cannot see
 * which way a branch points (`docs/162` §5.1), and "the canonical drops the
 * raw value" is trivially satisfiable by dropping it from the page links too
 * — which would delete the notice on page 2. `campaignsPageHref` keeping the
 * raw value is therefore a CONTROL, not an oversight.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_REPORTED_VALUE_LENGTH,
  TRUNCATION_MARK,
  reportedValue,
} from '@/lib/reported-value';
import {
  CATEGORY_ALIASES,
  VALID_CATEGORIES,
  campaignsCanonicalHref,
  campaignsPageHref,
  resolveBrowseParams,
} from './browse-params';
import { unappliedCategoryNotice } from '@/lib/blog-categories';
import { CAMPAIGN_CATEGORIES } from '@/lib/categories';

const LONG = 'A'.repeat(500);

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

/**
 * ⛔ COMMENTS STRIPPED FIRST, and this is not hygiene.
 *
 * The first version of the wrap rules searched the WHOLE FILE for
 * `wrap-anywhere` — and the comment explaining why it is load-bearing quotes
 * it, so three injections that DELETED the class from the markup passed.
 * `docs/116` §4 states the rule ("the comment explaining the fix necessarily
 * quotes the forbidden string, so strip comments first") and `docs/165` §3
 * the sibling one (a mention is not a render). Both were read before this
 * file was written, and the harness caught it anyway.
 */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');
}

describe('EXECUTED: the cap', () => {
  it('⛔ caps and marks a long value', () => {
    const out = reportedValue(LONG);
    expect(out.length).toBe(MAX_REPORTED_VALUE_LENGTH + TRUNCATION_MARK.length);
    expect(out.endsWith(TRUNCATION_MARK)).toBe(true);
  });

  it('⛔ CONTROL: a short value is returned whole and unmarked', () => {
    // Without this, "cap everything to nothing" would satisfy the rule above.
    expect(reportedValue('garbage-not-real')).toBe('garbage-not-real');
    expect(reportedValue('  spaced  ')).toBe('spaced');
    expect(reportedValue('   ')).toBe('');
  });

  it('⛔ the cap EXCEEDS the longest value any surface could recognise', () => {
    /*
      DERIVED, not restated. If the cap were below a real category, a visitor
      who typed something nearly right would be shown their own near-miss
      truncated and could not see what they got wrong. The longest today is
      `first-responders` at 16.
    */
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const recognisable = [
      ...VALID_CATEGORIES,
      ...CAMPAIGN_CATEGORIES.map((c) => slug(c.label)),
      ...Object.keys(CATEGORY_ALIASES),
    ];
    const longest = Math.max(...recognisable.map((s) => s.length));
    expect(longest).toBeGreaterThan(0);
    expect(MAX_REPORTED_VALUE_LENGTH).toBeGreaterThan(longest);
  });
});

describe('EXECUTED: every reported value is capped', () => {
  it('⛔ /campaigns caps category, sort and status', () => {
    const { unapplied } = resolveBrowseParams({ category: LONG, sort: LONG, status: LONG });
    expect(unapplied).toHaveLength(3);
    for (const p of unapplied) {
      expect(p.value.length, `${p.key} was not capped`).toBeLessThanOrEqual(
        MAX_REPORTED_VALUE_LENGTH + TRUNCATION_MARK.length,
      );
    }
  });

  it('⛔ CONTROL: a recognised value produces NO report at all', () => {
    // "cap it" must not be satisfiable by reporting everything.
    const { unapplied, category } = resolveBrowseParams({ category: 'medical' });
    expect(category).toBe('medical');
    expect(unapplied).toHaveLength(0);
  });

  it('⛔ the blog notice caps too', () => {
    const notice = unappliedCategoryNotice(LONG);
    expect(notice).toContain(TRUNCATION_MARK);
    expect(notice.length).toBeLessThan(140);
    // CONTROL: a short value is quoted whole.
    expect(unappliedCategoryNotice('news-ish')).toContain('“news-ish”');
  });

  it('⛔ /completed-campaigns does not keep a cap of its own', () => {
    /*
      It used to carry `.slice(0, 60)` while `/blog` carried 40 and
      `/campaigns` nothing — three implementations of one rule. This reads
      source because the page is a server component no test can call.
    */
    const src = read('src/app/completed-campaigns/page.tsx');
    expect(src).toMatch(/reportedValue\s*\(/);
    const pushes = src.match(/unapplied\.push\([^)]*\)/g) ?? [];
    expect(pushes.length, 'expected two unapplied pushes').toBe(2);
    for (const p of pushes) {
      expect(p, `a push bypasses the shared cap: ${p}`).toContain('reportedValue(');
    }
  });
});

describe('EXECUTED: the canonical cannot carry an unapplied value', () => {
  it('⛔ an unrecognised category canonicalises to the bare listing', () => {
    const resolved = resolveBrowseParams({ category: 'garbage-not-real' });
    expect(resolved.unapplied).toHaveLength(1); // it IS still reported
    expect(campaignsCanonicalHref(resolved, 1)).toBe('/campaigns');
  });

  it('⛔ CONTROL: `campaignsPageHref` still CARRIES it', () => {
    /*
      THE ANTI-VACUITY ROW. Dropping the raw value everywhere would satisfy
      the rule above and delete the "not applied" notice on page 2, silently
      showing a different result set than page 1. The two functions must
      disagree, and that disagreement is the design.
    */
    const href = campaignsPageHref({ category: 'garbage-not-real' }, 2);
    expect(href).toContain('category=garbage-not-real');
    expect(href).toContain('page=2');
  });

  it('⛔ an applied filter IS kept, or the canonical would lie the other way', () => {
    const resolved = resolveBrowseParams({ category: 'medical', q: 'cancer' });
    const href = campaignsCanonicalHref(resolved, 1);
    expect(href).toContain('category=medical');
    expect(href).toContain('q=cancer');
  });

  it('⛔ an alias and its enum value give ONE canonical', () => {
    const alias = Object.keys(CATEGORY_ALIASES)[0];
    expect(alias, 'no alias exists - this rule needs rewriting').toBeTruthy();
    const target = CATEGORY_ALIASES[alias];
    expect(campaignsCanonicalHref(resolveBrowseParams({ category: alias }), 1)).toBe(
      campaignsCanonicalHref(resolveBrowseParams({ category: target }), 1),
    );
  });

  it('⚠️ a no-op param is absent, and page 1 carries no page param', () => {
    // `status` never changes this listing, and the default sort is the bare URL.
    expect(campaignsCanonicalHref(resolveBrowseParams({ status: 'active' }), 1)).toBe('/campaigns');
    expect(campaignsCanonicalHref(resolveBrowseParams({ sort: 'most_funded' }), 1)).toBe(
      '/campaigns',
    );
    expect(campaignsCanonicalHref(resolveBrowseParams({ sort: 'newest' }), 1)).toBe(
      '/campaigns?sort=newest',
    );
    expect(campaignsCanonicalHref(resolveBrowseParams({}), 2)).toBe('/campaigns?page=2');
  });

  it('⛔ the page WIRES the resolved canonical, not the raw one', () => {
    const src = read('src/app/campaigns/(index)/page.tsx');
    const meta = src.slice(
      src.indexOf('export async function generateMetadata'),
      src.indexOf('const metadata: Metadata'),
    );
    expect(meta.length, 'generateMetadata not found').toBeGreaterThan(120);
    const code = meta.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
    expect(code, 'the canonical is not built from resolved params').toMatch(
      /campaignsCanonicalHref\s*\(/,
    );
    expect(code, 'the canonical still uses the RAW page href').not.toMatch(
      /canonical[^\n]*campaignsPageHref/,
    );
  });
});

describe('the reported value is allowed to WRAP', () => {
  /*
    A cap bounds the damage and does not remove it: the capped 60 on
    `/completed-campaigns` still overflowed a phone by 239px and the capped 40
    on `/blog` by 36px. A flex item defaults to `min-width: auto`, so one
    unbroken word sets the row's minimum.

    ⚠️ `wrap-anywhere` (`overflow-wrap: anywhere`), NOT `break-words`
    (`overflow-wrap: break-word`): only the former contributes to min-content
    sizing, which is what the flex parent reads.
  */
  const SURFACES = [
    'src/app/campaigns/filter-notice.tsx',
    'src/app/blog/(index)/page.tsx',
  ] as const;

  it.each(SURFACES)('⛔ %s lets the quoted value wrap', (rel) => {
    expect(code(rel), 'no wrap-anywhere in the MARKUP of the surface quoting the URL').toMatch(
      /wrap-anywhere/,
    );
  });

  it('⛔ the flex notice also clears `min-width: auto`', () => {
    const src = code('src/app/campaigns/filter-notice.tsx');
    expect(src).toMatch(/sm:flex-row/); // the premise: it IS a flex row
    expect(src, 'the flex child can still be sized by its longest word').toMatch(/min-w-0/);
  });

  /*
    The SIBLING DEFECT, found while verifying the fix above.

    `q` and `location` are free text, so there is no such thing as an
    unrecognised value and nothing is reported — but they are echoed into an
    active-filter CHIP, and `freeText` caps them at 100, which is not short.
    [VERIFIED live at 390px] an unbroken 100-character `?q=` made that button
    **898px** wide and slid the page **524px**; `?location=` 532px; a short
    value and no param both 0px as the controls.

    ⛔ A chip TRUNCATES rather than wrapping — a five-line pill is not a chip,
    and the full value is still in the search input above it.
  */
  const CHIP_FILES = [
    'src/app/campaigns/filters.tsx',
    'src/app/completed-campaigns/filters.tsx',
  ] as const;

  it.each(CHIP_FILES)('⛔ %s bounds the free-text chips', (rel) => {
    const buttons = code(rel).match(/<button\b[\s\S]*?<\/button>/g) ?? [];
    const chips = buttons.filter((b) => /\{searchQuery\}|\{activeLocation\}/.test(b));
    expect(chips.length, `expected two free-text chips in ${rel}`).toBe(2);
    for (const chip of chips) {
      expect(chip, `a chip can outgrow its parent: ${rel}`).toContain('max-w-full');
      expect(chip, `a chip does not truncate its value: ${rel}`).toContain('truncate');
      expect(chip, `a truncating flex child needs min-w-0: ${rel}`).toContain('min-w-0');
    }
  });

  it('ANTI-VACUITY: comments really are stripped, and the files are real', () => {
    /*
      THE ROW THAT CAUGHT THE HOLE. Each of these files carries a comment
      MENTIONING the class it must apply, so a whole-file search passes
      against markup that no longer has it. If this stripping ever stops
      working, the three rules above go vacuous silently.
    */
    for (const rel of SURFACES) {
      const raw = read(rel);
      expect(raw.length, rel).toBeGreaterThan(1500);
      expect(raw, rel).toMatch(/role="status"/);
      expect(
        raw.length - code(rel).length,
        `${rel}: no comment was stripped - the stripper is not working`,
      ).toBeGreaterThan(200);
    }
  });
});
