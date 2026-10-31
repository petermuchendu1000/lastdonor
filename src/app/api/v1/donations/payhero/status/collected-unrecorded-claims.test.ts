/**
 * A collection PayHero took and we did not book may not be called a donation.
 *
 * ── WHAT WENT WRONG ───────────────────────────────────────────────────────
 *
 * `settlePayHeroRequest` claimed the request `succeeded`, called
 * `recordGatewayCharge`, looked up whether a donation row had resulted - and
 * returned `{ kind: 'recorded' }` whether or not one had. `recordGatewayCharge`
 * returns early without booking anything when the campaign has COMPLETED,
 * which it can do while the donor is entering a PIN; on that path it writes
 * `donation.manual_refund_required` at `critical` and returns above both the
 * donation transaction and the receipt.
 *
 * So the donor read "Thank you - your donation is in … we are sending one by
 * email too" while no donation existed, no receipt was sent, the campaign
 * total was unchanged, and the platform's own record said a person had to
 * return the money by hand. `docs/162`.
 *
 * ── WHY THESE RULES ARE SHAPED THIS WAY ───────────────────────────────────
 *
 * THREE branches of the route can answer for a settled collection - the
 * terminal-row early return, `case 'recorded'`, and `case 'already_settled'` -
 * and all three used to read `status` alone. A rule that pinned one of them
 * would have passed against the other two, so what is enforced is that there
 * is exactly ONE place that may answer the claiming state, and that it decides
 * from the donation link (`docs/146`'s one-predicate rule).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { claimForSettledCollection } from '@/lib/payhero-prompt';

const ROOT = process.cwd();
const ROUTE = readFileSync(join(ROOT, 'src/app/api/v1/donations/payhero/status/route.ts'), 'utf8');
const CLIENT = readFileSync(join(ROOT, 'src/components/campaign/MpesaDonationForm.tsx'), 'utf8');
const PROMPT = readFileSync(join(ROOT, 'src/lib/payhero-prompt.ts'), 'utf8');

/** Strip comments, so prose quoting a forbidden string is not a violation. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

const ROUTE_CODE = code(ROUTE);
const CLIENT_CODE = code(CLIENT);

/**
 * The server state the CLIENT renders with its thank-you screen, read from
 * the client itself rather than retyped here. Renaming the state on both
 * sides keeps this green; renaming it on one side fails.
 */
function thankYouStates(): string[] {
  /*
    The assignment that puts the form into the screen headed "Thank you - your
    donation is in", and the `state === '…'` test guarding it.
  */
  const idx = CLIENT_CODE.indexOf("setPhase('succeeded')");
  expect(idx, "could not find the client's success phase assignment").toBeGreaterThan(-1);
  const before = CLIENT_CODE.slice(0, idx);
  const tests = Array.from(before.matchAll(/state === '([a-z_]+)'/g)).map((m) => m[1]);
  // The nearest test before the assignment is the one that guards it.
  return tests.slice(-1);
}

/** Every `settled('<state>'` literal in the route, with its character offset. */
function settledCalls(): { state: string; at: number }[] {
  return Array.from(ROUTE_CODE.matchAll(/settled\(\s*'([a-z_]+)'/g)).map((m) => ({
    state: m[1],
    at: m.index!,
  }));
}

describe('a collection that was not booked is not reported as a donation', () => {
  const THANK_YOU = thankYouStates();

  it('ANTI-VACUITY: the client really does have a thank-you screen behind a server state', () => {
    /*
      Without this, `thankYouStates()` returning [] would make rule 1 pass
      against anything at all.
    */
    expect(THANK_YOU.length, 'derived no thank-you state from the client').toBeGreaterThan(0);
    expect(THANK_YOU).toContain('succeeded');
    expect(CLIENT, 'the screen this rule is about must still exist').toContain(
      'your donation is in',
    );
  });

  it('⛔ exactly one place in the route may answer a thank-you state', () => {
    /*
      The defect was three places answering it from `status` alone. One
      answering site means one decider; a second is a second answer to the
      same question.
    */
    const claiming = settledCalls().filter((c) => THANK_YOU.includes(c.state));
    expect(
      claiming.length,
      `expected exactly 1 site answering ${THANK_YOU.join('/')}, found ${claiming.length}`,
    ).toBe(1);
  });

  it('⛔ EXECUTED: the judgement points the right way', () => {
    /*
      §5.1: a structural rule cannot see which way a ternary points. An
      injection that INVERTED the decider - claim success when nothing was
      booked, refuse when it was - passed every text rule in this file. So
      the judgement is a pure function and its direction is executed, not
      read (`docs/157` §4.1).
    */
    expect(claimForSettledCollection(null)).toBe('collected_unrecorded');
    expect(claimForSettledCollection(undefined)).toBe('collected_unrecorded');
    expect(claimForSettledCollection('a-donation-id')).toBe('succeeded');
  });

  it('⛔ the route routes its answer through that judgement', () => {
    /*
      ANTI-VACUITY for the row above: a pure function nobody calls proves
      nothing about what the donor is told.
    */
    expect(ROUTE_CODE).toMatch(/claimForSettledCollection\(donationId\)/);
  });

  it('⛔ each claim answers the state it is named after', () => {
    /*
      The answer table is keyed by the claim precisely so there is no
      condition to invert (§5.1). What remains possible is SWAPPING the two
      entries, and that makes a key disagree with the state it answers -
      which, unlike a ternary's direction, is visible.
    */
    expect(ROUTE_CODE).toMatch(
      /collected_unrecorded:\s*\(\)\s*=>\s*\n?\s*settled\('collected_unrecorded'/,
    );
    expect(ROUTE_CODE).toMatch(/succeeded:\s*\(\)\s*=>\s*settled\('succeeded'/);
  });

  it('⛔ that one place is the answer-table entry of the same name', () => {
    /*
      ⚠️ This rule used to slice a FIXED 400 characters before the answer and
      require `donationId` in them. That fitted the ternary it was written
      against and then FAILED ON CORRECT CODE the moment the ternary became a
      lookup table - `docs/153`'s fixed-slice trap, and `docs/116`'s. What is
      asserted now is the structural fact and no distance: the single
      thank-you answer is reached only as the table entry keyed by that same
      state, so it cannot be reached without the judgement that selects the
      key.
    */
    const claiming = settledCalls().filter((c) => THANK_YOU.includes(c.state));
    const at = claiming[0].at;
    const prefix = ROUTE_CODE.slice(0, at).trimEnd();
    expect(
      prefix.endsWith(`${claiming[0].state}: () =>`),
      `the ${claiming[0].state} answer must sit in the table entry of the same name`,
    ).toBe(true);
  });

  it('⛔ the decider is actually used by EVERY branch that can answer for a settled row', () => {
    /*
      ANTI-VACUITY the other way: a decider nobody calls satisfies the rules
      above while every branch keeps claiming success. All three branches that
      can speak for a settled collection must route through it - named
      individually rather than counted, because a count passes as soon as the
      calls total up however they are distributed.
    */
    expect(
      ROUTE_CODE,
      'the terminal-row early return',
    ).toMatch(/row\.status === 'succeeded'\)\s*return succeededOrUnrecorded/);
    expect(
      ROUTE_CODE,
      "case 'already_settled'",
    ).toMatch(/outcome\.status === 'succeeded'\)\s*return succeededOrUnrecorded/);
    expect(
      ROUTE_CODE,
      "case 'recorded'",
    ).toMatch(/case 'recorded':[\s\S]{0,200}?return succeededOrUnrecorded\(outcome\.donationId\)/);
  });

  it('⛔ the route selects the donation link, or the decider has nothing to read', () => {
    expect(ROUTE_CODE).toMatch(/donationId:\s*payheroPaymentRequests\.donationId/);
  });

  it('⛔ the unrecorded message claims nothing it cannot substantiate', () => {
    const msg = (PROMPT.match(/COLLECTED_UNRECORDED_MESSAGE =\s*([\s\S]*?);/) ?? [])[1] ?? '';
    expect(msg.length, 'could not read the shared message').toBeGreaterThan(0);

    // The money DID move, so the docs/158 reassurance would be false here.
    expect(/nothing has been charged/i.test(msg)).toBe(false);
    // No donation exists, so it must not thank anybody for one.
    expect(/thank you|donation is in/i.test(msg)).toBe(false);
    // No refund promise and no clock: docs/140, docs/122.
    expect(/refund|send(ing)? (it|your money) back|business days|\d+\s*days/i.test(msg)).toBe(
      false,
    );
    // And it must state the one thing that IS established.
    expect(/went through/i.test(msg)).toBe(true);
  });

  it('⛔ the client screen for it claims nothing false either', () => {
    const idx = CLIENT_CODE.indexOf("phase === 'collected_unrecorded'");
    expect(idx, 'the client must render this state').toBeGreaterThan(-1);
    // The screen runs to the next phase branch.
    const next = CLIENT_CODE.indexOf("phase === 'unresolved'", idx);
    const screen = CLIENT_CODE.slice(idx, next > idx ? next : idx + 2_500);

    expect(/nothing has been charged/i.test(screen)).toBe(false);
    expect(/thank you/i.test(screen)).toBe(false);
    expect(/your donation is in/i.test(screen)).toBe(false);
    expect(/we are sending one by email/i.test(screen)).toBe(false);
    expect(/refund|business days/i.test(screen)).toBe(false);
    // It must still offer a human, which is the only recourse that exists.
    expect(/SUPPORT_EMAIL/.test(screen)).toBe(true);
  });

  it('CONTROL: the genuine success screen keeps its thanks and its receipt line', () => {
    /*
      This rule must never become "no screen may thank anybody". A real
      donation is thanked, and told its receipt is coming - that send is
      reached on this path (`handlePostPaymentEffects`).
    */
    const idx = CLIENT_CODE.indexOf("phase === 'succeeded'");
    expect(idx).toBeGreaterThan(-1);
    const screen = CLIENT_CODE.slice(idx, idx + 1_800);
    expect(/your donation is in/i.test(screen)).toBe(true);
    expect(/sending one by email/i.test(screen)).toBe(true);
  });
});
