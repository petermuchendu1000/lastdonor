/**
 * An outcome we cannot verify must not be reported as one we can.
 *
 * ── WHY A RULE ──────────────────────────────────────────────────────────────
 *
 * `docs/160`. `settlePayHeroRequest` answers `unverifiable` when it cannot
 * establish what happened, and the status route used to report that to the
 * browser as `state: 'failed'`. The client's `failed` screen heads with "Your
 * donation was not completed" and then appends, unconditionally and outside
 * the `??` that holds the server's message:
 *
 *     "That usually means the prompt was cancelled, it timed out before the
 *      PIN was entered, or there was not enough in the M-Pesa balance."
 *
 * Three invented causes for an outcome the sentence above has just said we
 * cannot determine. On the amount-mismatch path
 * (`payhero-settlement.ts:198-224`) the platform's own audit row reads *"Money
 * moved but no donation row was written"* - so that sentence would be
 * addressed to somebody whose balance had just been debited, under a heading
 * telling them nothing happened, beside a button inviting them to pay again.
 *
 * This is `docs/158`'s rule - a claim about somebody's money may only be made
 * when we know it - applied to the poll rather than to initiation, and
 * `docs/121`'s on the way out. It is a rule rather than a one-off fix because
 * "unverifiable is basically a failure" is a permanently tempting
 * simplification: the two differ by which screen renders, and nothing in the
 * type system distinguishes them.
 *
 * ⚠️ DERIVED AT BOTH ENDS. It reads the CLIENT to learn which server states
 * render the claiming screen, and the ROUTE to learn what the unverifiable
 * branch answers. Renaming a state, re-pointing the client's mapping, or
 * changing the branch each fail it; pinning the literal `'failed'` would have
 * caught none of those.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../../../../..');
const ROUTE = 'src/app/api/v1/donations/payhero/status/route.ts';
const FORM = 'src/components/campaign/MpesaDonationForm.tsx';

function source(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

/**
 * Blank comments, keeping newlines, so prose never counts as code.
 *
 * ⛔ Load-bearing: the comment explaining this very fix necessarily quotes
 * `'failed'` and the copy it replaced, so a raw-source match would report the
 * fix as the defect (`docs/116` §4).
 */
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

/**
 * The body of `case '<kind>':` up to the next `case ` at the same level.
 *
 * ⛔ Brace-matched rather than a fixed slice, for the reason `docs/116` §4 and
 * `docs/153` §5 both record: a window of N characters moves when a comment
 * does, and `[^>]*`-style patterns stop at the first delimiter.
 */
function caseBody(code: string, kind: string): string | null {
  const anchor = `case '${kind}':`;
  const start = code.indexOf(anchor);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start + anchor.length; i < code.length; i += 1) {
    const c = code[i];
    if (c === '{' || c === '(') depth += 1;
    else if (c === '}' || c === ')') {
      depth -= 1;
      // Fell out of the switch body entirely.
      if (depth < 0) return code.slice(start, i);
    } else if (depth === 0 && code.startsWith('case ', i)) {
      return code.slice(start, i);
    }
  }
  return code.slice(start);
}

/** Every quoted string in a fragment. */
function literals(fragment: string): string[] {
  return Array.from(fragment.matchAll(/'([^'\\]*)'/g)).map((m) => m[1]);
}

const ROUTE_SRC = stripComments(source(ROUTE));
const FORM_SRC = stripComments(source(FORM));

/**
 * The server states the CLIENT renders with its claiming screen, read from the
 * client itself: `if (state === 'failed' || state === 'abandoned') {`.
 */
function claimingStates(): string[] {
  const line = FORM_SRC.split('\n').find(
    (l) => l.includes('state ===') && l.includes("setPhase('failed')".slice(0, 8)) === false && l.includes('||'),
  );
  // The mapping may be written across one line or several; take every
  // `state === '<x>'` that appears before the failed-phase assignment.
  const idx = FORM_SRC.indexOf("setPhase('failed')");
  const before = idx === -1 ? '' : FORM_SRC.slice(Math.max(0, idx - 400), idx);
  const found = Array.from(before.matchAll(/state === '([a-z_]+)'/g)).map((m) => m[1]);
  void line;
  return Array.from(new Set(found));
}

describe('an unverifiable outcome is not reported as a known one', () => {
  const CLAIMING = claimingStates();
  const UNVERIFIABLE = caseBody(ROUTE_SRC, 'unverifiable');
  const FAILED = caseBody(ROUTE_SRC, 'failed');

  it('ANTI-VACUITY: the client really does have a claiming screen', () => {
    /*
      Without this, `claimingStates()` returning [] would make rule 1 pass
      against anything - the exact "check that cannot fail" Gate 4 is about.
    */
    expect(CLAIMING.length, 'derived no claiming states from the client').toBeGreaterThan(0);
    expect(CLAIMING).toContain('failed');
  });

  it('ANTI-VACUITY: the route still has both branches to compare', () => {
    expect(UNVERIFIABLE, `no case 'unverifiable' in ${ROUTE}`).toBeTruthy();
    expect(FAILED, `no case 'failed' in ${ROUTE}`).toBeTruthy();
  });

  it('⛔ the unverifiable branch answers no state the client would claim with', () => {
    const answered = literals(UNVERIFIABLE!).filter((l) => CLAIMING.includes(l));
    expect(
      answered,
      `the unverifiable branch answers ${JSON.stringify(answered)}, which the client renders ` +
        'with its "Your donation was not completed" screen - a claim about money we have just ' +
        'said we cannot verify (docs/160)',
    ).toEqual([]);
  });

  it('⛔ and it stops the poll, or the donor spins forever', () => {
    /*
      `docs/159`: the client stops on `keepPolling === false`. Reporting the
      row's real `pending` state without that flag reinstates the endless
      loop - this fix and that one are coupled, so the rule checks both.
    */
    expect(
      /\bfalse\b/.test(UNVERIFIABLE!),
      'the unverifiable branch must pass keepPolling: false explicitly - `settled` derives it ' +
        'from the state, and `pending` derives to TRUE (docs/159)',
    ).toBe(true);
  });

  it('⛔ and it claims nothing about the money', () => {
    const CLAIMS = [
      /nothing (?:has been|was) charged/i,
      /did not go through/i,
      /was not completed/i,
    ];
    for (const c of CLAIMS) {
      expect(c.test(UNVERIFIABLE!), `the unverifiable branch must not say ${c}`).toBe(false);
    }
  });

  it('ANTI-VACUITY: the genuine failure branch still says so', () => {
    /*
      Otherwise every rule above is satisfied by removing all outcome copy and
      telling every donor nothing. PayHero ANSWERED on this branch, so the
      claim is substantiated and must survive.
    */
    const answered = literals(FAILED!).filter((l) => CLAIMING.includes(l));
    expect(answered, 'the real failure branch must still answer a claiming state').not.toEqual([]);
    expect(/nothing has been charged/i.test(FAILED!)).toBe(true);
  });
});
