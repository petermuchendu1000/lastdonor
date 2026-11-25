/**
 * A collection the gateway took and we did not book may not be called a
 * donation — on EITHER M-Pesa rail.
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
 * THREE branches of a status route can answer for a settled collection - the
 * terminal-row early return, `case 'recorded'`, and `case 'already_settled'` -
 * and all three used to read `status` alone. A rule that pinned one of them
 * would have passed against the other two, so what is enforced is that there
 * is exactly ONE place that may answer the claiming state, and that it decides
 * from the donation link (`docs/146`'s one-predicate rule).
 *
 * ── WHY THE ROUTES ARE DISCOVERED AND NOT NAMED ───────────────────────────
 *
 * This file read ONE hardcoded path until 2026-11-25 and lived beside it, in
 * `payhero/status/`. The second rail's poll (`docs/183`) carries the identical
 * three-branch structure, the same `succeededOrUnrecorded` helper and the same
 * answer table — so a rule naming `payhero/status/route.ts` would have gone
 * green against it **without ever reading it**.
 *
 * That is `docs/116` §4 exactly (a review gate named two files while a third
 * insert published unreviewed campaigns in production), `docs/134`'s sweep for
 * the same reason, and `docs/182` §8, where the sibling honesty rule in this
 * directory had to be generalised one day earlier for one day's worth of the
 * same reason. `docs/110` §9.2's rule applies: a third instance means a sweep.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

import { claimForSettledCollection } from '@/lib/mpesa-prompt';

const ROOT = process.cwd();
const DONATIONS = resolve(__dirname);
const CLIENT_PATH = 'src/components/campaign/MpesaDonationForm.tsx';
const CLIENT = readFileSync(join(ROOT, CLIENT_PATH), 'utf8');
const PROMPT = readFileSync(join(ROOT, 'src/lib/mpesa-prompt.ts'), 'utf8');

/** Strip comments, so prose quoting a forbidden string is not a violation. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

const CLIENT_CODE = code(CLIENT);

/** Every `.../status/route.ts` under the donations tree. */
function statusRoutes(): { rel: string; src: string }[] {
  return readdirSync(DONATIONS, { recursive: true, encoding: 'utf8' })
    .filter((p) => /(^|[\\/])status[\\/]route\.ts$/.test(p))
    .sort()
    .map((p) => ({
      rel: resolve(DONATIONS, p).replace(ROOT + '/', ''),
      src: code(readFileSync(resolve(DONATIONS, p), 'utf8')),
    }));
}

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

/** Every `settled('<state>'` literal in a route, with its character offset. */
function settledCalls(src: string): { state: string; at: number }[] {
  return Array.from(src.matchAll(/settled\(\s*'([a-z_]+)'/g)).map((m) => ({
    state: m[1],
    at: m.index!,
  }));
}

/** The drizzle table a route reads, so the select rule works per rail. */
function tableOf(src: string): string {
  const m = src.match(/\.from\((\w+)\)/);
  expect(m, 'could not read the table this route selects from').not.toBeNull();
  return m![1];
}

describe('a collection that was not booked is not reported as a donation', () => {
  const ROUTES = statusRoutes();
  const THANK_YOU = thankYouStates();

  it('finds the status routes at all, and both rails are among them', () => {
    /*
      ⛔ ANTI-VACUITY, and the reason this file stopped naming one path. If
      discovery broke, every per-route rule below would pass over nothing.
    */
    expect(ROUTES.length, 'no status routes found - discovery is broken').toBeGreaterThanOrEqual(
      2,
    );
    const names = ROUTES.map((r) => r.rel);
    expect(names.some((n) => n.includes('/payhero/'))).toBe(true);
    expect(names.some((n) => n.includes('/palpluss/'))).toBe(true);
  });

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

  it.each(ROUTES.map((r) => [r.rel, r] as const))(
    '%s: ⛔ exactly one place may answer a thank-you state',
    (_name, r) => {
      /*
        The defect was three places answering it from `status` alone. One
        answering site means one decider; a second is a second answer to the
        same question.
      */
      const claiming = settledCalls(r.src).filter((c) => THANK_YOU.includes(c.state));
      expect(
        claiming.length,
        `expected exactly 1 site answering ${THANK_YOU.join('/')}, found ${claiming.length}`,
      ).toBe(1);
    },
  );

  it.each(ROUTES.map((r) => [r.rel, r] as const))(
    '%s: ⛔ routes its answer through that judgement',
    (_name, r) => {
      /*
        ANTI-VACUITY for the executed row above: a pure function nobody calls
        proves nothing about what the donor is told.
      */
      expect(r.src).toMatch(/claimForSettledCollection\(donationId\)/);
    },
  );

  it.each(ROUTES.map((r) => [r.rel, r] as const))(
    '%s: ⛔ each claim answers the state it is named after',
    (_name, r) => {
      /*
        The answer table is keyed by the claim precisely so there is no
        condition to invert (§5.1). What remains possible is SWAPPING the two
        entries, and that makes a key disagree with the state it answers -
        which, unlike a ternary's direction, is visible.
      */
      expect(r.src).toMatch(
        /collected_unrecorded:\s*\(\)\s*=>\s*\n?\s*settled\('collected_unrecorded'/,
      );
      expect(r.src).toMatch(/succeeded:\s*\(\)\s*=>\s*settled\('succeeded'/);
    },
  );

  it.each(ROUTES.map((r) => [r.rel, r] as const))(
    '%s: ⛔ that one place is the answer-table entry of the same name',
    (_name, r) => {
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
      const claiming = settledCalls(r.src).filter((c) => THANK_YOU.includes(c.state));
      const prefix = r.src.slice(0, claiming[0].at).trimEnd();
      expect(
        prefix.endsWith(`${claiming[0].state}: () =>`),
        `the ${claiming[0].state} answer must sit in the table entry of the same name`,
      ).toBe(true);
    },
  );

  it.each(ROUTES.map((r) => [r.rel, r] as const))(
    '%s: ⛔ the decider is used by EVERY branch that can answer for a settled row',
    (_name, r) => {
      /*
        ANTI-VACUITY the other way: a decider nobody calls satisfies the rules
        above while every branch keeps claiming success. All three branches that
        can speak for a settled collection must route through it - named
        individually rather than counted, because a count passes as soon as the
        calls total up however they are distributed.
      */
      expect(r.src, 'the terminal-row early return').toMatch(
        /row\.status === 'succeeded'\)\s*return succeededOrUnrecorded/,
      );
      expect(r.src, "case 'already_settled'").toMatch(
        /outcome\.status === 'succeeded'\)\s*return succeededOrUnrecorded/,
      );
      expect(r.src, "case 'recorded'").toMatch(
        /case 'recorded':[\s\S]{0,200}?return succeededOrUnrecorded\(outcome\.donationId\)/,
      );
    },
  );

  it.each(ROUTES.map((r) => [r.rel, r] as const))(
    '%s: ⛔ selects the donation link, or the decider has nothing to read',
    (_name, r) => {
      /*
        The table is derived from the route itself, so this works per rail
        without this file knowing either schema name.
      */
      expect(r.src).toMatch(new RegExp(`donationId:\\s*${tableOf(r.src)}\\.donationId`));
    },
  );

  /*
    ── The contract between a route and whatever polls it ───────────────────

    `docs/183`: the Palpluss poll can answer `reversed`, which the shared form
    does not render — it would fall through to the `keepPolling === false`
    branch and show the `unresolved` screen, headed "We could not confirm this
    payment", about an outcome we understand perfectly well.

    That is harmless only while no client fetches that route, which is the
    state today. So the rule is derived from WHO FETCHES WHAT: it is vacuous
    for a route nothing polls, and arms itself the moment the form is pointed
    at one.

    ⚠️ `pending` is deliberately exempt. It is the fall-through by design -
    the client keeps polling unless told to stop - so requiring an explicit
    test for it would fail correct code.
  */
  it.each(ROUTES.map((r) => [r.rel, r] as const))(
    '%s: ⛔ every terminal state it can answer is handled by any client that polls it',
    (rel, r) => {
      const routePath = rel
        .replace(/^src\/app/, '')
        .replace(/\/route\.ts$/, '');
      if (!CLIENT_CODE.includes(routePath)) return; // nothing polls it yet

      const answered = new Set(settledCalls(r.src).map((c) => c.state));
      answered.delete('pending');
      const tested = new Set(
        Array.from(CLIENT_CODE.matchAll(/state === '([a-z_]+)'/g)).map((m) => m[1]),
      );

      const unhandled = [...answered].filter((s) => !tested.has(s));
      expect(
        unhandled,
        `${CLIENT_PATH} polls ${routePath} but does not test for ${unhandled.join(', ')}. ` +
          'An unhandled terminal state falls through to the unresolved screen, which says ' +
          '"We could not confirm this payment" about an outcome the server just confirmed. ' +
          'docs/183 §4.',
      ).toEqual([]);
    },
  );

  it('CONTROL: that contract rule is live for the rail the client does poll', () => {
    /*
      ⛔ ANTI-VACUITY. The rule above `return`s for any route nothing fetches,
      so if the client stopped naming either path it would pass over both and
      protect nothing. At least one route must actually be polled.
    */
    const polled = ROUTES.filter((r) =>
      CLIENT_CODE.includes(r.rel.replace(/^src\/app/, '').replace(/\/route\.ts$/, '')),
    );
    expect(
      polled.length,
      'the client polls no status route at all - the contract rule is inert',
    ).toBeGreaterThan(0);
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
