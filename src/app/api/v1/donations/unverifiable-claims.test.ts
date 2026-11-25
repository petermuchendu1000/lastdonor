/**
 * An outcome we cannot verify must not be reported as one we can.
 *
 * ── WHY A RULE ──────────────────────────────────────────────────────────────
 *
 * `docs/160`. A settlement answers `unverifiable` when it cannot establish
 * what happened, and the PayHero status route used to report that to the
 * browser as `state: 'failed'`. The client's `failed` screen heads with "Your
 * donation was not completed" and then appends, unconditionally and outside
 * the `??` that holds the server's message:
 *
 *     "That usually means the prompt was cancelled, it timed out before the
 *      PIN was entered, or there was not enough in the M-Pesa balance."
 *
 * Three invented causes for an outcome the sentence above has just said we
 * cannot determine. On the amount-mismatch path the platform's own audit row
 * reads *"Money moved but no donation row was written"* - so that sentence
 * would be addressed to somebody whose balance had just been debited, under a
 * heading telling them nothing happened, beside a button inviting them to pay
 * again.
 *
 * This is `docs/158`'s rule - a claim about somebody's money may only be made
 * when we know it - applied to the poll rather than to initiation, and
 * `docs/121`'s on the way out. It is a rule rather than a one-off fix because
 * "unverifiable is basically a failure" is a permanently tempting
 * simplification: the two differ by which screen renders, and nothing in the
 * type system distinguishes them.
 *
 * ── WHY IT MOVED HERE, AND WHY IT SWEEPS ──────────────────────────────────
 *
 * This file lived in `payhero/status/` and read that ONE route until
 * 2026-11-25. `settlePalplussRequest` answers `unverifiable` too, and its
 * route is correct - but only by its author's care, because nothing checked
 * it. That mattered the moment `MpesaDonationForm` stopped hardcoding the
 * PayHero paths: the Palpluss branch became donor-reachable for the first
 * time with no guard over it at all.
 *
 * That is the FOURTH instance of one shape in three days - `docs/116` §4 (a
 * review gate named two files while a third insert published unreviewed
 * campaigns in production), `docs/182` §8 and `docs/183` §6 (both sibling
 * rules in this directory, generalised for exactly this reason). `docs/110`
 * §9.2's rule applies: a third instance means a sweep, so the route list is
 * DISCOVERED and this file sits beside the routes rather than inside one.
 *
 * ⚠️ DERIVED AT BOTH ENDS. It reads the CLIENT to learn which server states
 * render the claiming screen, and each ROUTE to learn what its unverifiable
 * branch answers. Renaming a state, re-pointing the client's mapping, or
 * changing a branch each fail it; pinning the literal `'failed'` would have
 * caught none of those.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const DONATIONS = resolve(__dirname);
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

/**
 * Inline single-quoted `const` declarations, so hoisted copy is visible.
 *
 * ⛔ WHY: the Palpluss route lifts its failure sentence into
 * `const FAILED_MESSAGE = '…'` and uses it three times - which is right, since
 * `docs/152` is about four drifting promises about one thing - and this
 * sweep's own anti-vacuity rule then FIRED ON CORRECT CODE, reporting the
 * route as having dropped the reassurance. `docs/182` §8 hit exactly this and
 * its sibling in this directory carries the same helper for the same reason.
 *
 * ⛔ Also expands the shared copy module, because a message the routes IMPORT
 * is otherwise invisible: a `not.toMatch` rule over a branch whose text lives
 * behind an imported identifier passes while saying nothing.
 */
function expandStringConsts(s: string, extra = ''): string {
  const decl = /^[ \t]*(?:export )?const ([A-Za-z_$][\w$]*) =\s*((?:'(?:[^'\\]|\\.)*'\s*\+?\s*)+);/gm;
  let out = s;
  for (const m of `${s}\n${extra}`.matchAll(decl)) {
    const [, name, expr] = m;
    const value = Array.from(expr.matchAll(/'((?:[^'\\]|\\.)*)'/g))
      .map((p) => p[1])
      .join('');
    out = out.replace(new RegExp(`\\b${name}\\b(?!\\s*=\\s*')`, 'g'), `'${value}'`);
  }
  return out;
}

/** The module both rails take shared donor-facing copy from. */
const SHARED_COPY = stripComments(source('src/lib/mpesa-prompt.ts'));

const FORM_SRC = stripComments(source(FORM));

/** Every `.../status/route.ts` under the donations tree, with its source. */
function statusRoutes(): { rel: string; src: string }[] {
  return readdirSync(DONATIONS, { recursive: true, encoding: 'utf8' })
    .filter((p) => /(^|[\\/])status[\\/]route\.ts$/.test(p))
    .sort()
    .map((p) => ({
      rel: resolve(DONATIONS, p).replace(ROOT + '/', ''),
      src: expandStringConsts(
        stripComments(readFileSync(resolve(DONATIONS, p), 'utf8')),
        SHARED_COPY,
      ),
    }));
}

/**
 * The server states the CLIENT renders with its claiming screen.
 *
 * ⚠️ Read from the CONDITION OF THE BRANCH that assigns the failed phase, and
 * nothing else. The earlier version of this took every `state === '<x>'` in
 * the 400 characters before `setPhase('failed')`, which swept in whichever
 * neighbouring branches happened to fit - so adding a state above it changed
 * what this rule believed the failed screen claims with. A fixed window is
 * the `docs/153` §5 trap, and here it made the derivation depend on the order
 * branches are written in.
 */
function claimingStates(): string[] {
  const idx = FORM_SRC.indexOf("setPhase('failed')");
  if (idx === -1) return [];
  // The nearest `if (` that opens the enclosing branch.
  const ifAt = FORM_SRC.lastIndexOf('if (', idx);
  if (ifAt === -1) return [];
  let depth = 0;
  let close = ifAt;
  for (let i = FORM_SRC.indexOf('(', ifAt); i < idx; i += 1) {
    if (FORM_SRC[i] === '(') depth += 1;
    else if (FORM_SRC[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  const condition = FORM_SRC.slice(ifAt, close + 1);
  return Array.from(new Set(literals(condition)));
}

describe('an unverifiable outcome is not reported as a known one', () => {
  const ROUTES = statusRoutes();
  const CLAIMING = claimingStates();

  it('ANTI-VACUITY: the status routes were discovered, and both rails are among them', () => {
    /*
      ⛔ The reason this file stopped naming one path. If discovery broke,
      every per-route rule below would pass over nothing.
    */
    expect(ROUTES.length, 'no status routes found - discovery is broken').toBeGreaterThanOrEqual(
      2,
    );
    const names = ROUTES.map((r) => r.rel);
    expect(names.some((n) => n.includes('/payhero/'))).toBe(true);
    expect(names.some((n) => n.includes('/palpluss/'))).toBe(true);
  });

  it('ANTI-VACUITY: the client really does have a claiming screen', () => {
    /*
      Without this, `claimingStates()` returning [] would make rule 1 pass
      against anything - the exact "check that cannot fail" Gate 4 is about.
    */
    expect(CLAIMING.length, 'derived no claiming states from the client').toBeGreaterThan(0);
    expect(CLAIMING).toContain('failed');
  });

  it('CONTROL: the claiming states are the failed branch\'s own, not its neighbours\'', () => {
    /*
      ⛔ The precision this rule depends on. `reversed` and
      `collected_unrecorded` are terminal states with screens of their OWN,
      sitting either side of the failed branch - if the derivation swept them
      in, a route answering one of them would be reported as claiming a
      failure it does not claim.
    */
    expect(CLAIMING, 'reversed has its own screen (docs/181 §3.4)').not.toContain('reversed');
    expect(CLAIMING).not.toContain('collected_unrecorded');
    expect(CLAIMING).not.toContain('pending');
  });

  it('ANTI-VACUITY: hoisted and imported copy is actually expanded', () => {
    /*
      ⛔ Every claim rule below is a `not.toMatch`, and the honesty rule is a
      positive match over the failed branch. If this expansion stopped working
      both halves would go quiet: the positive one by firing on correct code
      (which is how the need was found), the negative ones by passing over
      text they can no longer see.
    */
    const sample = [
      "  const LOCAL_MSG = 'did not go through';",
      "  return settled('failed', LOCAL_MSG);",
    ].join('\n');
    expect(expandStringConsts(sample)).toContain("settled('failed', 'did not go through')");

    // And through the shared copy module, which the routes import from.
    expect(
      expandStringConsts("settled('x', COLLECTED_UNRECORDED_MESSAGE, false)", SHARED_COPY),
      'the shared copy module is not being expanded',
    ).toMatch(/went through/i);

    // A declaration must not be mistaken for a use and self-substituted.
    expect(expandStringConsts("const A = 'z';")).toContain("const A = 'z';");
  });

  it.each(ROUTES.map((r) => [r.rel, r] as const))(
    '%s: ANTI-VACUITY: it still has both branches to compare',
    (rel, r) => {
      expect(caseBody(r.src, 'unverifiable'), `no case 'unverifiable' in ${rel}`).toBeTruthy();
      expect(caseBody(r.src, 'failed'), `no case 'failed' in ${rel}`).toBeTruthy();
    },
  );

  it.each(ROUTES.map((r) => [r.rel, r] as const))(
    '%s: ⛔ its unverifiable branch answers no state the client would claim with',
    (rel, r) => {
      const answered = literals(caseBody(r.src, 'unverifiable')!).filter((l) =>
        CLAIMING.includes(l),
      );
      expect(
        answered,
        `${rel}'s unverifiable branch answers ${JSON.stringify(answered)}, which the client ` +
          'renders with its "Your donation was not completed" screen - a claim about money we ' +
          'have just said we cannot verify (docs/160)',
      ).toEqual([]);
    },
  );

  it.each(ROUTES.map((r) => [r.rel, r] as const))(
    '%s: ⛔ and it stops the poll, or the donor spins forever',
    (rel, r) => {
      /*
        `docs/159`: the client stops on `keepPolling === false`. Reporting the
        row's real `pending` state without that flag reinstates the endless
        loop - this fix and that one are coupled, so the rule checks both.
      */
      expect(
        /\bfalse\b/.test(caseBody(r.src, 'unverifiable')!),
        `${rel}'s unverifiable branch must pass keepPolling: false explicitly - \`settled\` ` +
          'derives it from the state, and `pending` derives to TRUE (docs/159)',
      ).toBe(true);
    },
  );

  it.each(ROUTES.map((r) => [r.rel, r] as const))(
    '%s: ⛔ and it claims nothing about the money',
    (rel, r) => {
      const CLAIMS = [
        /nothing (?:has been|was) charged/i,
        /did not go through/i,
        /was not completed/i,
      ];
      const body = caseBody(r.src, 'unverifiable')!;
      for (const c of CLAIMS) {
        expect(c.test(body), `${rel}'s unverifiable branch must not say ${c}`).toBe(false);
      }
    },
  );

  it.each(ROUTES.map((r) => [r.rel, r] as const))(
    '%s: ANTI-VACUITY: its genuine failure branch still says so',
    (rel, r) => {
      /*
        Otherwise every rule above is satisfied by removing all outcome copy
        and telling every donor nothing. The gateway ANSWERED on this branch,
        so the claim is substantiated and must survive.
      */
      const failed = caseBody(r.src, 'failed')!;
      const answered = literals(failed).filter((l) => CLAIMING.includes(l));
      expect(
        answered,
        `${rel}'s real failure branch must still answer a claiming state`,
      ).not.toEqual([]);
      expect(/nothing has been charged/i.test(failed), `${rel} dropped the reassurance`).toBe(
        true,
      );
    },
  );
});
