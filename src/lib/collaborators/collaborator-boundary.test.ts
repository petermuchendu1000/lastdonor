/**
 * The boundary a collaborator may not cross, enforced mechanically.
 *
 * ── THE ARGUMENT THIS FILE IS THE PROOF OF ──────────────────────────────────
 *
 * A collaborator is somebody the organiser invited by email. They are safe to
 * add because of exactly one fact: **the capability set they can hold touches
 * content and nothing else.**
 *
 * The thing that makes this more than a preference is traced, not assumed.
 * [VERIFIED 2026-10-25] `user-campaigns/[id]/withdraw/route.ts:146-154`
 * resolves the payout destination with `eq(users.id, session.user.id)` - the
 * CALLER's Connect account - and hands it to `createTransfer` at line 405-408,
 * with no later re-check that it belongs to the creator. So the invariant
 * *"the credited account belongs to the person the funds are owed to"* is held
 * up by the ownership check eight lines above it and by nothing else.
 * Delegating ownership pays a family's money to a helper, silently.
 *
 * ⚠️ Those are properties of the code, not of a comment, so they are read off
 * the code - the same shape as `docs/108`'s vouch boundary, `docs/91`'s
 * social-link tests and `docs/102`'s import allowlist. The type system cannot
 * notice this directory quietly gaining a `db.update(users)`.
 *
 * ── WHAT THIS FILE DOES NOT CLAIM ───────────────────────────────────────────
 *
 * It makes a narrow claim about ONE directory, structurally. It does not
 * attempt a repo-wide enumeration of who may withdraw: `docs/108` records a
 * test that tried exactly that, named two writers and missed a third, because
 * `.set(update)` from a variable defeats any text search. A grep proves the
 * text, not the semantics (`docs/101`).
 *
 * The complementary half - that the money and identity routes still compare
 * `creatorId` and were not widened - is asserted in
 * `collaborator-call-sites.test.ts`.
 *
 * ⛔ If a change needs a collaborator to do more than this, that reopens the
 * decision in `docs/111` §1. Do not widen the allowance to let it through.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  DELEGATABLE,
  NEVER_DELEGATED,
  isDelegatable,
} from '@/lib/collaborators/capabilities';

const DIR = join(process.cwd(), 'src/lib/collaborators');

/** Code with every comment removed, so a mention in prose is not a finding. */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((name) => ({ name, code: codeOnly(readFileSync(join(DIR, name), 'utf8')) }));

describe('the directory is sealed against money and identity', () => {
  it('reads a non-trivial number of source files', () => {
    // A listing that silently returned nothing would make every assertion
    // below pass for the worst possible reason.
    expect(files.length).toBeGreaterThanOrEqual(2);
    const names = files.map((f) => f.name);
    expect(names).toContain('capabilities.ts');
    expect(names).toContain('can-collaborate.ts');
  });

  it('⛔ writes to no table other than campaign_collaborators', () => {
    /*
      The blast radius, read off the code. A collaborator module may record
      and revoke memberships and leave an audit trail. A write to `campaigns`,
      `users`, `donations`, `campaignWithdrawals` or `verificationDocuments`
      would be a different and much larger feature.

      ⚠️ The receiver is matched, not just the method name. A first version of
      this assertion matched any `.update(x)` and flagged
      `createHash('sha256').update(raw)` in `invites.ts` - a crypto call, not
      a database write. Narrowing the pattern would normally weaken the
      check, so the test below closes that off by proving there is no OTHER
      database handle in the directory to write through.
    */
    const allowed = new Set(['campaignCollaborators', 'auditLogs']);
    for (const { name, code } of files) {
      for (const match of code.matchAll(
        /\b(?:db|tx)\s*\.\s*(?:update|insert|delete)\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g,
      )) {
        expect(
          allowed.has(match[1]),
          `${name} writes to \`${match[1]}\`, which is not in the allowed set`,
        ).toBe(true);
      }
    }
  });

  it('⚠️ has no database handle other than `db`, so the check above is complete', () => {
    /*
      This is what makes the narrowed pattern sound. The assertion above only
      sees writes through `db` or `tx`; if a file imported its own pool or
      aliased the handle, a write could slip past it. So: the only database
      import in this directory is `{ db } from '@/db'`, and nothing re-binds
      it.
    */
    for (const { name, code } of files) {
      const dbImports = [...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/db'/g)];
      for (const imp of dbImports) {
        const named = imp[1].split(',').map((x) => x.trim()).filter(Boolean);
        expect(named, `${name} imports more than \`db\` from @/db`).toEqual(['db']);
      }
      expect(code, `${name} imports postgres directly`).not.toMatch(/from\s*'postgres'/);
      expect(code, `${name} builds its own drizzle client`).not.toContain('drizzle(');
      // No aliasing of the handle, which would defeat the receiver match.
      expect(code, `${name} re-binds the db handle`).not.toMatch(/=\s*db\s*;/);
    }
  });

  it('⛔ never names a money, payout or verification column', () => {
    for (const { name, code } of files) {
      for (const column of [
        'totalReleasedAmount',
        'totalWithdrawnAmount',
        'raisedAmount',
        'goalAmount',
        'stripeConnectAccountId',
        'payoutCurrency',
        'verificationStatus',
        'diditSessionId',
      ]) {
        expect(code, `${name} refers to \`${column}\``).not.toContain(column);
      }
    }
  });

  it('⛔ never names the campaign status column or its literals', () => {
    // The docs/78 / docs/79 publication review is untouched by this feature.
    for (const { name, code } of files) {
      expect(code, `${name} writes campaigns.status`).not.toMatch(/status:\s*['"]/);
      expect(code, `${name} mentions under_review`).not.toContain('under_review');
    }
  });
});

describe('the two capability lists cannot overlap', () => {
  it('⛔ no capability is both delegatable and never-delegated', () => {
    /*
      The single assertion that stops this feature growing into ownership.
      Moving `withdraw` from one list to the other is the change this test
      exists to refuse.
    */
    const never = new Set<string>(NEVER_DELEGATED);
    for (const cap of DELEGATABLE) {
      expect(never.has(cap), `"${cap}" appears in BOTH lists`).toBe(false);
    }
  });

  it('⛔ the money and identity capabilities are named as refused', () => {
    // Asserted positively, so deleting an entry from NEVER_DELEGATED to make
    // something pass fails here rather than quietly succeeding.
    for (const cap of [
      'withdraw',
      'change_payout_account',
      'upload_identity',
      'delete_campaign',
      'invite_collaborator',
      'change_status',
    ]) {
      expect(NEVER_DELEGATED as readonly string[]).toContain(cap);
    }
  });

  it('isDelegatable fails CLOSED', () => {
    for (const cap of NEVER_DELEGATED) {
      expect(isDelegatable(cap), cap).toBe(false);
    }
    for (const junk of ['', 'WITHDRAW', 'post_update ', 'anything', '*']) {
      expect(isDelegatable(junk), JSON.stringify(junk)).toBe(false);
    }
    // And it says yes to the real ones, so the check is not simply "no".
    for (const cap of DELEGATABLE) {
      expect(isDelegatable(cap), cap).toBe(true);
    }
  });

  it('every delegatable capability is wired to a surface that exists', () => {
    /*
      docs/76, docs/77 and docs/81 are three docs about shipping a capability
      with no code behind it. Each entry names a route; that route must be on
      disk.
    */
    const surfaces: Record<string, string> = {
      post_update: 'src/app/api/v1/user-campaigns/[id]/updates/route.ts',
      edit_content: 'src/app/api/v1/user-campaigns/[id]/route.ts',
    };
    expect(Object.keys(surfaces).sort()).toEqual([...DELEGATABLE].sort());
    for (const [cap, file] of Object.entries(surfaces)) {
      expect(
        () => readFileSync(join(process.cwd(), file), 'utf8'),
        `${cap} names ${file}, which does not exist`,
      ).not.toThrow();
    }
  });
});

describe('canCollaborate requires an ACCEPTED and UNREVOKED row', () => {
  const code = codeOnly(readFileSync(join(DIR, 'can-collaborate.ts'), 'utf8'));

  it('⛔ checks both acceptedAt and revokedAt', () => {
    /*
      Either condition alone is a defect with no symptom. Without
      `acceptedAt`, a pending invite grants access the invitee never accepted.
      Without `revokedAt`, revocation does nothing at all and the organiser
      has no way to remove somebody - and nothing else in the product would
      report either.
    */
    expect(code).toMatch(/isNotNull\(\s*campaignCollaborators\.acceptedAt\s*\)/);
    expect(code).toMatch(/isNull\(\s*campaignCollaborators\.revokedAt\s*\)/);
  });

  it('refuses a missing user id before querying', () => {
    // A null userId must not reach the query: `eq(column, null)` is never
    // true in SQL, so it would be harmless by accident rather than by design.
    expect(code).toMatch(/if\s*\(!userId\)\s*return false;/);
  });

  it('runs the capability guard before touching the database', () => {
    const guardAt = code.indexOf('isDelegatable');
    const queryAt = code.indexOf('db\n') >= 0 ? code.indexOf('db\n') : code.indexOf('db.select');
    expect(guardAt).toBeGreaterThan(-1);
    expect(queryAt).toBeGreaterThan(-1);
    expect(guardAt, 'the capability guard must precede the query').toBeLessThan(queryAt);
  });
});
