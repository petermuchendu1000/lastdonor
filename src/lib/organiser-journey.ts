/**
 * The one definition of what an organiser must do to get paid.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Audited 2026-10-25. An organiser was never told, anywhere, that getting the
 * money requires their ID:
 *
 *   /how-it-works              the word "verification" does not appear
 *   the six-screen wizard      never mentions it
 *   the submission receipt     never mentions it
 *   "your campaign is live"    never mentions it
 *   scheduled reminders        `notifyVerificationReminder` has FOUR urgency
 *                              levels and ZERO callers; no cron exists
 *
 * The only prompts were one grey line on `/dashboard` and a link fourth of
 * five on the campaign page. Nothing ever said it mattered.
 *
 * Every surface now renders from THIS module, so the steps, their order, the
 * words and the consequences cannot drift apart again. That is the point: the
 * previous state was not one missing feature, it was six surfaces each with
 * its own partial idea of the journey.
 *
 * ── THE TWO TIERS, WHICH NOTHING USED TO NAME ───────────────────────────────
 *
 * ⚠️ There are two verification tiers with two DIFFERENT consequences, and an
 * organiser had no way to learn either:
 *
 *   `identity_verified`  lifts the pre-verification raise cap (`docs/101`,
 *                        `CAP_EXEMPT_VERIFICATION_STATUSES`) - the campaign
 *                        can keep taking money.
 *   `fully_verified`     is what `user-campaigns/[id]/withdraw/route.ts:272`
 *                        requires before a payout. Nothing less.
 *
 * So "verified" is not one thing, and a campaign can be past the cap and
 * still unable to pay out. Both steps are named separately below.
 *
 * ── RULES THIS COPY KEEPS ───────────────────────────────────────────────────
 *
 * ⛔ No turnaround time, anywhere (`docs/78` quotes none deliberately).
 * ⛔ No promise of an email when a campaign is DECIDED - a refused campaign
 *    notifies nobody and that is still open (`docs/93`).
 * ⛔ Nothing is claimed that the platform does not do.
 *
 * This module is PURE. It reads no database, so it can render on a list of
 * twenty campaigns without a query each, and so its rules can be tested
 * directly.
 */

import { isSupportedCurrency, getCurrency } from '@/lib/money/currencies';
import { formatMoney } from '@/lib/money/format';

export type StepState =
  /** Finished. Nothing to do. */
  | 'done'
  /** The organiser can act on this right now, and should. */
  | 'now'
  /** Someone at LastDonor is acting; the organiser waits. */
  | 'waiting'
  /** Not yet reachable, because an earlier step is not finished. */
  | 'later'
  /** Something went wrong or more is needed from them. */
  | 'attention';

export type StepId =
  | 'write'
  | 'review'
  | 'identity'
  | 'documents'
  | 'payout_account'
  | 'withdraw';

export interface JourneyStep {
  id: StepId;
  /** What the organiser does, in their words. */
  title: string;
  state: StepState;
  /** One sentence: what is true about this step right now. */
  detail: string;
  /**
   * What this step unlocks or what its absence blocks - the "why bother".
   *
   * This is the field the old UI had nothing like, and its absence is why
   * verification read as bureaucracy rather than as the thing standing
   * between an organiser and the money.
   */
  consequence: string | null;
  href: string | null;
  /** Button label. Null when there is nothing for them to press. */
  action: string | null;
}

export interface JourneyFacts {
  campaignId: string;
  /** `campaigns.status`. */
  status: string;
  /** `campaigns.verification_status`. */
  verificationStatus: string;
  /** `campaigns.currency`, for naming the raise cap. */
  currency: string;
  /**
   * Whether a payout account exists.
   *
   * `'unknown'` is a first-class answer, not a default to paper over: a list
   * of campaigns does not query payout accounts, and a step that claimed
   * "you still need to add your account" to somebody who already had would
   * be worse than one that stays quiet.
   */
  payoutAccount?: 'present' | 'missing' | 'unknown';
}

/** Statuses that mean a person is looking at it now. */
const DOCS_WITH_REVIEWERS = ['documents_uploaded', 'submitted_for_review'];

/** The cap figure, named in the organiser's own currency, or null. */
export function unverifiedCapLabel(currency: string): string | null {
  // `getCurrency` throws on an unknown code (docs/92), which is right for
  // money arithmetic and wrong here - this renders inside a dashboard list.
  if (!isSupportedCurrency(currency)) return null;
  const def = getCurrency(currency);
  if (!Number.isFinite(def.unverifiedCapMinor)) return null;
  return formatMoney(def.unverifiedCapMinor, def.code, 'exact');
}

function identityStep(f: JourneyFacts): JourneyStep {
  const base = { id: 'identity' as const, title: 'Check your ID' };
  const href = `/dashboard/campaigns/${f.campaignId}/verification`;
  const cap = unverifiedCapLabel(f.currency);

  /*
    The consequence is stated in money, not in status names. "Your campaign
    is unverified" tells an organiser nothing; "this campaign can raise up to
    $500 until we check your ID" tells them exactly what it costs to wait.
  */
  const capConsequence = cap
    ? `Until this is done, this campaign can raise up to ${cap}, and we cannot pay you anything.`
    : 'Until this is done, we cannot pay you anything.';

  switch (f.verificationStatus) {
    case 'identity_verified':
    case 'fully_verified':
    case 'verified':
      return {
        ...base,
        state: 'done',
        detail: 'We have checked who you are.',
        consequence: null,
        href,
        action: 'View',
      };
    case 'pending':
      return {
        ...base,
        state: 'waiting',
        detail: 'You have started. Finish it in the window that opened.',
        consequence: capConsequence,
        href,
        action: 'Continue',
      };
    case 'rejected':
      return {
        ...base,
        state: 'attention',
        detail: 'The check did not pass. You can try again.',
        consequence: capConsequence,
        href,
        action: 'Try again',
      };
    case 'info_requested':
      return {
        ...base,
        state: 'attention',
        detail: 'We asked you for something more.',
        consequence: capConsequence,
        href,
        action: 'Respond',
      };
    case 'suspended':
      return {
        ...base,
        state: 'attention',
        detail: 'This check is on hold. Email support@lastdonor.org.',
        consequence: capConsequence,
        href,
        action: 'View',
      };
    default:
      return {
        ...base,
        state: 'now',
        detail: 'Takes a few minutes. You need a photo ID.',
        consequence: capConsequence,
        href,
        action: 'Check my ID',
      };
  }
}

function documentsStep(f: JourneyFacts): JourneyStep {
  const base = { id: 'documents' as const, title: 'Send your papers' };
  const href = `/dashboard/campaigns/${f.campaignId}/verification`;

  /*
    ⚠️ This is the tier nothing used to name. `identity_verified` lifts the
    raise cap; the WITHDRAWAL route requires `fully_verified`. An organiser
    could be past the cap, raising freely, and still unable to take a penny
    out - with no screen anywhere saying so.
  */
  const consequence = 'We cannot pay you until a person has checked these.';

  if (f.verificationStatus === 'fully_verified') {
    return {
      ...base,
      state: 'done',
      detail: 'We have everything we need.',
      consequence: null,
      href,
      action: 'View',
    };
  }
  if (DOCS_WITH_REVIEWERS.includes(f.verificationStatus)) {
    return {
      ...base,
      state: 'waiting',
      detail: 'A person is reading them now.',
      consequence,
      href,
      action: 'View',
    };
  }
  if (f.verificationStatus === 'identity_verified') {
    return {
      ...base,
      state: 'now',
      detail: 'Send proof of what the money is for, such as a hospital bill.',
      consequence,
      href,
      action: 'Send papers',
    };
  }
  return {
    ...base,
    state: 'later',
    detail: 'After we have checked your ID.',
    consequence,
    href: null,
    action: null,
  };
}

function payoutStep(f: JourneyFacts): JourneyStep {
  const base = { id: 'payout_account' as const, title: 'Add where the money goes' };
  const href = '/dashboard/payout-settings';
  const consequence = 'We need somewhere to send the money.';

  switch (f.payoutAccount) {
    case 'present':
      return { ...base, state: 'done', detail: 'We have your account.', consequence: null, href, action: 'Change' };
    case 'missing':
      return { ...base, state: 'now', detail: 'Tell us the account to pay.', consequence, href, action: 'Add account' };
    default:
      // 'unknown' says nothing it cannot support. See `JourneyFacts`.
      return { ...base, state: 'later', detail: 'Where we send the money.', consequence, href, action: 'Open' };
  }
}

/**
 * The whole journey for one campaign, in order, with the current state of each
 * step.
 *
 * Order is the order things actually happen, and it does not change with
 * state - a list whose rows reorder as it progresses is unreadable, and the
 * shape of the path is itself the information a first-time organiser needs.
 */
export function organiserJourney(f: JourneyFacts): JourneyStep[] {
  const live = ['active', 'last_donor_zone', 'completed'].includes(f.status);
  const canWithdraw = f.verificationStatus === 'fully_verified' && live;

  const write: JourneyStep = {
    id: 'write',
    title: 'Write your campaign',
    state: 'done',
    detail: 'Done. You can still edit it.',
    consequence: null,
    href: `/dashboard/campaigns/${f.campaignId}/edit`,
    action: 'Edit',
  };

  const review: JourneyStep = (() => {
    const base = { id: 'review' as const, title: 'A person reads it' };
    if (f.status === 'under_review') {
      return {
        ...base,
        state: 'waiting' as const,
        detail: 'It is with us now. It is not public yet.',
        /*
          Deliberately not "we will email you when it is decided" - docs/93
          deleted exactly that, because a REFUSED campaign notifies nobody
          and that is still open. Only the approval half is promised, and
          only because the approval email genuinely sends.
        */
        consequence: 'We will email you if it goes live.',
        href: null,
        action: null,
      };
    }
    if (f.status === 'draft') {
      return {
        ...base,
        state: 'later' as const,
        detail: 'After you send it to us.',
        consequence: null,
        href: null,
        action: null,
      };
    }
    if (['suspended', 'cancelled', 'archived'].includes(f.status)) {
      return {
        ...base,
        state: 'attention' as const,
        detail: `This campaign is ${f.status}. Email support@lastdonor.org.`,
        consequence: null,
        href: null,
        action: null,
      };
    }
    return {
      ...base,
      state: 'done' as const,
      detail: 'Approved. It is public.',
      consequence: null,
      href: null,
      action: null,
    };
  })();

  const withdraw: JourneyStep = {
    id: 'withdraw',
    title: 'Take the money out',
    state: canWithdraw ? 'now' : 'later',
    detail: canWithdraw ? 'You can ask for a payout.' : 'Once the steps above are done.',
    consequence: null,
    href: '/dashboard/withdrawals',
    action: canWithdraw ? 'Request payout' : null,
  };

  return [write, review, identityStep(f), documentsStep(f), payoutStep(f), withdraw];
}

/**
 * The one thing to put in front of the organiser right now, or null.
 *
 * For a compact surface - a dashboard row, an email subject - where the whole
 * ladder does not fit. The FIRST step needing them is the right one: showing
 * every outstanding step at once in a small space is how the old UI ended up
 * saying nothing at all.
 */
export function nextOrganiserAction(f: JourneyFacts): JourneyStep | null {
  const steps = organiserJourney(f);
  return (
    steps.find((s) => s.state === 'attention') ??
    steps.find((s) => s.state === 'now') ??
    null
  );
}
