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
 * ── Why the routes are DISCOVERED and not named ───────────────────────────
 *
 * This file named ONE route until 2026-11-24. The second M-Pesa rail
 * (`docs/182`) carries the identical four-kind copy down to the sentence, and
 * a rule naming `payhero/initiate` would have gone green against it without
 * ever reading it — `docs/116` §4 exactly, where a review gate named two
 * files and the third insert went unreviewed in production, and `docs/134`'s
 * sweep for the same reason.
 *
 * So the initiate routes come off disk, and each is matched to the classifier
 * IT IMPORTS. A route importing none fails; a rail absent from `RAILS` fails.
 * The registry is checked against the filesystem rather than the other way
 * round, which is what makes a third rail impossible to add silently.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyInitiationFailure, PayHeroApiError } from '@/lib/payhero';
import { classifyPalplussInitiationFailure, PalplussApiError } from '@/lib/palpluss';

const ROOT = resolve(__dirname, '../../../../..');
const DONATIONS = resolve(__dirname);

/**
 * One entry per M-Pesa rail: how to run its classifier, and an error object
 * that rail's own client would raise for "the gateway answered 5xx".
 *
 * The `classifier` string is the import name a route uses, which is how a
 * discovered route is matched to its rail without this file knowing any
 * route's path.
 */
const RAILS = [
  {
    rail: 'payhero',
    classifier: 'classifyInitiationFailure',
    classify: classifyInitiationFailure as (e: unknown) => string,
    gatewayAnswered: () => new PayHeroApiError(502, 'bad gateway'),
  },
  {
    rail: 'palpluss',
    classifier: 'classifyPalplussInitiationFailure',
    classify: classifyPalplussInitiationFailure as (e: unknown) => string,
    gatewayAnswered: () => new PalplussApiError(502, 'bad gateway'),
  },
] as const;

/** Every `.../initiate/route.ts` under the donations tree. */
function initiateRoutes(): string[] {
  return readdirSync(DONATIONS, { recursive: true, encoding: 'utf8' })
    .filter((p) => /(^|[\\/])initiate[\\/]route\.ts$/.test(p))
    .map((p) => resolve(DONATIONS, p).replace(ROOT + '/', ''))
    .sort();
}

/** The rail whose classifier this route imports, or null. */
function railFor(rel: string): (typeof RAILS)[number] | null {
  const code = readFileSync(resolve(ROOT, rel), 'utf8');
  return RAILS.find((r) => new RegExp(`\\b${r.classifier}\\b`).test(code)) ?? null;
}

/** Phrasings that tell a donor their money is untouched. */
const NOT_CHARGED =
  /nothing (?:has been|was) charged|you (?:have not|were not|weren't) been charged|no money (?:has )?left/i;

function source(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

/**
 * Inline any module-level string constant back into the code.
 *
 * ⚠️ WHY THIS EXISTS, found 2026-11-24 by this rule firing on correct code.
 *
 * The Palpluss route hoists its "our side, and nothing has been charged"
 * sentence into one constant, because THREE separate refusals use it and four
 * near-identical promises about somebody's money is the `docs/152` defect
 * (a refund paragraph fifty lines from the sentence that corrected it). A
 * rule that reads a branch as text sees `OUR_SIDE` and finds no reassurance —
 * so without this it would have reported honest copy as missing, and, worse,
 * would have pressured the next author to duplicate donor-facing money copy
 * in order to satisfy a test.
 *
 * Deliberately narrow: only `const NAME = <string literals joined by +>;` at
 * the start of a line, and only whole-word occurrences afterwards. Anything
 * cleverer belongs in a compiler.
 */
function expandStringConsts(s: string): string {
  const decl = /^[ \t]*const ([A-Za-z_$][\w$]*) =\s*((?:'(?:[^'\\]|\\.)*'\s*\+?\s*)+);/gm;
  let out = s;
  for (const m of s.matchAll(decl)) {
    const [, name, expr] = m;
    const value = Array.from(expr.matchAll(/'((?:[^'\\]|\\.)*)'/g))
      .map((p) => p[1])
      .join('');
    out = out.replace(new RegExp(`\\b${name}\\b(?!\\s*=\\s*')`, 'g'), `'${value}'`);
  }
  return out;
}

/**
 * A file's code as these rules read it: comments blanked, string constants
 * inlined. One helper, so no rule can accidentally read a raw file and start
 * matching prose or missing hoisted copy.
 */
function readCode(rel: string): string {
  return expandStringConsts(stripComments(source(rel)));
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
  const routes = initiateRoutes();

  it('finds the initiate routes at all, and knows the rail of each', () => {
    /*
      ⛔ ANTI-VACUITY, and the reason this file stopped naming one path. If
      discovery broke, or a third rail arrived, every rule below would pass
      over nothing at all.
    */
    expect(routes.length, 'no initiate routes found - discovery is broken').toBeGreaterThanOrEqual(
      RAILS.length,
    );
    const orphans = routes.filter((r) => railFor(r) === null);
    expect(
      orphans,
      'an initiate route that imports no failure classifier cannot be telling a donor the ' +
        'truth about the no-response case. Add the rail to RAILS and classify. docs/158.',
    ).toEqual([]);
  });

  it.each(routes)('%s: a timeout classifies as a kind of its own, and that branch exists', (rel) => {
    /*
      Executed, not assumed. If somebody reclassifies the timeout back onto a
      branch that claims nothing was charged, this is where it shows.
    */
    const rail = railFor(rel)!;
    const kind = rail.classify(new Error('The operation was aborted'));
    expect(kind, 'a timeout must not share a kind with "the gateway answered"').not.toBe(
      'transient',
    );
    // The CONTROL: a gateway that really did answer 5xx is the other kind.
    expect(rail.classify(rail.gatewayAnswered())).toBe('transient');

    const body = branchBody(readCode(rel), kind);
    expect(body, `${rel} has no branch for kind "${kind}"`).not.toBeNull();
  });

  it.each(routes)('%s: ⛔ its message does NOT say nothing was charged', (rel) => {
    const rail = railFor(rel)!;
    const kind = rail.classify(new Error('The operation was aborted'));
    const body = branchBody(readCode(rel), kind)!;
    expect(
      NOT_CHARGED.test(body),
      `In ${rel} the "${kind}" branch tells the donor their money is untouched, and on that ` +
        'branch no response arrived so we cannot know. Say we could not confirm, and tell them ' +
        'to check their own M-Pesa messages before retrying. docs/158.',
    ).toBe(false);
  });

  it.each(routes)(
    '%s: ⚠️ ANTI-VACUITY: the branches that CAN substantiate it still say it',
    (rel) => {
      /*
        Without this the rule is satisfied by deleting the reassurance
        everywhere - which would tell every donor we might have charged them,
        including the many cases where we know perfectly well we did not.
      */
      const code = readCode(rel);
      for (const kind of ['transient', 'configuration'] as const) {
        const body = branchBody(code, kind);
        expect(body, `${rel} has no branch for "${kind}"`).not.toBeNull();
        expect(
          NOT_CHARGED.test(body!),
          `in ${rel} the "${kind}" branch should still reassure the donor - the gateway answered`,
        ).toBe(true);
      }
    },
  );

  it('⛔ and the shared default for that code does not claim it either', () => {
    const errors = readCode('src/lib/errors.ts');
    const at = errors.indexOf('PAYMENT_OUTCOME_UNKNOWN');
    expect(at, 'the error code is gone - re-read docs/158 before removing it').toBeGreaterThan(-1);
    const entry = errors.slice(at, at + 700);
    expect(
      NOT_CHARGED.test(entry),
      'the PAYMENT_OUTCOME_UNKNOWN default message claims the donor was not charged',
    ).toBe(false);
  });

  it.each(routes)(
    '%s: ⚠️ the row records an unknown outcome as unknown, not as a failure',
    (rel) => {
      // The row is the only record of the attempt, and it carries status
      // 'failed' for want of anywhere better; the REASON must not agree with it.
      const code = readCode(rel);
      expect(code).toMatch(/Initiation outcome UNKNOWN/);
      expect(code, 'an unknown outcome should reach an operator, not sit at warning').toMatch(
        /kind === 'unknown'\s*\?\s*\n?\s*'Initiation outcome UNKNOWN|'configuration' \|\| kind === 'unknown'/,
      );
    },
  );

  /*
    ⛔ ANTI-VACUITY FOR THE EXPANDER.

    The "does NOT say nothing was charged" rule passes trivially if the
    expander silently stops working — a branch that only references a
    constant looks reassurance-free. The ANTI-VACUITY rule above fails
    closed in that case, but only for the branches that must claim it, so
    this asserts the mechanism directly: expansion must change something,
    and a known hoisted sentence must actually appear in the code the rules
    see.
  */
  it('⚠️ the control: hoisted copy really is inlined before matching', () => {
    const sample = [
      "  const OUR_SIDE =",
      "    'M-Pesa payments are unavailable right now. ' +",
      "    'Nothing has been charged.';",
      '  return fail(503, X, OUR_SIDE);',
    ].join('\n');

    const expanded = expandStringConsts(sample);
    expect(NOT_CHARGED.test(sample.split('\n')[3])).toBe(false);
    expect(
      NOT_CHARGED.test(expanded.split('\n').at(-1)!),
      'the expander no longer inlines a hoisted string constant, so any rule reading a ' +
        'branch as text has silently stopped seeing copy that lives in one',
    ).toBe(true);

    // And it fires on at least one real route, not only on the sample.
    const expandedSomething = routes.some(
      (rel) => readCode(rel).length !== stripComments(source(rel)).length,
    );
    expect(
      expandedSomething,
      'no initiate route hoists copy into a constant any more - if that is deliberate, ' +
        'this control is the thing to re-read, not to delete',
    ).toBe(true);
  });

  it('⚠️ the control: the matcher really does recognise the claim', () => {
    expect(NOT_CHARGED.test('and nothing has been charged. Please try again')).toBe(true);
    expect(NOT_CHARGED.test('Nothing was charged. Check the number')).toBe(true);
    expect(NOT_CHARGED.test('we cannot tell you whether it went through')).toBe(false);
  });
});
