/**
 * What the admin sidebar OFFERS a role must be what its pages SERVE that role.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * `src/app/admin/layout.tsx:30` admits **`editor` as well as `admin`**, and
 * only ONE of the 35 admin pages calls `requireRole` of its own. Everything
 * else is gated by the layout, or by a hand-written
 * `if (session?.user?.role !== 'admin') redirect('/admin')` that nothing
 * cross-checks against the navigation.
 *
 * So the two drifted in BOTH directions at once, and both were measured in a
 * browser with an editor signed in and an admin as the control (`docs/132`):
 *
 *  - **Offered and refused.** The `Finance & Users` group carries no
 *    `adminOnly`, so an editor is shown Donations, Donors and Users - and all
 *    three pages redirect them back to `/admin`. Three dead links, the
 *    `docs/119` shape: *"a tile is gated by whether its target will serve the
 *    viewer"*.
 *  - **Declared admin-only and not enforced.** `Trust & Verification` and
 *    `Operations` ARE `adminOnly`, so the links are hidden - but the pages
 *    have no gate, so the URLs are served to an editor anyway.
 *    `/admin/screening` is 332 lines with **no `role`, `isAdmin` or `session`
 *    anywhere in it**, and it joins `document_screenings` to
 *    `verification_documents`. Hiding a link is not access control.
 *
 * ⛔ The codebase already states the intended policy, per group, in
 * `NAV_GROUPS`. What was missing is anything that makes the pages obey it.
 * This test is that, and it derives BOTH ends from source so neither side can
 * be "fixed" by editing the test (`docs/109`).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const SIDEBAR = resolve(ROOT, 'src/components/admin/AdminSidebar.tsx');

/** One navigation entry, with the group policy it inherits. */
type NavItem = { href: string; group: string; adminOnly: boolean };

/**
 * Parse `NAV_GROUPS` out of the sidebar.
 *
 * ⚠️ Read from SOURCE rather than imported, because the module is a client
 * component pulling in `next/navigation` and a heroicon per row; the parse
 * also keeps the test honest about `adminOnly` being a GROUP-level flag.
 */
function navItems(): NavItem[] {
  const src = readFileSync(SIDEBAR, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const start = src.indexOf('const NAV_GROUPS');
  const end = src.indexOf('\n];', start);
  expect(start, 'NAV_GROUPS not found - the sidebar changed shape').toBeGreaterThan(-1);
  const body = src.slice(start, end);

  const out: NavItem[] = [];
  // Groups start at a 2-space-indented `{` holding a `label:`.
  for (const chunk of body.split(/\n  \{\n/).slice(1)) {
    const label = /label:\s*'([^']+)'/.exec(chunk)?.[1] ?? '?';
    const adminOnly = /\n\s*adminOnly:\s*true/.test(chunk);
    for (const m of chunk.matchAll(/href:\s*'([^']+)'/g)) {
      out.push({ href: m[1], group: label, adminOnly });
    }
  }
  return out;
}

/** The page file a nav href resolves to. `/admin` lives in a route group. */
function pageFileFor(href: string): string | null {
  const rel = href === '/admin'
    ? 'src/app/admin/(index)/page.tsx'
    : `src/app/${href.replace(/^\//, '')}/page.tsx`;
  const abs = resolve(ROOT, rel);
  return existsSync(abs) ? abs : null;
}

/**
 * Does this page refuse a non-admin?
 *
 * Two shapes exist and both count: the hand-written redirect, and a
 * `requireRole` list that excludes `editor`. ⚠️ `requireRole(['admin',
 * 'editor'])` is NOT an admin gate - `/admin/notifications` uses exactly that
 * and would be a false positive for any rule that just greps `requireRole`.
 */
function gatesOutEditor(file: string): boolean {
  const src = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  if (/role\s*!==\s*['"]admin['"]/.test(src)) return true;
  for (const m of src.matchAll(/requireRole\(\[([^\]]*)\]/g)) {
    if (!/['"]editor['"]/.test(m[1])) return true;
  }
  return false;
}

const ITEMS = navItems();

describe('⚠️ the control: the sidebar actually parsed', () => {
  /*
    Every assertion below is a filter over ITEMS, and an empty list satisfies
    all of them. `docs/123`: a rule that never checked its own input.
  */
  it('found a believable number of entries, of both kinds', () => {
    expect(ITEMS.length).toBeGreaterThan(15);
    expect(ITEMS.some((i) => i.adminOnly), 'no adminOnly group parsed').toBe(true);
    expect(ITEMS.some((i) => !i.adminOnly), 'no open group parsed').toBe(true);
    expect(ITEMS.map((i) => i.href)).toContain('/admin/screening');
    expect(ITEMS.map((i) => i.href)).toContain('/admin/users');
  });

  it('every nav href resolves to a page that exists', () => {
    const missing = ITEMS.filter((i) => !pageFileFor(i.href)).map((i) => i.href);
    expect(missing, 'sidebar links a path with no page.tsx').toEqual([]);
  });
});

describe('⛔ a link the sidebar SHOWS must be a page that SERVES', () => {
  it('no non-adminOnly entry points at an admin-gated page', () => {
    const dead = ITEMS
      .filter((i) => !i.adminOnly)
      .filter((i) => { const f = pageFileFor(i.href); return f && gatesOutEditor(f); })
      .map((i) => `${i.href}  (group "${i.group}" is not adminOnly, but the page refuses a non-admin)`);
    expect(
      dead,
      'these are offered to an editor and bounce them back to /admin:\n  ' + dead.join('\n  '),
    ).toEqual([]);
  });
});

describe('⛔ a group marked adminOnly must be ENFORCED by its pages', () => {
  it('every adminOnly entry points at a page that refuses a non-admin', () => {
    const unenforced = ITEMS
      .filter((i) => i.adminOnly)
      .filter((i) => { const f = pageFileFor(i.href); return f && !gatesOutEditor(f); })
      .map((i) => `${i.href}  (group "${i.group}" is adminOnly, but the page serves anyone the layout admits)`);
    expect(
      unenforced,
      'hiding a link is not access control - these URLs are served to an editor:\n  ' +
        unenforced.join('\n  '),
    ).toEqual([]);
  });
});

describe("⛔ the dashboard must not SEND a non-admin what it will not show them", () => {
  /*
    `/admin` is an editor's landing screen - Overview is not `adminOnly` and
    the page has no gate, both deliberate. What was wrong is that it handed
    them donor NAMES against gift AMOUNTS: the page computed `isAdmin`, passed
    it, and `AdminDashboard` destructured only `{ stats }`.

    ⚠️ Read as TEXT, in the `docs/91` style, because the type system is happy
    either way - an unused prop compiles perfectly, which is how it survived.
  */
  const page = readFileSync(resolve(ROOT, 'src/app/admin/(index)/page.tsx'), 'utf8');
  const comp = readFileSync(resolve(ROOT, 'src/components/admin/AdminDashboard.tsx'), 'utf8');

  it('⚠️ the control: both files were found and still wire isAdmin through', () => {
    expect(page.length).toBeGreaterThan(500);
    expect(comp.length).toBeGreaterThan(500);
    expect(page, 'the page no longer computes isAdmin').toMatch(/const isAdmin = /);
  });

  it('the component CONSUMES isAdmin, not just declares it', () => {
    expect(
      comp,
      'AdminDashboard takes isAdmin and ignores it - the defect docs/132 fixed',
    ).toMatch(/\{\s*stats,\s*isAdmin\s*\}/);
    expect(comp, 'isAdmin is destructured but never branched on').toMatch(/isAdmin &&/);
  });

  it('⛔ and the PAGE withholds the data, because the component is a client one', () => {
    /*
      The load-bearing half. A section hidden in JSX is still serialized into
      the RSC payload, so hiding alone would leave donor names readable in the
      browser.
    */
    expect(comp.slice(0, 40), 'AdminDashboard stopped being a client component - re-read docs/132').toMatch(/'use client'/);
    expect(page, 'the page passes full stats to a non-admin').toMatch(/recentDonations:\s*\[\]/);
    expect(page).toMatch(/donationTotals:\s*\[\]/);
  });
});

describe('⚠️ the layout is what makes this necessary', () => {
  it('admits editor, so no page may rely on it for an admin-only screen', () => {
    /*
      If this ever becomes admin-only, the whole class disappears and the two
      rules above become belt-and-braces - so this failing is the signal to
      re-read the decision, not to delete anything.
    */
    const layout = readFileSync(resolve(ROOT, 'src/app/admin/layout.tsx'), 'utf8');
    expect(layout).toMatch(/role\s*!==\s*'editor'/);
  });
});
