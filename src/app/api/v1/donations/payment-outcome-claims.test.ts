/**
 * A payment refusal may only claim the donor was not charged when we KNOW it.
 *
 * ── WHY A RATCHET ───────────────────────────────────────────────────────────
 *
 * `docs/158`. The M-Pesa initiation classified a **timeout** as `transient`
 * and answered *"We could not reach M-Pesa just now and nothing has been
 * charged. Please try again in a moment."* - a statement about somebody's
 * money, on the one branch where no response arrived and we cannot know. The
 * push reaches Safaricom synchronously behind a 20s client deadline, so a
 * request that got there can have raised a prompt on the handset while we were
 * giving up on it; and the row is then written `failed` with no PayHero
 * reference, which `settlePayHeroRequest` itself calls `unverifiable`.
 *
 * `docs/121` settled exactly this question on the way OUT: *"'your withdrawal
 * failed' there is a claim it cannot substantiate, and it is the one case where
 * the money may actually have moved."* This is that rule on the way in, and it
 * is a rule rather than a one-off fix because the pressure to "simplify" the
 * two kinds back into one is permanent - they differ by one word of copy and
 * nothing else visible.
 *
 * ⚠️ The rule is DERIVED at both ends: it executes the real classifier on a
 * real no-response error to learn which kind that is, then reads the route's
 * branch for THAT kind. Renaming the kind, re-pointing the branch, or
 * reclassifying the timeout each fail it; pinning the string `'unknown'` would
 * have caught none of those.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyInitiationFailure, PayHeroApiError } from '@/lib/payhero';

const ROOT = resolve(__dirname, '../../../../..');
const INITIATE = 'src/app/api/v1/donations/payhero/initiate/route.ts';

/** Phrasings that tell a donor their money is untouched. */
const NOT_CHARGED =
  /nothing (?:has been|was) charged|you (?:have not|were not|weren't) been charged|no money (?:has )?left/i;

function source(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

/** Blank comments, keeping newlines, so prose never counts as code. */
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

/**
 * The body of `if (kind === '<name>') { … }` in the initiate route.
 *
 * ⛔ Brace-matched, not a fixed slice: `docs/116` §4 records a sweep that took
 * 2,600 characters and broke when a comment moved, and `docs/153` §5 records
 * `[^>]*` stopping at a `>` inside an arrow function. Count braces.
 */
export function branchBody(code: string, kind: string): string | null {
  /*
    ⚠️ Anchored on `if (`, and that is not cosmetic: the route also writes
    `kind === 'configuration' || kind === 'unknown'` in the audit severity,
    which sits EARLIER in the file - so a bare `indexOf` brace-matched the
    audit object and reported the configuration branch as having no
    reassurance in it. The first version of this rule failed on correct code
    for that reason.
  */
  const head = code.indexOf(`if (kind === '${kind}')`);
  if (head === -1) return null;
  const open = code.indexOf('{', head);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return null;
}

describe('⛔ the no-response branch must not claim the donor is unharmed', () => {
  it('a timeout classifies as a kind of its own, and that branch exists', () => {
    /*
      Executed, not assumed. If somebody reclassifies the timeout back onto a
      branch that claims nothing was charged, this is where it shows.
    */
    const kind = classifyInitiationFailure(new Error('The operation was aborted'));
    expect(kind, 'a timeout must not share a kind with "the gateway answered"').not.toBe(
      'transient',
    );
    expect(classifyInitiationFailure(new PayHeroApiError(502, 'bad gateway'))).toBe('transient');

    const body = branchBody(stripComments(source(INITIATE)), kind);
    expect(body, `the initiate route has no branch for kind "${kind}"`).not.toBeNull();
  });

  it('⛔ its message does NOT say nothing was charged', () => {
    const kind = classifyInitiationFailure(new Error('The operation was aborted'));
    const body = branchBody(stripComments(source(INITIATE)), kind)!;
    expect(
      NOT_CHARGED.test(body),
      `The "${kind}" branch tells the donor their money is untouched, and on that branch no ` +
        'response arrived so we cannot know. Say we could not confirm, and tell them to check ' +
        'their own M-Pesa messages before retrying. docs/158.',
    ).toBe(false);
  });

  it('⚠️ ANTI-VACUITY: the branches that CAN substantiate it still say it', () => {
    /*
      Without this the rule is satisfied by deleting the reassurance
      everywhere - which would tell every donor we might have charged them,
      including the many cases where we know perfectly well we did not.
    */
    const code = stripComments(source(INITIATE));
    for (const kind of ['transient', 'configuration'] as const) {
      const body = branchBody(code, kind);
      expect(body, `no branch for "${kind}"`).not.toBeNull();
      expect(
        NOT_CHARGED.test(body!),
        `the "${kind}" branch should still reassure the donor - the gateway answered`,
      ).toBe(true);
    }
  });

  it('⛔ and the shared default for that code does not claim it either', () => {
    const errors = stripComments(source('src/lib/errors.ts'));
    const at = errors.indexOf('PAYMENT_OUTCOME_UNKNOWN');
    expect(at, 'the error code is gone - re-read docs/158 before removing it').toBeGreaterThan(-1);
    const entry = errors.slice(at, at + 700);
    expect(
      NOT_CHARGED.test(entry),
      'the PAYMENT_OUTCOME_UNKNOWN default message claims the donor was not charged',
    ).toBe(false);
  });

  it('⚠️ the row records an unknown outcome as unknown, not as a failure', () => {
    // The row is the only record of the attempt, and it carries status
    // 'failed' for want of anywhere better; the REASON must not agree with it.
    const code = stripComments(source(INITIATE));
    expect(code).toMatch(/Initiation outcome UNKNOWN/);
    expect(code, 'an unknown outcome should reach an operator, not sit at warning').toMatch(
      /kind === 'unknown'\s*\?\s*'Initiation outcome UNKNOWN|'configuration' \|\| kind === 'unknown'/,
    );
  });

  it('⚠️ the control: the matcher really does recognise the claim', () => {
    expect(NOT_CHARGED.test('and nothing has been charged. Please try again')).toBe(true);
    expect(NOT_CHARGED.test('Nothing was charged. Check the number')).toBe(true);
    expect(NOT_CHARGED.test('we cannot tell you whether it went through')).toBe(false);
  });
});
