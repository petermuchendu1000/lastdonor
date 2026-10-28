/**
 * One sweep over the screens that ask somebody to make an account, for the
 * benefits of having one that the product does not deliver.
 *
 * ── WHY A SWEEP AND NOT ANOTHER ASSERTION ───────────────────────────────────
 *
 * `docs/122` found three unsubstantiated promises on `/register` and removed
 * two of them by hand. Both of the ones it missed were on surfaces one click
 * away in the same flow:
 *
 *   `/register`  "Save campaigns and get updates as they close"   REMOVED
 *   `/login`     "…track your donations and saved campaigns."     UNSWEPT
 *   `/register`  "Ask for your money back without digging out
 *                 a receipt."                                     UNSWEPT
 *
 * Before `docs/127` the words "saved campaign" appeared in **exactly one
 * place in the whole codebase** - the sentence on `/login` promising them.
 * A hand fix on one page and nothing watching the other reads, from the
 * outside, exactly like coverage. `organiser-promises.test.ts` is the same
 * shape for the organiser side, and was written for the same reason.
 *
 * ── BOTH ENDS ARE DERIVED ───────────────────────────────────────────────────
 *
 * Neither rule pins today's answer. Each reads what the product HAS and what
 * the copy SAYS and requires them to agree, so building the feature makes the
 * rule pass on its own and nobody has to remember to come back here
 * (`docs/109`).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

/**
 * The screens a person reads while deciding to create or use an account.
 *
 * Not the marketing pages: `/how-it-works` and the homepage describe the
 * platform, not what an account buys you, and `fee-claims.test.ts` already
 * owns the claims they do make.
 *
 * ⚠️ And NOT `src/components/user/` - the account settings screen, which the
 * first version of this file swept. It fired there, on
 * `AccountPageClient.tsx:397`, where "Refunds, campaign status changes,
 * verification and withdrawal notices" is the LABEL ON A NOTIFICATION TOGGLE:
 * factual, correct, and naming the categories that switch controls. The rule
 * was too wide, not the copy wrong.
 *
 * The boundary taken is the one the file is about - a screen that SELLS an
 * account, not a screen for somebody who already has one - because the
 * alternative was an allowlist entry, and a rule with an exception somebody
 * has to maintain is how the next unswept claim gets written (`docs/121` §3
 * made the same call and removed the last legitimate case rather than except
 * it).
 */
const SURFACE_DIRS = ['src/app/login', 'src/app/register'];

function walk(dir: string): string[] {
  const abs = join(ROOT, dir);
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const full = join(abs, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(join(dir, entry)));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * ⛔ Comments are stripped FIRST.
 *
 * The comment explaining why a claim was removed necessarily quotes the claim
 * - both files edited by `docs/127` do - so a raw-source match reports the fix
 * as the defect. `docs/116` §4 learned this the expensive way, finding six
 * campaign inserts in four files, two of them prose.
 */
function strippedSource(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const SURFACES = SURFACE_DIRS.flatMap(walk).map((file) => ({
  path: relative(ROOT, file),
  source: strippedSource(file),
}));

describe('the sweep reaches something', () => {
  /*
    The control for both rules below. They are implications - "if the copy
    says X, the feature must exist" - and an implication over an empty set is
    true. Without this, deleting `SURFACE_DIRS` would turn the whole file
    green, which is the `docs/123` mistake (a rule whose own input it never
    checked).
  */
  it('reads the account-entry screens, and they have copy in them', () => {
    expect(SURFACES.length).toBeGreaterThanOrEqual(4);
    expect(SURFACES.map((s) => s.path)).toEqual(
      expect.arrayContaining([
        'src/app/login/page.tsx',
        'src/app/register/page.tsx',
        'src/app/login/forgot-password/page.tsx',
        'src/app/login/reset-password/page.tsx',
      ]),
    );
    for (const s of SURFACES) expect(s.source.length).toBeGreaterThan(100);
  });
});

describe('⛔ a saved-campaigns claim requires somewhere to save them', () => {
  /** End A, derived: does the schema declare storage for such a feature? */
  const schema = readFileSync(join(ROOT, 'src/db/schema.ts'), 'utf8');
  const STORAGE = /saved|bookmark|favou?rite|watchlist/i;
  const storageExists = STORAGE.test(schema);

  it('⚠️ end A: the schema has no saved/bookmarked-campaign storage today', () => {
    /*
      Stated out loud rather than assumed. If somebody builds the feature this
      assertion fails, which is the signal to re-read the rule below - it goes
      vacuous the moment storage exists, and a rule that quietly stops biting
      is worse than one that breaks.
    */
    expect(storageExists).toBe(false);
  });

  it('end B: no account-entry screen offers to save or bookmark a campaign', () => {
    if (storageExists) return;
    const offenders = SURFACES.filter((s) =>
      /\b(saved?|bookmark(ed)?|favou?rite[sd]?)\s+campaigns?\b/i.test(s.source),
    ).map((s) => s.path);

    expect(
      offenders,
      `names a saved-campaigns feature with no column, route or control behind it: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});

describe('⛔ a refund promise requires a donor-facing refund route', () => {
  /**
   * End A, derived from disk: an API route a DONOR can reach whose path is
   * about refunds. Everything under `admin/` is excluded - an administrator
   * refunding somebody is not the donor asking.
   */
  function donorRefundRoutes(dir: string): string[] {
    const abs = join(ROOT, dir);
    const out: string[] = [];
    for (const entry of readdirSync(abs)) {
      const full = join(abs, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'admin') continue;
        out.push(...donorRefundRoutes(join(dir, entry)));
      } else if (entry === 'route.ts' && /refund/i.test(dir)) {
        out.push(relative(ROOT, full));
      }
    }
    return out;
  }
  const routes = donorRefundRoutes('src/app/api');

  it('⚠️ end A: there is no donor-facing refund route today', () => {
    expect(routes).toEqual([]);
  });

  it('end B: no account-entry screen promises an easier way to be refunded', () => {
    if (routes.length > 0) return;
    /*
      `/refund-policy` is the operative instruction and it asks for the donor
      email address, the donation date, the campaign name, the amount and an
      explanation - the receipt. A guest follows that path and so does an
      account holder, so a signup page cannot offer the second one a shortcut.
    */
    const offenders = SURFACES.filter((s) =>
      /\brefunds?\b|\brefunded\b|\bmoney back\b/i.test(s.source),
    ).map((s) => s.path);

    expect(
      offenders,
      `promises something about refunds on a signup screen, with no donor-facing refund route: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});

describe('⚠️ the control: the rules are not satisfied by saying nothing', () => {
  /*
    Both rules above are absence rules, and an empty page passes every absence
    rule there is. `fee-claims.test.ts` carries the same control for the same
    reason: without it, deleting the fee section would be a valid "fix".
  */
  /*
    ⚠️ Looked up safely, and asserted found.

    The first version destructured with `!` at module scope, so emptying
    `SURFACE_DIRS` threw during COLLECTION - and a collection error emits no
    `x` line, reads as "no tests", and is indistinguishable from a broken
    file. That is exactly the probe that lied in `docs/124` §5.1. A control
    has to fail as an assertion to be read as one.
  */
  const sourceOf = (path: string): string => SURFACES.find((s) => s.path === path)?.source ?? '';
  const login = sourceOf('src/app/login/page.tsx');
  const register = sourceOf('src/app/register/page.tsx');

  it('/login still says what signing in opens', () => {
    expect(login, 'the login screen was not swept at all').not.toBe('');
    expect(login).toMatch(/campaigns you have supported and the updates you follow/i);
  });

  it('/register still lists what an account actually does', () => {
    expect(register, 'the register screen was not swept at all').not.toBe('');
    expect(register).toMatch(/Track every donation/i);
    expect(register).toMatch(/Get campaign updates by email/i);
    // Account-only and verified: `SidebarShareButton.tsx:63` mints an
    // attributed link only `if (isAuthenticated)`, and `/dashboard/impact`
    // reports what it brought in (`docs/57`, `docs/58`).
    expect(register).toMatch(/Share a campaign with your own link/i);
  });
});
