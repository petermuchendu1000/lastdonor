import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { resolve } from 'node:path';

/*
  ─────────────────────────────────────────────────────────────────────────────
  AN ADMIN CAMPAIGN SCREEN OFFERS A NON-ADMIN ONLY WHAT THEIR ROLE CAN DO,
  AND SENDS THEM NOTHING MORE.                                     docs/133
  ─────────────────────────────────────────────────────────────────────────────

  `src/app/admin/layout.tsx:30` admits `editor` as well as `admin`, and
  `/admin/campaigns` sits in the sidebar's OPEN `Content` group on purpose:
  `POST /api/v1/admin/campaigns/[campaignId]/updates` admits
  `['editor','admin']`, and the campaign detail page holds the only link to
  the form that posts it. So an editor belongs on these two screens.

  Everything else they offered was `requireRole(['admin'])` - seven controls
  on the detail page (Approve and publish, Pause, Resume, Suspend, Cancel,
  Archive, Restore) plus Edit, and three row actions on the list - so an
  editor was shown nine or ten controls of which every one answers 403. That
  is `docs/119`'s rule ("a step may offer an action only if its target will
  accept it") unenforced on the admin side, and `docs/117`'s "a control that
  can only fail is worse than no control".

  ── WHY THIS DERIVES THE ROUTE ROLES FROM DISK ──────────────────────────────

  The interesting half is not "is the button guarded" - it is "is the button
  guarded BECAUSE its route requires admin". So rule 1 reads every campaign
  action route's own `requireRole` list and asserts the partition this file
  then applies. Widen one of them to admit an editor and rule 1 fails, which
  sends the next reader here instead of letting a stale guard sit on a route
  that would now serve them. Same shape as `docs/109`: derive both ends, then
  decide what the middle may be.
*/

const ROOT = process.cwd();

const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');

/* Comments quote the very strings these rules search for. Strip them first -
   `docs/116` §4's lesson, where a comment explaining a fix read as the bug. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const CAMPAIGN_API_DIR = 'src/app/api/v1/admin/campaigns';

/** Every role list any handler in a route file requires. */
function rolesRequired(file: string): string[][] {
  const src = stripComments(read(file));
  return [...src.matchAll(/requireRole\(\[([^\]]*)\]/g)].map((m) =>
    [...m[1].matchAll(/['"]([a-z]+)['"]/g)].map((r) => r[1]),
  );
}

describe('campaign admin controls match the roles their routes require', () => {
  /*
    ── RULE 1 ──────────────────────────────────────────────────────────────
    The partition, read from the routes themselves.
  */
  it('admits an editor to campaign CONTENT routes and to nothing else', () => {
    const files = globSync(`${CAMPAIGN_API_DIR}/**/route.ts`, { cwd: ROOT }).sort();
    expect(files.length).toBeGreaterThanOrEqual(10);

    /* Relative to the campaigns dir, with the dynamic segment normalised. */
    const key = (f: string) =>
      f.slice(`${CAMPAIGN_API_DIR}/[campaignId]/`.length).replace(/\[[^\]]+\]/g, '*');

    const admitsEditor: string[] = [];
    const adminOnly: string[] = [];

    for (const f of files) {
      const lists = rolesRequired(f);
      expect(lists.length, `${f} declares no requireRole`).toBeGreaterThan(0);
      const anyEditor = lists.some((l) => l.includes('editor'));
      (anyEditor ? admitsEditor : adminOnly).push(key(f));
    }

    /*
      The two content capabilities an editor holds over a campaign. Both are
      per-campaign, which is WHY the list and detail screens stay open to
      them. `messages/*\/moderate` has no UI anywhere in the product - a
      `docs/83` gap recorded in `docs/133` §5, not fixed here.
    */
    expect(admitsEditor.sort()).toEqual([
      'messages/*/moderate/route.ts',
      'updates/route.ts',
    ]);

    /* Everything else. A new action route lands here and fails until somebody
       decides which side it is on. */
    expect(adminOnly.sort()).toEqual([
      'cancel/route.ts',
      'pause/route.ts',
      'resume/route.ts',
      /* The base route: `PATCH`, the one status writer (`docs/120`). */
      'route.ts',
      'suspend/route.ts',
      /*
        ⚠️ An editor may POST an update and may NOT delete one: this is
        `DELETE .../updates/[updateId]`, admin-only, with no UI anywhere. So
        an editor cannot remove an update they wrote. Recorded in `docs/133`
        §5 as a role question for the owner, not changed here.
      */
      'updates/*/route.ts',
      'verification/route.ts',
      'vouch/route.ts',
    ]);

    /* The base route (PATCH: the one status writer, `docs/120`) sits one
       level up, so `key()` does not apply to it. */
    expect(
      rolesRequired(`${CAMPAIGN_API_DIR}/[campaignId]/route.ts`).every(
        (l) => !l.includes('editor'),
      ),
      'PATCH /api/v1/admin/campaigns/[campaignId] must stay admin-only',
    ).toBe(true);
  });

  /*
    ── RULE 2 ──────────────────────────────────────────────────────────────
    `CampaignDetail`: every admin-only control behind `isAdmin`.

    The predicates are asserted, not the JSX, because that is where the
    component puts the decision - one question ("will the route accept this
    viewer in this state?"), asked in one place.
  */
  it('gates every admin-only control in CampaignDetail', () => {
    const src = stripComments(read('src/components/admin/CampaignDetail.tsx'));

    for (const name of ['canApprove', 'canPause', 'canResume', 'canSuspend', 'canCancel', 'canArchive', 'canRestore']) {
      const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`));
      expect(m, `${name} not found in CampaignDetail`).toBeTruthy();
      expect(m![1], `${name} must require isAdmin`).toMatch(/\bisAdmin\b/);
    }

    /* The Edit link has no predicate of its own; it opens a form that submits
       the admin-only PUT. */
    const editLink = src.indexOf('/edit`');
    expect(editLink, 'the Edit link vanished from CampaignDetail').toBeGreaterThan(-1);
    expect(
      src.slice(Math.max(0, editLink - 400), editLink),
      'the Edit link must be inside an isAdmin guard',
    ).toMatch(/isAdmin\s*&&/);

    /*
      ── THE CONTROL ──
      `Add Update` is the one action an editor may take here, and it must NOT
      be gated. Without this, deleting every control on the screen would
      satisfy the rule above.
    */
    const addUpdate = src.indexOf('/updates/new`');
    expect(addUpdate, 'the Add Update link vanished from CampaignDetail').toBeGreaterThan(-1);
    expect(
      src.slice(Math.max(0, addUpdate - 300), addUpdate),
      'Add Update must stay ungated: POST .../updates admits an editor',
    ).not.toMatch(/isAdmin\s*&&/);
  });

  /*
    ── RULE 3 ──────────────────────────────────────────────────────────────
    `CampaignsList`: Edit, Change Status and Delete gated; View Details not.
  */
  it('gates every admin-only row action in CampaignsList, and nothing else', () => {
    const src = stripComments(read('src/components/admin/CampaignsList.tsx'));

    for (const [needle, label] of [
      ['/edit`', 'Edit'],
      ['Change Status', 'Change Status'],
      ['setDeleteTarget(c)', 'Delete'],
    ] as const) {
      const at = src.indexOf(needle);
      expect(at, `${label} not found in CampaignsList`).toBeGreaterThan(-1);
      expect(
        src.slice(Math.max(0, at - 500), at),
        `${label} must be inside an isAdmin guard`,
      ).toMatch(/isAdmin\s*&&/);
    }

    /* The control: the row's only non-admin action stays reachable. */
    const view = src.indexOf('View Details');
    expect(view, 'View Details vanished from CampaignsList').toBeGreaterThan(-1);
    expect(
      src.slice(Math.max(0, view - 200), view),
      'View Details must stay ungated: it is how an editor reaches the update form',
    ).not.toMatch(/isAdmin\s*&&/);
  });

  /*
    ── RULE 4 ──────────────────────────────────────────────────────────────
    `isAdmin` is a REQUIRED prop on both components.

    `docs/118`'s reasoning: an optional flag would let a future render site
    omit it and compile, and a default of `true` would restore every defect
    above in silence.
  */
  it('declares isAdmin as a required prop on both components', () => {
    for (const f of [
      'src/components/admin/CampaignDetail.tsx',
      'src/components/admin/CampaignsList.tsx',
    ]) {
      const src = stripComments(read(f));
      expect(src, `${f} must declare isAdmin`).toMatch(/\n\s*isAdmin:\s*boolean;/);
      expect(src, `${f} must not make isAdmin optional`).not.toMatch(/isAdmin\?:/);
    }
  });

  /*
    ── RULE 5 ──────────────────────────────────────────────────────────────
    The two screens that exist ONLY to drive an admin-only write gate
    themselves. `src/app/admin/layout.tsx` admits an editor, so the page is
    the only place this can live.
  */
  it('gates /admin/campaigns/new and /admin/campaigns/[id]/edit', () => {
    for (const f of [
      'src/app/admin/campaigns/new/page.tsx',
      'src/app/admin/campaigns/[id]/edit/page.tsx',
    ]) {
      const src = stripComments(read(f));
      expect(src, `${f} must read the session`).toMatch(/await\s+auth\(\)/);
      expect(src, `${f} must refuse a non-admin`).toMatch(
        /role\s*!==\s*['"]admin['"][\s\S]{0,80}redirect\(/,
      );
    }
  });

  /*
    ── RULE 6 ──────────────────────────────────────────────────────────────
    The detail page REMOVES the donor's identity for a non-admin rather than
    hiding it in the markup.

    `CampaignDetail` is `'use client'`, so a value passed to it is serialized
    into the RSC payload whether or not a cell renders it - `docs/132` §4.1.
    `/admin/donations` and `/admin/donors` both gate on `role !== 'admin'`, so
    this page was the one place an editor could read a name against a gift.
  */
  it('narrows the donor identity before sending it to the client component', () => {
    const src = stripComments(read('src/app/admin/campaigns/[id]/page.tsx'));

    expect(src, 'the page must read the session').toMatch(/await\s+auth\(\)/);

    for (const field of ['donorName', 'donorEmail', 'donorLocation']) {
      expect(
        src,
        `${field} must be withheld from a non-admin before it is passed down`,
      ).toMatch(new RegExp(`${field}:\\s*isAdmin\\s*\\?`));
    }

    /* The trust panel's two controls are admin-only and its data belongs to
       the gated Trust & Verification area, so it is not rendered at all. */
    expect(src, 'the vouch panel must not render for a non-admin').toMatch(
      /\{isAdmin\s*&&/,
    );
    expect(
      src,
      'the vouch panel queries must not run for a non-admin either',
    ).toMatch(/isAdmin\s*\?\s*await\s+listCampaignVouches/);
  });
});
