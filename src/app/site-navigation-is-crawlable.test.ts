import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A `SiteNavigationElement` is a machine-readable claim that a URL is part of
 * this site's navigation. It must therefore be navigable WITHOUT JavaScript.
 *
 * ## The defect this encodes (docs/143)
 *
 * `layout.tsx` advertised six `SiteNavigationElement` nodes, one of them
 * `/about` — and **no page on the site linked `/about` in server-rendered
 * HTML**. `Navbar.tsx`'s `ABOUT_ITEMS` does list it, but that array is
 * rendered inside a Radix `DropdownMenuContent` and a `Sheet`-based mobile
 * menu, both of which mount only when opened. Measured: 0 inbound internal
 * links across all 56 sitemap URLs, `href="/about"` absent from the homepage
 * HTML including the RSC payload, and absent from `/privacy` with
 * `/compare` at 1 as the control.
 *
 * ## Why the two surfaces are read differently
 *
 * `Footer.tsx` maps over `LINK_GROUPS` unconditionally, so its OBJECT form
 * (`href: '/x'`) *is* the rendering. `Navbar.tsx`'s object arrays are only
 * ever rendered inside a dropdown or the mobile sheet, so there only the JSX
 * ATTRIBUTE form (`href="/x"`), outside those surfaces, proves a crawler can
 * see the link. Reading the navbar's object arrays as evidence is exactly the
 * mistake that would have let this defect pass — docs/130's trap
 * (*"absent from the DOM until the row menu opens"*) on a public page.
 */

const APP = __dirname;
const SRC = join(APP, '..');
const NAVBAR = join(SRC, 'components/layout/Navbar.tsx');
const FOOTER = join(SRC, 'components/layout/Footer.tsx');

/** The paths claimed as site navigation, read from the JSON-LD source. */
function navigationClaims(): string[] {
  const layout = readFileSync(join(APP, 'layout.tsx'), 'utf8');
  const claims: string[] = [];
  // Each node is `'@type': 'SiteNavigationElement'` followed by a `url:` built
  // from BASE_URL. Take the template-literal tail as the path.
  const re = /'@type':\s*'SiteNavigationElement'[\s\S]{0,400}?url:\s*`\$\{BASE_URL\}([^`]*)`/g;
  for (const m of layout.matchAll(re)) claims.push(m[1] === '' ? '/' : m[1]!);
  return claims;
}

/** Footer paths: the object form, because LINK_GROUPS is rendered as-is. */
function footerPaths(): string[] {
  const src = readFileSync(FOOTER, 'utf8');
  return [...src.matchAll(/href:\s*'(\/[^']*)'/g)].map((m) => m[1]!);
}

/**
 * Navbar paths a crawler can see: JSX `href="/x"` attributes that are NOT
 * inside a `DropdownMenuContent` and NOT in the mobile sheet (everything from
 * the first `md:hidden` container onward).
 */
function crawlerVisibleNavbarPaths(): { paths: string[]; strippedChars: number } {
  const full = readFileSync(NAVBAR, 'utf8');
  const mobileAt = full.indexOf('md:hidden');
  let desktop = mobileAt === -1 ? full : full.slice(0, mobileAt);
  const before = desktop.length;
  for (;;) {
    const open = desktop.indexOf('<DropdownMenuContent');
    if (open === -1) break;
    const close = desktop.indexOf('</DropdownMenuContent>', open);
    if (close === -1) {
      desktop = desktop.slice(0, open);
      break;
    }
    desktop = desktop.slice(0, open) + desktop.slice(close + '</DropdownMenuContent>'.length);
  }
  return {
    paths: [...desktop.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]!),
    strippedChars: before - desktop.length,
  };
}

const CLAIMS = navigationClaims();
const FOOTER_PATHS = footerPaths();
const NAV = crawlerVisibleNavbarPaths();
const VISIBLE = new Set([...FOOTER_PATHS, ...NAV.paths]);

describe('every SiteNavigationElement is reachable without JavaScript', () => {
  it('reads the navigation claims out of the JSON-LD source', () => {
    // Anti-vacuity: an empty claim set would satisfy the main rule.
    expect(CLAIMS.length).toBeGreaterThanOrEqual(6);
    expect(CLAIMS).toContain('/about');
  });

  it('reads footer link paths', () => {
    expect(FOOTER_PATHS.length).toBeGreaterThan(10);
  });

  it('the dropdown strip actually removes something', () => {
    // Anti-vacuity for the navbar extractor: if the strip were a no-op the
    // navbar's dropdown links would count as crawler-visible and the whole
    // rule would go green against the original defect.
    expect(NAV.strippedChars).toBeGreaterThan(200);
    expect(NAV.paths.length).toBeGreaterThan(0);
  });

  it('does NOT count a navbar link that only exists inside a dropdown', () => {
    // `/about` lives in ABOUT_ITEMS as object form, rendered only in a
    // dropdown. This is the control that makes the main rule meaningful: it
    // must be the FOOTER that satisfies /about, never the navbar.
    expect(NAV.paths).not.toContain('/about');
  });

  it.each(CLAIMS)('%s is linked from crawler-visible chrome', (path) => {
    expect(VISIBLE.has(path)).toBe(true);
  });

  it('the navbar main bar contributes paths the footer does not', () => {
    /*
      Proves the union is doing real work in both directions - the rule is not
      "everything must be in the footer".

      ⚠️ This used to assert `/donate` was in the navbar and NOT in the
      footer. `docs/147` put a "Donate to the General Fund" link in the
      footer's Platform group deliberately, because the footer is the only
      crawler-visible navigation and `/donate` had three UI links, two of them
      inside menus that mount on click. So `/donate` is now in both, and
      [VERIFIED by computing the sets] NO claimed path is navbar-only any
      more.

      The control therefore moves to the home link, which the navbar carries
      and `LINK_GROUPS` does not. Its force is unchanged: it is a claim about
      the EXTRACTOR - that navbar main-bar hrefs are really being read - and
      it still fails if that extractor returns nothing.
    */
    expect(NAV.paths).toContain('/');
    expect(FOOTER_PATHS).not.toContain('/');

    // And the navbar CTA itself is still found, which is what makes the
    // footer link an addition rather than a replacement.
    expect(NAV.paths).toContain('/donate');
  });
});
