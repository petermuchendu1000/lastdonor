/**
 * The create wizard lets an organiser choose the currency, and no longer
 * asserts dollars anywhere.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `docs/116` §3 made `currency` settable by the API and recorded that it was
 * **reachable from no screen**, so every campaign ever created took the `USD`
 * default - on a platform whose only working rail is M-Pesa and whose only
 * real donations have been shillings (`docs/92`). `docs/118` §6 then found the
 * consequence: all 14 active production campaigns are USD routed to a Stripe
 * key that does not authenticate, so not one of them can take a donation.
 *
 * This is the owner's chosen fix (`docs/118` §10): make the working rail
 * reachable.
 *
 * ⚠️ Structural, and comments are stripped first - the comments explaining
 * this change necessarily quote the strings it forbids (`docs/116` §4).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SUPPORTED_CURRENCY_CODES } from '@/lib/money/currencies';

const ROOT = resolve(__dirname, '../../..');
const FORM = 'src/app/share-your-story/ShareYourStoryForm.tsx';

/** Comments blanked, length preserved. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

const raw = readFileSync(resolve(ROOT, FORM), 'utf8');
const code = stripComments(raw);

describe('the sweep can see the file', () => {
  it('read a real component', () => {
    // Without this every assertion below passes against an empty string.
    expect(raw.length).toBeGreaterThan(50_000);
    expect(code).toContain('ShareYourStoryForm');
  });

  it('⛔ stripping is load-bearing here', () => {
    /*
      Demonstrated, not asserted: the prose in that file explains the old
      hardcoded dollar and therefore contains it, so a raw-source sweep would
      report the fix as the defect.
    */
    expect(raw).toContain('was USD');
    expect(code).not.toContain('was USD');
  });
});

describe('⛔ the organiser can choose the currency', () => {
  it('offers every currency the platform can COLLECT', () => {
    expect(code).toContain('SUPPORTED_CURRENCY_CODES.map');
    // Not WORLD_CURRENCY_EXPONENTS: 150 of those have no gateway (docs/103),
    // and a campaign in a currency nothing settles is unfundable.
    expect(code).not.toContain('WORLD_CURRENCY_EXPONENTS');
  });

  it('sends it to the API, which has accepted it since docs/116 §3', () => {
    expect(code).toMatch(/currency: form\.currency/);
  });

  it('⛔ uses a NATIVE select, not an eighth hand-rolled radiogroup', () => {
    /*
      `docs/100`: all seven hand-rolled `role="radiogroup"`s had to be
      retrofitted with a key handler and roving tabindex, and its own rule is
      that a plain list of labels should be a native control instead. Two
      currency codes are a plain list.
    */
    expect(code).toMatch(/<select/);
    const selectBlock = code.slice(code.indexOf('<select'), code.indexOf('</select>'));
    expect(selectBlock).toContain('form.currency');
    // And it is labelled, since the visible text is only the code.
    expect(code).toMatch(/htmlFor="currency"/);
  });

  it('⛔ validates a restored draft, because getCurrency throws', () => {
    /*
      The draft is localStorage, so its contents are not trustworthy, and
      `getCurrency` deliberately throws on an unsupported code. The file
      already guards `fundraisingFor` and `beneficiaryRelation` the same way.
    */
    expect(code).toMatch(/SUPPORTED_CURRENCY_CODES\.includes\(fields\.currency\)/);
    expect(code).toMatch(/fields\.currency = DEFAULT_CURRENCY/);
  });
});

describe('⛔ no part of the wizard assumes dollars', () => {
  it('converts major to minor through the currency, never a literal 100', () => {
    /*
      This was `parseInt(form.goalAmount, 10) * 100`. Correct only while every
      campaign is USD: UGX, RWF, XOF and XAF are zero-decimal, so the same
      expression overstates a goal 100x (`docs/92`).
    */
    expect(code).toContain('majorToMinor(');
    /*
      ⚠️ Scoped to lines that mention the goal. A blanket ban on `* 100` was
      the first version of this rule and it was WRONG, not the code: the step
      progress bar is `((step + 1) / STEP_COUNT) * 100}%`, a legitimate
      percentage. An over-broad rule sends somebody to "fix" working code.
    */
    const goalMath = code
      .split('\n')
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => /goal/i.test(l) && /[*/]\s*10{2,}/.test(l));
    expect(
      goalMath.map(([n, l]) => `${FORM}:${n}  ${l.trim()}`),
      'convert the goal with majorToMinor, which reads the exponent',
    ).toEqual([]);
  });

  it('renders no hardcoded currency symbol or code', () => {
    // `$` followed by a digit, or a bare USD badge, in JSX.
    const offenders = code
      .split('\n')
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => /\$[0-9]/.test(l) || />\s*USD\s*</.test(l) || /in dollars/.test(l));
    expect(
      offenders.map(([n, l]) => `${FORM}:${n}  ${l.trim()}`),
      'the wizard must not state a currency it was not told',
    ).toEqual([]);
  });

  it('renders money through formatMoney', () => {
    expect(code).toContain('formatMoney(');
  });

  it('the goal bounds messages are per currency', () => {
    expect(code).toMatch(/Minimum goal is \$\{formatMoney/);
    expect(code).toMatch(/Maximum goal is \$\{formatMoney/);
  });
});

describe('the API end is genuinely ready for it', () => {
  it('the create schema restricts to collectable currencies', () => {
    const schema = stripComments(
      readFileSync(resolve(ROOT, 'src/lib/validators/user-campaign.ts'), 'utf8'),
    );
    expect(schema).toContain('SUPPORTED_CURRENCY_CODES');
    expect(schema).toMatch(/currency: z/);
  });

  it('the create route writes the column', () => {
    const route = stripComments(
      readFileSync(resolve(ROOT, 'src/app/api/v1/user-campaigns/route.ts'), 'utf8'),
    );
    expect(route).toMatch(/currency: data\.currency/);
  });

  it('⚠️ and both collectable currencies still have a gateway', () => {
    // The point of the feature: at least one choice must be able to collect.
    expect(SUPPORTED_CURRENCY_CODES.length).toBeGreaterThanOrEqual(2);
  });
});
