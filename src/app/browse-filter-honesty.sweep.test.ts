/**
 * A public surface that narrows a list by a caller-supplied category must
 * REPORT a value it could not apply.
 *
 * ── WHY A SWEEP AND NOT A THIRD ASSERTION ─────────────────────────────────
 *
 * `src/app/campaigns/browse-params.ts` has stated this in its own header
 * since `docs/45`: *"The rule for a value we cannot apply is: never silently
 * widen the result set. An unapplied value is reported to the visitor and the
 * listing is shown deliberately unfiltered on that dimension, rather than
 * being dropped in silence (which reads as 'all 12 of these match your
 * filter')."*
 *
 * It was enforced on `/campaigns`, where it was written. Then:
 *
 *   `docs/164`  `/blog` and `GET /api/v1/blog` had the same defect.
 *   `docs/165`  `/completed-campaigns` had it too - and worse, it carried its
 *               own copy of the 23 categories with NO alias resolution, so
 *               [VERIFIED live] `?category=disaster-relief` returned 1 card
 *               on `/campaigns` and 12 here.
 *
 * Three instances of one rule is a sweep, not a third per-surface test
 * (`docs/110` §9.2). So this discovers the surfaces from disk.
 *
 * ── GATE 4: THE DISCOVERY WAS WRONG FIRST ─────────────────────────────────
 *
 * ⚠️ The first pattern matched `params.category` and
 * `searchParams.get('category')` - and MISSED `/campaigns`, the reference
 * implementation, because it resolves everything through
 * `resolveBrowseParams(params)` and never names the field. A sweep that
 * cannot see the known-good surface is not evidence about the others, so
 * `resolveBrowseParams(` is part of the discovery.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(__dirname);

/** Resolvers that read a caller-supplied category. */
const RESOLVES =
  /params\.category|searchParams\.get\('category'\)|resolveBrowseParams\(/;

/**
 * Mechanisms that actually TELL the caller the value was not applied.
 *
 * ⚠️ MY FIRST VERSION WAS
 *   `/FilterNotice|unappliedCategoryNotice|unappliedCategory|unapplied/`
 * and injection row 2 did not fire against it, two ways at once:
 *
 *   - `FilterNotice` matched `<FilterNoticeDisabled` as a SUBSTRING. That is
 *     `docs/149` §5.1's trap exactly (`/<LocalAmount/` matching
 *     `<LocalAmountXX`), written the day after reading it.
 *   - bare `unapplied` matched the local VARIABLE DECLARATION, so a surface
 *     that computes the list and never renders it would pass - which is
 *     `docs/119`'s `_hasCampaigns` shape, i.e. the defect class itself.
 *
 * So each pattern now requires a RENDER or a CALL, with word boundaries.
 */
const REPORTS_PATTERNS: readonly RegExp[] = [
  /<FilterNotice[\s/>]/, //            rendered as an element
  /unappliedCategoryNotice\s*\(/, //   called (the /blog page)
  /unappliedCategory\s*:/, //          put in a response body (the blog API)
];

function reports(code: string): boolean {
  return REPORTS_PATTERNS.some((re) => re.test(code));
}

/**
 * Surfaces that resolve a category and deliberately report nothing.
 *
 * ⛔ Each needs a reason, and the reason may not be "it is an API": the blog
 * API reports through `meta.unappliedCategory` (`docs/164`), so being an API
 * is not an excuse by itself.
 */
const NO_REPORT_REASON: Record<string, string> = {
  'api/v1/campaigns/route.ts':
    'the continuation of /campaigns\' own list, called by CampaignGrid\'s "Load more". The PAGE already reported the value and is showing an unfiltered list, so returning more unfiltered rows is consistent with what the visitor was told. Reporting here would put a notice in a JSON payload nothing renders.',
  'api/v1/search/route.ts':
    '[VERIFIED] no consumer anywhere in src/ outside its own tests, so there is no surface on which a notice could appear. If something starts calling it, it needs the blog API\'s treatment.',
  'campaigns/browse-params.ts':
    'the resolver module itself - it PRODUCES the unapplied list that the others render.',
};

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

/** Staff screens are out of scope: `docs/110` §4, two audiences. */
const NOT_PUBLIC = ['admin', 'dashboard', 'api/v1/admin'];

function surfaces(): { rel: string; code: string }[] {
  const out: { rel: string; code: string }[] = [];
  for (const f of sourceFiles(APP)) {
    const rel = f.slice(APP.length + 1).split('\\').join('/');
    if (NOT_PUBLIC.some((p) => rel.startsWith(p))) continue;
    const code = strip(readFileSync(f, 'utf8'));
    if (RESOLVES.test(code)) out.push({ rel, code });
  }
  return out;
}

describe('browse filter honesty, swept across every public surface', () => {
  const SURFACES = surfaces();

  it('ANTI-VACUITY: the sweep finds the surfaces, including the reference one', () => {
    const names = SURFACES.map((s) => s.rel);
    expect(names.length).toBeGreaterThanOrEqual(5);
    // The three PAGES a visitor browses.
    expect(names).toContain('campaigns/(index)/page.tsx');
    expect(names).toContain('blog/(index)/page.tsx');
    expect(names).toContain('completed-campaigns/page.tsx');
  });

  it('⛔ every surface either REPORTS an unapplied value or is named with a reason', () => {
    const silent = SURFACES.filter(
      ({ rel, code }) => !reports(code) && !NO_REPORT_REASON[rel],
    ).map(({ rel }) => rel);

    expect(silent).toEqual([]);
  });

  it('⛔ the three browse PAGES are not in the reason list', () => {
    /*
      Without this, the rule above is satisfiable by adding every offender to
      `NO_REPORT_REASON` - which is how an allowlist becomes the hole it was
      meant to close (`docs/152`). A page a visitor browses must report.
    */
    for (const page of [
      'campaigns/(index)/page.tsx',
      'blog/(index)/page.tsx',
      'completed-campaigns/page.tsx',
    ]) {
      expect(NO_REPORT_REASON[page], `${page} may not be excused`).toBeUndefined();
      const surface = SURFACES.find((s) => s.rel === page);
      expect(surface, `${page} is no longer discovered`).toBeTruthy();
      expect(reports(surface!.code), `${page} does not report`).toBe(true);
    }
  });

  it('⛔ no browse surface keeps its own copy of the category list', () => {
    /*
      `/completed-campaigns` held a 23-entry `CampaignCategory[]` of its own,
      which is how it came to lack the ALIAS table `/campaigns` has - the
      product's menu DISPLAYS "Disaster Relief" while the link carries
      `?category=disaster`, so a visitor who types the displayed slug was
      guessing the product's own string. One list, one resolver.
    */
    const offenders = SURFACES.filter(({ code }) =>
      /'medical'\s*,\s*'memorial'|'memorial'\s*,\s*'emergency'/.test(code),
    ).map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it('ANTI-VACUITY: the report patterns require a RENDER, not a mention', () => {
    /*
      The two failures injection row 2 found, pinned so they cannot return.
    */
    expect(reports('      <FilterNotice unapplied={unapplied} />')).toBe(true);
    // A renamed element is NOT a report (the substring trap).
    expect(reports('      <FilterNoticeDisabled unapplied={unapplied} />')).toBe(false);
    // Computing the list and dropping it is NOT a report.
    expect(reports('const unapplied: UnappliedParam[] = []; unapplied.push(x);')).toBe(false);
    // The other two mechanisms, as calls / response fields.
    expect(reports('{unappliedCategoryNotice(resolved.raw)}')).toBe(true);
    expect(reports('? { unappliedCategory: resolved.raw }')).toBe(true);
    expect(reports('// unappliedCategoryNotice is imported but never called')).toBe(false);
  });

  it('CONTROL: a reason is prose, not a placeholder', () => {
    // An entry whose "reason" is empty would pass rule 2 while explaining
    // nothing to the next reader.
    for (const [rel, reason] of Object.entries(NO_REPORT_REASON)) {
      expect(reason.length, `${rel} has no real reason`).toBeGreaterThan(40);
    }
  });

  it('CONTROL: the reason list describes reality', () => {
    // A stale entry reads as a decision somebody took. Every named file must
    // still exist and must still be discovered by the sweep.
    const names = SURFACES.map((s) => s.rel);
    for (const rel of Object.keys(NO_REPORT_REASON)) {
      expect(names, `${rel} is named but no longer a browse surface`).toContain(rel);
    }
  });
});
