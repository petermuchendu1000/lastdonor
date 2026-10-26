/**
 * The rules that decide where a campaign's money may go.
 *
 * The assertions that matter most are the NEGATIVE ones: a designation must
 * not grant anything, and it must take the organiser's withdrawal away. Those
 * two together are the whole safety argument of `docs/113` §11.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DESIGNATABLE_CAMPAIGN_STATUSES,
  NEVER_GRANTED,
  decideDesignation,
  isDesignationLocked,
  organiserWithdrawalBlockedBy,
  type DesignationInput,
} from '@/lib/institutional-payout/decide';

const NOW = new Date('2026-10-25T12:00:00.000Z');

function input(over: Partial<DesignationInput> = {}): DesignationInput {
  return {
    campaignStatus: 'active',
    campaignCurrency: 'KES',
    existing: null,
    account: { currency: 'KES', status: 'active', institutionStatus: 'active' },
    ...over,
  };
}

describe('decideDesignation', () => {
  it('allows the ordinary case: live KES campaign, active KES account', () => {
    expect(decideDesignation(input())).toEqual({ allowed: true });
  });

  it('⛔ refuses an account in a DIFFERENT currency from the campaign', () => {
    /*
      A campaign has one currency and two are never added together
      (`docs/92`). Sending a KES ledger to a USD account reinterprets the
      integer - the ~130x class of error the PayHero guards exist for.
    */
    const d = decideDesignation(input({ account: { currency: 'USD', status: 'active', institutionStatus: 'active' } }));
    expect(d).toEqual({ allowed: false, reason: 'currency_mismatch' });
  });

  it('refuses a retired account and a suspended institution separately', () => {
    expect(
      decideDesignation(input({ account: { currency: 'KES', status: 'retired', institutionStatus: 'active' } })),
    ).toEqual({ allowed: false, reason: 'account_not_active' });
    expect(
      decideDesignation(input({ account: { currency: 'KES', status: 'active', institutionStatus: 'suspended' } })),
    ).toEqual({ allowed: false, reason: 'institution_not_active' });
  });

  it('⛔ reports the LOCK ahead of "already designated"', () => {
    /*
      Two different sentences for the organiser: "you cannot change this now"
      is not "you already chose". Ordering is behaviour here, not style.
    */
    expect(decideDesignation(input({ existing: { lockedAt: NOW } }))).toEqual({
      allowed: false,
      reason: 'locked_money_already_sent',
    });
    expect(decideDesignation(input({ existing: { lockedAt: null } }))).toEqual({
      allowed: false,
      reason: 'already_designated',
    });
  });

  it('⛔ allows designation while a campaign is under_review', () => {
    /*
      After `docs/78`/`docs/79` EVERY submitted campaign sits in this state.
      If it were excluded the screen would be unreachable for every campaign
      on the platform - the `docs/83` failure, where a surface silently stops
      being reachable because of a decision made in another file.
    */
    expect(decideDesignation(input({ campaignStatus: 'under_review' }))).toEqual({ allowed: true });
    expect(DESIGNATABLE_CAMPAIGN_STATUSES).toContain('under_review');
  });

  it('refuses terminal and punitive campaign states', () => {
    for (const status of ['completed', 'cancelled', 'suspended', 'archived']) {
      expect(decideDesignation(input({ campaignStatus: status })), status).toEqual({
        allowed: false,
        reason: 'campaign_status_forbids',
      });
    }
  });
});

describe('organiserWithdrawalBlockedBy', () => {
  it('⛔ blocks the organiser when an ACTIVE designation exists', () => {
    expect(organiserWithdrawalBlockedBy({ status: 'active', revokedAt: null })).toBe(
      'designated_to_institution',
    );
  });

  it('is inert for a campaign with no designation — which is every campaign today', () => {
    expect(organiserWithdrawalBlockedBy(null)).toBeNull();
  });

  it('does not block once the designation is revoked', () => {
    expect(organiserWithdrawalBlockedBy({ status: 'revoked', revokedAt: NOW })).toBeNull();
    // A row still marked active but carrying a revocation timestamp is
    // inconsistent; treat the revocation as the truth rather than blocking a
    // creator out of their own money on a data error.
    expect(organiserWithdrawalBlockedBy({ status: 'active', revokedAt: NOW })).toBeNull();
  });
});

describe('isDesignationLocked', () => {
  it('is false before money moves and true after', () => {
    expect(isDesignationLocked(null)).toBe(false);
    expect(isDesignationLocked({ lockedAt: null })).toBe(false);
    expect(isDesignationLocked({ lockedAt: NOW })).toBe(true);
  });
});

describe('⛔ the module grants nothing', () => {
  const DIR = join(process.cwd(), 'src/lib/institutional-payout');
  const code = readFileSync(join(DIR, 'decide.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('names every capability a designation must never confer', () => {
    expect([...NEVER_GRANTED].sort()).toEqual(
      [
        'bypass_review',
        'lift_raise_cap',
        'publish_campaign',
        'release_funds',
        'verify_fully',
        'verify_identity',
      ].sort(),
    );
  });

  it('⛔ never mentions a verification status it could assign', () => {
    /*
      The `docs/108` lesson: the type system cannot notice a decision module
      quietly starting to return a verification value. It is read off the
      code instead. Comments are stripped first so the prose above - which
      discusses these states deliberately - is not a finding.
    */
    expect(code).not.toMatch(/fully_verified/);
    expect(code).not.toMatch(/identity_verified/);
  });

  it('⛔ contains no database access at all', () => {
    // A rule a test cannot execute is a rule nobody has checked (`docs/107`).
    expect(code).not.toMatch(/\bdb\b|drizzle|\.select\(|\.update\(|\.insert\(/);
  });
});
