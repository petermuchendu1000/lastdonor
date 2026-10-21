/**
 * Every outgoing email stays readable by the people who receive it.
 *
 * ## Who this is for
 *
 * Someone who left school early. Someone reading in a second language.
 * Someone deciding whether to trust us with money, or acting on a deadline
 * that costs them funds if they miss it. Our copy is the only thing
 * standing between them and a wrong decision, and the cost of a sentence
 * they have to read twice is not evenly shared.
 *
 * ## Why a ratchet and not a style guide
 *
 * Every one of the 45 templates was written by somebody trying to be
 * clear. 20 of them still exceeded the budget, with the worst at grade
 * 15.5 - a postgraduate reading level, on an email telling a person we
 * could not check their ID. Good intentions produced that; only a number
 * catches it.
 *
 * The budget, glossary and measurement live in `@/lib/email-readability`,
 * shared with `scripts/email-readability.ts` so the CLI and this test can
 * never disagree. See `docs/94`.
 *
 * ## If this test fails
 *
 * Run `npx tsx scripts/email-readability.ts --verbose`. It names the
 * template, the sentences that are too long, and the plain word to use
 * instead of each piece of jargon. Fix the copy. Do NOT raise the budget:
 * the numbers are the audience, not the target.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  BUDGET,
  JARGON,
  EMAIL_SOURCE_FILES,
  measureAll,
  failures,
  scoreHtml,
} from './email-readability';

const rows = measureAll();

describe('every outgoing email is written in plain language', () => {
  it('finds the templates at all', () => {
    // Without this, every assertion below is vacuously true - which is how
    // a ratchet quietly stops ratcheting.
    expect(EMAIL_SOURCE_FILES.length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThanOrEqual(40);
  });

  it(`reads at grade ${BUDGET.grade} or below`, () => {
    const over = rows
      .filter((r) => r.grade > BUDGET.grade)
      .map((r) => `${r.name}: grade ${r.grade}`);
    expect(
      over,
      'Flesch-Kincaid grade above the budget. Shorten the sentences and ' +
        'prefer shorter words. Run: npx tsx scripts/email-readability.ts --verbose',
    ).toEqual([]);
  });

  it(`keeps every sentence to ${BUDGET.longestSentence} words or fewer`, () => {
    const over = rows
      .filter((r) => r.longest > BUDGET.longestSentence)
      .map((r) => `${r.name} (${r.longest}w): ${r.longSentences[0] ?? ''}`);
    expect(
      over,
      'Sentence length is the biggest barrier for a reader who is tired, ' +
        'stressed or reading in a second language. Split it in two.',
    ).toEqual([]);
  });

  it('uses no jargon from the house glossary', () => {
    const hits = rows.flatMap((r) =>
      r.jargon.map((j) => `${r.name}: "${j}" -> say "${JARGON[j]}"`),
    );
    expect(
      hits,
      'These words are precise to us and opaque to the reader. The ' +
        'glossary in email-readability.ts gives the plain replacement.',
    ).toEqual([]);
  });

  it('reports no template that exceeds the budget on any axis', () => {
    expect(failures(rows).map((r) => r.name)).toEqual([]);
  });
});

/*
  The measurement itself is tested, because it was wrong twice and a
  harness that under-reports is worse than none: it issues a clean bill of
  health. Both cases below were real (docs/94).
*/
describe('the measurement is trustworthy', () => {
  it('does not run a heading into the paragraph beneath it', () => {
    // A heading has no full stop. Stripping tags naively joins these into
    // one 14-word sentence; a reader sees two short ones.
    const s = scoreHtml('<h1>Your campaign is in review</h1><p>It is not public yet.</p>');
    expect(s).not.toBeNull();
    expect(s!.sentences).toBe(2);
    expect(s!.longest).toBeLessThanOrEqual(6);
  });

  it('scores long sentences worse than short ones', () => {
    const short = scoreHtml('<p>We sent your money back. It takes five days.</p>')!;
    const long = scoreHtml(
      '<p>Your donation has subsequently been reimbursed in accordance with ' +
        'the aforementioned cancellation, notwithstanding any additional ' +
        'administrative requirements that may arise.</p>',
    )!;
    expect(long.grade).toBeGreaterThan(short.grade);
    expect(long.longest).toBeGreaterThan(short.longest);
  });

  it('detects glossary jargon', () => {
    const s = scoreHtml('<p>We will disburse the funds to the organiser.</p>')!;
    expect(s.jargon).toContain('disburse');
    expect(s.jargon).toContain('organiser');
  });

  it('ignores markup, colours and URLs rather than scoring them', () => {
    const plain = scoreHtml('<p>We sent your money back today.</p>')!;
    const dressed = scoreHtml(
      '<p style="color:#D97706;background:#fffbeb">We sent your money back today.</p>' +
        '<a href="https://lastdonor.org/dashboard/campaigns/x/verification">.</a>',
    )!;
    expect(dressed.words).toBe(plain.words);
  });
});
