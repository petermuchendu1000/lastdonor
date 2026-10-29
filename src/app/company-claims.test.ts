/**
 * Machine-readable claims about the COMPANY, which nothing compared.
 *
 * `foundingDate` in the Organization JSON-LD and `- Founded:` in
 * `public/llms.txt` are the same fact stated twice, in two surfaces search
 * engines and AI crawlers republish and no human ever reads. They said
 * **2024** on an entity whose domain [VERIFIED by `.org` RDAP, 2026-10-29]
 * was registered **2026-03-20**. `docs/142` found it and correctly left it as
 * [UNKNOWN] - a fact only the owner holds - and the owner answered 2026 on
 * 2026-10-29.
 *
 * ⚠️ The useful rule is not the year. It is that **two surfaces asserting one
 * fact must agree**, and that a claim about where the company is established
 * must be backed by the document that would establish it. Both drifted
 * together here; nothing would have caught them drifting apart.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');
const ROOT = join(SRC, '..');

const LAYOUT = readFileSync(join(SRC, 'app/layout.tsx'), 'utf8');
const LLMS = readFileSync(join(ROOT, 'public/llms.txt'), 'utf8');
const TERMS = readFileSync(join(SRC, 'app/terms/page.tsx'), 'utf8');

/**
 * The domain's registration date, [VERIFIED 2026-10-29] from the `.org` RDAP
 * service (`rdap.publicinterestregistry.org`): `registration =
 * 2026-03-20T05:45:57.643Z`.
 *
 * It is NOT the founding date and must never be written as one - it is the
 * earliest date anything about this platform demonstrably existed, which is
 * what makes it a usable floor.
 */
const DOMAIN_REGISTERED_YEAR = 2026;

function layoutFoundingYear(): number {
  const m = /foundingDate:\s*'(\d{4})/.exec(LAYOUT);
  expect(m, 'foundingDate not found in the Organization graph').not.toBeNull();
  return Number(m![1]);
}

function llmsFoundedYear(): number {
  const m = /^- Founded:\s*(\d{4})\s*$/m.exec(LLMS);
  expect(m, '"- Founded:" not found in public/llms.txt').not.toBeNull();
  return Number(m![1]);
}

describe('the company facts stated in two machine-readable surfaces agree', () => {
  it('states a founding year in both surfaces', () => {
    // Anti-vacuity: deleting either claim would satisfy the comparison below
    // by making one side absent, so both must be present first.
    expect(layoutFoundingYear()).toBeGreaterThan(1900);
    expect(llmsFoundedYear()).toBeGreaterThan(1900);
  });

  it('agrees on the founding year', () => {
    expect(llmsFoundedYear()).toBe(layoutFoundingYear());
  });

  it('does not claim a founding year before anything demonstrably existed', () => {
    /*
      A floor, not a pin. It does not assert WHICH year is right - only that
      the platform cannot have been founded before its own domain was
      registered. 2024 fails this; 2026 and anything later passes, so the
      owner can correct the year without touching the rule.
    */
    expect(layoutFoundingYear()).toBeGreaterThanOrEqual(DOMAIN_REGISTERED_YEAR);
    expect(llmsFoundedYear()).toBeGreaterThanOrEqual(DOMAIN_REGISTERED_YEAR);
  });
});

describe('no surface claims a jurisdiction the terms do not establish', () => {
  /*
    `public/llms.txt` carried `- Jurisdiction: United States`, and [VERIFIED]
    it was the ONLY jurisdiction claim in the whole product: `/terms` contains
    no governing-law clause, no jurisdiction, no arbitration provision. So the
    one place the claim appeared was a crawler-facing text file, with nothing
    behind it.

    The rule DERIVES both ends and relaxes on its own: state a governing law
    in `/terms` and a matching `llms.txt` line becomes legal again. It is the
    `docs/127` shape - a promise must be backed by the thing that would make
    it true.
  */
  const TERMS_ESTABLISHES_LAW =
    /governing law|governed by the laws|laws of the (State|Commonwealth|Republic)|exclusive jurisdiction|binding arbitration/i.test(
      TERMS,
    );

  it('has no governing-law clause in /terms today', () => {
    // The premise, asserted rather than assumed. If this flips, the next rule
    // stops applying and somebody should re-read this decision.
    expect(TERMS_ESTABLISHES_LAW).toBe(false);
  });

  it('makes no jurisdiction claim while /terms establishes none', () => {
    if (TERMS_ESTABLISHES_LAW) return;
    expect(LLMS).not.toMatch(/^-\s*Jurisdiction:/im);
    expect(LLMS).not.toMatch(/incorporated in|registered (company )?in [A-Z]/);
  });

  it('still describes the platform to a crawler', () => {
    // Anti-vacuity: emptying llms.txt would satisfy every rule above.
    expect(LLMS).toMatch(/^- Platform type:/m);
    expect(LLMS).toMatch(/^- Platform fees:/m);
    expect(LLMS).toMatch(/^- Domain:/m);
  });

  it('claims no UK registration, which is planned and not a fact', () => {
    /*
      Owner, 2026-10-29: *"we plan to register the company in UK"*. A plan is
      not a fact and CLAUDE.md forbids publishing one as such. This rule
      exists because the intention is now written down, which is exactly when
      somebody adds it to a page.
    */
    for (const [name, src] of [
      ['llms.txt', LLMS],
      ['layout.tsx', LAYOUT],
    ] as const) {
      expect(src, `${name} must not claim a UK entity`).not.toMatch(
        /United Kingdom|\bUK (company|entity|registered)|Companies House/i,
      );
    }
  });
});
