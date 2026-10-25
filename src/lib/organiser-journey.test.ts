/**
 * The organiser journey, and the promises its copy is not allowed to make.
 *
 * ⚠️ The assertions that matter most here are the ones that tie this module's
 * WORDS to the gates the code actually enforces. The defect this replaces was
 * not a missing screen - it was six surfaces each holding its own partial idea
 * of the journey, none of which matched `withdraw/route.ts` or
 * `campaign-raise-cap.ts`. So the two tiers are read from those modules rather
 * than retyped here.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  nextOrganiserAction,
  organiserJourney,
  organiserJourneyOutline,
  unverifiedCapLabel,
  type JourneyFacts,
  type StepId,
} from '@/lib/organiser-journey';
import { CAP_EXEMPT_VERIFICATION_STATUSES } from '@/lib/campaign-raise-cap';

const ROOT = resolve(__dirname, '../..');

const base: JourneyFacts = {
  campaignId: '11111111-1111-4111-a111-111111111111',
  status: 'under_review',
  verificationStatus: 'unverified',
  currency: 'USD',
};

const step = (f: Partial<JourneyFacts>, id: StepId) =>
  organiserJourney({ ...base, ...f }).find((s) => s.id === id)!;

describe('the journey always has the same shape', () => {
  it('returns the same six steps in the same order, whatever the state', () => {
    /*
      A ladder whose rows reorder as it progresses is unreadable, and the
      shape of the path is itself what a first-time organiser needs to see.
    */
    const expected: StepId[] = [
      'write', 'review', 'identity', 'documents', 'payout_account', 'withdraw',
    ];
    for (const f of [
      {},
      { status: 'active' },
      { status: 'active', verificationStatus: 'identity_verified' },
      { status: 'completed', verificationStatus: 'fully_verified' },
      { status: 'draft' },
      { status: 'suspended' },
      { verificationStatus: 'rejected' },
    ]) {
      expect(organiserJourney({ ...base, ...f }).map((s) => s.id), JSON.stringify(f))
        .toEqual(expected);
    }
  });

  it('never throws on an unknown status or currency', () => {
    // This renders inside a dashboard list and inside a server component.
    // `getCurrency` throws on an unknown code (docs/92); a badge that takes
    // the page down with it is worse than one that says less.
    expect(() => organiserJourney({ ...base, currency: 'ZZZ' })).not.toThrow();
    expect(() => organiserJourney({ ...base, status: 'brand_new_status' })).not.toThrow();
    expect(() =>
      organiserJourney({ ...base, verificationStatus: 'brand_new_status' }),
    ).not.toThrow();
  });
});

describe('the two tiers are named separately, because they do different things', () => {
  it('⚠️ identity alone is NOT enough to be paid', () => {
    /*
      The distinction nothing used to surface: `identity_verified` lifts the
      raise cap, and the withdrawal route requires `fully_verified`. An
      organiser could be past the cap and still unable to take a penny out.
    */
    const j = { status: 'active', verificationStatus: 'identity_verified' };
    expect(step(j, 'identity').state).toBe('done');
    expect(step(j, 'documents').state).toBe('now');
    expect(step(j, 'withdraw').state).toBe('later');
    expect(step(j, 'withdraw').action).toBeNull();
  });

  it('only fully_verified opens the payout step', () => {
    const j = { status: 'active', verificationStatus: 'fully_verified' };
    expect(step(j, 'documents').state).toBe('done');
    expect(step(j, 'withdraw').state).toBe('now');
    expect(step(j, 'withdraw').action).toBe('Request payout');
  });

  it('matches the statuses the raise cap actually exempts', () => {
    // Read from `campaign-raise-cap.ts`, not retyped: if that list changes,
    // this module's "done" state must change with it.
    for (const status of CAP_EXEMPT_VERIFICATION_STATUSES) {
      expect(step({ verificationStatus: status }, 'identity').state, status).toBe('done');
    }
  });

  it('⛔ matches the status the withdrawal route actually requires', () => {
    const withdrawSource = readFileSync(
      resolve(ROOT, 'src/app/api/v1/user-campaigns/[id]/withdraw/route.ts'),
      'utf8',
    );
    // The route refuses anything but this one status.
    expect(withdrawSource).toContain("verificationStatus !== 'fully_verified'");

    // So no lesser status may show the payout step as reachable.
    for (const status of ['unverified', 'pending', 'documents_uploaded', 'identity_verified']) {
      expect(step({ status: 'active', verificationStatus: status }, 'withdraw').state, status)
        .toBe('later');
    }
  });
});

describe('the consequence is stated in money, not in status names', () => {
  it('names the cap in the campaign’s own currency', () => {
    // The real rendered figures, so a formatting change that drops the
    // amount - the one thing that makes the sentence useful - fails here.
    expect(step({ currency: 'USD' }, 'identity').consequence).toContain('$500.00');
    expect(step({ currency: 'KES' }, 'identity').consequence).toContain('50,000');
    expect(step({ currency: 'KES' }, 'identity').consequence).toContain('Ksh');
  });

  it('still says what is blocked when the currency is not one we can price', () => {
    // No figure is better than a wrong one, but the consequence must survive.
    const c = step({ currency: 'ZZZ' }, 'identity').consequence!;
    expect(c).toContain('cannot pay you');
    expect(c).not.toMatch(/\bNaN\b|undefined|\bnull\b/);
  });

  it('every unfinished step says what it blocks', () => {
    /*
      The field the old UI had nothing like. Without it, verification reads
      as bureaucracy rather than as the thing between them and the money.
    */
    for (const s of organiserJourney(base)) {
      if (s.state === 'done' || s.id === 'write' || s.id === 'withdraw') continue;
      expect(s.consequence, `${s.id} has no stated consequence`).toBeTruthy();
    }
  });
});

describe('⛔ promises the product does not keep', () => {
  const allCopy = (f: Partial<JourneyFacts>) =>
    organiserJourney({ ...base, ...f })
      .flatMap((s) => [s.title, s.detail, s.consequence ?? '', s.action ?? ''])
      .join(' ');

  const everyState = [
    {}, { status: 'draft' }, { status: 'active' }, { status: 'completed' },
    { status: 'suspended' }, { status: 'cancelled' },
    { verificationStatus: 'pending' }, { verificationStatus: 'rejected' },
    { verificationStatus: 'info_requested' }, { verificationStatus: 'suspended' },
    { verificationStatus: 'identity_verified' }, { verificationStatus: 'fully_verified' },
    { verificationStatus: 'documents_uploaded' }, { verificationStatus: 'submitted_for_review' },
  ];

  it('never quotes a turnaround time', () => {
    // docs/78 quotes none anywhere, deliberately.
    for (const f of everyState) {
      expect(allCopy(f), JSON.stringify(f)).not.toMatch(/\b\d+\s*(hours?|days?|weeks?)\b/i);
      expect(allCopy(f), JSON.stringify(f)).not.toMatch(/within \w+ (hours?|days?)/i);
    }
  });

  it('never promises an email when a campaign is DECIDED', () => {
    /*
      docs/93: a REFUSED campaign notifies nobody - `under_review` goes only
      to `active` or `suspended`, and the suspend path addresses donors, of
      which an unpublished campaign has none. Still open. Only the approval
      half may be promised, because only that email sends.
    */
    for (const f of everyState) {
      expect(allCopy(f), JSON.stringify(f)).not.toMatch(/when it is decided/i);
      expect(allCopy(f), JSON.stringify(f)).not.toMatch(/\bdecision\b/i);
      expect(allCopy(f), JSON.stringify(f)).not.toMatch(/either way/i);
    }
    expect(step({ status: 'under_review' }, 'review').consequence)
      .toBe('We will email you if it goes live.');
  });

  it('does not call a campaign live while it is still in the queue', () => {
    expect(allCopy({ status: 'under_review' })).not.toMatch(/\bis live\b/i);
    expect(step({ status: 'under_review' }, 'review').detail).toContain('not public yet');
  });
});

describe('the payout-account step does not claim what the caller did not supply', () => {
  it('stays quiet when the caller does not know', () => {
    // A dashboard list does not query payout accounts. Telling somebody who
    // already added one that they still need to is worse than saying less.
    const s = step({}, 'payout_account');
    expect(s.state).toBe('later');
    expect(s.detail).not.toMatch(/still need|add your/i);
  });

  it('asks only when the caller knows it is missing', () => {
    expect(step({ payoutAccount: 'missing' }, 'payout_account').state).toBe('now');
    expect(step({ payoutAccount: 'present' }, 'payout_account').state).toBe('done');
  });
});

describe('nextOrganiserAction', () => {
  it('puts a problem ahead of an ordinary next step', () => {
    const s = nextOrganiserAction({
      ...base, status: 'active', verificationStatus: 'info_requested',
    });
    expect(s?.id).toBe('identity');
    expect(s?.state).toBe('attention');
  });

  it('is the ID check for a brand-new campaign', () => {
    expect(nextOrganiserAction(base)?.id).toBe('identity');
  });

  it('is null when nothing is waiting on the organiser', () => {
    // Under review with identity done: the ball is with us, not them.
    expect(
      nextOrganiserAction({
        ...base, status: 'under_review', verificationStatus: 'fully_verified',
      }),
    ).toBeNull();
  });

  it('always carries a link and a label when it returns a step', () => {
    for (const f of [
      {}, { verificationStatus: 'rejected' }, { verificationStatus: 'info_requested' },
      { status: 'active', verificationStatus: 'identity_verified' },
      { payoutAccount: 'missing' as const },
    ]) {
      const s = nextOrganiserAction({ ...base, ...f });
      if (!s) continue;
      expect(s.href, `${s.id} has no href`).toBeTruthy();
      expect(s.action, `${s.id} has no action label`).toBeTruthy();
    }
  });
});

describe('the outline cannot drift from the ladder', () => {
  /*
    `/how-it-works` and the wizard never mentioned the ID check at all
    (docs/110), so somebody deciding whether to start a campaign learned
    nothing until after they submitted. The outline is what those surfaces
    render. Written as prose on the page it would have been a SEVENTH idea of
    the journey, so it lives beside the ladder - and this is the assertion
    that keeps it honest.
  */
  it('has the same steps, in the same order', () => {
    expect(organiserJourneyOutline().map((s) => s.id)).toEqual(
      organiserJourney(base).map((s) => s.id),
    );
  });

  it('every step says something, in the second person', () => {
    for (const s of organiserJourneyOutline()) {
      expect(s.title, s.id).toBeTruthy();
      expect(s.detail.length, s.id).toBeGreaterThan(10);
      expect(s.detail.endsWith('.'), s.id).toBe(true);
    }
  });

  it('⛔ names the photo ID, which is the sentence that was missing', () => {
    const identity = organiserJourneyOutline().find((s) => s.id === 'identity')!;
    expect(identity.detail.toLowerCase()).toContain('photo id');
    // And says what the check is for. "Verification" alone reads as
    // paperwork rather than as the thing between them and the money.
    expect(identity.detail.toLowerCase()).toContain('money');
  });

  it('marks the one step where the organiser waits on us', () => {
    const weAct = organiserJourneyOutline().filter((s) => s.weAct).map((s) => s.id);
    expect(weAct).toEqual(['review']);
  });

  it('⛔ quotes no turnaround and promises no decision email', () => {
    // Same two rules as the ladder (docs/78, docs/93), asserted separately
    // because this copy is on a PUBLIC page and reaches more people.
    const all = organiserJourneyOutline()
      .flatMap((s) => [s.title, s.detail])
      .join(' ');
    expect(all).not.toMatch(/\b\d+\s*(hours?|days?|weeks?)\b/i);
    expect(all).not.toMatch(/when it is decided|\bdecision\b|either way/i);
  });
});

describe('unverifiedCapLabel', () => {
  it('prices the collectable currencies', () => {
    expect(unverifiedCapLabel('USD')).toContain('500');
    expect(unverifiedCapLabel('KES')).toBeTruthy();
  });

  it('returns null rather than guessing', () => {
    expect(unverifiedCapLabel('ZZZ')).toBeNull();
    expect(unverifiedCapLabel('')).toBeNull();
  });
});
