/**
 * The boundary a vouch may not cross, enforced mechanically.
 *
 * ── THE ARGUMENT THIS FILE IS THE PROOF OF ──────────────────────────────────
 *
 * An institutional vouch is a third party's assertion, recorded by an admin
 * who has not seen a single document. It is safe because of exactly one fact:
 * **it changes `verification_status` to `identity_verified` and nothing else.**
 *
 * `identity_verified` lifts the pre-verification raise cap (`docs/101`) and
 * moves no money. `fully_verified` DOES move money - the admin verification
 * route writes `total_released_amount` in the same transaction that sets it.
 * And `campaigns.status` is the publication review `docs/78` and `docs/79`
 * made real, which a vouch does not touch either.
 *
 * ⚠️ Those are properties of the code, not of a comment, so they are read off
 * the code. Same shape as `docs/91`'s social-link tests and `docs/102`'s
 * import allowlist: the type system cannot notice a module quietly starting
 * to write a different enum value or a different table.
 *
 * ── WHAT THIS CANNOT DO, AND WHY THERE IS NO REPO-WIDE VERSION ──────────────
 *
 * The first draft of this file also tried to enumerate every writer of
 * `fully_verified` in the repository, and it was WRONG - it named two files
 * and missed a third. `verification/didit/webhook/route.ts:137` writes
 * `db.update(campaigns).set(update)` where `update` is an object built
 * earlier, so no text search for `verificationStatus: 'fully_verified'` can
 * see it. That is the `docs/101` lesson again: **a grep over code proves the
 * text, not the semantics.**
 *
 * So this file makes a narrow claim it can actually keep - about the contents
 * of ONE directory, structurally - and does not pretend to a repo-wide one.
 * The directory is small, every write in it is direct, and the assertions
 * below read the actual `.update()` / `.insert()` targets rather than
 * searching for strings that happen to look dangerous.
 *
 * ⛔ If a future change needs a vouch to advance a campaign further than this,
 * that reopens the whole decision in `docs/108`. Do not widen the allowance
 * to let the change through.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'src/lib/trust-network');

/** Code with every comment removed, so a mention in prose is not a finding. */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((name) => ({ name, code: codeOnly(readFileSync(join(DIR, name), 'utf8')) }));

describe('the trust network is sealed against the money path', () => {
  it('reads a non-trivial number of source files', () => {
    // A directory listing that silently returned nothing would make every
    // assertion below pass for the worst possible reason.
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.map((f) => f.name).sort()).toContain('vouch.ts');
    expect(files.map((f) => f.name).sort()).toContain('decide.ts');
  });

  it('⛔ mentions fully_verified only to COMPARE against it, never to assign it', () => {
    /*
      The string legitimately appears in `decide.ts`, which refuses to vouch
      for an already-verified campaign and explains why in the refusal. The
      rule is therefore about position, not presence: every occurrence must
      be the right-hand side of an equality.
    */
    for (const { name, code } of files) {
      for (const match of code.matchAll(/fully_verified/g)) {
        const before = code.slice(Math.max(0, match.index - 12), match.index);
        expect(
          /[=!]==?\s*['"]?$/.test(before),
          `${name}: \`fully_verified\` at offset ${match.index} is not a comparison - ` +
            `context: ${JSON.stringify(code.slice(Math.max(0, match.index - 40), match.index + 20))}`,
        ).toBe(true);
      }
    }
  });

  it('⛔ writes to exactly four tables, and they are the expected four', () => {
    /*
      The blast radius, read off the code rather than asserted in prose. A
      vouch may record itself, verify a campaign, and leave an audit trail.
      Anything else - donations, withdrawals, users, verification_documents -
      would be a different feature.
    */
    const allowed = new Set(['campaigns', 'institutionVouches', 'trustedInstitutions', 'auditLogs']);
    const seen = new Set<string>();
    for (const { name, code } of files) {
      for (const match of code.matchAll(/\.(?:update|insert|delete)\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g)) {
        const table = match[1];
        seen.add(table);
        expect(allowed.has(table), `${name} writes to \`${table}\`, which is not in the allowed set`)
          .toBe(true);
      }
    }
    // And it really does write, so the loop above was not vacuous.
    expect(seen.has('campaigns')).toBe(true);
    expect(seen.has('institutionVouches')).toBe(true);
  });

  it('⛔ never names a money or payout column at all', () => {
    for (const { name, code } of files) {
      for (const column of [
        'totalReleasedAmount',
        'totalWithdrawnAmount',
        'raisedAmount',
        'goalAmount',
        'donorCount',
      ]) {
        expect(code, `${name} refers to \`${column}\``).not.toContain(column);
      }
    }
  });

  it('⛔ updates campaigns in exactly two places, writing only verification columns', () => {
    const vouch = files.find((f) => f.name === 'vouch.ts')!;
    const sets = [...vouch.code.matchAll(/\.update\(campaigns\)\s*\.set\(\{([\s\S]*?)\n\s*\}\)/g)].map(
      (m) => m[1],
    );

    expect(sets.length, 'record and revoke, and nothing else').toBe(2);

    const allowed = new Set([
      'verificationStatus',
      'verificationSource',
      'verificationReviewedAt',
      'updatedAt',
    ]);
    for (const body of sets) {
      const keys = [...body.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*):/gm)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(allowed.has(key), `vouch.ts writes campaigns.${key}, which is not allowed here`)
          .toBe(true);
      }
    }
  });

  it('writes the granted status only through the named constant', () => {
    /*
      `decide.ts` declares `VOUCH_GRANTS_STATUS` with the argument above it;
      nothing else may write the literal, because a literal is how the
      constant gets bypassed without its comment - and the comment is the
      argument.
    */
    for (const { name, code } of files) {
      if (name === 'decide.ts') continue;
      expect(code, `${name} must use VOUCH_GRANTS_STATUS, not the literal`)
        .not.toMatch(/'identity_verified'/);
    }
  });

  it('⛔ never writes campaigns.status, so it cannot publish anything', () => {
    /*
      Checked structurally, not by searching for status literals. The first
      version of this test looked for `status: 'active'` and failed on
      `status: 'active' | 'suspended'` in a TYPE annotation in `decide.ts` -
      a text search cannot tell a type from a write, which is the same
      distinction the `fully_verified` test above had to make.

      The complete statement about campaign writes is these two facts
      together: the directory never INSERTS a campaign, and every UPDATE of
      one writes only the four verification columns allowed above. There is
      no third way to change `campaigns.status`.
    */
    for (const { name, code } of files) {
      expect(code, `${name} inserts a campaign`).not.toMatch(/\.insert\(\s*campaigns\s*\)/);
      expect(code, `${name} assigns publishedAt`).not.toMatch(/publishedAt\s*:/);
    }
  });
});
