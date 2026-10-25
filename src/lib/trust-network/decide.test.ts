/**
 * The vouch decisions, case by case.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import {
  canCampaignBeVouched,
  canInstitutionVouch,
  outcomeOfRevocation,
  VOUCHABLE_CAMPAIGN_STATUSES,
  VOUCHABLE_VERIFICATION_STATUSES,
  VOUCH_GRANTS_STATUS,
  VOUCH_WINDOW_DAYS,
} from './decide';

const activeInstitution = {
  status: 'active' as const,
  monthlyVouchLimit: 10,
  vouchesInWindow: 0,
};

const freshCampaign = {
  status: 'under_review',
  verificationStatus: 'unverified',
  alreadyVouchedByThisInstitution: false,
};

describe('canInstitutionVouch', () => {
  it('lets an active institution inside its budget vouch', () => {
    expect(canInstitutionVouch(activeInstitution)).toEqual({ ok: true });
    expect(canInstitutionVouch({ ...activeInstitution, vouchesInWindow: 9 })).toEqual({ ok: true });
  });

  it('refuses a suspended institution even with budget left', () => {
    const r = canInstitutionVouch({ ...activeInstitution, status: 'suspended' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('INSTITUTION_SUSPENDED');
  });

  it('refuses at the limit, not one past it', () => {
    // 10 of 10 is spent. The off-by-one here is the difference between a
    // budget of 10 and a budget of 11.
    const r = canInstitutionVouch({ ...activeInstitution, vouchesInWindow: 10 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('INSTITUTION_BUDGET_SPENT');
  });

  it('refuses a zero limit outright, which is how an institution is frozen without suspending it', () => {
    const r = canInstitutionVouch({ ...activeInstitution, monthlyVouchLimit: 0 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('INSTITUTION_BUDGET_SPENT');
  });

  it('names the window in the refusal, so an admin can tell what to change', () => {
    const r = canInstitutionVouch({ ...activeInstitution, vouchesInWindow: 10 });
    expect(r.ok === false && r.message).toContain('10');
    expect(r.ok === false && r.message).toContain(String(VOUCH_WINDOW_DAYS));
  });
});

describe('canCampaignBeVouched', () => {
  it('accepts every vouchable verification status', () => {
    for (const verificationStatus of VOUCHABLE_VERIFICATION_STATUSES) {
      expect(canCampaignBeVouched({ ...freshCampaign, verificationStatus }), verificationStatus)
        .toEqual({ ok: true });
    }
  });

  it('accepts every vouchable campaign status', () => {
    for (const status of VOUCHABLE_CAMPAIGN_STATUSES) {
      expect(canCampaignBeVouched({ ...freshCampaign, status }), status).toEqual({ ok: true });
    }
  });

  it('⛔ refuses an already-verified campaign in BOTH directions', () => {
    /*
      `identity_verified` already has what a vouch grants. `fully_verified`
      has MORE - money has been released against it - so writing the grant
      would be a DOWNGRADE performed by a third party. Both must refuse, and
      for a reader the second is the one that matters.
    */
    for (const verificationStatus of ['identity_verified', 'fully_verified']) {
      const r = canCampaignBeVouched({ ...freshCampaign, verificationStatus });
      expect(r.ok, verificationStatus).toBe(false);
      expect(r.ok === false && r.code).toBe('VERIFICATION_STATE');
      expect(r.ok === false && r.message).toContain('already verified');
    }
  });

  it('refuses a campaign a person rejected', () => {
    // Un-rejecting is an admin action with its own trail, not something a
    // third party does by writing in.
    const r = canCampaignBeVouched({ ...freshCampaign, verificationStatus: 'rejected' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('VERIFICATION_STATE');
  });

  it('refuses a suspended, cancelled, completed or archived campaign', () => {
    for (const status of ['suspended', 'cancelled', 'completed', 'archived']) {
      const r = canCampaignBeVouched({ ...freshCampaign, status });
      expect(r.ok, status).toBe(false);
      expect(r.ok === false && r.code).toBe('CAMPAIGN_STATE');
    }
  });

  it('refuses a second live vouch from the same institution', () => {
    const r = canCampaignBeVouched({ ...freshCampaign, alreadyVouchedByThisInstitution: true });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('ALREADY_VOUCHED');
  });

  it('checks the duplicate FIRST, so the message names the real problem', () => {
    /*
      A campaign that is already vouched for is also already
      `identity_verified`, so order decides which refusal an admin reads.
      "This organisation has already vouched" is actionable; "already
      verified, so a vouch would add nothing" sends them looking for a
      document review that does not exist.
    */
    const r = canCampaignBeVouched({
      status: 'active',
      verificationStatus: 'identity_verified',
      alreadyVouchedByThisInstitution: true,
    });
    expect(r.ok === false && r.code).toBe('ALREADY_VOUCHED');
  });
});

describe('outcomeOfRevocation', () => {
  const vouchVerified = {
    verificationStatus: VOUCH_GRANTS_STATUS,
    verificationSource: 'institution_vouch' as const,
    otherLiveVouches: 0,
  };

  it('un-verifies the campaign when this vouch was the only thing verifying it', () => {
    const o = outcomeOfRevocation(vouchVerified);
    expect(o.verificationStatus).toBe('unverified');
    expect(o.verificationSource).toBeNull();
    expect(o.reason).toContain('raise cap');
  });

  it('leaves it alone when another institution still vouches', () => {
    const o = outcomeOfRevocation({ ...vouchVerified, otherLiveVouches: 1 });
    expect(o.verificationStatus).toBeNull();
    expect(o.reason).toContain('Another organisation');
  });

  it('⛔ never undoes a document review', () => {
    const o = outcomeOfRevocation({ ...vouchVerified, verificationSource: 'documents' });
    expect(o.verificationStatus).toBeNull();
    expect(o.reason).toContain('documents');
  });

  it('⛔ treats an unrecorded source as UNKNOWN, not as this vouch’s doing', () => {
    /*
      A campaign verified before `verification_source` existed has NULL
      there. Reading NULL as "this mechanism set it" would strip a status
      this code never granted - the same confusion `docs/106` records about
      a missing trusted name, where "cannot judge" had to be kept distinct
      from "no problem found".
    */
    const o = outcomeOfRevocation({ ...vouchVerified, verificationSource: null });
    expect(o.verificationStatus).toBeNull();
    expect(o.reason).toContain('not recorded');
  });

  it('⛔ never lowers fully_verified, because money has been released against it', () => {
    for (const verificationSource of ['institution_vouch', 'documents', null] as const) {
      const o = outcomeOfRevocation({
        verificationStatus: 'fully_verified',
        verificationSource,
        otherLiveVouches: 0,
      });
      expect(o.verificationStatus, String(verificationSource)).toBeNull();
    }
  });

  it('checks the other-vouches case before the status case', () => {
    // Corroboration survives even when the status is one this code did not
    // set: the point of the first branch is that the OTHER assertion stands.
    const o = outcomeOfRevocation({
      verificationStatus: 'fully_verified',
      verificationSource: 'documents',
      otherLiveVouches: 2,
    });
    expect(o.reason).toContain('Another organisation');
  });
});

describe('the boundary, as a value', () => {
  it('⛔ a vouch grants identity_verified and nothing more', () => {
    /*
      This single line is the safety argument of the whole feature.
      `fully_verified` releases money: the admin verification route sets
      `total_released_amount` in the same transaction that writes it. If this
      constant ever becomes that status, a third party's email can move money.
    */
    expect(VOUCH_GRANTS_STATUS).toBe('identity_verified');
    expect(VOUCH_GRANTS_STATUS).not.toBe('fully_verified');
  });

  it('does not list a verified status as vouchable', () => {
    expect(VOUCHABLE_VERIFICATION_STATUSES).not.toContain('identity_verified');
    expect(VOUCHABLE_VERIFICATION_STATUSES).not.toContain('fully_verified');
  });

  it('⛔ does not list a published-campaign bypass', () => {
    // A vouch skips the VERIFICATION queue, not the publication review that
    // docs/78 and docs/79 made real. Nothing here touches `campaigns.status`,
    // and `under_review` being vouchable is what lets the reviewer read the
    // vouch while the campaign waits.
    expect(VOUCHABLE_CAMPAIGN_STATUSES).toContain('under_review');
  });
});
