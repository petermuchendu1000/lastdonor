/**
 * Which routes wear the public footer.
 *
 * The case that matters is the ANCHORING one: a bare `startsWith('/admin')`
 * passes every obvious test and quietly strips the footer from
 * `/administrator`. That is the same prefix-dragging bug
 * `middleware.public-routes.test.ts` guards against on the public API list,
 * and it is the mutation this file is written to kill.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { showsPublicFooter } from './public-chrome';

describe('the signed-in tools have no public footer', () => {
  it('hides it on the admin root and everything beneath it', () => {
    for (const path of [
      '/admin',
      '/admin/',
      '/admin/screening',
      '/admin/verification',
      '/admin/campaigns/123/verification',
    ]) {
      expect(showsPublicFooter(path), path).toBe(false);
    }
  });

  it('hides it on the organiser dashboard and everything beneath it', () => {
    for (const path of [
      '/dashboard',
      '/dashboard/',
      '/dashboard/campaigns',
      '/dashboard/withdrawals',
      '/dashboard/campaigns/123/verification',
    ]) {
      expect(showsPublicFooter(path), path).toBe(false);
    }
  });
});

describe('the rest of the site keeps it', () => {
  it('shows it on every public route', () => {
    for (const path of [
      '/', '/campaigns', '/campaigns/some-slug', '/donate', '/blog',
      '/about', '/login', '/register', '/compare', '/how-it-works',
    ]) {
      expect(showsPublicFooter(path), path).toBe(true);
    }
  });

  it('⚠️ keeps it on paths that merely START with the word admin', () => {
    /*
      The whole reason the predicate is anchored. `/administrator` is not
      under `/admin`, and an unanchored check would silently strip the footer
      from it - including any future marketing page whose slug begins those
      five letters.
    */
    for (const path of [
      '/administrator', '/admin-guide', '/administration', '/adminx',
      '/dashboards', '/dashboard-demo',
    ]) {
      expect(showsPublicFooter(path), path).toBe(true);
    }
  });

  it('does not treat a nested "admin" segment as the admin tool', () => {
    expect(showsPublicFooter('/blog/admin')).toBe(true);
    expect(showsPublicFooter('/campaigns/admin-fees')).toBe(true);
    expect(showsPublicFooter('/blog/dashboard-tips')).toBe(true);
  });
});

describe('it fails toward showing, not hiding', () => {
  it('shows the footer for an unreadable pathname', () => {
    /*
      Direction matters. Showing a footer where it is not wanted is cosmetic;
      hiding it everywhere strips the site's navigation, legal links and
      unsubscribe route (docs/40, CAN-SPAM) on every page at once.
    */
    expect(showsPublicFooter(null)).toBe(true);
    expect(showsPublicFooter(undefined)).toBe(true);
    expect(showsPublicFooter('')).toBe(true);
    expect(showsPublicFooter('not-a-path')).toBe(true);
  });
});

describe('the layout actually uses it', () => {
  /*
    Read as TEXT, in the style of docs/91's social-link tests. The predicate
    being correct is worth nothing if `layout.tsx` stops calling it, and the
    type system cannot notice: `<Footer />` renders perfectly well ungated.

    ⚠️ This pins the FOOTER only. The NAVBAR must stay ungated - the admin
    sidebar has no sign-out, so the navbar is an administrator's only way out
    of the tool.
  */
  const layout = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8');

  it('wraps the footer in the gate', () => {
    expect(layout).toMatch(/<PublicFooterGate>\s*<Footer \/>\s*<\/PublicFooterGate>/);
  });

  it('does NOT gate the navbar', () => {
    expect(layout).toMatch(/<Navbar \/>/);
    expect(layout).not.toMatch(/<PublicFooterGate>\s*<Navbar/);
  });
});
