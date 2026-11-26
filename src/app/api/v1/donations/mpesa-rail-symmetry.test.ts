/**
 * Both M-Pesa rails answer "what do I charge in?" the same way, and both
 * refuse before they spend anything.
 *
 * ── WHY A RULE ──────────────────────────────────────────────────────────────
 *
 * `docs/185` moved `KES` from `gateway: 'payhero'` to `gateway: 'palpluss'` —
 * one line — and the PayHero initiate route started answering **HTTP 500**.
 * The two rails had drifted into opposite shapes for one question:
 *
 *   - `palplussChargeCurrency()` returned `string | null`, and its route
 *     asked it FIRST and answered a clean `503 PAYMENTS_UNAVAILABLE`.
 *   - `payHeroChargeCurrency()` **threw**, and its route asked it at line
 *     ~204 — after the campaign lookup, the amount check and the raise cap —
 *     so the throw landed in the outer catch as a bare 500, four queries in.
 *
 * ⚠️ Neither shape was careless. `docs/182` §4 justified the throw: *"exactly
 * one currency has always named it, so there it means the currency table is
 * broken."* True when written, and **the flip is what spent the premise**:
 * zero currencies name PayHero now, deliberately. `docs/182` §6 even recorded
 * the consequence — *"`payhero/initiate/route.ts:204` has the same call,
 * where it would surface as a 500"* — and left it, because at the time it was
 * unreachable.
 *
 * ⛔ So nothing caught it: `tsc` cannot see a throw, and [VERIFIED] no test
 * executes that route at all (`docs/182`: *"the PayHero twin has no
 * behavioural test"*). This rule is what makes the next rail symmetric by
 * construction rather than by whoever read the other one first.
 *
 * @vitest-environment node
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const DONATIONS = resolve(__dirname);

/** Blank comments, so this file's own prose cannot satisfy or violate a rule. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

/**
 * Every `.../initiate/route.ts` under the donations tree, with the
 * charge-currency function it imports.
 *
 * ⛔ The function is DISCOVERED from the route's own imports, not listed here,
 * so a third rail is covered the day it lands — `docs/183` §6's rule, stated
 * once: *a guard written while one implementation exists names that
 * implementation, and the second is invisible to it.*
 */
function initiateRoutes(): { rel: string; src: string; fn: string }[] {
  return readdirSync(DONATIONS, { recursive: true, encoding: 'utf8' })
    .filter((p) => /(^|[\\/])initiate[\\/]route\.ts$/.test(p))
    .sort()
    .map((p) => {
      const src = code(readFileSync(resolve(DONATIONS, p), 'utf8'));
      const fn = src.match(/\b(\w*ChargeCurrency)\b/)?.[1] ?? '';
      return { rel: resolve(DONATIONS, p).replace(ROOT + '/', ''), src, fn };
    });
}

describe('the two M-Pesa rails have one shape', () => {
  const ROUTES = initiateRoutes();

  it('ANTI-VACUITY: both rails were discovered, each with its own derivation', () => {
    /*
      ⛔ Every per-route rule below iterates this list, and the CONTROL that
      the function names DIFFER is what stops the whole file passing by
      measuring one rail twice.
    */
    expect(ROUTES.length, 'fewer than two initiate routes found').toBeGreaterThanOrEqual(2);
    for (const r of ROUTES) {
      expect(r.fn, `${r.rel} imports no *ChargeCurrency function`).toMatch(/ChargeCurrency$/);
    }
    const names = new Set(ROUTES.map((r) => r.fn));
    expect(
      names.size,
      `all routes use the same derivation (${[...names]}), so this file measures one rail`,
    ).toBe(ROUTES.length);
  });

  it.each(ROUTES.map((r) => [r.rel, r] as const))(
    '%s: ⛔ asks what it charges in BEFORE it parses the body',
    (rel, r) => {
      /*
        The body parse is the gate everything expensive sits behind - the
        campaign lookup needs `campaignId` out of it, so the first `await db`
        in both routes is after it. Preceding the parse therefore means
        preceding ALL database work, which is the property that matters:
        refusing here costs nothing, and the 500 this rule exists for happened
        four queries deep.
      */
      const askedAt = r.src.indexOf(`${r.fn}()`);
      const parsedAt = r.src.indexOf('request.json()');
      expect(askedAt, `${r.fn}() is never called in ${rel}`).toBeGreaterThan(-1);
      expect(parsedAt, `${rel} never parses a body`).toBeGreaterThan(-1);
      expect(
        askedAt,
        `${rel} asks ${r.fn}() AFTER parsing the request body, so a rail that collects ` +
          'nothing is discovered only once the route has done real work. Ask first and ' +
          'refuse: docs/185.',
      ).toBeLessThan(parsedAt);
    },
  );

  it.each(ROUTES.map((r) => [r.rel, r] as const))(
    '%s: ⛔ refuses with a 503 when its rail collects nothing',
    (rel, r) => {
      /*
        Derived from the variable the call is assigned to, so renaming it does
        not quietly disarm this. The branch must be a guard clause on the
        falsy value - the shape that cannot fall through.
      */
      const assigned = r.src.match(
        new RegExp(`const\\s+(\\w+)\\s*=\\s*${r.fn}\\(\\)`),
      )?.[1];
      expect(assigned, `${r.fn}() in ${rel} is called but not assigned`).toBeTruthy();

      const guardAt = r.src.indexOf(`if (!${assigned})`);
      expect(
        guardAt,
        `${rel} never checks \`if (!${assigned})\`. ${r.fn}() can answer null - that is ` +
          'the live state for PayHero since docs/185 - and an unchecked null reaches the ' +
          'gateway call as an undefined currency.',
      ).toBeGreaterThan(-1);

      // The guard's own block, brace-matched rather than sliced to a fixed width.
      const open = r.src.indexOf('{', guardAt);
      let depth = 0;
      let end = open;
      for (let i = open; i < r.src.length; i += 1) {
        if (r.src[i] === '{') depth += 1;
        else if (r.src[i] === '}') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const block = r.src.slice(open, end);
      expect(block, `${rel}'s guard must answer 503`).toMatch(/\b503\b/);
      expect(block, `${rel}'s guard must return, not fall through`).toMatch(/return\s+fail\(/);
    },
  );

  it.each(ROUTES.map((r) => [r.rel, r] as const))(
    '%s: ⚠️ its derivation is typed to allow null',
    (rel, r) => {
      /*
        A route cannot usefully guard a function that throws instead of
        answering - that is the drift this file is named for. The signature is
        read from the module the route imports it from, which is found from
        the import rather than guessed.
      */
      const importedFrom = r.src.match(
        new RegExp(`import\\s*\\{[^}]*\\b${r.fn}\\b[^}]*\\}\\s*from\\s*'([^']+)'`, 's'),
      )?.[1];
      expect(importedFrom, `could not find where ${rel} imports ${r.fn} from`).toBeTruthy();

      const file = resolve(ROOT, 'src', `${importedFrom!.replace(/^@\//, '')}.ts`);
      const src = readFileSync(file, 'utf8');
      const signature = src.match(
        new RegExp(`export function ${r.fn}\\(\\)\\s*:\\s*([^{]+)\\{`),
      )?.[1];
      expect(signature, `${r.fn} is not an exported zero-arg function in ${file}`).toBeTruthy();
      expect(
        signature!.replace(/\s+/g, ''),
        `${r.fn} must return \`string | null\`. It THREW until docs/185, on the premise ` +
          'that zero currencies meant a broken table - which stopped being true the ' +
          'moment a rail was deliberately left collecting nothing.',
      ).toBe('string|null');
    },
  );
});

describe('neither rail client depends on the other', () => {
  const CLIENTS = [
    { name: 'payhero', file: 'src/lib/payhero.ts', other: 'palpluss' },
    { name: 'palpluss', file: 'src/lib/palpluss.ts', other: 'payhero' },
  ];

  it.each(CLIENTS)('⛔ $name does not import from $other', ({ file, other }) => {
    /*
      ⛔ `palpluss.ts` imported `LASTDONOR_REFERENCE_PREFIX` from `./payhero`
      until `docs/185` — so the client of the rail that COLLECTS depended on
      the module of the rail that collects nothing.

      ⚠️ That was found by a test failing to collect, not by reading: the
      health route gained a Palpluss check, its test mocks `@/lib/payhero`
      wholesale, and the mock swallowed a constant Palpluss needed —
      *"No LASTDONOR_REFERENCE_PREFIX export is defined on the @/lib/payhero
      mock"*. Mocking one rail broke the other.

      The shared constant lives in `mpesa-prompt.ts` now, which is the module
      `docs/159` prescribes and `docs/183` §8 renamed for exactly this: a fact
      about M-Pesa, or about our own rows, that two rails need.

      ⚠️ `payhero.ts` still RE-EXPORTS the name so the move broke no call
      site. A re-export is not a dependency — the import below is what this
      rule reads.
    */
    const src = code(readFileSync(resolve(ROOT, file), 'utf8'));
    const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s*'([^']+)';/gm)].map(
      (m) => m[1],
    );
    const offending = imports.filter((p) => new RegExp(`(^|/)${other}$`).test(p));
    expect(
      offending,
      `${file} imports ${offending.join(', ')} — the two M-Pesa clients must be ` +
        'independent, so that either can be the one collecting. A constant they share ' +
        'belongs in src/lib/mpesa-prompt.ts (docs/159, docs/183 §8).',
    ).toEqual([]);
  });

  it('CONTROL: the import scan actually sees this file\'s imports', () => {
    /*
      ⛔ Both rules above are `not`-shaped over a parsed list, so a scanner
      that parsed nothing would satisfy them (`docs/163` §5.1).
    */
    const src = code(readFileSync(resolve(ROOT, 'src/lib/palpluss.ts'), 'utf8'));
    const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s*'([^']+)';/gm)].map(
      (m) => m[1],
    );
    expect(imports.length, 'parsed no imports out of palpluss.ts').toBeGreaterThan(2);
    expect(imports, 'the shared constant must come from the neutral module').toContain(
      './mpesa-prompt',
    );
  });
});

/*
  ── EXECUTED: neither derivation throws when its rail collects nothing ─────

  The rules above read text, and text cannot tell a function that returns null
  from one that throws on the way to returning null. `docs/157` §4.1 is the
  same problem and the same cure: the branch that matters is unreachable under
  the real table (one rail always has a currency), so the table is simulated.
*/
describe('⛔ SIMULATED: a table where no currency names either rail', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  /** Load both clients against a card-only currency table. */
  async function withCardOnlyTable() {
    vi.doMock('@/lib/money/currencies', () => ({
      SUPPORTED_CURRENCY_CODES: ['USD'],
      isSupportedCurrency: (c: string) => c === 'USD',
      getCurrency: (c: string) => {
        if (c !== 'USD') throw new Error(`Unsupported currency: ${c}`);
        return { code: 'USD', gateway: 'stripe' };
      },
    }));
    vi.doMock('./money/currencies', () => ({
      SUPPORTED_CURRENCY_CODES: ['USD'],
      isSupportedCurrency: (c: string) => c === 'USD',
      getCurrency: (c: string) => {
        if (c !== 'USD') throw new Error(`Unsupported currency: ${c}`);
        return { code: 'USD', gateway: 'stripe' };
      },
    }));
    const [payhero, palpluss] = await Promise.all([
      import('@/lib/payhero'),
      import('@/lib/palpluss'),
    ]);
    return { payhero, palpluss };
  }

  it('PayHero answers null rather than throwing', async () => {
    const { payhero } = await withCardOnlyTable();
    expect(() => payhero.payHeroChargeCurrency()).not.toThrow();
    expect(payhero.payHeroChargeCurrency()).toBeNull();
  });

  it('Palpluss answers null rather than throwing', async () => {
    const { palpluss } = await withCardOnlyTable();
    expect(() => palpluss.palplussChargeCurrency()).not.toThrow();
    expect(palpluss.palplussChargeCurrency()).toBeNull();
  });

  it('CONTROL: under the REAL table exactly one of them answers', async () => {
    /*
      ⛔ Without this, both functions returning null unconditionally would
      satisfy the two rules above - and that is a platform that can collect
      nothing. Exactly one M-Pesa rail is configured at a time (`docs/184`:
      two is as much a refusal as none), so exactly one answers.

      ⚠️ The unmocks are load-bearing and this control is how I know:
      `vi.resetModules()` in `beforeEach` drops the module CACHE but leaves the
      `vi.doMock` REGISTRY in place, so the first run of this test re-imported
      both clients against the card-only table and read `[]` - "neither rail
      collects", which is what a genuinely broken platform looks like. The
      control failing is the only reason the simulation above is known to be
      measuring a simulation.
    */
    vi.doUnmock('@/lib/money/currencies');
    vi.doUnmock('./money/currencies');
    vi.resetModules();
    const [{ payHeroChargeCurrency }, { palplussChargeCurrency }] = await Promise.all([
      import('@/lib/payhero'),
      import('@/lib/palpluss'),
    ]);
    const answers = [payHeroChargeCurrency(), palplussChargeCurrency()].filter(Boolean);
    expect(
      answers,
      'exactly one M-Pesa rail should be routed to - neither or both is a refusal',
    ).toHaveLength(1);
  });
});
