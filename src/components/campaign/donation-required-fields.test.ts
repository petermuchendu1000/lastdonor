/**
 * A field the pay button refuses to proceed without is marked `required`.
 *
 * ── WHAT WAS MEASURED ───────────────────────────────────────────────────────
 *
 * Walking `/donate` on production at a 390px viewport, in Nairobi's timezone -
 * which is the donor this platform actually has, since M-Pesa is the only rail
 * that has ever worked (`docs/92`, `docs/147`):
 *
 *     0. nothing filled   "Enter an amount to continue"            disabled
 *     1. amount chosen    "Send M-Pesa request for Ksh 100.00"     disabled
 *     2. + phone number   "Send M-Pesa request for Ksh 100.00"     disabled
 *     3. + email          "Send M-Pesa request for Ksh 100.00"     ENABLED
 *
 * So at step 2 the button names the donor's amount back to them and does
 * nothing, with no message saying what is missing. And all three inputs
 * reported `required=false` with no `aria-required`, while the field directly
 * above the email one is labelled "Your name (optional)" - so the visual
 * contrast said "required" and the accessibility tree said the opposite.
 *
 * ⚠️ Marking them changes NO behaviour and NO pixel, which is why it is the
 * whole fix: the component contains no `<form>` element and the pay button is
 * `type="button"`, so native validation never runs, and there is no
 * `:invalid` or `:required` rule in the stylesheets.
 *
 * ── WHY THIS RULE DERIVES BOTH ENDS ─────────────────────────────────────────
 *
 * Pinning "these two ids carry `required`" would pass forever and say nothing
 * about whether it is still the right two. So the rule reads the submit
 * predicate, extracts the state identifiers it gates on, maps each `<input>`
 * to the state it is bound to via `value={…}`, and requires exactly those to
 * be marked - the `docs/109` shape, where both ends come from source and the
 * test stays correct if the predicate changes.
 *
 * ⛔ The optional field is the ANTI-VACUITY CONTROL. `donorName` is absent
 * from `canSubmit`, so it must stay UNMARKED - without that half, a change
 * that slapped `required` on every input in the file would satisfy the rule
 * while telling donors their name is compulsory.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join(__dirname, 'MpesaDonationForm.tsx');
const SRC = readFileSync(FILE, 'utf8');

/** Comments stripped: `docs/116` §4 - the comment explaining a fix quotes it. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:/])\/\/[^\n]*/g, '');

/** The submit predicate, from `const canSubmit =` to its terminating `;`. */
function submitPredicate(): string {
  const i = CODE.indexOf('const canSubmit');
  expect(i, 'canSubmit not found - the rule would be vacuous').toBeGreaterThan(-1);
  const end = CODE.indexOf(';', i);
  return CODE.slice(i, end);
}

/** Every `<input …>` tag in the file, with its id, bound state and markings. */
function inputs(): { id: string; boundTo: string | null; required: boolean }[] {
  const out: { id: string; boundTo: string | null; required: boolean }[] = [];
  const re = /<input\b([\s\S]*?)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CODE))) {
    const attrs = m[1];
    const id = /id="([^"]+)"/.exec(attrs)?.[1];
    if (!id) continue;
    out.push({
      id,
      boundTo: /value=\{([A-Za-z_$][\w$]*)\}/.exec(attrs)?.[1] ?? null,
      // `required` as a bare JSX attribute, or `required={true}`.
      required: /\brequired\b(?!\s*=\s*\{false\})/.test(attrs),
    });
  }
  return out;
}

describe('the M-Pesa donation form marks what it demands', () => {
  it('found the predicate and the inputs at all (anti-vacuity)', () => {
    const pred = submitPredicate();
    expect(pred).toContain('canSubmit');
    const fields = inputs();
    // phone, name, email - plus the anonymity checkbox has no id, so three.
    expect(fields.length, 'the input scan found nothing - every rule below would pass').toBeGreaterThanOrEqual(3);
    expect(fields.map((f) => f.id)).toEqual(
      expect.arrayContaining(['mpesa-phone', 'mpesa-name', 'mpesa-email']),
    );
  });

  it('⛔ every field the pay button gates on is marked required', () => {
    const pred = submitPredicate();
    const unmarked = inputs()
      .filter((f) => f.boundTo && pred.includes(f.boundTo))
      .filter((f) => !f.required)
      .map((f) => f.id);
    expect(
      unmarked,
      'these fields block submission but are announced as optional',
    ).toEqual([]);
  });

  it('⛔ and a field it does NOT gate on stays unmarked (the control)', () => {
    /*
      Without this, marking every input in the file would satisfy the rule
      above while telling donors their name is compulsory - and the label
      says "(optional)" three lines up, so the markup would contradict its
      own copy.
    */
    const pred = submitPredicate();
    const overMarked = inputs()
      .filter((f) => f.boundTo && !pred.includes(f.boundTo))
      .filter((f) => f.required)
      .map((f) => f.id);
    expect(overMarked, 'these are optional but announced as required').toEqual([]);

    // And specifically: the name field is the one that must stay optional.
    const name = inputs().find((f) => f.id === 'mpesa-name');
    expect(name, 'the optional field vanished - the control is gone').toBeDefined();
    expect(name!.required).toBe(false);
  });

  it('⚠️ the premise holds: no <form>, so this cannot start native validation', () => {
    /*
      A TRIPWIRE on the reasoning, not a style rule. The fix is safe BECAUSE
      nothing submits natively. If somebody wraps these fields in a `<form>`
      with an `onSubmit`, `required` starts gating that submit and showing
      browser bubbles, which is a different decision that somebody should take
      deliberately rather than inherit from this change.
    */
    expect(CODE).not.toMatch(/<form\b/);
    expect(CODE).toMatch(/type="button"/);
  });
});
