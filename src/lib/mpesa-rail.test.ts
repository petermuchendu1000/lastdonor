/**
 * One decider chooses the M-Pesa rail, and every donor-facing surface asks it.
 *
 * ── What this replaces, and why it is stronger ────────────────────────────
 *
 * `src/app/campaigns/[slug]/donate/charge-currency-premise.test.ts` is
 * DELETED, on its own instruction: it guarded one hazard — the donate page
 * calling `payHeroChargeCurrency()`, which THROWS when no currency routes to
 * PayHero — and said in its own header *"If it ever reads false, read
 * `docs/182` §6 and delete this file rather than satisfying it."* The page now
 * reads `mpesaChargeCurrency()`, which returns null, so the premise is gone.
 *
 * Deleting a guard is a serious act, so this one covers more than it did:
 *
 *   1. the throw is gone AND the null branch is EXECUTED, on a configuration
 *      that does not exist yet — which is the whole point, because the
 *      configuration that does not exist yet is the owner's next step;
 *   2. the rail is DERIVED everywhere rather than named, which is the defect
 *      the premise test could not see: four surfaces each compared a gateway
 *      to the literal `'payhero'`, so pointing KES at Palpluss would have
 *      removed the only working payment method from all of them at once while
 *      every test stayed green;
 *   3. the declared paths are checked AGAINST THE ROUTE TREE, so a typo in
 *      the form's table is a build failure and not a dead pay button.
 *
 * ⚠️ The BEHAVIOURAL half lives in `MpesaDonationForm.test.tsx`, which drives
 * the component and reads the URL it actually fetches. Text cannot see which
 * value a derivation reads (`docs/162` §5.1), and the distinction that
 * matters here — billed currency versus campaign currency — is invisible to
 * any structural rule: both spellings compile, both look right, and one of
 * them sends every USD campaign to a refusal screen.
 *
 * @vitest-environment node
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { SUPPORTED_CURRENCY_CODES, getCurrency } from '@/lib/money/currencies';
import { mpesaChargeCurrency, mpesaRailFor } from '@/lib/mpesa-rail';

const ROOT = process.cwd();
const DONATIONS = resolve(ROOT, 'src/app/api/v1/donations');
const FORM = 'src/components/campaign/MpesaDonationForm.tsx';
const DONATE_PAGE = 'src/app/campaigns/[slug]/donate/page.tsx';

/** Blank comments, so prose quoting a forbidden form cannot satisfy a rule. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const source = (rel: string) => code(read(rel));

const FORM_SRC = source(FORM);

/**
 * The rails that EXIST, read off the route tree.
 *
 * A rail is a directory under `donations/` serving both `initiate/route.ts`
 * and `status/route.ts` — the pair a push rail needs. Derived rather than
 * listed, so a third rail is covered the day it lands and a half-built one is
 * not mistaken for a finished one.
 */
function railsOnDisk(): string[] {
  return readdirSync(DONATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter(
      (name) =>
        existsSync(resolve(DONATIONS, name, 'initiate/route.ts')) &&
        existsSync(resolve(DONATIONS, name, 'status/route.ts')),
    )
    .sort();
}

/** The source text of the form's `RAIL_PATHS` object literal, braces included. */
function railPathsTable(): string {
  const start = FORM_SRC.indexOf('const RAIL_PATHS');
  expect(start, `no RAIL_PATHS table in ${FORM} - every rule below is vacuous`).toBeGreaterThan(
    -1,
  );
  /*
    ⚠️ From the `=`, not from the declaration. My first version took the first
    `{` after `const RAIL_PATHS`, which is the one inside the TYPE annotation
    `Record<MpesaRail, { initiate: string; status: string }>` - so brace
    matching ended at the type's closing brace and the table parsed as zero
    entries. Two rules then "passed" over an empty list and only the
    anti-vacuity row said so.
  */
  const open = FORM_SRC.indexOf('{', FORM_SRC.indexOf('=', start));
  let depth = 0;
  let end = open;
  for (let i = open; i < FORM_SRC.length; i += 1) {
    if (FORM_SRC[i] === '{') depth += 1;
    else if (FORM_SRC[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return FORM_SRC.slice(open, end);
}

/** The `RAIL_PATHS` table in the form, as `{ rail: { initiate, status } }`. */
function declaredPaths(): Record<string, { initiate: string; status: string }> {
  const out: Record<string, { initiate: string; status: string }> = {};
  for (const m of railPathsTable().matchAll(
    /(\w+):\s*\{\s*initiate:\s*'([^']+)',\s*status:\s*'([^']+)',?\s*\}/g,
  )) {
    out[m[1]] = { initiate: m[2], status: m[3] };
  }
  return out;
}

const codesByGateway = (predicate: (g: string) => boolean): string[] =>
  SUPPORTED_CURRENCY_CODES.filter((c) => predicate(getCurrency(c).gateway));

describe('the derivation itself', () => {
  it('ANTI-VACUITY: the currency table exercises both arms', () => {
    /*
      ⛔ Every rule below iterates the currency table. With no card currency
      the "answers null" rule passes over nothing, and with no M-Pesa currency
      so does its opposite - so neither would be protecting anything.
    */
    expect(
      codesByGateway((g) => g === 'stripe'),
      'no card currency - the null arm of mpesaRailFor is untested',
    ).not.toHaveLength(0);
    expect(
      codesByGateway((g) => g !== 'stripe'),
      'no M-Pesa currency - the rail arm of mpesaRailFor is untested',
    ).not.toHaveLength(0);
  });

  it('⛔ EXECUTED: a card currency gets no M-Pesa rail', () => {
    for (const code of codesByGateway((g) => g === 'stripe')) {
      expect(mpesaRailFor(code), `${code} is a card currency`).toBeNull();
    }
  });

  it('⛔ EXECUTED: every other currency gets the rail it names', () => {
    for (const code of codesByGateway((g) => g !== 'stripe')) {
      expect(mpesaRailFor(code)).toBe(getCurrency(code).gateway);
    }
  });

  it('⛔ EXECUTED: an unknown code is refused, not guessed', () => {
    /*
      `getCurrency` throws on an unknown code by design (`docs/92`: a shilling
      figure with a dollar sign still looks like money), and this function is
      called with whatever a page hands it. A throw here would be the error
      boundary inside a 200 on the donate page (`docs/88` F9), so the
      unsupported check comes FIRST.
    */
    for (const bogus of ['', ' ', 'ZZZ', 'KESS', 'not-a-currency']) {
      expect(mpesaRailFor(bogus), `${JSON.stringify(bogus)} must answer null`).toBeNull();
    }
  });

  it('CONTROL: but a known code in the wrong case still resolves', () => {
    /*
      ⚠️ My first version of the rule above listed `'kes'` as bogus and it
      FAILED - correctly. `isSupportedCurrency` runs `normaliseCurrencyCode`,
      which trims and upper-cases, and that is deliberate: codes arrive from
      gateways and from query strings. So "unknown" means *not a currency*,
      never *not upper-case*, and this pins the distinction rather than
      leaving the rule above to imply the stronger claim.
    */
    const mpesa = codesByGateway((g) => g !== 'stripe')[0];
    expect(mpesaRailFor(mpesa.toLowerCase())).toBe(mpesaRailFor(mpesa));
    expect(mpesaRailFor(` ${mpesa} `)).toBe(mpesaRailFor(mpesa));
  });

  it('CONTROL: the charge currency agrees with the derivation', () => {
    const mpesa = codesByGateway((g) => g !== 'stripe');
    expect(mpesaChargeCurrency()).toBe(mpesa.length === 1 ? mpesa[0] : null);
  });
});

/*
  ── The branch that matters is unreachable in today's configuration ───────

  `mpesaChargeCurrency()` must answer NULL, never throw, when no currency
  routes to an M-Pesa rail. That is precisely the state the owner creates
  half-way through flipping KES from one rail to the other, and it is the
  state the OLD call (`payHeroChargeCurrency`) turned into an error boundary
  on every live campaign's donate page.

  Today exactly one currency routes to M-Pesa, so a test driven only by the
  real table exercises the one-answer arm and nothing else - it would pass
  with the zero case removed entirely. `docs/157` §4.1 is the same problem and
  the same cure: simulate the configuration the runtime does not have.
*/
describe('⛔ SIMULATED: configurations that do not exist yet', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  /** Load `mpesa-rail` against a fabricated currency table. */
  async function withTable(table: Record<string, string>) {
    vi.doMock('@/lib/money/currencies', () => ({
      SUPPORTED_CURRENCY_CODES: Object.keys(table),
      isSupportedCurrency: (c: string) => c in table,
      getCurrency: (c: string) => {
        if (!(c in table)) throw new Error(`Unsupported currency: ${c}`);
        return { code: c, gateway: table[c] };
      },
    }));
    return import('@/lib/mpesa-rail');
  }

  it('answers null when NO currency routes to an M-Pesa rail', async () => {
    const { mpesaChargeCurrency: charge, mpesaRailFor: railFor } = await withTable({
      USD: 'stripe',
      EUR: 'stripe',
    });
    expect(charge()).toBeNull();
    expect(railFor('USD')).toBeNull();
  });

  it('answers null when TWO do, rather than picking one', async () => {
    /*
      Two is as much a refusal as none. A caller cannot act on "there are two"
      - picking one silently is how a donor is charged in the wrong money -
      and `palplussChargeCurrency()` already settled that for a single rail.
    */
    const { mpesaChargeCurrency: charge } = await withTable({
      USD: 'stripe',
      KES: 'payhero',
      TZS: 'palpluss',
    });
    expect(charge()).toBeNull();
  });

  it('follows the table to the OTHER rail, which is the owner\'s next step', async () => {
    /*
      The one-line change this whole module exists to make safe: KES moves
      from one rail to the other and every surface follows, with no code
      change and nothing throwing.
    */
    const { mpesaChargeCurrency: charge, mpesaRailFor: railFor } = await withTable({
      USD: 'stripe',
      KES: 'palpluss',
    });
    expect(charge()).toBe('KES');
    expect(railFor('KES')).toBe('palpluss');
  });
});

describe('the declared paths match the routes that exist', () => {
  const DISK = railsOnDisk();
  const DECLARED = declaredPaths();

  it('ANTI-VACUITY: both the route tree and the table were read', () => {
    expect(DISK.length, 'no rail serves both initiate and status - discovery is broken').
      toBeGreaterThanOrEqual(2);
    expect(Object.keys(DECLARED).length, `parsed no entries out of ${FORM}'s RAIL_PATHS`).
      toBeGreaterThanOrEqual(2);
  });

  it('⛔ every non-card gateway in the currency table is a rail that exists', () => {
    /*
      `MpesaRail` is `Exclude<gateway, 'stripe'>` - derived by exclusion, with
      no list to drift. This is the premise that makes that derivation safe:
      if somebody adds a CARD gateway to the union, `mpesaRailFor` would claim
      it as M-Pesa, and this is what refuses it rather than hoping nobody
      does.
    */
    const gateways = [...new Set(codesByGateway((g) => g !== 'stripe').map((c) => getCurrency(c).gateway))];
    const missing = gateways.filter((g) => !DISK.includes(g));
    expect(
      missing,
      `${missing.join(', ')} is routed to by a currency but serves no initiate+status pair. ` +
        'Either it is not an M-Pesa-shaped rail - in which case MpesaRail must stop being ' +
        '"everything that is not stripe" - or its routes were never built.',
    ).toEqual([]);
  });

  it('⛔ every rail that exists is declared, so the form can reach it', () => {
    const undeclared = DISK.filter((r) => !(r in DECLARED));
    expect(
      undeclared,
      `${undeclared.join(', ')} serves both routes and ${FORM} has no path for it, so no ` +
        'donor can ever be sent there.',
    ).toEqual([]);
  });

  it('⛔ and every declared path is a route on disk, not a typo', () => {
    /*
      The failure this catches is silent and expensive: a donor fills the
      form, presses pay, and the fetch 404s. Nothing else in the codebase
      compares these strings to the file system.
    */
    for (const [rail, paths] of Object.entries(DECLARED)) {
      for (const [action, path] of Object.entries(paths)) {
        const expected = `/api/v1/donations/${rail}/${action}`;
        expect(path, `${rail}.${action} points at ${path}`).toBe(expected);
        expect(
          existsSync(resolve(ROOT, 'src/app', path.replace(/^\//, ''), 'route.ts')),
          `${path} has no route.ts on disk`,
        ).toBe(true);
      }
    }
  });
});

describe('no surface names a rail by hand', () => {
  /**
   * The donor-facing surfaces that choose between a card form and an M-Pesa
   * one, or that quote an M-Pesa charge.
   *
   * Scoped deliberately. A RAIL'S OWN route and client must name itself -
   * `payhero.ts` refusing a currency whose gateway is not `'payhero'` is that
   * rail asserting it collects what it is being handed, which is correct and
   * is a different statement from *which rail*.
   */
  const SURFACES = [
    FORM,
    'src/components/campaign/DonationForm.tsx',
    DONATE_PAGE,
    'src/app/campaigns/[slug]/donate/client.tsx',
    'src/app/donate/page.tsx',
  ];

  it('ANTI-VACUITY: the surfaces exist and were read', () => {
    for (const rel of SURFACES) {
      expect(existsSync(resolve(ROOT, rel)), `${rel} is gone - its rule is vacuous`).toBe(true);
      expect(source(rel).length, `${rel} read as empty`).toBeGreaterThan(500);
    }
  });

  it('ANTI-VACUITY: comment blanking really removes text', () => {
    /*
      Every rule below is a `not.toMatch`, so if `code()` stopped working -
      or started blanking the whole file - they would all pass over nothing
      (`docs/163` §5.1).

      ⚠️ This asserted `FORM_SRC.length < raw.length - 200` and FAILED,
      because `code()` blanks in PLACE: it replaces every non-newline
      character of a comment with a space, so the two lengths are equal by
      design (which is what keeps character offsets usable). The property is
      that the comment TEXT is gone, not that the file shrank - so the check
      names a phrase this file's own prose contains and the code does not.
    */
    const raw = read(FORM);
    const phrase = 'Deliberately placed AFTER the failed branch';
    expect(raw, 'that comment has been reworded - pick another phrase').toContain(phrase);
    expect(FORM_SRC, 'comments are not being blanked').not.toContain(phrase);
    expect(FORM_SRC, 'blanking ate the code too').toContain('RAIL_PATHS');
  });

  it.each(SURFACES)('%s does not compare a gateway to a rail literal', (rel) => {
    const src = source(rel);
    const offenders = Array.from(
      src.matchAll(/gateway\s*(?:===|!==)\s*'(payhero|palpluss)'/g),
    ).map((m) => m[0]);
    expect(
      offenders,
      `${rel} decides between rails by naming one. Ask mpesaRailFor(currency) instead - a ` +
        'literal here removes the only working payment method the day the currency table ' +
        'points at the other rail, with every test still green.',
    ).toEqual([]);
  });

  it('⛔ the form builds no rail path outside its one table', () => {
    const table = railPathsTable();
    const elsewhere = FORM_SRC.replace(table, ' ');

    expect(table, 'the table itself must hold the literals').toContain('/api/v1/donations/');
    const strays = Array.from(elsewhere.matchAll(/['"`]\/api\/v1\/donations\/[^'"`]*/g)).map(
      (m) => m[0],
    );
    expect(
      strays,
      `${FORM} names a donations path outside RAIL_PATHS: ${strays.join(', ')}. ` +
        'One builder (`docs/118`) - and the guards in src/app/api/v1/donations/ find a ' +
        "route's clients by asking which files name its path.",
    ).toEqual([]);
  });

  it('⛔ the form takes the rail from the currency the donor is BILLED in', () => {
    /*
      Structural half only. The behavioural proof is in
      `MpesaDonationForm.test.tsx`, because `mpesaRailFor(currency)` and
      `mpesaRailFor(billedCurrency)` both compile, both read correctly, and
      differ only in that the first sends every cross-currency donor to a
      refusal screen.
    */
    expect(
      FORM_SRC,
      'the rail must be derived from billedCurrency - the same value printed on the pay ' +
        'button - so the charge shown and the rail that performs it cannot disagree',
    ).toMatch(/mpesaRailFor\(billedCurrency\)/);
  });

  it('⛔ the donate page derives its charge currency without a throw', () => {
    const src = source(DONATE_PAGE);
    expect(src, 'the page must read the shared derivation').toMatch(/mpesaChargeCurrency\(/);
    for (const throwing of ['payHeroChargeCurrency', 'palplussChargeCurrency']) {
      expect(
        src.includes(throwing),
        `${DONATE_PAGE} calls ${throwing}(), which throws when its rail has no currency - ` +
          'and it runs for EVERY campaign on EVERY load, so that is the error boundary ' +
          'inside a 200 on every live donate page (docs/182 §6).',
      ).toBe(false);
    }
    expect(
      src,
      'a null charge currency must be handled, not passed on - chargePreviewFor takes a string',
    ).toMatch(/mpesaCurrency\s*\n?\s*\?/);
  });
});
