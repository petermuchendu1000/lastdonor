import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync, globSync } from 'node:fs';
import { resolve, join } from 'node:path';

/*
  ─────────────────────────────────────────────────────────────────────────────
  AN ADMIN COMPONENT THAT CALLS AN ADMIN-ONLY ROUTE MUST KNOW THE VIEWER'S
  ROLE.                                                           docs/134
  ─────────────────────────────────────────────────────────────────────────────

  `src/app/admin/layout.tsx` admits `editor` as well as `admin`, so a screen
  can be legitimately open to an editor while individual controls on it are
  not. That has now gone wrong THREE times:

    docs/119  the organiser journey offered a step whose target redirects
    docs/133  twelve campaign controls, every one answering 403 to an editor
    docs/134  Create (news feed), Delete (blog post), Delete (blog topic)

  Three instances of one rule is a sweep, not a third assertion - `docs/110`
  §9.2. So this rule DISCOVERS its own inputs: it walks every component under
  `src/components/admin/`, extracts each `fetch` to an admin API route with
  its HTTP method, resolves that to the route file on disk, reads the route's
  own `requireRole` list for that method, and requires any component calling
  an admin-only route to declare a required `isAdmin` prop.

  Widen a route to admit an editor and the requirement disappears on its own;
  add a component that calls a `['admin']` route and the build fails until it
  takes the prop. Neither end is hard-coded here.
*/

const ROOT = process.cwd();
const COMPONENT_DIR = 'src/components/admin';
const API_ROOT = 'src/app/api/v1/admin';

const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');

/* The comments below quote the very strings this sweeps for (`docs/116` §4). */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

type Call = { file: string; path: string; method: string };

/**
 * Every `fetch` to `/api/v1/admin/...` in a component, with its method.
 *
 * The method may sit on the same line (`{ method: 'DELETE' }`) or on the next
 * few, so a bounded window after the call is searched. A fetch with no method
 * is a GET.
 */
function adminFetches(file: string): Call[] {
  const src = stripComments(read(file));
  const out: Call[] = [];
  for (const m of src.matchAll(/fetch\(\s*[`'"]([^`'"]*\/api\/v1\/admin\/[^`'"]*)[`'"]/g)) {
    const after = src.slice(m.index!, m.index! + 400);
    const method = /method:\s*['"]([A-Z]+)['"]/.exec(after)?.[1] ?? 'GET';
    out.push({ file, path: m[1], method });
  }
  return out;
}

/**
 * Resolve a fetch path to its route file.
 *
 * A literal segment matches a directory of that name; a `${…}` segment
 * matches any `[dynamic]` directory. Returns null when nothing matches, which
 * the caller treats as "cannot judge" rather than "fine".
 */
function routeFileFor(path: string): string | null {
  const segs = path.replace(/^.*\/api\/v1\/admin\//, '').split('/').filter(Boolean);
  let dir = resolve(ROOT, API_ROOT);
  for (const seg of segs) {
    if (/\$\{/.test(seg)) {
      const dyn = readdirSync(dir).filter(
        (d) => d.startsWith('[') && statSync(join(dir, d)).isDirectory(),
      );
      if (dyn.length !== 1) return null;
      dir = join(dir, dyn[0]);
    } else {
      const next = join(dir, seg);
      if (!existsSync(next) || !statSync(next).isDirectory()) return null;
      dir = next;
    }
  }
  const f = join(dir, 'route.ts');
  return existsSync(f) ? f : null;
}

/** The roles a route's handler for `method` requires, or null if absent. */
function rolesFor(routeFile: string, method: string): string[] | null {
  const src = stripComments(readFileSync(routeFile, 'utf-8'));
  const at = src.search(new RegExp(`export async function ${method}\\b`));
  if (at < 0) return null;
  // The next handler, so the search window is this handler's body only.
  const rest = src.slice(at + 1);
  const nextAt = rest.search(/export async function [A-Z]+\b/);
  const body = nextAt < 0 ? rest : rest.slice(0, nextAt);
  const list = /requireRole\(\[([^\]]*)\]/.exec(body)?.[1];
  if (list === undefined) return null;
  return [...list.matchAll(/['"]([a-z]+)['"]/g)].map((r) => r[1]);
}

const COMPONENTS = globSync(`${COMPONENT_DIR}/*.tsx`, { cwd: ROOT })
  .filter((f) => !f.endsWith('.test.tsx'))
  .sort();

/**
 * Does this page refuse a non-admin?
 *
 * ⚠️ `role !== 'admin'` alone is NOT a refusal - `/admin/blog/[id]/edit`
 * reads `role !== 'admin' && role !== 'editor'`, which ADMITS one. Same
 * correction `docs/133` made to the `docs/132` helper.
 */
function gatesOutEditor(pageFile: string): boolean {
  const src = stripComments(readFileSync(pageFile, 'utf-8'));
  for (const m of src.matchAll(/role\s*!==\s*['"]admin['"][^;{]*/g)) {
    if (!/['"]editor['"]/.test(m[0])) return true;
  }
  for (const m of src.matchAll(/requireRole\(\[([^\]]*)\]/g)) {
    if (!/['"]editor['"]/.test(m[1])) return true;
  }
  return false;
}

/** Every admin page that renders this component. */
function renderSites(componentFile: string): string[] {
  const name = componentFile.split('/').pop()!.replace('.tsx', '');
  return globSync('src/app/admin/**/page.tsx', { cwd: ROOT }).filter((p) =>
    new RegExp(`<${name}\\b`).test(readFileSync(resolve(ROOT, p), 'utf-8')),
  );
}

/**
 * Is EVERY occurrence of `<Component` on this page already inside an
 * `isAdmin &&` guard?
 *
 * This is the second legitimate shape, and `docs/133` chose it deliberately:
 * `/admin/campaigns/[id]` serves an editor, but `<CampaignVouches>` is not
 * rendered for one at all - both its controls are admin-only and its data
 * belongs to the gated Trust & Verification area - so the component needs no
 * role prop of its own. Not rendering beats passing a flag down.
 */
function renderGuarded(pageFile: string, componentFile: string): boolean {
  const name = componentFile.split('/').pop()!.replace('.tsx', '');
  const src = stripComments(readFileSync(pageFile, 'utf-8'));
  const sites = [...src.matchAll(new RegExp(`<${name}\\b`, 'g'))];
  if (!sites.length) return false;
  return sites.every((m) => /\{isAdmin\s*&&/.test(src.slice(Math.max(0, m.index! - 600), m.index!)));
}

/*
  Components that call an admin-only route AND are rendered on at least one
  page that admits a non-admin.

  ⚠️ The page gate is load-bearing in this predicate, and the first version of
  this rule left it out. Without it the sweep flagged a dozen components -
  `UsersList`, `SystemSettings`, `VerificationQueue` and the rest - that sit
  on pages gated to `admin`, where only an admin can be present to press
  anything. The rule was wrong, not those components (`docs/119`'s lesson).
*/
function unguardedAdminOnlyCallers(): { file: string; calls: Call[]; pages: string[] }[] {
  const out: { file: string; calls: Call[]; pages: string[] }[] = [];
  for (const file of COMPONENTS) {
    const calls = adminFetches(file).filter((c) => {
      const rf = routeFileFor(c.path);
      if (!rf) return false;
      const roles = rolesFor(rf, c.method);
      return roles !== null && roles.length > 0 && !roles.includes('editor');
    });
    if (!calls.length) continue;
    const open = renderSites(file).filter(
      (p) =>
        !gatesOutEditor(resolve(ROOT, p)) &&
        !renderGuarded(resolve(ROOT, p), file),
    );
    if (open.length) out.push({ file, calls, pages: open });
  }
  return out;
}

describe('an admin component that calls an admin-only route knows the role', () => {
  /*
    ── THE ANTI-VACUITY CONTROL, FIRST ──
    If the resolver silently stopped matching anything, every rule below would
    pass. So assert the sweep still SEES the known admin-only callers before
    asserting anything about them.
  */
  it('the sweep resolves routes and still finds admin-only callers', () => {
    expect(COMPONENTS.length).toBeGreaterThan(20);

    const anyResolved = COMPONENTS.flatMap(adminFetches).filter((c) => routeFileFor(c.path));
    expect(anyResolved.length, 'the path->route resolver matched nothing').toBeGreaterThan(10);

    const names = unguardedAdminOnlyCallers().map((c) => c.file.split('/').pop());
    expect(names, 'the three docs/134 components must be seen by the sweep').toEqual(
      expect.arrayContaining(['NewsFeedMonitor.tsx', 'BlogPostsList.tsx', 'TopicQueueList.tsx']),
    );

    /*
      And the page gate must really exclude things, or the predicate has
      collapsed back into the over-broad first version. `UsersList` calls
      `DELETE /api/v1/admin/users/[id]` (admin-only) and renders only on
      `/admin/users`, which gates - so it must NOT appear.
    */
    expect(names, 'a component on a gated page must not be required to gate again')
      .not.toContain('UsersList.tsx');
  });

  /*
    ── THE RULE ──
  */
  it('every admin-only caller declares a REQUIRED isAdmin prop', () => {
    const offenders: string[] = [];

    for (const { file, calls } of unguardedAdminOnlyCallers()) {
      const src = stripComments(read(file));
      const declared = /\n\s*isAdmin:\s*boolean;/.test(src);
      const optional = /isAdmin\?:/.test(src);
      if (!declared || optional) {
        const what = calls.map((c) => `${c.method} ${c.path}`).join(', ');
        offenders.push(`${file} calls ${what} but ${optional ? 'isAdmin is optional' : 'declares no isAdmin'}`);
      }
    }

    expect(
      offenders,
      'these components offer a control whose route answers 403 to an editor:\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  /*
    ── THE CONTROLS ──
    Without these, deleting the three controls outright would satisfy the rule
    above. Each names a capability the editor DOES hold, which must stay
    ungated.
  */
  it('leaves the editor-permitted controls alone', () => {
    const blog = stripComments(read(`${COMPONENT_DIR}/BlogPostsList.tsx`));
    const topics = stripComments(read(`${COMPONENT_DIR}/TopicQueueList.tsx`));

    // `blog` POST and `blog/[id]` PATCH admit an editor: writing and
    // publishing must not be gated.
    const newPost = blog.indexOf('New Post');
    expect(newPost, 'the New Post control vanished').toBeGreaterThan(-1);
    expect(blog.slice(Math.max(0, newPost - 300), newPost)).not.toMatch(/isAdmin\s*&&/);

    // `topics` POST admits an editor.
    const addTopic = topics.indexOf('Add Topic');
    expect(addTopic, 'the Add Topic control vanished').toBeGreaterThan(-1);
    expect(topics.slice(Math.max(0, addTopic - 300), addTopic)).not.toMatch(/isAdmin\s*&&/);

    // And the gated ones really are gated.
    for (const [src, needle, label] of [
      [blog, 'aria-label={`Delete ${post.title}`}', 'blog Delete'],
      [topics, 'aria-label={`Delete ${topic.title}`}', 'topic Delete'],
    ] as const) {
      const at = src.indexOf(needle);
      expect(at, `${label} not found`).toBeGreaterThan(-1);
      expect(src.slice(Math.max(0, at - 500), at), `${label} must be gated`).toMatch(/isAdmin\s*&&/);
    }
  });

  /*
    ── THE PAGES ──
    A prop nothing supplies is no gate. Each render site must read the session.
  */
  it('each page reads the session and passes it down', () => {
    for (const [page, comp] of [
      ['src/app/admin/news-feed/page.tsx', 'NewsFeedMonitor'],
      ['src/app/admin/blog/page.tsx', 'BlogPostsList'],
      ['src/app/admin/blog/topics/page.tsx', 'TopicQueueList'],
    ] as const) {
      const src = stripComments(read(page));
      expect(src, `${page} must read the session`).toMatch(/await\s+auth\(\)/);
      expect(src, `${page} must derive isAdmin`).toMatch(/role\s*===\s*['"]admin['"]/);
      expect(src, `${page} must pass isAdmin to <${comp}>`).toMatch(/isAdmin=\{isAdmin\}/);
    }
  });
});
