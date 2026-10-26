/**
 * The words a donor reads before giving.
 *
 * These assertions look pedantic and are the point of the feature. `docs/108`
 * put the same guard on `VouchedByBadge` for the same reason: one edit to
 * "Verified" turns honest copy into a claim the platform cannot substantiate,
 * and nothing in the type system would notice.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { institutionalPayoutCopy, type PayoutDisclosure } from '@/lib/institutional-payout/public';

const base: PayoutDisclosure = {
  institutionName: 'Kenyatta National Hospital',
  institutionKindLabel: 'Hospital or clinic',
  organiserIdentityChecked: false,
};

const all = (d: PayoutDisclosure) => Object.values(institutionalPayoutCopy(d)).join(' ');

describe('what the donor is told', () => {
  it('names the institution in the claim itself, not just the badge', () => {
    const c = institutionalPayoutCopy(base);
    expect(c.badge).toContain('Kenyatta National Hospital');
    expect(c.body).toContain('Kenyatta National Hospital');
  });

  it('⛔ says the money does not pass through the family account', () => {
    expect(institutionalPayoutCopy(base).body).toMatch(/does not pass through/i);
  });

  it('⛔ never claims the ORGANISER is verified', () => {
    /*
      The destination is checked. The person is a separate question with a
      separate answer, and conflating them is the failure `docs/108` refused
      and `docs/110` found three screens already making.
    */
    const text = all(base);
    expect(text).not.toMatch(/\bverified\b/i);
    expect(text).not.toMatch(/\bverification\b/i);
    expect(text).not.toMatch(/\bwe checked the organiser\b/i);
  });

  it('⛔ states the ID gap when identity has NOT been checked', () => {
    expect(institutionalPayoutCopy(base).notChecked).toMatch(/ID/);
  });

  it('⛔ drops the ID gap once identity HAS been checked, keeping the bill-number gap', () => {
    /*
      The bill number is typed by the organiser and nothing can check it, so
      that caveat survives every verification state. If it ever disappears,
      the copy is claiming more than the system knows.
    */
    const c = institutionalPayoutCopy({ ...base, organiserIdentityChecked: true });
    expect(c.notChecked).not.toMatch(/ID/);
    expect(c.notChecked).toMatch(/bill number/i);
  });

  it('⛔ always admits the bill number is unchecked, in every state', () => {
    for (const checked of [true, false]) {
      const c = institutionalPayoutCopy({ ...base, organiserIdentityChecked: checked });
      expect(c.notChecked, String(checked)).toMatch(/bill number/i);
    }
  });

  it('uses the reader’s words, not ours', () => {
    // `docs/94`: name the thing the reader would name.
    const text = all(base).toLowerCase();
    for (const jargon of ['paybill', 'designation', 'disbursement', 'payout account', 'remittance']) {
      expect(text, jargon).not.toContain(jargon);
    }
  });

  it('keeps sentences short enough to read', () => {
    // `docs/94`: no sentence over 20 words.
    for (const [key, value] of Object.entries(institutionalPayoutCopy(base))) {
      for (const sentence of value.split(/(?<=[.!?])\s+/)) {
        const words = sentence.trim().split(/\s+/).filter(Boolean).length;
        expect(words, `${key}: ${sentence}`).toBeLessThanOrEqual(20);
      }
    }
  });
});
