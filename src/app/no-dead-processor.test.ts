/**
 * No public page credits a payment provider that collects nothing.
 *
 * ── WHY A RULE ──────────────────────────────────────────────────────────────
 *
 * `docs/185` moved `KES` from `gateway: 'payhero'` to `gateway: 'palpluss'` —
 * one line in the currency table — and **five sentences across four policy
 * pages became false in the same instant**, each telling donors that PayHero
 * processes their M-Pesa payment. PayHero processes nothing now.
 *
 * Two guards already read those pages and **neither could see all of it**:
 * `collection-rails.test.ts` and `refund-rails.test.ts` both spell an M-Pesa
 * rail as `/\bPayHero\b|\bM-?Pesa\b/i`. That alternative is CORRECT for what
 * those rules ask — a donor reading how a refund reaches them needs the word
 * *M-Pesa*, not a company name they have never seen — but it means a sentence
 * saying *"M-Pesa payments by PayHero"* satisfies a rule asking whether
 * Palpluss is named. `/terms` and `/fund-release-policy` stayed green while
 * false.
 *
 * So this rule asks the one question neither of those can: **is a company
 * named here as a processor when it processes nothing?** The dead set is
 * DERIVED from the currency table (`deadGateways()`), so it needs no editing
 * when a rail is flipped back — and it is empty-by-construction for every
 * rail that does collect, which is why the anti-vacuity row below matters.
 *
 * ⚠️ This is a NAME rule, not a mention rule. A page may discuss a provider's
 * history, or name it as holding records it already received; what it may not
 * do is present it as processing payments. The distinction is carried by
 * `PROCESSING_CONTEXT` and proven by the controls.
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PAYMENT_PROVIDER_NAME,
  collectingGateways,
  deadGateways,
} from '@/lib/payment-providers';

const ROOT = process.cwd();
const APP = resolve(ROOT, 'src/app');

/** Blank comments, so this file's own prose cannot be the violation. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

/**
 * Public pages only.
 *
 * ⛔ `/admin` and `/dashboard` are excluded on `docs/110` §4's boundary: those
 * are operator and organiser surfaces where naming the rail a row was taken
 * on is a FACT about that row, not a claim about what the platform does now.
 * An admin refund dialog must be able to say "this one came in over PayHero".
 */
function publicPages(): { rel: string; src: string }[] {
  return readdirSync(APP, { recursive: true, encoding: 'utf8' })
    .filter((p) => /page\.tsx$/.test(p))
    .filter((p) => !p.startsWith('admin/') && !p.startsWith('dashboard/'))
    .sort()
    .map((p) => ({
      rel: `src/app/${p}`,
      src: code(readFileSync(resolve(APP, p), 'utf8')),
    }));
}

/**
 * The sentence shapes that present a company as processing payments.
 *
 * Deliberately narrow: each requires the provider's name NEAR a processing
 * verb, so a page that mentions the company for another reason is untouched.
 * `[^.]{0,60}` cannot cross a full stop, so a match is always inside one
 * sentence (`docs/152`'s qualifier lesson — a window that spans sentences
 * reports the wrong one).
 */
function processingClaims(name: string): RegExp[] {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    // "processed by PayHero", "are processed by PayHero"
    new RegExp(`process(?:ed|es|ing)?\\s+by\\s+${n}`, 'i'),
    // "payments by PayHero", "donations by PayHero"
    new RegExp(`(?:payments?|donations?)\\s+by\\s+${n}`, 'i'),
    // "payments go to PayHero", "payments to PayHero"
    new RegExp(`(?:payments?|donations?)\\s+(?:go\\s+)?to\\s+${n}`, 'i'),
    // "PayHero: For M-Pesa payment processing" — the sharing-list shape
    new RegExp(`${n}\\s*:?\\s*</strong>\\s*For\\b[^.]{0,60}processing`, 'i'),
    // "handled entirely by PayHero", "collected by PayHero"
    new RegExp(`(?:handled|collected|charged)[^.]{0,30}\\bby\\s+${n}`, 'i'),
  ];
}

describe('no public page credits a provider that collects nothing', () => {
  const PAGES = publicPages();
  const DEAD = deadGateways();
  const LIVE = collectingGateways();

  it('ANTI-VACUITY: the page corpus and both gateway sets were read', () => {
    /*
      ⛔ Every rule below iterates one of these. With no pages, or with no dead
      gateway, they pass over nothing and protect nothing — and "no dead
      gateway" is a real state this platform was in until 2026-11-26, so the
      message says which it is rather than reading as a broken scan.
    */
    expect(PAGES.length, 'no public pages found - discovery is broken').toBeGreaterThan(20);
    expect(LIVE.length, 'no gateway collects anything at all').toBeGreaterThan(0);
    expect(
      DEAD.length,
      'every known gateway collects something, so this rule is dormant. That is a ' +
        'legitimate state (it was true before docs/185) - but if it is unexpected, ' +
        'check PAYMENT_PROVIDER_NAME against the currency table.',
    ).toBeGreaterThan(0);
  });

  it('⛔ EXECUTED: the dead set is the complement of the live set', () => {
    /*
      A structural rule cannot see which way a set-difference points, and
      inverting it would make this file forbid naming the rails that DO
      collect - green, and exactly backwards (`docs/162` §5.1).
    */
    for (const g of DEAD) expect(LIVE).not.toContain(g);
    for (const g of LIVE) expect(DEAD).not.toContain(g);
    expect([...DEAD, ...LIVE].sort()).toEqual(Object.keys(PAYMENT_PROVIDER_NAME).sort());
  });

  it.each(DEAD)('⛔ no public page presents %s as processing payments', (gateway) => {
    const name = PAYMENT_PROVIDER_NAME[gateway];
    const patterns = processingClaims(name);
    const offenders: string[] = [];

    for (const page of PAGES) {
      for (const re of patterns) {
        const hit = re.exec(page.src);
        if (hit) offenders.push(`${page.rel}: "${hit[0].replace(/\s+/g, ' ')}"`);
      }
    }

    expect(
      offenders,
      `${name} routes from no currency in src/lib/money/currencies.ts, so it collects ` +
        `nothing - and these public sentences tell donors it processes their money:\n` +
        `  ${offenders.join('\n  ')}\n` +
        'Name the rail that actually collects. A page may still say what this provider ' +
        'received in the past, or that it holds those records; it may not be presented ' +
        'as processing anything now. docs/185.',
    ).toEqual([]);
  });

  it.each(LIVE)('CONTROL: %s, which DOES collect, may be named as a processor', (gateway) => {
    /*
      ⛔ Without this the rule above is satisfied by deleting every processor
      name from every policy page - which is the opposite of what `docs/152`
      established, where naming the sub-processor IS the compliance
      disclosure. At least one public page must present each live rail as
      processing payments.
    */
    const name = PAYMENT_PROVIDER_NAME[gateway];
    const patterns = processingClaims(name);
    const naming = PAGES.filter((p) => patterns.some((re) => re.test(p.src))).map((p) => p.rel);
    expect(
      naming,
      `${name} collects money and no public page names it as the processor. docs/152 ` +
        'requires the sub-processor to be disclosed.',
    ).not.toEqual([]);
  });

  it('CONTROL: the matcher catches the sentences that were actually live', () => {
    /*
      ⛔ Every rule above is a `not`-shaped assertion over a regex list, so a
      matcher that caught nothing would satisfy all of them (`docs/163` §5.1).
      These are the five real sentences as they stood before docs/185, so the
      patterns are proven against the defect rather than against inventions.
    */
    const wasLive = [
      'Card payments are processed by Stripe, and M-Pesa payments by PayHero.',
      'Card donations are processed by Stripe, and M-Pesa donations by PayHero.',
      'M-Pesa donations are processed by PayHero.',
      'card payments go to Stripe, a PCI DSS Level 1 certified provider, and M-Pesa payments to PayHero.',
      '<strong>PayHero:</strong> For M-Pesa payment processing',
    ];
    const patterns = processingClaims('PayHero');
    for (const sentence of wasLive) {
      expect(
        patterns.some((re) => re.test(sentence)),
        `the matcher misses a sentence that was live in production: ${sentence}`,
      ).toBe(true);
    }
  });

  it('CONTROL: a historical statement about a dead provider is NOT flagged', () => {
    /*
      ⛔ The distinction this rule rests on. `/privacy` still lists PayHero,
      because it holds the phone numbers of every M-Pesa donation taken so far
      and dropping it would UNDERSTATE the disclosure. A rule that forbade the
      NAME rather than the CLAIM would force that true sentence out.
    */
    const patterns = processingClaims('PayHero');
    for (const kept of [
      '<strong>PayHero:</strong> Processed the M-Pesa payments made before ' +
        'we moved to Palpluss, and still holds the records of those payments',
      '<strong>PayHero:</strong> Handled our earlier M-Pesa donations and retains those records',
      '<strong>PayHero:</strong> Holds the records of M-Pesa donations taken before 2026-11-26',
    ]) {
      expect(
        patterns.some((re) => re.test(kept)),
        `a historical disclosure is being read as a processing claim: ${kept}`,
      ).toBe(false);
    }

    /*
      ⚠️ And the live page really does carry one, so this control is not
      theoretical - checked as a PROPERTY, not as today's sentence.

      ⛔ My first version matched `/PayHero:<\/strong>\s*Processed the M-Pesa
      payments/`, i.e. the exact wording. Mutation row R11 reworded that
      sentence while keeping it historical - a change this rule must permit -
      and the control FIRED. That is `docs/160` §5.2 (and `docs/163` §5.2, and
      `docs/161` §6.1) in a test written an hour after reading them: the
      property is that PayHero is still disclosed and is not presented as
      processing anything, and the words are free to improve.
    */
    const privacy = PAGES.find((p) => p.rel === 'src/app/privacy/page.tsx');
    expect(privacy, '/privacy not found').toBeTruthy();
    expect(
      privacy!.src,
      'PayHero holds every M-Pesa donor phone number this platform has collected and must ' +
        'stay disclosed as a recipient - dropping it UNDERSTATES the sharing list',
    ).toMatch(/PayHero/);
    expect(
      processingClaims('PayHero').some((re) => re.test(privacy!.src)),
      '/privacy presents PayHero as a processor',
    ).toBe(false);
  });
});
