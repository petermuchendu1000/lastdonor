/**
 * No route may answer "this does not exist" with HTTP 200.
 *
 * Verified against production 2026-10-17: `/campaigns/<bogus-slug>`
 * returned `HTTP 200` with `x-nextjs-cache: HIT` and
 * `x-nextjs-prerender: 1`, while an unrouted path like `/<bogus>` correctly
 * returned 404. The cause is the combination, not either part:
 *
 *   `export const revalidate = N`  +  `notFound()`
 *
 * With `revalidate` set, the not-found render is written into the ISR entry
 * for that slug and replayed from cache, and a cached entry is served 200
 * regardless of the status the render asked for. The body says "Campaign
 * Not Found" while the response says "here it is" — a soft 404, which
 * search engines index as a thin page rather than dropping.
 *
 * `noStore()` before `notFound()` marks the render dynamic, keeps it out of
 * the ISR entry, and lets the 404 reach the client.
 *
 * This is a structural invariant across routes rather than a behaviour of
 * any one of them, so it is asserted structurally. See docs/80.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const APP = path.resolve(__dirname);

function pages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) pages(full, out);
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

/** Strip comments so prose about `notFound()` is not mistaken for a call. */
function code(file: string) {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const AT_RISK = pages(APP)
  .map((file) => ({ file, src: code(file) }))
  .filter(({ src }) => /^export const revalidate\s*=/m.test(src) && /\bnotFound\(\)/.test(src));

describe('a cached page that can 404', () => {
  it('finds the routes this invariant is about', () => {
    // If this drops to zero the filter has broken, not the codebase.
    expect(AT_RISK.length).toBeGreaterThan(0);
  });

  it.each(AT_RISK.map(({ file }) => path.relative(APP, file)))(
    '%s calls noStore() so its 404 is not cached as a 200',
    (rel) => {
      const { src } = AT_RISK.find(({ file }) => path.relative(APP, file) === rel)!;
      expect(src).toMatch(/\bnoStore\(\)/);
    },
  );

  it.each(AT_RISK.map(({ file }) => path.relative(APP, file)))(
    '%s calls noStore() before every notFound(), not merely somewhere',
    (rel) => {
      const { src } = AT_RISK.find(({ file }) => path.relative(APP, file) === rel)!;
      // Every notFound() must have a noStore() earlier in the file. That is
      // weaker than proving control flow, and strong enough to catch the
      // regression this exists for: a new notFound() added without one.
      const firstNoStore = src.indexOf('noStore()');
      const firstNotFound = src.indexOf('notFound()');
      expect(firstNoStore).toBeGreaterThanOrEqual(0);
      expect(firstNoStore).toBeLessThan(firstNotFound);
    },
  );
});
