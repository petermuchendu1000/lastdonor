/**
 * Every public, indexable page must be advertised in the sitemap.
 *
 * `staticPages` in `src/app/sitemap.ts` is a HAND-WRITTEN list, and nothing
 * compared it to the pages that actually exist. On 2026-11-05 that list was
 * missing `/newsletter`: a real 318-word page answering 200 with
 * `index, follow` and a self-referencing canonical, linked from the footer on
 * every page - Google's own Links report counted **36 internal links to it,
 * tied with the homepage as the most-linked page on the site** - and absent
 * from `/sitemap.xml` since it was added on 2026-10-29.
 *
 * Nothing failed. A page was added and whoever added it did not also edit a
 * list in another file. That is the shape recorded in `docs/119` (a hand-kept
 * nav list), `docs/124` (a hand-kept scrub list), `docs/144` (a hand-curated
 * category grid) and `docs/146` - four times, which is what makes it a class
 * rather than an oversight.
 *
 * ── Why this test EXECUTES the route instead of reading it ──────────────
 *
 * The advertised set comes from calling the real default export against an
 * empty fake database. With zero campaigns `advertisedCategorySlugs` returns
 * nothing (the tally is KNOWN and every category is empty), so what comes back
 * is exactly the static section. A test that regex-matched the array literal
 * would pass against a `staticPages` the route no longer returns - the lesson
 * `docs/162` §5.1 paid for and `docs/164` repeated.
 *
 * ── Why the candidate set needs no hand-written exclusion list ──────────
 *
 * A route is a candidate unless one of two things is true, and both are read
 * from the code that already decides them:
 *
 *   1. It sits under a prefix `robots.ts` disallows (`PRIVATE_PATHS`). Those
 *      are uncrawlable, so advertising one would be the contradiction
 *      `campaign-visibility.ts` names.
 *   2. Its own `page.tsx`, or any ancestor `layout.tsx`, declares
 *      `robots: { index: false }`. Three routes inherit it from a layout
 *      (`/login`, `/login/reset-password`, `/register`), so checking the page
 *      file alone would report correct code as broken.
 *
 * [VERIFIED 2026-11-05 against the live site] that predicate reproduces the
 * live measurement exactly: all 76 static routes were fetched from
 * production, and the 8 served with a `noindex` robots meta are precisely the
 * 8 this detector flags among 200-answering routes - **zero false positives**.
 * The remaining 48 redirect behind auth; 42 of them also declare noindex, and
 * the 6 that do not are all under `/admin` or `/dashboard`, which rule 1
 * removes.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
        then: (f: (v: unknown[]) => unknown) => Promise.resolve([]).then(f),
      }),
    }),
  },
}));

const APP_DIR = join(process.cwd(), 'src/app');
const BASE_URL = 'https://lastdonor.org';

/** `robots.ts` decides what is crawlable; read its list rather than retyping it. */
function disallowedPrefixes(): string[] {
  const src = readFileSync(join(APP_DIR, 'robots.ts'), 'utf8');
  const match = src.match(/const PRIVATE_PATHS\s*=\s*\[([^\]]*)\]/);
  if (!match) throw new Error('PRIVATE_PATHS not found in robots.ts');
  return [...match[1].matchAll(/'([^']+)'/g)]
    .map((m) => m[1])
    .filter((p) => p !== '/api/'); // `/api/` holds route handlers, not pages
}

/** Every `page.tsx` under `src/app`, excluding API route handlers. */
function pageFiles(dir = APP_DIR): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'api') out.push(...pageFiles(full));
    } else if (/^page\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** File path -> URL path, dropping Next route groups `(name)`. */
function routeOf(file: string): string {
  const rel = file.slice(APP_DIR.length).replace(/\/page\.tsx?$/, '');
  const route = rel
    .split('/')
    .filter((seg) => !/^\(.*\)$/.test(seg))
    .join('/');
  return route === '' ? '/' : route;
}

// No `/s` flag: `[^}]*` already spans newlines, and `s` needs an es2018 target.
const NOINDEX = /robots\s*:\s*\{[^}]*index\s*:\s*false/;

/**
 * Does this page declare `noindex`, itself or by inheritance?
 *
 * Returns the file that declares it, so a failure says WHERE - and so the
 * control test below can assert the mechanism, not just the verdict.
 */
function noindexSource(file: string): string | null {
  if (NOINDEX.test(readFileSync(file, 'utf8'))) return file;
  let dir = dirname(file);
  while (dir.startsWith(APP_DIR)) {
    const layout = join(dir, 'layout.tsx');
    if (existsSync(layout) && NOINDEX.test(readFileSync(layout, 'utf8'))) {
      return layout;
    }
    if (dir === APP_DIR) break;
    dir = dirname(dir);
  }
  return null;
}

/** Static public pages: no dynamic segment, crawlable, not self-declared noindex. */
function publicStaticRoutes(): string[] {
  const blocked = disallowedPrefixes();
  return pageFiles()
    .map((file) => ({ file, route: routeOf(file) }))
    .filter(({ route }) => !route.includes('['))
    .filter(({ route }) => !blocked.some((p) => route === p || route.startsWith(p)))
    .filter(({ file }) => noindexSource(file) === null)
    .map(({ route }) => route)
    .sort();
}

async function advertisedStaticPaths(): Promise<string[]> {
  const { default: sitemap } = await import('./sitemap');
  const entries = await sitemap();
  return entries
    .map((e) => e.url.replace(BASE_URL, '') || '/')
    .filter((p) => !p.startsWith('/campaigns/') && !p.startsWith('/blog/'))
    .sort();
}

describe('the sitemap advertises every public page', () => {
  it('leaves no public, indexable page unadvertised', async () => {
    const advertised = new Set(await advertisedStaticPaths());
    const missing = publicStaticRoutes().filter((r) => !advertised.has(r));

    expect(
      missing,
      `public pages missing from /sitemap.xml: ${missing.join(', ')}. ` +
        'Add them to `staticPages` in src/app/sitemap.ts, or give the page ' +
        '`robots: { index: false }` if it should not be indexed.',
    ).toEqual([]);
  });

  it('advertises nothing that declares noindex', async () => {
    const byRoute = new Map(
      pageFiles().map((file) => [routeOf(file), file] as const),
    );
    const contradictions = (await advertisedStaticPaths()).filter((path) => {
      const file = byRoute.get(path);
      return file !== undefined && noindexSource(file) !== null;
    });

    expect(
      contradictions,
      `advertised in the sitemap AND served noindex: ${contradictions.join(', ')}`,
    ).toEqual([]);
  });

  /*
    Anti-vacuity. Both rules above are "this list is empty" assertions, so a
    deriver that silently returned nothing would satisfy both (`docs/163`
    §5.1). These pin that each side actually found something real.
  */
  it('derives a non-empty candidate set containing known public pages', () => {
    const routes = publicStaticRoutes();
    expect(routes.length).toBeGreaterThan(10);
    for (const known of ['/', '/about', '/privacy', '/campaigns']) {
      expect(routes, `${known} must be a candidate`).toContain(known);
    }
  });

  it('derives a non-empty advertised set', async () => {
    expect((await advertisedStaticPaths()).length).toBeGreaterThan(10);
  });

  /*
    The predicate must DISCRIMINATE. A detector that called everything noindex
    would make rule 1 pass with every page unadvertised; one that called
    nothing noindex would make rule 2 pass trivially. Both directions, and the
    inherited case, which is the one a page-file-only check gets wrong.
  */
  it('classifies noindex pages as noindex and public pages as public', () => {
    const byRoute = new Map(
      pageFiles().map((file) => [routeOf(file), file] as const),
    );

    const settings = byRoute.get('/settings');
    expect(settings, '/settings must exist for this control').toBeDefined();
    expect(noindexSource(settings!)).toBe(settings!);

    const about = byRoute.get('/about');
    expect(about, '/about must exist for this control').toBeDefined();
    expect(noindexSource(about!)).toBeNull();
  });

  it('detects noindex inherited from an ancestor layout', () => {
    const byRoute = new Map(
      pageFiles().map((file) => [routeOf(file), file] as const),
    );
    const reset = byRoute.get('/login/reset-password');
    expect(reset, '/login/reset-password must exist for this control').toBeDefined();

    const source = noindexSource(reset!);
    expect(source).not.toBeNull();
    // The declaration is in a LAYOUT, not in the page file itself.
    expect(source).not.toBe(reset!);
    expect(source!.endsWith('layout.tsx')).toBe(true);
  });

  it('reads the disallow list from robots.ts', () => {
    const blocked = disallowedPrefixes();
    expect(blocked).toContain('/admin/');
    expect(blocked).toContain('/dashboard');
    expect(blocked).not.toContain('/api/');
  });
});
