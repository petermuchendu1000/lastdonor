/**
 * `classifyPalplussStatus`, executed over every value it can be handed.
 *
 * ⛔ This is a PURE function precisely so that it can be, and the reason is
 * `docs/162` §5.1: an injection that INVERTED a settlement decision passed
 * every structural/text rule, because text cannot see which way a branch
 * points. `docs/157` §4.1 fixed the same class the same way. So the whole of
 * "is this money" is one function and these tests drive it, rather than a
 * grep asserting the settlement file mentions the right words.
 */

import { describe, expect, it } from 'vitest';
import { classifyPalplussStatus } from './palpluss';

describe('classifyPalplussStatus', () => {
  /*
    All seven documented values, each pinned individually. An `it.each` over a
    table would read more compactly and would also let a single wrong
    expectation hide as a typo in data; these are seven money decisions.
  */
  it('PENDING is not over', () => {
    expect(classifyPalplussStatus('PENDING')).toBe('pending');
  });

  it('PROCESSING is not over either', () => {
    expect(classifyPalplussStatus('PROCESSING')).toBe('pending');
  });

  it('SUCCESS is the only value that means money arrived', () => {
    expect(classifyPalplussStatus('SUCCESS')).toBe('success');
  });

  it('FAILED means no money moved', () => {
    expect(classifyPalplussStatus('FAILED')).toBe('failed');
  });

  it('CANCELLED means no money moved', () => {
    expect(classifyPalplussStatus('CANCELLED')).toBe('failed');
  });

  it('EXPIRED means no money moved', () => {
    // Absent from the published status enum, present in the webhook event
    // list. Handled rather than guessed at (docs/180's contradiction #3).
    expect(classifyPalplussStatus('EXPIRED')).toBe('failed');
  });

  /*
    ⛔ The distinction that justifies a fifth class. REVERSED and FAILED both
    decline to book a donation and look identical to a donor, so the pressure
    to merge them is real - and merging them would file "money moved and came
    back" under "the payment did not go through", losing a movement on the
    service account that somebody may have to reconcile.
  */
  it('REVERSED is its own class, NOT failed', () => {
    expect(classifyPalplussStatus('REVERSED')).toBe('reversed');
    expect(classifyPalplussStatus('REVERSED')).not.toBe('failed');
  });

  /*
    The soundness hole this function exists to close. `TransactionSnapshot.
    status` is narrowed and falls back to PENDING, so an unrecognised value
    arrives there indistinguishable from a genuine pending one - and a
    settlement that read it would treat Palpluss's vocabulary growing as
    "still waiting" forever, or worse, as a failure.
  */
  /*
    ⚠️ `'success'` is deliberately NOT in this list, and its absence is the
    finding. The first version of this file had it here — commented "right
     word, and still not a value they document in lower case" — while the
    normalisation block below asserted `'success' → 'success'`. One file,
    both halves of a contradiction, green on neither: `docs/109`'s lesson
    ("nothing compares two assertions to each other") caught here only
    because both happened to be in the same run.

    The code is right. Case IS normalised, on purpose: the one thing worse
    than an unrecognised status is a recognised one misread as unrecognised,
    which leaves a settled payment pending forever.
  */
  it.each(['SETTLED', 'REFUNDED', 'DISPUTED', 'OK', 'TRUE', '', '   '])(
    '%p is unrecognised, never an outcome',
    (raw) => {
      expect(classifyPalplussStatus(raw)).toBe('unrecognised');
    },
  );

  it('null and undefined are unrecognised', () => {
    expect(classifyPalplussStatus(null)).toBe('unrecognised');
    expect(classifyPalplussStatus(undefined)).toBe('unrecognised');
  });

  /*
    Casing and whitespace are normalised, because the one thing worse than an
    unrecognised status is a recognised one misread as unrecognised: that
    leaves a settled payment pending forever. [VERIFIED] the live API returns
    upper case on both endpoints, so this is tolerance, not a guess about
    which case they use.
  */
  it.each([
    ['success', 'success'],
    ['Success', 'success'],
    ['  SUCCESS  ', 'success'],
    ['failed', 'failed'],
    ['reversed', 'reversed'],
    ['pending', 'pending'],
  ] as const)('%p normalises to %p', (raw, expected) => {
    expect(classifyPalplussStatus(raw)).toBe(expected);
  });

  /*
    ANTI-VACUITY. Every rule above asserts one value maps to one class; none
    of them would notice a function that returned the same class for
    everything. These two pin that the partition is real.
  */
  it('does not collapse every input to one class', () => {
    const classes = new Set(
      ['PENDING', 'SUCCESS', 'FAILED', 'REVERSED', 'NONSENSE'].map(classifyPalplussStatus),
    );
    expect(classes.size).toBe(5);
  });

  it('exactly one documented value yields success', () => {
    const documented = [
      'PENDING',
      'PROCESSING',
      'SUCCESS',
      'FAILED',
      'REVERSED',
      'CANCELLED',
      'EXPIRED',
    ];
    const successes = documented.filter((s) => classifyPalplussStatus(s) === 'success');
    expect(successes).toEqual(['SUCCESS']);
  });
});
