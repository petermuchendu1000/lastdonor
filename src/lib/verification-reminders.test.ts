/**
 * The reminder ladder: which level is true, and which words are forbidden.
 *
 * ⚠️ The assertions that matter most are the copy ones. The reason this
 * ladder exists at all is that the four emails already in the codebase say
 * things the platform does not do, and a cron is what turns dormant bad copy
 * into mail somebody receives. So the rule is asserted BOTH ways: the new
 * template must not threaten a refund or count days, and the OLD template
 * must still trip the same rule - otherwise the rule is matching nothing and
 * would pass against anything.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  APPROACHING_CAP_FRACTION,
  COLLECTING_STATUSES,
  REMINDER_MIN_GAP_HOURS,
  REMINDER_PRIORITY,
  capMinor,
  dueReminder,
  trueLevel,
  type ReminderFacts,
  type ReminderLevel,
} from '@/lib/verification-reminders';
import { CAP_EXEMPT_VERIFICATION_STATUSES } from '@/lib/campaign-raise-cap';
import { campaignStatusEnum } from '@/db/schema';
import { verificationConsequenceEmail } from '@/lib/email-templates';

const ROOT = resolve(__dirname, '../..');
const NOW = new Date('2026-10-25T09:00:00Z');

/*
  US$500 cap, US$5,000 goal - the shape of a real campaign, where the cap
  bites long before the goal. The funded cases below set a LOW goal
  explicitly, because a goal under the cap is the only way an unverified
  campaign reaches it, and mixing the two is what made the first version of
  this file assert the wrong thing.
*/
const base: ReminderFacts = {
  status: 'active',
  verificationStatus: 'unverified',
  currency: 'USD',
  realRaisedMinor: 0,
  goalMinor: 500_000,
  sentLevels: [],
  lastSentAt: null,
  now: NOW,
};

const f = (o: Partial<ReminderFacts>): ReminderFacts => ({ ...base, ...o });
const CAP = capMinor('USD')!;

describe('the cap figure is read from the money registry', () => {
  it('prices the collectable currencies and refuses the rest', () => {
    expect(CAP).toBe(50_000);
    expect(capMinor('KES')).toBe(5_000_000);
    expect(capMinor('ZZZ')).toBeNull();
    expect(capMinor('')).toBeNull();
  });
});

describe('which statement is true', () => {
  it('says nothing about a campaign that cannot take money', () => {
    /*
      Derived from the enum rather than listed: a new status must be a
      deliberate decision here, not a silent omission. A campaign in the
      review queue cannot take a penny, so a cap warning is meaningless.
    */
    const notCollecting = campaignStatusEnum.enumValues.filter(
      (s) => !(COLLECTING_STATUSES as readonly string[]).includes(s),
    );
    expect(notCollecting.length).toBeGreaterThan(0);
    for (const status of notCollecting) {
      expect(trueLevel(f({ status, realRaisedMinor: CAP })), status).toBeNull();
    }
  });

  it('says nothing to a fully verified organiser', () => {
    for (const v of ['fully_verified', 'verified']) {
      expect(trueLevel(f({ verificationStatus: v, realRaisedMinor: CAP })), v).toBeNull();
      expect(trueLevel(f({ verificationStatus: v, realRaisedMinor: 99_999 })), v).toBeNull();
    }
  });

  it('is silent at zero donations', () => {
    // The deliberate choice recorded in the module header: an email about
    // money that does not exist is what makes the next one ignorable.
    expect(trueLevel(f({ realRaisedMinor: 0 }))).toBeNull();
  });

  it('is first_money on the first real donation', () => {
    expect(trueLevel(f({ realRaisedMinor: 100 }))).toBe('first_money');
  });

  it('is approaching_cap at the fraction, not before it', () => {
    const threshold = CAP * APPROACHING_CAP_FRACTION;
    expect(trueLevel(f({ realRaisedMinor: threshold - 1 }))).toBe('first_money');
    expect(trueLevel(f({ realRaisedMinor: threshold }))).toBe('approaching_cap');
  });

  it('is at_cap at the cap and above it', () => {
    expect(trueLevel(f({ realRaisedMinor: CAP - 1 }))).toBe('approaching_cap');
    expect(trueLevel(f({ realRaisedMinor: CAP }))).toBe('at_cap');
    // docs/101 accepts a concurrency overshoot, so over the cap must not
    // fall through to a lesser level.
    expect(trueLevel(f({ realRaisedMinor: CAP + 2_500 }))).toBe('at_cap');
  });

  it('funded beats every cap level', () => {
    // A US$300 goal sits below the US$500 cap, so both statements are true
    // at once and the more consequential one must win.
    const lowGoal = { goalMinor: 30_000 };
    expect(trueLevel(f({ ...lowGoal, realRaisedMinor: 30_000 }))).toBe('funded_and_stuck');
    expect(trueLevel(f({ ...lowGoal, realRaisedMinor: CAP }))).toBe('funded_and_stuck');
    expect(REMINDER_PRIORITY[0]).toBe('funded_and_stuck');
  });

  it('⚠️ makes NO cap claim once the cap is exempt', () => {
    /*
      The two-tier trap from docs/110. `identity_verified` LIFTS the raise
      cap, so telling that organiser their campaign stops at $500 would be
      false - and it is exactly the state a naive "not fully verified"
      filter would mail.
    */
    for (const v of CAP_EXEMPT_VERIFICATION_STATUSES) {
      expect(trueLevel(f({ verificationStatus: v, realRaisedMinor: CAP })), v).not.toBe('at_cap');
      expect(trueLevel(f({ verificationStatus: v, realRaisedMinor: 100 })), v)
        .not.toBe('first_money');
    }
    // But a funded, cap-exempt campaign still cannot be paid, and that is
    // still worth saying.
    expect(
      trueLevel(
        f({ verificationStatus: 'identity_verified', goalMinor: 30_000, realRaisedMinor: 30_000 }),
      ),
    ).toBe('funded_and_stuck');
  });

  it('still reaches a rejected or stalled check', () => {
    // These organisers are precisely the ones a reminder is for.
    for (const v of ['rejected', 'info_requested', 'pending', 'suspended']) {
      expect(trueLevel(f({ verificationStatus: v, realRaisedMinor: CAP })), v).toBe('at_cap');
    }
  });

  it('makes no cap claim in a currency it cannot price', () => {
    expect(trueLevel(f({ currency: 'ZZZ', realRaisedMinor: 100 }))).toBeNull();
    // The funded statement needs no cap figure, so it survives.
    expect(trueLevel(f({ currency: 'ZZZ', goalMinor: 30_000, realRaisedMinor: 30_000 })))
      .toBe('funded_and_stuck');
  });

  it('treats a zero goal as no goal rather than as instantly funded', () => {
    // A 0 goal is impossible (`campaigns_goal_positive`), but reading one
    // as "funded" would mail every organiser the wrong level.
    expect(trueLevel(f({ goalMinor: 0, realRaisedMinor: 100 }))).toBe('first_money');
  });
});

describe('each level is sent once, and never two in a day', () => {
  it('does not repeat a level', () => {
    const facts = f({ realRaisedMinor: CAP });
    expect(dueReminder(facts)).toBe('at_cap');
    expect(dueReminder({ ...facts, sentLevels: ['at_cap'] })).toBeNull();
  });

  it('does not backfill a level the campaign skipped past', () => {
    // Straight to the cap: the earlier levels were never true at a moment
    // this job observed, and are not sent retrospectively.
    const facts = f({ realRaisedMinor: CAP, sentLevels: ['at_cap'] });
    expect(dueReminder(facts)).toBeNull();
  });

  it('holds the floor between two different levels', () => {
    const facts = f({
      realRaisedMinor: CAP,
      sentLevels: ['first_money'],
      lastSentAt: new Date(NOW.getTime() - (REMINDER_MIN_GAP_HOURS - 1) * 3_600_000),
    });
    expect(dueReminder(facts)).toBeNull();
    expect(
      dueReminder({
        ...facts,
        lastSentAt: new Date(NOW.getTime() - REMINDER_MIN_GAP_HOURS * 3_600_000),
      }),
    ).toBe('at_cap');
  });

  it('sends at most four emails over the life of a campaign', () => {
    /*
      Walk a campaign through every level with the floor satisfied, feeding
      each send back into the ledger. The bound is the point: this job can
      never become a drip campaign.
    */
    const sent: ReminderLevel[] = [];
    let raised = 100;
    // +US$200/day for 40 days passes the cap and then the US$5,000 goal, so
    // the walk really does visit all four levels rather than stopping short.
    for (let day = 0; day < 40; day++) {
      const level = dueReminder(
        f({
          realRaisedMinor: raised,
          sentLevels: sent,
          lastSentAt: sent.length
            ? new Date(NOW.getTime() - REMINDER_MIN_GAP_HOURS * 3_600_000)
            : null,
        }),
      );
      if (level) sent.push(level);
      raised = raised + 20_000;
    }
    expect(sent.length).toBeLessThanOrEqual(4);
    expect(new Set(sent).size).toBe(sent.length);
    // And it is not vacuous: the walk must actually have escalated.
    expect(sent).toEqual(['first_money', 'approaching_cap', 'at_cap', 'funded_and_stuck']);
  });
});

describe('⛔ the words this ladder may not use', () => {
  const LEVELS: ReminderLevel[] = [
    'first_money', 'approaching_cap', 'at_cap', 'funded_and_stuck',
  ];

  const render = (level: ReminderLevel) => {
    const e = verificationConsequenceEmail({
      campaignerName: 'Asha',
      campaignTitle: 'Help Asha',
      campaignId: '11111111-1111-4111-a111-111111111111',
      level,
      capLabel: '$500.00',
      raisedLabel: '$420.00',
      goalLabel: '$300.00',
    });
    return `${e.subject} ${e.html}`;
  };

  /**
   * The rules, as predicates, so the SAME list can be run against the old
   * template to prove each one discriminates.
   */
  const FORBIDDEN: { name: string; re: RegExp }[] = [
    { name: 'threatens to return the donations', re: /send (the |your )?money back|send it back|give the money back/i },
    { name: 'counts elapsed days', re: /\b\d+\s*days? ago\b|reached its goal \d|\bdays? (left|remaining)\b/i },
    { name: 'quotes a turnaround or deadline', re: /\bwithin \w+ (hours?|days?)\b|\bdeadline\b/i },
    { name: 'calls itself a last reminder', re: /last reminder|final reminder/i },
  ];

  for (const level of LEVELS) {
    for (const rule of FORBIDDEN) {
      it(`${level} never ${rule.name}`, () => {
        expect(render(level)).not.toMatch(rule.re);
      });
    }
  }

  it('⚠️ the same rules DO catch the old ladder, so they are not vacuous', () => {
    /*
      Read as source text. `verificationReminderEmail` is still exported and
      still used nowhere; if somebody wires it to this cron, these are the
      sentences they would be sending. Three of the four rules must fire on
      it - if a rule stops firing here it has stopped meaning anything, and
      the assertion above would pass against a refund threat.
    */
    const src = readFileSync(resolve(ROOT, 'src/lib/email-templates.ts'), 'utf8');
    const old = src.slice(
      src.indexOf('export function verificationReminderEmail'),
      src.indexOf('export function verificationConsequenceEmail'),
    );
    expect(old.length).toBeGreaterThan(500);

    const fired = FORBIDDEN.filter((r) => r.re.test(old)).map((r) => r.name);
    expect(fired).toContain('threatens to return the donations');
    expect(fired).toContain('counts elapsed days');
    expect(fired).toContain('calls itself a last reminder');
  });

  it('every level names what is blocked and links to the ID check', () => {
    for (const level of LEVELS) {
      const html = render(level);
      expect(html, level).toMatch(/check (who you are|your ID)|checked your ID/i);
      expect(html, level).toContain('/verification');
    }
  });

  it('writes to the mailbox the rest of the product uses', () => {
    // docs/110 flagged the old ladder signing off to verify@lastdonor.org,
    // a mailbox nothing else uses and whose existence is [UNKNOWN].
    for (const level of LEVELS) {
      expect(render(level)).toContain('support@lastdonor.org');
      expect(render(level)).not.toContain('verify@lastdonor.org');
    }
  });

  it('escapes the campaign title', () => {
    const e = verificationConsequenceEmail({
      campaignerName: '<script>x</script>',
      campaignTitle: '<img src=x onerror=alert(1)>',
      campaignId: 'abc',
      level: 'at_cap',
      capLabel: '$500.00',
      raisedLabel: '$500.00',
      goalLabel: '$300.00',
    });
    expect(e.html).not.toContain('<script>');
    expect(e.html).not.toContain('<img src=x');
  });
});

describe('the cron is actually wired', () => {
  const route = readFileSync(
    resolve(ROOT, 'src/app/api/v1/cron/verification-reminders/route.ts'),
    'utf8',
  );

  it('authenticates like every other cron route', () => {
    expect(route).toContain('verifyCronAuth');
  });

  it('takes the lock that fails closed', () => {
    expect(route).toContain("CRON_LOCKS['verification-reminders']");
  });

  it('⛔ measures the REAL raised figure, never the blended column', () => {
    // docs/101: `raised_amount` is blended with fabricated seed money, so a
    // cap measured against it would warn organisers about money nobody gave.
    const queries = readFileSync(
      resolve(ROOT, 'src/lib/verification-reminders.server.ts'),
      'utf8',
    );
    expect(queries).toContain('realRaisedMinorSql');
    expect(queries).not.toMatch(/campaigns\.raisedAmount/);
    expect(route).not.toMatch(/campaigns\.raisedAmount/);
  });

  it('delegates the queries to a module a test can run', () => {
    // docs/107: a query that lives only inside a route handler is executed
    // by nothing. The route must not grow its own.
    expect(route).toContain('selectDueReminders');
    expect(route).not.toContain('db.select(');
  });

  it('is in the schedule table the Worker bundles', async () => {
    const { CRON_JOBS } = await import('@/lib/cron-schedule');
    expect(CRON_JOBS.map((j) => j.job)).toContain('verification-reminders');
  });
});
