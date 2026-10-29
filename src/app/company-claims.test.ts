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

// The 254 ISO country codes `docs/103` generated. Used to DERIVE country
// names rather than hand-listing them; see the last describe block.
import { COUNTRY_CURRENCY } from '@/lib/geo/country-currency.generated';

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

describe('no surface publishes a country as if it were an address', () => {
  /*
    The footer and `/privacy` published:

        LastDonor.org
        United States
        contact@lastdonor.org

    A country with no street is not an address. It is a claim about where the
    platform operates, and after `docs/148` removed `areaServed` from the
    Organization graph it was the LAST `United States` assertion left in
    user-facing copy. Owner decision 2026-10-29: remove it, on the same
    principle `docs/148` and `docs/76` already applied - absent asserts
    nothing, while a bare country asserts a jurisdiction `/terms` does not
    establish (the rule above proves it does not).

    ⚠️ It also added no information: `/privacy` tells the reader, one sentence
    above, to email for the current mailing details.

    ⛔ THIS IS NOT THE CAN-SPAM ADDRESS. That is `MAILING_POSTAL_ADDRESS`,
    [VERIFIED] read only by `src/lib/email-shell.ts:222` from the environment,
    nothing to do with these two blocks, and still unset - which is why the
    newsletter cron refuses to send (`docs/123`, `docs/135`). A real address
    belongs there, and putting a country here never made one exist.

    ── WHY THE COUNTRY LIST IS DERIVED ──────────────────────────────────────

    A hand-written list of countries is the shape this codebase keeps getting
    burned by (`docs/119`, `docs/124`, `docs/144`, `docs/146`, `docs/147`): it
    is only as good as whoever remembered to extend it, and it would catch
    "United States" while missing "Kenya". So the names come from the 254 ISO
    codes `docs/103` generated, resolved through `Intl.DisplayNames` - the
    same ICU data a human typing a country name would be reproducing.

    ⚠️ ICU does not produce every form a person might type, so the few
    abbreviations it cannot generate are added explicitly and labelled as
    such. That is a supplement to a derived list, not a substitute for one.
  */
  const CONTACT_SURFACES = [
    ['Footer.tsx', readFileSync(join(SRC, 'components/layout/Footer.tsx'), 'utf8')],
    ['privacy/page.tsx', readFileSync(join(SRC, 'app/privacy/page.tsx'), 'utf8')],
  ] as const;

  const COUNTRY_NAMES: Set<string> = (() => {
    const names = new Set<string>();
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    for (const code of Object.keys(COUNTRY_CURRENCY)) {
      const name = dn.of(code);
      if (name && name !== code) names.add(name);
    }
    // Forms ICU will not emit. Explicit, and few, on purpose.
    for (const extra of ['USA', 'U.S.A.', 'U.S.', 'US', 'UK', 'U.K.', 'England', 'Britain']) {
      names.add(extra);
    }
    return names;
  })();

  it('derived the country names at all (guards a vacuous pass)', () => {
    // Without this, an empty set would make every rule below trivially pass.
    expect(COUNTRY_NAMES.size).toBeGreaterThan(200);
    expect(COUNTRY_NAMES.has('United States')).toBe(true);
    expect(COUNTRY_NAMES.has('Kenya')).toBe(true);
    expect(COUNTRY_NAMES.has('United Kingdom')).toBe(true);
  });

  /**
   * The contact block: from the brand line to the end of its element. Scoped
   * rather than whole-file, because `/privacy` legitimately discusses
   * international transfers in prose and the footer carries unrelated copy.
   */
  function contactBlock(src: string): string | null {
    const i = src.indexOf('LastDonor.org<br />');
    if (i === -1) return null;
    const end = src.indexOf('</', i);
    return end === -1 ? src.slice(i) : src.slice(i, end);
  }

  it('finds a contact block in both surfaces (guards a vacuous pass)', () => {
    for (const [name, src] of CONTACT_SURFACES) {
      expect(contactBlock(src), `${name} has no contact block to check`).not.toBeNull();
    }
  });

  it('publishes no bare country line in either contact block', () => {
    for (const [name, src] of CONTACT_SURFACES) {
      const block = contactBlock(src)!;
      /*
        AUTO-RELAXING, deliberately: a block that also carries a street line -
        anything with a digit in it, which a street number or a postcode has
        and a bare country name does not - is a real address, and naming the
        country in it is then correct rather than a claim standing in for one.
        So supplying a real address makes this rule stop applying instead of
        having to be edited.
      */
      const hasStreetLine = /\d/.test(block);
      if (hasStreetLine) continue;

      const lines = block
        .split(/<br\s*\/?>|\n/)
        .map((l) => l.replace(/<[^>]*>/g, '').trim())
        .filter(Boolean);

      const offenders = lines.filter((l) => COUNTRY_NAMES.has(l));
      expect(
        offenders,
        `${name}: a country name on its own line is a jurisdiction claim, not an address. ` +
          `Add a street address (then this rule relaxes), or leave it out.`,
      ).toEqual([]);
    }
  });

  it('still publishes a way to reach a human in both blocks', () => {
    /*
      The control. Without it, deleting both contact blocks entirely would
      satisfy every rule above - and a privacy page with no contact route is
      worse than one naming a country.
    */
    for (const [name, src] of CONTACT_SURFACES) {
      expect(contactBlock(src)!, `${name} must still carry an email address`).toMatch(
        /@lastdonor\.org/,
      );
    }
  });
});
