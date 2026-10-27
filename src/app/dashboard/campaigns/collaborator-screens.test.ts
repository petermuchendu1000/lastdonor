/**
 * A collaborator reaches the campaign screens, and sees none of the sealed
 * controls on them.
 *
 * ── WHY A SOURCE-READING TEST ───────────────────────────────────────────────
 *
 * These are server components: `docs/107` §7 records that no admin page's
 * data query is executed by any test, and the same holds here - a unit test
 * cannot reach a server component's database call, and the E2E suite is the
 * only thing that renders them. `e2e-19-collaborator-journey.spec.ts` does
 * exactly that and is the stronger check.
 *
 * This file is the cheap one that runs on every commit, and it guards the
 * property most likely to be lost by accident: somebody tidying the campaign
 * screen moves a section out of its `showsOrganiserOnly` wrapper, the E2E
 * suite is not run locally, and a helper is shown an invite panel that 403s.
 *
 * ⚠️ Structural, not textual. It parses which identifiers each gate wraps
 * rather than grepping for a string that would match a comment - the
 * `docs/116` §4 lesson, where a sweep flagged its own explanation.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/** Comments blanked, length preserved, so offsets still line up. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/^(\s*)\/\/.*$/gm, (m, i: string) => i + ' '.repeat(m.length - i.length));
}

const DETAIL = stripComments(read('src/app/dashboard/campaigns/[id]/page.tsx'));
const LIST = stripComments(read('src/components/dashboard/CampaignsListClient.tsx'));

/**
 * The regions of `source` that sit inside `{<flag> && (` … `)}`.
 *
 * Brace-matched from the `(`, so a section is "inside the gate" only if it
 * really is - not if it merely appears after one. A fixed-length window is
 * the `docs/116` §4 defect.
 */
function gatedRegions(source: string, flag: string): string[] {
  const out: string[] = [];
  const needle = `{${flag} && (`;
  let from = 0;
  for (;;) {
    const start = source.indexOf(needle, from);
    if (start === -1) break;
    const open = start + needle.length - 1;
    let depth = 0;
    let end = open;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    out.push(source.slice(open, end));
    from = end;
  }
  return out;
}

describe('the campaign screen admits a collaborator', () => {
  it('resolves membership rather than only comparing creatorId', () => {
    // Before `docs/117` this page was creator-only and bounced every helper
    // to a dashboard that listed nothing for them.
    expect(DETAIL).toContain('resolveCampaignRole');
    expect(DETAIL).toMatch(/redirect\('\/dashboard\/campaigns'\)/);
  });

  it('⛔ asks for MEMBERSHIP, not a capability', () => {
    /*
      Viewing is not a delegated power. Calling `canCollaborate` here with
      `post_update` as a stand-in would read as though it were, and would put
      this page in the DELEGATING map, every entry of which PERFORMS the
      capability it names.
    */
    expect(DETAIL).not.toContain('canCollaborate');
  });
});

describe('⛔ the sealed sections are gated to the organiser', () => {
  const gated = gatedRegions(DETAIL, 'showsOrganiserOnly').join('\n');

  it('found the gates at all', () => {
    // Without this, every assertion below would pass against an empty string.
    expect(gatedRegions(DETAIL, 'showsOrganiserOnly').length).toBeGreaterThanOrEqual(4);
    expect(gated.length).toBeGreaterThan(200);
  });

  it.each([
    ['CampaignTeamPanel', 'invite_collaborator'],
    ['JourneyChecklist', 'the organiser path to being paid'],
    ['/verification', 'upload_identity'],
    ['/donors', 'donor names are not a content capability'],
    /*
      ⛔ ADDED 2026-10-27 (`docs/119`). This list had FOUR entries and this
      was the missing fifth - which is exactly why the ungated Impact Update
      tile survived the `docs/117` pass that wrote this test. The target
      filters on `eq(campaigns.creatorId, session.user.id)` and then
      `redirect('/dashboard')`, so a collaborator was thrown off the campaign
      entirely by a tile they were shown.

      ⚠️ The lesson is about the test, not the tile: a hand-written list of
      regions is only as good as whoever remembered to extend it. The
      `requiresAllTiles` rule below is the structural half.
    */
    ['/impact-update', 'reporting how a family money was spent is not content'],
  ])('%s is inside the gate (%s)', (marker) => {
    expect(DETAIL, `${marker} is not on the page at all`).toContain(marker);
    expect(gated, `${marker} renders for a collaborator`).toContain(marker);
  });
});

describe('⛔ every Quick Action tile is accounted for', () => {
  /*
    The hand-written list above missed one. This rule needs no list: it finds
    every `/dashboard/campaigns/<id>/<child>` link in the file and requires
    each child to be either inside the organiser gate or named here as
    deliberately open to a helper.

    ⚠️ The open set is exactly the TWO delegatable capabilities (`docs/111`):
    `updates` for `post_update` and `edit` for `edit_content`. Both targets
    admit a collaborator by capability, so gating these tiles would HIDE a
    power a helper genuinely holds - the opposite mistake.

    `edit` is still conditional, just on a different flag (`isEditable`,
    `docs/119`), which is why it does not appear inside the organiser gate.
  */
  const OPEN_TO_COLLABORATORS = ['updates', 'edit'];

  it('is gated unless explicitly open to a helper', () => {
    const gated = gatedRegions(DETAIL, 'showsOrganiserOnly').join('\n');
    const children = [
      ...new Set(
        [...DETAIL.matchAll(/\/dashboard\/campaigns\/\$\{id\}\/([a-z-]+)/g)].map(
          (m) => m[1],
        ),
      ),
    ];
    expect(children.length, 'found no child links - this rule is blind').toBeGreaterThan(2);

    const ungated = children.filter(
      (c) => !OPEN_TO_COLLABORATORS.includes(c) && !gated.includes(`/${c}`),
    );
    expect(
      ungated,
      'each tile must sit inside showsOrganiserOnly, or be named open deliberately',
    ).toEqual([]);
  });
});

describe("⛔ a collaborator's list row offers no money control", () => {
  const creatorOnly = gatedRegions(LIST, "c.role === 'creator'").join('\n');

  it('found the gates', () => {
    expect(gatedRegions(LIST, "c.role === 'creator'").length).toBeGreaterThanOrEqual(2);
  });

  it('the payout destination is creator-only', () => {
    expect(LIST).toContain('payout-destination');
    expect(creatorOnly).toContain('payout-destination');
  });

  it('the organiser journey prompt is creator-only', () => {
    expect(LIST).toContain('NextStepRow');
    expect(creatorOnly).toContain('NextStepRow');
  });

  it('but the campaign itself is NOT gated, or the fix would be pointless', () => {
    /*
      The control. Hiding everything from a collaborator would satisfy every
      assertion above and leave the original defect exactly as it was - an
      empty dashboard. The row's own link must sit outside the gate.
    */
    expect(creatorOnly).not.toContain('Manage');
    expect(LIST).toContain('Manage');
  });
});

describe('the capability screens delegate the capability they are for', () => {
  it.each([
    ['src/app/dashboard/campaigns/[id]/updates/page.tsx', 'post_update'],
    ['src/app/dashboard/campaigns/[id]/edit/page.tsx', 'edit_content'],
  ])('%s uses %s, after the ownership check', (file, capability) => {
    const code = stripComments(read(file));
    expect(code).toContain(`canCollaborate(id, session.user.id, '${capability}')`);

    // The owner must not pay for the membership query (docs/87, pool max 5).
    const ownerAt = code.search(/creatorId === session\.user\.id/);
    const collabAt = code.indexOf('canCollaborate(');
    expect(ownerAt).toBeGreaterThan(-1);
    expect(ownerAt).toBeLessThan(collabAt);
  });
});
