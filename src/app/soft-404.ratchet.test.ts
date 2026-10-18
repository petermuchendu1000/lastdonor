import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';

/*
  A `loading.tsx` above a route that calls `notFound()` turns its 404
  into a 200.

  ## What was actually wrong (docs/80, rewritten 2026-10-18)

  A nonexistent campaign, blog post or category answered HTTP 200 with
  a "Not Found" body. docs/80 attributed this to `revalidate` +
  `notFound()` - a cached ISR entry replayed as 200 - and predicted the
  fix was to move caching down to the data layer.

  That diagnosis was wrong, and the predicted fix would not have
  worked. Six probe routes built into real production builds settled
  it:

    revalidate + notFound()                      200
    no revalidate, unstable_cache + notFound()   200
    force-dynamic, unstable_cache + notFound()   200
    force-dynamic, SYNC, notFound() first line   200   <- decisive
    dynamicParams: false, unknown param          404
    no route at all                              404

  A page whose literal first statement is `notFound()`, with nothing
  awaited and no caching of any kind, still answered 200. So caching
  was never involved.

  The cause is `loading.tsx`. It creates an implicit `<Suspense>`
  boundary around every route beneath its segment. React streams the
  shell as soon as it suspends, which puts the HTTP status line on the
  wire before the page component has finished rendering. When
  `notFound()` throws after that, Next can still swap the body - which
  is why the body was always correct - but the 200 is already sent.

  Proven by removing `src/app/loading.tsx` and rebuilding: every one of
  those 200s became a 404, including the `revalidate` case docs/80
  blamed.

  ## The arrangement this test protects

  `loading.tsx` is not banned. It is scoped, with route groups, so that
  it never sits above a route that calls `notFound()`:

    src/app/(home)/loading.tsx            covers / only
    src/app/campaigns/(index)/loading.tsx covers /campaigns only
    src/app/blog/(index)/loading.tsx      covers /blog only

  `campaigns/[slug]` and `blog/[slug]` lost their skeletons outright,
  because those sit directly on the routes that call `notFound()` and
  there is nowhere to move them to. To get a skeleton back on those
  two, put an explicit `<Suspense>` INSIDE the page, below the lookup
  that decides 404 - then the status is settled before anything
  streams.

  Dropping a `loading.tsx` back into `src/app/`, `src/app/campaigns/`
  or `src/app/blog/` would silently restore the soft 404 with no test
  failing anywhere else. Hence this one.
*/

const APP = join(process.cwd(), 'src', 'app');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(APP);

/** Directory of every page that calls `notFound()`, relative to src/app. */
function notFoundPageDirs(): string[] {
  return files
    .filter((f) => /[/\\]page\.tsx$/.test(f))
    .filter((f) => /\bnotFound\(\)/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(APP, dirname(f)));
}

/** Directory of every `loading.tsx`, relative to src/app. */
function loadingDirs(): string[] {
  return files
    .filter((f) => /[/\\]loading\.tsx$/.test(f))
    .map((f) => relative(APP, dirname(f)));
}

/**
 * Does a `loading.tsx` at `loadingDir` wrap a page at `pageDir`?
 *
 * Next applies a segment's `loading.tsx` to that segment and every
 * descendant that does not have its own. Route groups - `(name)` - do
 * not appear in the URL but DO scope the boundary, so a page is only
 * covered when it sits inside the same group path.
 */
function covers(loadingDir: string, pageDir: string): boolean {
  if (loadingDir === pageDir) return true;
  const prefix = loadingDir === '' ? '' : loadingDir + sep;
  return pageDir.startsWith(prefix);
}

describe('no loading.tsx sits above a route that calls notFound()', () => {
  it('finds the pages that call notFound(), so the test is not vacuous', () => {
    const dirs = notFoundPageDirs();
    // campaigns/[slug], blog/[slug], campaigns/category/[category].
    expect(dirs.length).toBeGreaterThanOrEqual(3);
  });

  it('finds the loading.tsx files, so the test is not vacuous', () => {
    expect(loadingDirs().length).toBeGreaterThan(0);
  });

  it('no notFound() page is wrapped in an implicit Suspense boundary', () => {
    const offenders: string[] = [];
    for (const pageDir of notFoundPageDirs()) {
      for (const loadingDir of loadingDirs()) {
        if (covers(loadingDir, pageDir)) {
          offenders.push(
            `${loadingDir || '(app root)'}/loading.tsx wraps ${pageDir}/page.tsx, ` +
              'which calls notFound() - its 404 will be served as 200',
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the scoped skeletons are still in place', () => {
    // Removing the soft 404 should not have cost the loading states on
    // the pages that never call notFound(). If a future change deletes
    // these rather than scoping them, that is a silent UX regression.
    //
    // `dashboard` and `admin` are here because this test found them:
    // nine more pages behind auth had the same defect, which nobody had
    // looked for because the reported symptom was about crawlers. Those
    // are `noindex` so no search engine was affected, but a signed-in
    // person opening a campaign id that does not exist was still getting
    // a 200.
    const dirs = loadingDirs();
    expect(dirs).toContain(join('(home)'));
    expect(dirs).toContain(join('campaigns', '(index)'));
    expect(dirs).toContain(join('blog', '(index)'));
    expect(dirs).toContain(join('dashboard', '(index)'));
    expect(dirs).toContain(join('admin', '(index)'));
  });

  it('a route group genuinely scopes the boundary', () => {
    // The whole fix rests on this: `(home)/loading.tsx` must NOT be
    // treated as covering `campaigns/[slug]`.
    expect(covers(join('(home)'), join('campaigns', '[slug]'))).toBe(false);
    expect(covers(join('campaigns', '(index)'), join('campaigns', '[slug]'))).toBe(false);
    // ...while a real parent segment still does.
    expect(covers('campaigns', join('campaigns', '[slug]'))).toBe(true);
    expect(covers('', join('campaigns', '[slug]'))).toBe(true);
  });
});
