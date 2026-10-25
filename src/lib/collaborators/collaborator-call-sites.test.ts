/**
 * Where the capability check is allowed to appear, and where it must not.
 *
 * ── WHY THIS IS A SEPARATE FILE FROM THE BOUNDARY TEST ──────────────────────
 *
 * `collaborator-boundary.test.ts` proves the collaborator MODULE cannot write
 * money. That is necessary and not sufficient: the module could be perfectly
 * sealed and someone could still call `canCollaborate` from the withdrawal
 * route, which would delegate money with no change to the sealed directory at
 * all.
 *
 * So this file looks at the call sites instead. It is the half that would have
 * caught the dangerous version of this feature.
 *
 * ⚠️ The specific hazard, traced. [VERIFIED 2026-10-25]
 * `withdraw/route.ts:146-154` reads the payout destination with
 * `eq(users.id, session.user.id)` - the CALLER's Connect account - and hands
 * it to `createTransfer` at 405-408. Lines 155-405 contain no further
 * `creatorId` check. So the ownership comparison at line 138 is the only
 * thing making the credited account the organiser's. A `canCollaborate` call
 * added there pays a family's money to a helper, and nothing in the system
 * reports it.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { DELEGATABLE } from '@/lib/collaborators/capabilities';

const ROOT = process.cwd();

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const codeOnly = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Routes that must stay creator-only. Each one either moves money, decides
 * where money goes, or speaks for the organiser's identity.
 */
const SEALED = [
  'src/app/api/v1/user-campaigns/[id]/withdraw/route.ts',
  'src/app/api/v1/user-campaigns/[id]/withdrawals/route.ts',
  'src/app/api/v1/user-campaigns/[id]/verification/submit/route.ts',
  'src/app/api/v1/user-campaigns/[id]/verification/documents/route.ts',
  'src/app/api/v1/user-campaigns/[id]/verification/status/route.ts',
  'src/app/dashboard/payout-settings/page.tsx',
];

/** Surfaces that are allowed to delegate, and the capability each may use. */
const DELEGATING = {
  'src/app/api/v1/user-campaigns/[id]/updates/route.ts': 'post_update',
  'src/app/api/v1/user-campaigns/[id]/route.ts': 'edit_content',
} as const;

describe('the sealed routes exist and were read', () => {
  it('every sealed path is on disk', () => {
    // A renamed file would otherwise make its assertion vanish silently,
    // which is the failure mode this whole file guards against.
    for (const f of SEALED) {
      expect(() => read(f), `${f} is missing - was it renamed?`).not.toThrow();
    }
    expect(SEALED.length).toBeGreaterThanOrEqual(6);
  });
});

describe('⛔ money and identity are not delegated', () => {
  for (const file of SEALED) {
    it(`${file} does not consult canCollaborate`, () => {
      const code = codeOnly(read(file));
      expect(code, `${file} delegates a sealed capability`).not.toContain('canCollaborate');
      expect(code).not.toContain('collaborators/can-collaborate');
    });
  }

  it('the withdrawal route still compares creatorId to the session', () => {
    /*
      Asserted positively. Deleting the ownership check to "simplify" the
      route would leave the previous assertions passing - there would be no
      `canCollaborate` to find - while removing the only thing that makes the
      payout destination the organiser's account.
    */
    const code = codeOnly(read('src/app/api/v1/user-campaigns/[id]/withdraw/route.ts'));
    expect(code).toMatch(/campaign\.creatorId\s*!==\s*session\.user\.id/);
  });

  it('⚠️ the payout destination is still resolved from the caller, so the check is load-bearing', () => {
    /*
      This is not a rule, it is a tripwire on the premise. If somebody ever
      changes the withdrawal route to resolve the destination from the
      CREATOR instead of the caller, this assertion fails - and whoever sees
      it should come back and re-read whether money could then be delegated
      safely. Until then the premise behind NEVER_DELEGATED holds.
    */
    const code = codeOnly(read('src/app/api/v1/user-campaigns/[id]/withdraw/route.ts'));
    expect(
      code,
      'the payout account is no longer read from session.user.id - re-read docs/111 §1',
    ).toMatch(/\.where\(eq\(users\.id,\s*session\.user\.id\)\)/);
  });
});

describe('the delegating surfaces delegate exactly what they claim', () => {
  for (const [file, capability] of Object.entries(DELEGATING)) {
    it(`${file} uses "${capability}"`, () => {
      const code = codeOnly(read(file));
      expect(code).toContain('canCollaborate');
      expect(code).toContain(`'${capability}'`);
    });

    it(`${file} checks ownership FIRST`, () => {
      // Both for correctness and for the query budget: the owner's path must
      // not pay for a collaborator lookup (docs/87, pool max 5).
      const code = codeOnly(read(file));
      const ownerAt = code.search(/creatorId === session\.user\.id/);
      const collabAt = code.indexOf('canCollaborate(');
      expect(ownerAt).toBeGreaterThan(-1);
      expect(collabAt).toBeGreaterThan(-1);
      expect(ownerAt, 'the ownership check must precede the collaborator query')
        .toBeLessThan(collabAt);
    });
  }

  it('⛔ DELETE stays creator-only in the shared handler file', () => {
    /*
      `requireOwner` is shared by GET, PUT and DELETE in one file, so the
      capability is passed per call site. This asserts the DELETE call passes
      none - the hazard being that widening PUT widens DELETE by accident,
      which is exactly what a single shared check would have done.
    */
    const src = read('src/app/api/v1/user-campaigns/[id]/route.ts');
    const calls: { fn: string; args: string }[] = [];
    let fn = '';
    for (const line of src.split('\n')) {
      const m = /^export async function (GET|PUT|DELETE)/.exec(line);
      if (m) fn = m[1];
      const c = /requireOwner\(id, requestId([^)]*)\)/.exec(line);
      if (c) calls.push({ fn, args: c[1].trim() });
    }

    expect(calls.map((c) => c.fn)).toEqual(['GET', 'PUT', 'DELETE']);
    expect(calls.find((c) => c.fn === 'DELETE')!.args, 'DELETE was widened').toBe('');
    expect(calls.find((c) => c.fn === 'PUT')!.args).toContain('edit_content');
  });

  it('no capability is wired anywhere outside the declared surfaces', () => {
    /*
      The list above is maintained by hand. This sweep is what catches a new
      route that starts consulting `canCollaborate` without anybody adding it
      here - the `docs/110` §9.3 lesson that two correct assertions and one
      unswept surface read exactly like coverage.
    */
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          walk(p);
        } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          /*
            ⚠️ Comments stripped FIRST. The sweep's first version matched the
            raw text and flagged three route files that mention
            `canCollaborate` only to say they deliberately do not use it -
            exactly the kind of note this boundary needs to carry. A rule that
            punishes documenting itself would get the documentation deleted.
          */
          if (codeOnly(readFileSync(p, 'utf8')).includes('canCollaborate')) {
            found.push(relative(ROOT, p));
          }
        }
      }
    };
    walk(join(ROOT, 'src/app'));
    walk(join(ROOT, 'src/components'));

    expect(found.sort()).toEqual(Object.keys(DELEGATING).sort());
  });

  it('every delegatable capability has a declared surface', () => {
    expect(Object.values(DELEGATING).sort()).toEqual([...DELEGATABLE].sort());
  });
});
