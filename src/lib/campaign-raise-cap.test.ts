/**
 * Tests for the pre-verification fundraising cap.
 *
 * The failure that prompted this work: money OUT was gated on verification
 * (`withdraw/route.ts` refuses anything but `fully_verified`) while money IN
 * was gated on campaign STATUS only. On 2026-10-24 production held 13
 * `active` campaigns, every one of them `unverified`, so each could have
 * raised an unbounded amount and only discovered at payout that it could not
 * be paid. The first test below is that symptom.
 */

import { describe, it, expect } from 'vitest';
import {
  checkRaiseCap,
  isCapExempt,
  CAP_EXEMPT_VERIFICATION_STATUSES,
} from './campaign-raise-cap';
import { CURRENCIES, getCurrency } from './money/currencies';
import { formatMoney } from './money/format';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const USD = getCurrency('USD');
const KES = getCurrency('KES');

describe('the symptom: an unverified campaign used to raise without limit', () => {
  it('refuses a donation that would carry an unverified campaign past the cap', () => {
    const d = checkRaiseCap(
      { verificationStatus: 'unverified', realRaisedMinor: USD.unverifiedCapMinor, currency: 'USD' },
      USD.minDonationMinor,
    );
    expect(d.allowed).toBe(false);
  });

  it('refuses a single donation far larger than the cap', () => {
    // USD maxDonationMinor is 10,000,000 against a 50,000 cap, so one
    // donation can exceed it 200-fold. A check written as
    // `realRaised < cap` would wave this through.
    expect(USD.maxDonationMinor).toBeGreaterThan(USD.unverifiedCapMinor);
    const d = checkRaiseCap(
      { verificationStatus: 'unverified', realRaisedMinor: 0, currency: 'USD' },
      USD.maxDonationMinor,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('CAP_EXCEEDED');
  });
});

describe('boundaries', () => {
  it('allows a donation that lands exactly ON the cap', () => {
    const d = checkRaiseCap(
      { verificationStatus: 'unverified', realRaisedMinor: 0, currency: 'USD' },
      USD.unverifiedCapMinor,
    );
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.remainingMinor).toBe(USD.unverifiedCapMinor);
  });

  it('refuses a donation ONE minor unit over the cap', () => {
    const d = checkRaiseCap(
      { verificationStatus: 'unverified', realRaisedMinor: 0, currency: 'USD' },
      USD.unverifiedCapMinor + 1,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('CAP_EXCEEDED');
  });

  it('allows the last donation that exactly fills the remaining headroom', () => {
    const raised = USD.unverifiedCapMinor - USD.minDonationMinor;
    const d = checkRaiseCap(
      { verificationStatus: 'unverified', realRaisedMinor: raised, currency: 'USD' },
      USD.minDonationMinor,
    );
    expect(d.allowed).toBe(true);
  });
});

describe('headroom smaller than the currency floor is CAP_REACHED, not CAP_EXCEEDED', () => {
  /*
    The distinction matters to the donor. If KES 30 of headroom is left but
    the floor is KES 50, there is no amount they could type that succeeds.
    Telling them "you can still give KES 30" offers an amount
    `checkDonationAmount` then rejects, which reads as the site contradicting
    itself.
  */
  it('reports CAP_REACHED when the gap is below minDonationMinor', () => {
    const raised = KES.unverifiedCapMinor - (KES.minDonationMinor - 100);
    const d = checkRaiseCap(
      { verificationStatus: 'unverified', realRaisedMinor: raised, currency: 'KES' },
      KES.minDonationMinor,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe('CAP_REACHED');
      expect(d.remainingMinor).toBeGreaterThan(0);
      expect(d.remainingMinor).toBeLessThan(KES.minDonationMinor);
    }
  });

  it('reports CAP_REACHED, and never negative headroom, when already over the cap', () => {
    // Reachable: the cap is enforced before collection, so a settled
    // overshoot (see the concurrency block below) leaves realRaised > cap.
    const d = checkRaiseCap(
      { verificationStatus: 'unverified', realRaisedMinor: USD.unverifiedCapMinor * 3, currency: 'USD' },
      USD.minDonationMinor,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe('CAP_REACHED');
      expect(d.remainingMinor).toBe(0);
    }
  });
});

describe('verification lifts the cap', () => {
  it.each([...CAP_EXEMPT_VERIFICATION_STATUSES])('%s is exempt', (status) => {
    const d = checkRaiseCap(
      { verificationStatus: status, realRaisedMinor: USD.unverifiedCapMinor * 100, currency: 'USD' },
      USD.maxDonationMinor,
    );
    expect(d.allowed).toBe(true);
    expect(isCapExempt(status)).toBe(true);
  });

  /*
    Pins the exempt list. `verification_status` also contains 'verified',
    'pending', 'submitted_for_review', 'documents_uploaded', 'info_requested',
    'rejected' and 'suspended'. Only the two an admin approval writes
    (approve_t1 -> identity_verified, approve_t2 -> fully_verified) lift the
    cap. If someone adds a state here, this test makes them say so out loud.
  */
  it('exempts exactly the four statuses downstream of an ID check', () => {
    /*
      ⚠️ Was `identity_verified` and `fully_verified` only, and the two
      document-review statuses were asserted NOT exempt directly below. That
      was right while nothing could reach them from `identity_verified`;
      `docs/121` opened the submit path and armed the consequence - an
      organiser who passed the ID check and sent their papers dropped back
      under the limit, and donors started being refused.

      Owner decision, 2026-10-27: the cap lifts once a person has checked the
      ID, and sending papers afterwards does not put it back. `docs/121` §10.
    */
    expect([...CAP_EXEMPT_VERIFICATION_STATUSES].sort()).toEqual([
      'documents_uploaded',
      'fully_verified',
      'identity_verified',
      'submitted_for_review',
    ]);
  });

  it.each(['unverified', 'pending', 'info_requested', 'rejected', 'suspended', 'verified'])(
    '%s is NOT exempt',
    (status) => {
      expect(isCapExempt(status)).toBe(false);
    },
  );

  it('⛔ the premise: an organiser can only reach the document statuses via the ID check', () => {
    /*
      This is what makes the two additions above safe rather than generous,
      so it is asserted rather than left in a comment.

      The submit route is the only organiser writer of `documents_uploaded`,
      and it requires at least one document; the upload form renders only once
      the ID check has passed. So neither status is reachable by an organiser
      without `identity_verified` first - which is why treating them as
      "a person has checked this ID" is true and not optimistic.

      ⛔ If either of these two reads stops holding, the exemption above is
      lifting a cap on an unchecked campaign and this decision must be
      reopened.
    */
    const strip = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    const submitRoute = strip(
      readFileSync(
        resolve(__dirname, '../app/api/v1/user-campaigns/[id]/verification/submit/route.ts'),
        'utf-8',
      ),
    );
    const dashboard = strip(
      readFileSync(
        resolve(__dirname, '../components/verification/CampaignVerificationDashboard.tsx'),
        'utf-8',
      ),
    );

    // The submit route refuses without a document.
    expect(submitRoute).toMatch(/Upload at least one verification document/);
    // The upload form is behind the ID check.
    expect(dashboard).toMatch(/identityVerified \|\| documents\.length > 0/);
  });
});

describe('money-safety invariants', () => {
  /*
    If a currency's cap were below its donation floor, the campaign would be
    closed to donations from its very first shilling - the cap would read as
    "this campaign is broken" rather than "this campaign is unverified".
  */
  it.each(Object.keys(CURRENCIES))('%s: cap is above the donation floor', (code) => {
    const def = getCurrency(code);
    expect(def.unverifiedCapMinor).toBeGreaterThan(def.minDonationMinor);
  });

  it.each(Object.keys(CURRENCIES))('%s: cap is a whole number of minor units', (code) => {
    expect(Number.isInteger(getCurrency(code).unverifiedCapMinor)).toBe(true);
  });

  it('never caps on a currency it does not know, rather than guessing a figure', () => {
    const d = checkRaiseCap(
      { verificationStatus: 'unverified', realRaisedMinor: 10 ** 9, currency: 'ZZZ' },
      10 ** 9,
    );
    expect(d.allowed).toBe(true);
  });
});

describe('seed money must not consume real headroom', () => {
  /*
    `campaigns.raised_amount` is BLENDED: the simulation engine increments it
    for `source = 'seed'` rows that carry no money. The cap is measured over
    real un-refunded donations instead, so a campaign showing a large seeded
    total still has its full real headroom. This test states the contract the
    callers' scalar subquery implements.
  */
  it('a campaign with a large seeded total but no real donations has full headroom', () => {
    const d = checkRaiseCap(
      { verificationStatus: 'unverified', realRaisedMinor: 0, currency: 'USD' },
      USD.unverifiedCapMinor,
    );
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.remainingMinor).toBe(USD.unverifiedCapMinor);
  });
});

describe('the concurrency bound, stated rather than assumed', () => {
  /*
    THIS IS A KNOWN LIMITATION, ENCODED ON PURPOSE.

    The cap is enforced BEFORE the provider is asked for money, because that
    is the last moment at which refusing costs the donor nothing. By the time
    `payment-service.ts` settles, M-Pesa or Stripe has already taken the
    funds, and refusing there would mean refunding - which moves money and
    burns the flat KES 8.9 collection fee the platform absorbs.

    The consequence is that `checkRaiseCap` is a pure function of a figure
    read a moment ago, so two donors in flight at once can both be told yes.
    The overshoot is bounded by (concurrent in-flight donations x
    maxDonationMinor) and is NOT zero. Do not read the tests above as proving
    the cap is atomic. Closing this would require either reserving headroom
    at initiate or auto-refunding the overage, and auto-refunding moves money,
    which is the owner's call.
  */
  it('two concurrent donors reading the same figure are BOTH allowed', () => {
    const stale = { verificationStatus: 'unverified', realRaisedMinor: 0, currency: 'USD' as const };
    const a = checkRaiseCap(stale, USD.unverifiedCapMinor);
    const b = checkRaiseCap(stale, USD.unverifiedCapMinor);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    // So the settled total can reach twice the cap.
    expect(USD.unverifiedCapMinor * 2).toBeGreaterThan(USD.unverifiedCapMinor);
  });

  it('once the overshoot has settled, further donations are refused', () => {
    const d = checkRaiseCap(
      { verificationStatus: 'unverified', realRaisedMinor: USD.unverifiedCapMinor * 2, currency: 'USD' },
      USD.minDonationMinor,
    );
    expect(d.allowed).toBe(false);
  });
});

describe('the donor-facing wording', () => {
  /*
    Found by exercising `create-checkout` over HTTP, not by a unit test: with
    nothing raised yet, `remainingMinor` equals the cap and the message said
    "can take $500.00 more for now. It can accept up to $500.00 before..." -
    the same figure twice. Every assertion here previously checked the CODE
    and the headroom, never the sentence.
  */
  it('does not print the same figure twice when nothing has been raised', () => {
    const d = checkRaiseCap(
      { verificationStatus: 'unverified', realRaisedMinor: 0, currency: 'USD' },
      USD.unverifiedCapMinor + 1,
    );
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    const cap = formatMoney(USD.unverifiedCapMinor, 'USD', 'exact');
    const occurrences = d.message.split(cap).length - 1;
    expect(occurrences, `"${cap}" appears ${occurrences}x in: ${d.message}`).toBe(1);
    expect(d.message).not.toMatch(/more for now/);
  });

  it('DOES name the remaining headroom once some has been used', () => {
    const raised = USD.unverifiedCapMinor - 2_000; // $20 left
    const d = checkRaiseCap(
      { verificationStatus: 'unverified', realRaisedMinor: raised, currency: 'USD' },
      USD.unverifiedCapMinor,
    );
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.message).toMatch(/\$20\.00 more for now/);
    expect(d.message).toMatch(/up to \$500\.00/);
  });

  it('every refusal says nothing has been charged', () => {
    const cases = [
      { realRaisedMinor: 0, amount: USD.unverifiedCapMinor + 1 },
      { realRaisedMinor: USD.unverifiedCapMinor, amount: USD.minDonationMinor },
      { realRaisedMinor: USD.unverifiedCapMinor - 100, amount: USD.minDonationMinor },
    ];
    for (const c of cases) {
      const d = checkRaiseCap(
        { verificationStatus: 'unverified', realRaisedMinor: c.realRaisedMinor, currency: 'USD' },
        c.amount,
      );
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.message).toMatch(/Nothing has been charged\./);
    }
  });
});
