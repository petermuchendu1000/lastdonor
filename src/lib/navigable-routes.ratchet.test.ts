/**
 * `ROUTE_PATTERNS` must say exactly what `src/app/` serves.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * `Breadcrumbs` is a client component with nothing but `usePathname()`, so the
 * only way it can know whether a crumb's href resolves to a page is to carry
 * the list. A carried list rots - `docs/119` is the lesson, where a
 * hand-written set of sealed regions named four and missed the fifth.
 *
 * So the list is DERIVED here, from disk, and compared. Nobody has to remember
 * to update it: delete a route and this fails; add one and this fails.
 *
 * ⛔ Note what this is NOT. It does not check that a route serves a 200 for a
 * given row - a page can exist and `notFound()`, or redirect somebody without
 * the role. `docs/118`'s `hasPublicPage` owns that question for campaigns.
 * This owns "is there a page here at all", which is the only claim a
 * breadcrumb makes.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ROUTE_PATTERNS, UNSERVED_PREFIXES, isNavigablePath } from './navigable-routes';

const APP = resolve(__dirname, '../app');

/** A Next route group - `(home)`, `(index)` - contributes no URL segment. */
const GROUP = /^\(.*\)$/;

/** Walk `src/app` and return every route that has a page, as a URL pattern. */
function patternsFromDisk(dir: string = APP, segs: string[] = []): string[] {
  const entries = readdirSync(dir);
  const out: string[] = [];

  if (entries.includes('page.tsx') || entries.includes('page.ts')) {
    out.push('/' + segs.map((s) => (s.startsWith('[') ? '*' : s)).join('/'));
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    // `/api/**` are route handlers, never pages, and never breadcrumbed.
    if (segs.length === 0 && entry === 'api') continue;
    out.push(...patternsFromDisk(full, GROUP.test(entry) ? segs : [...segs, entry]));
  }
  return out;
}

const onDisk = [...new Set(patternsFromDisk())].sort();

describe('⛔ the carried list matches the routes that exist', () => {
  it('⚠️ the control: the sweep found a believable number of routes', () => {
    /*
      Both assertions below are comparisons, and two empty lists compare
      equal. Without this, breaking `patternsFromDisk` would turn the file
      green - the `docs/123` mistake, a rule that never checked its own input.
    */
    expect(onDisk.length).toBeGreaterThan(50);
    expect(onDisk).toContain('/');
    expect(onDisk).toContain('/campaigns/category/*');
    expect(onDisk).toContain('/admin/blog/*/edit');
  });

  it('every route on disk is in ROUTE_PATTERNS', () => {
    const missing = onDisk.filter((p) => !ROUTE_PATTERNS.includes(p));
    expect(
      missing,
      `add these to src/lib/navigable-routes.ts:\n${missing.map((m) => `  '${m}',`).join('\n')}`,
    ).toEqual([]);
  });

  it('every entry in ROUTE_PATTERNS still exists on disk', () => {
    const stale = ROUTE_PATTERNS.filter((p) => !onDisk.includes(p));
    expect(
      stale,
      `these routes are gone - remove them from src/lib/navigable-routes.ts:\n${stale.map((m) => `  '${m}',`).join('\n')}`,
    ).toEqual([]);
  });
});

describe('⛔ the ancestors a breadcrumb would link', () => {
  /**
   * Every path prefix a breadcrumb renders as a link, for every route that
   * exists. This is the exact set `Breadcrumbs` tests with `isNavigablePath`.
   */
  function ancestorsOf(pattern: string): string[] {
    const segs = pattern.split('/').filter(Boolean);
    return segs.slice(0, -1).map((_, i) => '/' + segs.slice(0, i + 1).join('/'));
  }

  /**
   * Every ancestor pattern a breadcrumb would build that has NO page.
   *
   * ⛔ Derived from DISK, never from `isNavigablePath`. The first version of
   * this test computed the set by calling that function - which reads
   * `UNSERVED_PREFIXES` - so the list validated itself and the check could
   * not fail. Gate 4: a verification that passes because it asked the thing
   * it is verifying is not a verification.
   */
  const unservedOnDisk = [
    ...new Set(onDisk.flatMap(ancestorsOf).filter((a) => !onDisk.includes(a))),
  ].sort();

  it('⚠️ some ancestor really is missing, or this file proves nothing', () => {
    /*
      THE CONTROL THAT MATTERS. The rule is "an unserved ancestor is not
      linked"; with no unserved ancestor it would be vacuously true forever.
      Five exist (`docs/128`), four of them live.
    */
    expect(unservedOnDisk.length).toBeGreaterThan(0);
  });

  it('UNSERVED_PREFIXES is exactly what the route tree implies', () => {
    const missing = unservedOnDisk.filter((p) => !UNSERVED_PREFIXES.includes(p));
    const stale = UNSERVED_PREFIXES.filter((p) => !unservedOnDisk.includes(p));
    expect(
      { missing, stale },
      'src/lib/navigable-routes.ts UNSERVED_PREFIXES has drifted from src/app/.\n' +
        `add:    ${JSON.stringify(missing)}\n` +
        `remove: ${JSON.stringify(stale)}`,
    ).toEqual({ missing: [], stale: [] });
  });

  it('⛔ and every one of them is refused by the predicate', () => {
    // The two ends meet here: derived from disk on one side, read from the
    // module on the other (`docs/109`).
    for (const pattern of unservedOnDisk) {
      const concrete = pattern.replace(/\*/g, 'd7fcb01f-468a-49e1-848f-bee7377a35ea');
      expect(isNavigablePath(concrete), `${concrete} must not be linked`).toBe(false);
    }
  });

  it('an ancestor that IS served is still reported navigable', () => {
    // Without this, `isNavigablePath` returning false for everything would
    // satisfy the rule by linking nothing at all.
    expect(isNavigablePath('/campaigns')).toBe(true);
    expect(isNavigablePath('/admin')).toBe(true);
    expect(isNavigablePath('/admin/campaigns')).toBe(true);
    expect(isNavigablePath('/')).toBe(true);
  });

  it('⚠️ a wildcard matches exactly one segment', () => {
    // `/admin/users/*` must not swallow a deeper path and report it served.
    expect(isNavigablePath('/admin/users/abc')).toBe(true);
    expect(isNavigablePath('/admin/users/abc/def')).toBe(false);
  });

  it('the four live offenders are each reported unserved', () => {
    for (const p of [
      '/campaigns/category',
      '/admin/blog/e2e00000-0000-4000-8000-00000000000b',
      '/admin/campaigns/d7fcb01f-468a-49e1-848f-bee7377a35ea/updates',
      '/admin/institutions/24238a27-c16d-4f4c-99e7-4274a3b16d9e',
    ]) {
      expect(isNavigablePath(p), `${p} must not be linked`).toBe(false);
    }
  });
});
