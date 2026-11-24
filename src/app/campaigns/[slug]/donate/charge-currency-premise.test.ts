/**
 * The donate page derives the M-Pesa charge currency from PayHero ALONE, and
 * it does so for every campaign on every load.
 *
 * ── The trap this exists to stop ──────────────────────────────────────────
 *
 * `payHeroChargeCurrency()` THROWS unless exactly one currency names
 * `gateway: 'payhero'`. `donate/page.tsx` calls it unconditionally — not
 * inside a branch keyed on the campaign's own rail — so it runs on a USD
 * campaign's donate page as readily as a KES one.
 *
 * Today `KES` names payhero, so it returns `'KES'` and nothing is wrong. The
 * moment somebody flips KES to `gateway: 'palpluss'` — which is the explicit
 * next step for this rail (`docs/180` §7, owner action) — that function finds
 * zero and throws during render. A throw in a server component is not a 500:
 * it renders the error boundary **inside a 200**, which is the shape
 * `docs/88` F9 records and which a status-code sweep cannot see. It would land
 * on the public donate page of every live campaign at once.
 *
 * ⛔ So this is REPORTED, NOT FIXED (`docs/182` §6). Fixing it properly means
 * deciding what that page shows when no rail routes to a campaign's currency,
 * which is a product question on the busiest money surface, and that surface
 * has no behavioural test. What this file does instead is convert a runtime
 * error boundary into a BUILD FAILURE that names the remedy — which costs
 * nothing now and cannot be walked into by accident.
 *
 * ── Why it relaxes on its own ─────────────────────────────────────────────
 *
 * The premise is checked, not assumed. If somebody makes that page tolerate a
 * missing M-Pesa charge currency, they will stop calling the throwing
 * derivation, rule 1 stops holding, and this file says so rather than
 * standing in the way. `docs/127` and `docs/148` §B.5 are the same shape: a
 * rule that reads both ends and steps aside when the thing it guards has been
 * solved properly.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SUPPORTED_CURRENCY_CODES, getCurrency } from '@/lib/money/currencies';
import { payHeroChargeCurrency } from '@/lib/payhero';
import { palplussChargeCurrency } from '@/lib/palpluss';

const PAGE = resolve(__dirname, 'page.tsx');

const pageSource = () => readFileSync(PAGE, 'utf8');

/** Blank comments, so this file's own prose about the call cannot satisfy it. */
const stripComments = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));

const codesFor = (gateway: string): string[] =>
  SUPPORTED_CURRENCY_CODES.filter((c) => getCurrency(c).gateway === gateway);

describe('the donate page can always derive an M-Pesa charge currency', () => {
  const premiseHolds = /payHeroChargeCurrency\s*\(/.test(stripComments(pageSource()));

  it('PREMISE: the page still derives it from PayHero alone', () => {
    /*
      Not an assertion that this is desirable — it is the condition under
      which the rule below is load-bearing. If it ever reads false, read
      `docs/182` §6 and delete this file rather than satisfying it.
    */
    expect(
      premiseHolds,
      'the donate page no longer calls payHeroChargeCurrency(). If it now tolerates a ' +
        'missing M-Pesa charge currency, this whole file is obsolete - see docs/182 §6.',
    ).toBe(true);
  });

  it('⛔ exactly one currency routes to payhero, or that page throws on every campaign', () => {
    if (!premiseHolds) return;

    const payhero = codesFor('payhero');
    expect(
      payhero,
      'payHeroChargeCurrency() throws unless exactly one currency names ' +
        "gateway: 'payhero', and src/app/campaigns/[slug]/donate/page.tsx calls it for " +
        'EVERY campaign on EVERY load. With ' +
        `${payhero.length} such currencies it throws during render, which shows up as the ` +
        'error boundary inside a 200 on the public donate page of every live campaign ' +
        '(docs/88 F9). If you are moving KES to Palpluss, make that page tolerate a null ' +
        'charge currency FIRST - docs/182 §6 has the shape.',
    ).toHaveLength(1);
  });

  /*
    ⛔ ANTI-VACUITY. The rule above is a count, and a count can be right while
    the function it stands in for reads something else entirely. This asserts
    the count and the derivation agree, so the rule is measuring the thing
    that actually runs on that page.
  */
  it('CONTROL: the derivation returns the one currency the count found', () => {
    const payhero = codesFor('payhero');
    if (payhero.length !== 1) return;
    expect(payHeroChargeCurrency()).toBe(payhero[0]);
  });

  /*
    The early-warning half. While nothing routes to Palpluss the rule above
    cannot fire, so this records the state the rule is waiting for — and if
    Palpluss ever has a currency while PayHero has none, the message above is
    the one that fires first.
  */
  it('records which rails currently have a currency at all', () => {
    expect(palplussChargeCurrency()).toBe(codesFor('palpluss')[0] ?? null);
    // Both rails routed at once is fine; neither is what breaks the page.
    expect(codesFor('payhero').length + codesFor('palpluss').length).toBeGreaterThan(0);
  });
});
