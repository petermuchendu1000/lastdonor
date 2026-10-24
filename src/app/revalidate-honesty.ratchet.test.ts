/**
 * Ratchet: a page may not claim ISR it cannot get.
 *
 * In Next 15 a page that reads `searchParams` is dynamic - its output depends
 * on the query string, so it is never prerendered and never ISR-cached. An
 * `export const revalidate` on such a page is inert, and inert cache
 * directives are worse than none: they read as a promise that the route is
 * cheap to serve.
 *
 * MEASURED against production 2026-10-24, all ten `revalidate` pages:
 *
 *   reads searchParams  -> private, no-cache, no-store, max-age=0  (4 of 4)
 *   does not            -> s-maxage=300, stale-while-revalidate=.. (5 of 5)
 *   /about (no revalidate, static) -> s-maxage=31536000
 *
 * The correlation was exact, which is what promoted the Next.js rule from
 * documentation to a verified fact about this deployment.
 *
 * Same defect class as the sixteen inert `revalidate` exports docs/88
 * removed from the admin tree, where the admin layout's `force-dynamic`
 * governed the subtree and the exports did nothing.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const APP = join(process.cwd(), 'src/app');

function pageFiles(): string[] {
  return readdirSync(APP, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.endsWith('page.tsx'))
    .map((p) => join(APP, p));
}

type Page = { rel: string; src: string };

function pages(): Page[] {
  return pageFiles().map((path) => ({
    rel: path.replace(process.cwd() + '/', ''),
    src: readFileSync(path, 'utf8'),
  }));
}

/** `export const revalidate = …`, ignoring anything inside a comment. */
function declaresRevalidate(src: string): boolean {
  return /^export const revalidate\s*=/m.test(stripComments(src));
}

function readsSearchParams(src: string): boolean {
  return /\bsearchParams\b/.test(stripComments(src));
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('revalidate honesty', () => {
  const all = pages();

  it('finds the app tree (guards against a vacuous pass)', () => {
    expect(all.length).toBeGreaterThan(30);
    // And finds at least one page that legitimately declares revalidate, so
    // the rule below is exercised rather than trivially satisfied.
    expect(all.filter((p) => declaresRevalidate(p.src)).length).toBeGreaterThan(3);
  });

  it('no page combines `revalidate` with `searchParams`', () => {
    const lying = all
      .filter((p) => declaresRevalidate(p.src) && readsSearchParams(p.src))
      .map((p) => p.rel);
    expect(lying).toEqual([]);
  });

  it('the three pages this was found on still read searchParams and still declare nothing', () => {
    // Pinned by name: if one of them stops reading searchParams it becomes
    // genuinely cacheable and SHOULD get a revalidate back, which is a change
    // worth noticing rather than inheriting.
    for (const rel of [
      'src/app/campaigns/(index)/page.tsx',
      'src/app/blog/(index)/page.tsx',
      'src/app/completed-campaigns/page.tsx',
    ]) {
      const page = all.find((p) => p.rel === rel);
      expect(page, `${rel} not found`).toBeDefined();
      expect(readsSearchParams(page!.src), `${rel} should read searchParams`).toBe(true);
      expect(declaresRevalidate(page!.src), `${rel} must not declare revalidate`).toBe(false);
    }
  });
});
