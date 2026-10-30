/**
 * No public surface says one gateway collects the money, when two do.
 *
 * ── WHY THIS IS A SWEEP AND NOT A THIRD ASSERTION ───────────────────────────
 *
 * `docs/152` fixed `/refund-policy` and then swept its siblings, because
 * `PROCESSOR_NAME_ALLOWED` exempts every policy page from `fee-claims.test.ts`
 * for the same reason. The sweep found the same defect in three more places:
 *
 *   - `/terms`           "All donations are processed by Stripe"
 *   - `/fund-release-policy`
 *                        "Stripe processes donations and handles card,
 *                         wallet, subscription, and settlement mechanics."
 *   - `/privacy`         "Payment processing is handled entirely by Stripe"
 *                        and a sharing list naming Stripe and not PayHero.
 *
 * Four instances of one rule is not three assertions (`docs/110` §9.2). This
 * reads every public page and component.
 *
 * ── COLLECTION AND PAYOUT ARE DIFFERENT QUESTIONS ───────────────────────────
 *
 * ⛔ The single most important thing about this rule is what it must NOT
 * flag. Several surfaces name Stripe alone and are CORRECT to:
 *
 *   `/fund-release-policy`          "Stripe Connect onboarding and payout
 *                                    eligibility"
 *   `/campaign-verification-policy` "Bank or payout verification through
 *                                    Stripe Connect"
 *   `/refund-policy`                "If a dispute is opened through a bank or
 *                                    card issuer, Stripe and the payment
 *                                    network may request..."
 *
 * [VERIFIED] Stripe really is the only way money LEAVES: `createTransfer` has
 * exactly one caller (`docs/111`), it lives in `@/lib/stripe-connect`, and
 * `withdraw/route.ts:223` refuses any currency but `PLATFORM_PAYOUT_CURRENCY`
 * (`docs/121` §4). And a chargeback is a card-network mechanism that M-Pesa
 * does not have at all. A rule that fired on those would be satisfied by
 * naming PayHero in a paragraph about card disputes - making the page worse,
 * and asserting something the platform cannot substantiate.
 *
 * So the rule matches a COLLECTION PHRASE, not a processor name.
 *
 * ── THE QUALIFIER TEST ──────────────────────────────────────────────────────
 *
 * A collection claim is fine when it names every collectable rail
 * ("Card donations are processed by Stripe, and M-Pesa donations by
 * PayHero"), and fine when the rail is narrowed BEFORE the claim
 * ("Stripe: For *card* payment processing"). It is not fine when the claim
 * stands unqualified ("All donations are processed by Stripe").
 *
 * ⚠️ The qualifier must come BEFORE the collection phrase, and that is not a
 * detail. "Stripe processes donations and handles card, wallet, subscription
 * and settlement mechanics" contains the word *card* - trailing, in a list of
 * mechanics - and an anywhere-in-the-sentence test passes it. That was a real
 * hole in the first draft of this rule, found by injecting the production
 * sentence and watching it not fire.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENCIES } from '@/lib/money/currencies';

const ROOT = join(__dirname, '..');

/**
 * Public surfaces only. `docs/110` §4: admin and dashboard screens speak to a
 * different audience in a different vocabulary, and naming one gateway to an
 * operator looking at one donation's row is not a claim about the platform.
 */
const FILES = globSync('{app,components}/**/*.tsx', { cwd: ROOT })
  .filter((f) => !f.includes('/admin/') && !f.includes('/dashboard/'))
  .filter((f) => !f.endsWith('.test.tsx'));

/** Every gateway that can take money today, from the one source of truth. */
const GATEWAYS = [...new Set(Object.values(CURRENCIES).map((c) => c.gateway))].sort();

const PROSE_NAME: Record<string, RegExp> = {
  stripe: /\bStripe\b/,
  payhero: /\bPayHero\b/,
};

/** A sentence that claims something about who TAKES the money. */
const COLLECTION_PHRASE =
  /donations? (?:are|is) processed|processes donations?|donation processing|payment processing|payments are processed/i;

/** Words that narrow a claim to one rail. */
const RAIL_QUALIFIER = /\bcards?\b|\bM-?Pesa\b|\bmobile money\b/i;

/** Comments stripped: `docs/116` §4 - every comment here quotes the defect. */
function code(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:/])\/\/[^\n]*/g, ' ');
}

type Offence = { file: string; sentence: string };

function scan(): { offences: Offence[]; claims: number } {
  const offences: Offence[] = [];
  let claims = 0;

  for (const rel of FILES) {
    const text = code(readFileSync(join(ROOT, rel), 'utf8'))
      /*
        ⚠️ BLOCK-level tags end a sentence; inline ones do not, and the
        difference is load-bearing in both directions.

        A heading carries no full stop, so `<h2>Payment Processing</h2>`
        followed by a bullet merged into ONE "sentence" whose match landed on
        the HEADING, with nothing before it to narrow the claim - the rule
        reported correct copy as a defect on its first run.

        But replacing EVERY tag with a stop is worse: `<strong>Stripe:</strong>
        For card payment processing` would split the gateway's name away from
        the claim, the claim would name nobody, and the sweep would skip the
        very line `docs/152` found wrong in the privacy policy.
      */
      .replace(/<\/(?:h[1-6]|p|li|div|section|td|th|blockquote|ul|ol)\s*>/gi, ' . ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\{'\s*'\}/g, ' ')
      .replace(/&rsquo;/g, "'")
      .replace(/\s+/g, ' ');

    for (const sentence of text.split(/(?<=\.)\s+/)) {
      const m = COLLECTION_PHRASE.exec(sentence);
      if (!m) continue;
      const mentioned = GATEWAYS.filter((g) => PROSE_NAME[g]?.test(sentence));
      if (mentioned.length === 0) continue; // a claim naming nobody is not a rail claim
      claims++;

      if (mentioned.length === GATEWAYS.length) continue; // names them all
      if (RAIL_QUALIFIER.test(sentence.slice(0, m.index))) continue; // narrowed first

      offences.push({ file: rel, sentence: sentence.trim().slice(0, 220) });
    }
  }
  return { offences, claims };
}

describe('public surfaces do not credit one gateway with all collection', () => {
  it('the sweep has a corpus and a premise (anti-vacuity)', () => {
    expect(FILES.length, 'no public pages found - every rule below is vacuous').toBeGreaterThan(50);
    expect(
      GATEWAYS.length,
      'only one gateway collects now - this rule no longer means anything',
    ).toBeGreaterThan(1);
    expect(scan().claims, 'no collection claim found anywhere - the matcher is broken').toBeGreaterThan(0);
  });

  it('⛔ every collection claim names all rails, or is narrowed to one first', () => {
    const { offences } = scan();
    expect(
      offences.map((o) => `${o.file}: ${o.sentence}`),
      'these tell a donor who takes their money and name only some of the rails ' +
        'that can take it - the rail left out is the one that has taken every ' +
        'donation this platform has ever had',
    ).toEqual([]);
  });

  it('⚠️ payout and dispute copy naming one gateway is NOT flagged (the control)', () => {
    /*
      Without this, the rule looks safe while being far too broad, and the
      obvious way to satisfy a broader version is to name PayHero beside
      Stripe in a paragraph about card chargebacks or Stripe Connect payouts -
      both of which would be false.
    */
    const payoutish = [
      'Stripe Connect onboarding and payout eligibility.',
      'Payouts arrive through Stripe-connected payout rails.',
      'If a dispute is opened through a bank or card issuer, Stripe and the payment network may request records.',
    ];
    for (const s of payoutish) {
      expect(COLLECTION_PHRASE.test(s), `wrongly read as a collection claim: ${s}`).toBe(false);
    }
  });

  it('⚠️ the matcher really does catch the sentences that were live (control)', () => {
    /*
      Synthetic, so fixing the pages can never make this fail - but it pins
      that the matcher works, including the trailing-"card" case that defeated
      the first draft.
    */
    const live = [
      'All donations are processed by Stripe and are final upon completion.',
      'Stripe processes donations and handles card, wallet, subscription, and settlement mechanics.',
      'Payment processing is handled entirely by Stripe, a PCI DSS Level 1 certified provider.',
    ];
    for (const s of live) {
      const m = COLLECTION_PHRASE.exec(s);
      expect(m, `matcher missed a known-bad sentence: ${s}`).not.toBeNull();
      const narrowed = RAIL_QUALIFIER.test(s.slice(0, m!.index));
      expect(narrowed, `wrongly treated as narrowed: ${s}`).toBe(false);
    }

    // And the corrected forms must pass, or the rule has no fix.
    const fixed = [
      'Card donations are processed by Stripe, and M-Pesa donations by PayHero.',
      'Stripe: For card payment processing',
    ];
    for (const s of fixed) {
      const m = COLLECTION_PHRASE.exec(s);
      if (!m) continue;
      const names = GATEWAYS.filter((g) => PROSE_NAME[g]?.test(s));
      const ok = names.length === GATEWAYS.length || RAIL_QUALIFIER.test(s.slice(0, m.index));
      expect(ok, `a corrected sentence still fails the rule: ${s}`).toBe(true);
    }
  });
});

describe('the privacy policy names the companies that actually receive data', () => {
  const PRIVACY = readFileSync(join(ROOT, 'app/privacy/page.tsx'), 'utf8');
  const TEXT = code(PRIVACY).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

  it('⛔ it does not name a host this platform does not run on', () => {
    /*
      [VERIFIED three ways, `docs/152`] production answers `server: Fly/…`,
      `via: 2 fly.io` and a `fly-request-id` with no Vercel header; `fly.toml`
      is the deploy target while `vercel.json` is inert (`docs/65`); and this
      codebase's own comments say `VERCEL_ENV` is UNSET on Fly. Disclosing a
      recipient that receives nothing is as wrong as omitting one that does.
    */
    expect(TEXT).not.toMatch(/\bVercel\b/);
    expect(TEXT, 'the real host is not disclosed at all').toMatch(/\bFly\.io\b/);
  });

  /**
   * The SHARING LIST specifically - the enumeration of companies this policy
   * says receive personal data - not the page as a whole.
   *
   * ⚠️ My first version of the rule below asked whether the word "PayHero"
   * appeared anywhere on the page, and an injection deleting the sharing-list
   * entry DID NOT FIRE: the name survived in the security paragraph. A page
   * that mentions a processor in passing has not disclosed it as a recipient,
   * and that is the whole distinction this section exists to draw.
   */
  const SHARING_LIST = (() => {
    const anchor = TEXT.indexOf('We only share data with the services');
    expect(anchor, 'the sharing list is gone - the rule below would be vacuous').toBeGreaterThan(-1);
    // Up to the end of that enumeration; the next section heading bounds it.
    const after = TEXT.slice(anchor);
    const stop = after.search(/\d\.\s+(?:Data Retention|Your Rights|Security|Cookies)/i);
    return stop > 0 ? after.slice(0, stop) : after.slice(0, 1200);
  })();

  it('⛔ the sharing list names every gateway that can take a payment', () => {
    expect(SHARING_LIST.length, 'the slice is empty - anti-vacuity').toBeGreaterThan(100);
    for (const g of GATEWAYS) {
      expect(
        PROSE_NAME[g].test(SHARING_LIST),
        `${g} receives payment data and is not listed among the recipients`,
      ).toBe(true);
    }
  });

  it('⛔ and it discloses the phone number an M-Pesa donation stores', () => {
    /*
      [VERIFIED in production] `payhero_payment_requests` holds 5 rows, all 5
      carrying `phone_e164` AND `msisdn_sent`, oldest 2026-10-21. Both columns
      are `.notNull()`, so a donor's number is kept on every M-Pesa donation -
      the most identifying thing they hand over, and it was absent from the
      list of what this policy says is collected.
    */
    expect(TEXT).toMatch(/phone number you paid from|M-Pesa[^.]{0,80}phone number/i);
  });
});
