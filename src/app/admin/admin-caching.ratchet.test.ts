import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
  docs/88 F14. Caching for /admin is decided once, in the layout's
  `dynamic = 'force-dynamic'`. Sixteen pages carried their own
  `revalidate` and all sixteen were dead, because a layout's
  force-dynamic sets revalidate to 0 for everything beneath it.

  A dead directive is worse than none: the next reader assumes the
  screen is cached for 60s and reasons about staleness that cannot
  happen - or, worse, deletes the layout's force-dynamic believing the
  pages carry their own caching, at which point four pages that never
  call `auth()` really would start serving cached operator data.
*/

const ADMIN = join(process.cwd(), 'src/app/admin');

function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...pagesUnder(full));
    else if (entry === 'page.tsx' || entry === 'layout.tsx') out.push(full);
  }
  return out;
}

describe('admin caching is decided in one place (docs/88 F14)', () => {
  const files = pagesUnder(ADMIN);

  it('finds the admin pages', () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  it('no admin page exports revalidate', () => {
    const offenders = files
      .filter((f) => f.endsWith('page.tsx'))
      .filter((f) => /^\s*export const revalidate\b/m.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(process.cwd().length + 1));

    expect(offenders).toEqual([]);
  });

  it('the admin layout is force-dynamic', () => {
    const src = readFileSync(join(ADMIN, 'layout.tsx'), 'utf8');
    expect(src).toMatch(/export const dynamic = 'force-dynamic'/);
  });

  it('the four pages that never call auth() still sit under that layout', () => {
    // They rely on the layout alone. If one is ever moved out of
    // /admin, it needs its own guard before it is moved.
    for (const rel of ['blog/page.tsx', 'blog/topics/page.tsx', 'monitoring/page.tsx', 'news-feed/page.tsx']) {
      const src = readFileSync(join(ADMIN, rel), 'utf8');
      expect(src).not.toMatch(/export const revalidate\b/);
    }
  });
});
