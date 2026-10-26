/**
 * Which routes wear the public navbar.
 *
 * ⛔ The asymmetry between `/dashboard` and `/admin` is the whole decision,
 * and it is a fact about the code rather than a preference - so it is read
 * OFF the code. If the admin sidebar ever gains a sign-out, the first test
 * below fails and somebody re-reads `public-chrome.ts` instead of discovering
 * the stranding in production.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { showsPublicNavbar, showsPublicFooter } from '@/lib/public-chrome';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const codeOnly = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('⛔ the premise the gate rests on', () => {
  it('the DASHBOARD sidebar has a sign-out, so the navbar is not the only way out', () => {
    expect(codeOnly(read('src/components/dashboard/DashboardSidebar.tsx'))).toMatch(/signOut/);
  });

  it('the mobile sheet renders that same sidebar, so phones are covered too', () => {
    expect(codeOnly(read('src/components/dashboard/DashboardMobileNav.tsx'))).toMatch(
      /<DashboardSidebar/,
    );
  });

  it('⛔ the ADMIN sidebar still has NO sign-out, which is why /admin keeps the navbar', () => {
    /*
      If this ever fails, the fact has changed in the good direction: add
      '/admin' to NAVBAR_PRIVATE_PREFIXES and delete this assertion. Until
      then, hiding the navbar there strands an administrator.
    */
    expect(codeOnly(read('src/components/admin/AdminSidebar.tsx'))).not.toMatch(/signOut/);
  });
});

describe('showsPublicNavbar', () => {
  it('hides it on the dashboard and beneath it', () => {
    for (const p of ['/dashboard', '/dashboard/', '/dashboard/campaigns', '/dashboard/campaigns/x/payout-destination']) {
      expect(showsPublicNavbar(p), p).toBe(false);
    }
  });

  it('⛔ KEEPS it on admin, unlike the footer', () => {
    expect(showsPublicNavbar('/admin')).toBe(true);
    expect(showsPublicNavbar('/admin/payout-queue')).toBe(true);
    // The footer gate is the asymmetric one - admin loses the footer.
    expect(showsPublicFooter('/admin')).toBe(false);
  });

  it('keeps it on every public route', () => {
    for (const p of ['/', '/campaigns', '/campaigns/some-slug', '/login', '/share-your-story']) {
      expect(showsPublicNavbar(p), p).toBe(true);
    }
  });

  it('⛔ is ANCHORED, so a prefix cannot drag a marketing page private', () => {
    expect(showsPublicNavbar('/dashboards')).toBe(true);
    expect(showsPublicNavbar('/dashboard-guide')).toBe(true);
  });

  it('fails toward showing navigation when the path is unreadable', () => {
    for (const p of [null, undefined, '', 'not-a-path']) {
      expect(showsPublicNavbar(p), String(p)).toBe(true);
    }
  });
});
