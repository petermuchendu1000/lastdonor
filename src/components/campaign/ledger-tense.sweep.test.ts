/**
 * A donation form's fee ledger is a PROJECTION, not a record of an event.
 *
 * `docs/161` §4.1 measured this on the CARD form: `submitError` renders
 * directly beneath the ledger, so after any refusal the donor read
 * "Total charged today $25.00" 95px above "nothing has been charged". It
 * fixed that one form and left its sibling, and `MpesaDonationForm` - the
 * rail that has actually taken money - carried the identical wording with
 * its own `error` block 36px below the total row. Six messages reachable
 * from that form say "nothing has been charged": four in
 * `donations/payhero/initiate/route.ts` and two in the component itself.
 *
 * ⛔ So this is a SWEEP over every donation form, not a second per-file
 * assertion. `docs/110` §9.2: one rule applied to one surface and not swept
 * to the next is the defect, and `DonationForm.ledger.test.tsx` could never
 * have caught this because it renders ONE component.
 *
 * ⛔ The figure is deliberately NOT blanked when a refusal shows - a donor
 * who retries wants their amount still there - so rule 3 fails if a form
 * stops rendering money in its ledger. Satisfying rule 1 by deleting the
 * ledger is not a fix.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'src/components/campaign');

/**
 * ⚠️ Comments are stripped FIRST, and that is load-bearing rather than
 * tidiness: the comment explaining this fix necessarily QUOTES
 * "Total charged today", so a raw-source sweep reports the fix as the
 * defect (`docs/116` §4, `docs/167`, both met in person).
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

/** Every donation form on disk, so a third one is covered the day it lands. */
function donationForms(): { file: string; src: string }[] {
  return readdirSync(DIR)
    .filter((f) => /DonationForm\.tsx$/.test(f))
    .map((file) => ({ file, src: stripComments(readFileSync(join(DIR, file), 'utf8')) }));
}

/** The ledger block. Neither form nests a <dl>, and rule 2 pins that. */
function ledgerBlock(src: string): string {
  const open = src.indexOf('<dl');
  const close = src.indexOf('</dl>', open);
  if (open === -1 || close === -1) return '';
  return src.slice(open, close);
}

/** Each ledger row: the <dt>'s inner source and the <dd>'s that follows it. */
function rows(block: string): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  let i = 0;
  for (;;) {
    const open = block.indexOf('<dt', i);
    if (open === -1) break;
    const tagEnd = block.indexOf('>', open);
    const close = block.indexOf('</dt>', tagEnd);
    if (tagEnd === -1 || close === -1) break;
    const openTag = block.slice(open, tagEnd);
    // If an attribute ever carries a `>` inside an expression this slicer is
    // wrong, so say so loudly rather than mis-parsing in silence
    // (`docs/153` §5's `[^>]*` trap).
    expect(openTag, `<dt> in the ledger has an expression attribute; improve the slicer`)
      .not.toMatch(/\{/);
    const ddOpen = block.indexOf('<dd', close);
    const ddTagEnd = ddOpen === -1 ? -1 : block.indexOf('>', ddOpen);
    const ddClose = ddTagEnd === -1 ? -1 : block.indexOf('</dd>', ddTagEnd);
    out.push({
      label: block.slice(tagEnd + 1, close),
      value: ddClose === -1 ? '' : block.slice(ddTagEnd + 1, ddClose),
    });
    i = close + 5;
  }
  return out;
}

function labels(block: string): string[] {
  return rows(block).map((r) => r.label);
}

const FORMS = donationForms();

describe('a donation ledger states what will be paid, never what was charged', () => {
  /*
    RULE 1. The defect itself. "charged" is the past participle - it asserts
    the event happened - and the refusal rendered directly beneath says it
    did not.
  */
  it.each(FORMS)('$file: no ledger label asserts a completed charge', ({ file, src }) => {
    for (const label of labels(ledgerBlock(src))) {
      expect(
        label,
        `${file}: a ledger label says "charged", which asserts an event this box only projects`,
      ).not.toMatch(/\bcharged\b/i);
    }
  });

  /*
    RULE 2, ANTI-VACUITY. Rule 1 is a `not.toMatch` over a list, so an empty
    list satisfies it completely (`docs/163` §5.1). This pins that the sweep
    found both forms, each with a real ledger carrying several rows, and
    exactly one <dl> per form so a second ledger cannot escape it.
  */
  it('finds both donation forms, each with one ledger of several labelled rows', () => {
    expect(FORMS.map((f) => f.file).sort()).toEqual([
      'DonationForm.tsx',
      'MpesaDonationForm.tsx',
    ]);
    for (const { file, src } of FORMS) {
      expect(src.match(/<dl\b/g)?.length, `${file}: expected exactly one ledger`).toBe(1);
      expect(labels(ledgerBlock(src)).length, `${file}: ledger has no rows`).toBeGreaterThanOrEqual(3);
    }
  });

  /*
    RULE 3, THE FIGURE CONTROL. `docs/161` decided the amount STAYS on a
    refusal. Without this, deleting the ledger - or blanking its figures -
    would satisfy rule 1 and read as a fix.
  */
  it.each(FORMS)('$file: the TOTAL row still renders money', ({ file, src }) => {
    /*
      ⚠️ The TOTAL row, not "somewhere in the ledger". My first version asked
      the latter, and a mutation blanking the total's figure DID NOT FIRE -
      each ledger holds three <Money> elements, so removing the one that
      matters leaves two and the rule passes (Gate 4).

      The total is the LAST row structurally, never found by its label:
      `docs/161` had four tests pinned to exact copy and rewording broke
      them, which is the whole reason this rule exists.
    */
    const all = rows(ledgerBlock(src));
    const total = all[all.length - 1];
    expect(total, `${file}: ledger has no rows`).toBeDefined();
    expect(
      /<Money\b|centsToDollars\(|formatMoney\(/.test(total.value),
      `${file}: the total row renders no money figure - docs/161 decided it STAYS on a refusal`,
    ).toBe(true);
  });

  /*
    RULE 4, A PREMISE TRIPWIRE (`docs/148` §B.4). This rule only matters
    because a refusal renders in the same form, beneath the ledger. If one
    ever stops being able to show one, the reasoning above has moved and
    somebody should re-read it rather than inherit a rule whose premise is
    gone.
  */
  it.each(FORMS)('$file: a refusal renders between the ledger and the pay button', ({ file, src }) => {
    /*
      ⚠️ Not "the file contains role=alert somewhere". My first version asked
      that, and deleting the refusal beneath the ledger DID NOT FIRE - both
      forms carry other alert regions on their waiting and failed screens
      (Gate 4). What this rule rests on is the GEOMETRY `docs/161` measured:
      the refusal sits between the ledger and the pay button, 36px below the
      total on the M-Pesa form and 95px on the card one.
    */
    const close = src.indexOf('</dl>');
    expect(close, `${file}: no ledger`).toBeGreaterThan(-1);
    const after = src.slice(close);
    const alertAt = after.indexOf('role="alert"');
    const buttonAt = after.search(/<(?:motion\.)?button\b/);
    expect(alertAt, `${file}: no refusal region after the ledger`).toBeGreaterThan(-1);
    expect(buttonAt, `${file}: no pay button after the ledger`).toBeGreaterThan(-1);
    expect(
      alertAt,
      `${file}: the refusal no longer sits between the ledger and the pay button - ` +
        `that geometry is this rule's premise, so re-read docs/161 §4.1 and docs/175`,
    ).toBeLessThan(buttonAt);
  });
});
