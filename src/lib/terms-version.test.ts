/**
 * The terms page cannot disagree with the version every consent attests to.
 *
 * ── THE DEFECT (2026-10-30, `docs/152` §7) ──────────────────────────────────
 *
 * `consentRecord` stamps `TERMS_VERSION` onto every campaign submission, so
 * that value is the platform's answer to *"which document did this organiser
 * actually agree to"*. `docs/113` §10.2 recorded the hazard in prose:
 *
 *   ⚠️ "Bump `TERMS_VERSION` in the same commit that edits `/terms` - nothing
 *      enforces it, and a stale value attests to the wrong document."
 *
 * In the very turn that warning was read, `/terms` was edited (the Stripe-only
 * collection claim and the hardcoded USD bounds) and the constant was NOT
 * bumped. Meanwhile the page's own "Last updated" line read **April 1, 2026**
 * while the constant read **2026-10-25** - so there were already two answers,
 * and the visible one was six months out.
 *
 * **A human step that is only written down is a step that gets skipped.**
 *
 * ── WHAT THIS RULE CAN AND CANNOT DO ────────────────────────────────────────
 *
 * ⛔ It cannot tell whether somebody bumped the constant when they should
 * have - that needs git history, and a rule built on history would fail on
 * every unrelated commit that touches the file. What it CAN do is make the
 * two statements ONE statement, so the page is never the stale half: the page
 * renders `termsVersionLabel()`, and this pins that it carries no date of its
 * own to drift back to.
 *
 * ⚠️ The remaining human step is the constant itself, and it is now a single
 * value with one consumer rather than a value plus a page that must match it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TERMS_VERSION, termsVersionLabel } from './campaign-consent';

const TERMS_PAGE = readFileSync(join(__dirname, '../app/terms/page.tsx'), 'utf8');

/** Comments stripped: `docs/116` §4 - the comment above the fix quotes it. */
const CODE = TERMS_PAGE.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ').replace(
  /\/\*[\s\S]*?\*\//g,
  ' ',
);

describe('TERMS_VERSION and the terms page are one fact', () => {
  it('the constant is an ISO date (anti-vacuity)', () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('the label renders the constant, in the constant`s own day', () => {
    /*
      ⚠️ `new Date('2026-10-30')` is UTC midnight, so `toLocaleDateString`
      in any negative offset renders the PREVIOUS day - the terms page would
      claim a date one earlier than the record attests to. Pinned because the
      naive one-liner is the obvious way to write this.
    */
    const [y, m, d] = TERMS_VERSION.split('-').map(Number);
    const label = termsVersionLabel();
    expect(label).toContain(String(y));
    expect(label).toContain(String(d));
    expect(label).toMatch(
      new RegExp(
        [
          'January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December',
        ][m - 1],
      ),
    );
  });

  it('⛔ the terms page carries NO hardcoded date of its own', () => {
    /*
      This is the whole rule. A literal date here is a second answer to a
      question that already has one, and it is the answer a reader sees.
    */
    expect(
      CODE,
      'the terms page writes out a date instead of deriving it from TERMS_VERSION',
    ).not.toMatch(
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/,
    );
    expect(CODE, 'the terms page no longer derives its date at all').toContain(
      'termsVersionLabel()',
    );
  });

  it('⚠️ and the version is not older than the newest policy page (control)', () => {
    /*
      A loose floor, not a pin: `/terms` is the only page tied to a consent
      record, but if a SIBLING policy page is stamped later than the terms
      version, somebody edited the policies and bumped the wrong thing. It
      relaxes on its own the moment TERMS_VERSION is bumped.
    */
    const siblings = ['refund-policy', 'privacy', 'fund-release-policy'];
    const termsMs = Date.parse(TERMS_VERSION);
    for (const s of siblings) {
      const src = readFileSync(join(__dirname, `../app/${s}/page.tsx`), 'utf8');
      const m = /Last updated:\s*([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(src);
      if (!m) continue; // a page that derives its date is fine
      expect(
        Date.parse(m[1]),
        `/${s} is stamped ${m[1]}, later than TERMS_VERSION ${TERMS_VERSION}`,
      ).toBeLessThanOrEqual(termsMs);
    }
  });
});
