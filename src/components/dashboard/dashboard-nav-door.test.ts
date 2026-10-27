/**
 * The list of a person's campaigns has a permanent door, and the flag that
 * opens it is actually read.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * `docs/117` taught `/dashboard/campaigns` to list campaigns a person merely
 * HELPS with. [VERIFIED 2026-10-27] that route was then in **neither**
 * navigation surface - not `DashboardSidebar` (which `DashboardMobileNav`
 * also renders), not `UserNav` - so its only persistent doors were:
 *
 *   - `dashboard/(index)/page.tsx:207` "View all", inside
 *     `{myCampaigns.length > 0 && …}` where `myCampaigns` is
 *     `where(eq(campaigns.creatorId, userId))` - CREATOR ONLY
 *   - `FinancesClient.tsx:275`, inside `if (campaigns.length === 0)` - the
 *     EMPTY state, and labelled "Create Campaign" while pointing at the list
 *   - `PayoutDestinationFlow.tsx:193`, inside a creator-only flow
 *
 * So the people `docs/117` fixed the list for had no way back to it once the
 * one-shot redirect after accepting had been used. `docs/119`.
 *
 * Meanwhile `dashboard/layout.tsx` spent one of its three permitted queries
 * (`docs/87`) computing `hasCampaigns`, and `DashboardSidebar` destructured
 * it as `_hasCampaigns` and threw it away.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}
const read = (p: string) => stripComments(readFileSync(resolve(ROOT, p), 'utf8'));

const SIDEBAR = read('src/components/dashboard/DashboardSidebar.tsx');
const LAYOUT = read('src/app/dashboard/layout.tsx');

describe('the sweep can see the files', () => {
  it('read real components', () => {
    expect(SIDEBAR).toContain('PRIMARY_NAV');
    expect(LAYOUT).toContain('DashboardShell');
  });
});

describe('⛔ /dashboard/campaigns has a permanent door', () => {
  it('is in the primary navigation', () => {
    const nav = SIDEBAR.slice(
      SIDEBAR.indexOf('const PRIMARY_NAV'),
      SIDEBAR.indexOf('const ACCOUNT_CHILDREN'),
    );
    expect(nav.length, 'PRIMARY_NAV not found').toBeGreaterThan(50);
    expect(nav).toContain("href: '/dashboard/campaigns'");
  });

  it('⛔ and the mobile nav gets it too, because it renders this sidebar', () => {
    // Not a second list to keep in step - verified it delegates.
    expect(read('src/components/dashboard/DashboardMobileNav.tsx')).toContain(
      '<DashboardSidebar',
    );
  });
});

describe('⛔ the hasCampaigns flag is read, not discarded', () => {
  it('is not destructured into a throwaway', () => {
    expect(SIDEBAR).not.toContain('_hasCampaigns');
    expect(SIDEBAR).toMatch(/\{\s*hasCampaigns,/);
  });

  it('actually filters the nav', () => {
    expect(SIDEBAR).toMatch(/requiresCampaign[\s\S]*hasCampaigns|hasCampaigns[\s\S]*requiresCampaign/);
  });

  it('⛔ and the entry it gates is the campaigns one', () => {
    const nav = SIDEBAR.slice(
      SIDEBAR.indexOf('const PRIMARY_NAV'),
      SIDEBAR.indexOf('const ACCOUNT_CHILDREN'),
    );
    const line = nav.split('\n').find((l) => l.includes("'/dashboard/campaigns'"));
    expect(line).toBeTruthy();
    expect(line).toContain('requiresCampaign: true');
  });
});

describe('⛔ the flag means "created OR helping", not "created"', () => {
  it('the layout uses the shared predicate', () => {
    /*
      The whole point. A creator-only count would hide the door from exactly
      the people `docs/117` fixed the list for.
    */
    expect(LAYOUT).toContain('hasAnyCampaign(session.user.id)');
    expect(LAYOUT).not.toMatch(/eq\(campaigns\.creatorId, session\.user\.id\)/);
  });

  it('⛔ and that predicate is the SAME one the list uses', () => {
    /*
      Both read `liveMembership` in the same module, so the nav entry cannot
      disagree with what the list contains. If these ever diverge, somebody
      gets a nav item leading to an empty page, or a populated page with no
      nav item - which is the defect this file is about.
    */
    const mod = read('src/lib/dashboard/my-campaigns.server.ts');
    expect(mod).toContain('export async function hasAnyCampaign');
    const fn = mod.slice(mod.indexOf('export async function hasAnyCampaign'));
    expect(fn).toContain('liveMembership(userId)');
    expect(fn).toContain('eq(campaigns.creatorId, userId)');
    // listMyCampaigns must still use it too, or they are not "the same".
    expect(mod).toMatch(/listMyCampaigns[\s\S]*liveMembership\(userId\)/);
  });

  it('⚠️ and it is still ONE query (docs/87 caps a route at three)', () => {
    const mod = read('src/lib/dashboard/my-campaigns.server.ts');
    const fn = mod.slice(
      mod.indexOf('export async function hasAnyCampaign'),
      mod.indexOf('export async function listMyCampaigns'),
    );
    expect((fn.match(/await db/g) ?? []).length).toBe(1);
  });
});

describe('⛔ the Finances empty state offers the wizard, not the list', () => {
  it('"Create Campaign" goes to /share-your-story', () => {
    /*
      It pointed at `/dashboard/campaigns` - the LIST - so the single button
      offered to somebody with no campaigns did not do what it said.
    */
    const fin = read('src/components/dashboard/FinancesClient.tsx');
    const idx = fin.indexOf('Create Campaign');
    expect(idx, '"Create Campaign" button not found').toBeGreaterThan(-1);
    const block = fin.slice(Math.max(0, idx - 400), idx);
    expect(block).toContain('/share-your-story');
  });
});
