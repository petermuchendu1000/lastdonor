/**
 * One sweep over every organiser-facing screen, for the promises the product
 * does not keep.
 *
 * ── WHY A SWEEP AND NOT ANOTHER ASSERTION ───────────────────────────────────
 *
 * The rule already existed in two places when it was broken in a third.
 *
 *   `submit-redirect.test.ts:154`                asserted it of
 *                                                `SubmittedForReviewNotice`
 *   `email-templates.submission-receipt.test.ts` asserted it of the email
 *   the wizard's own "What happens next?" list   asserted by nothing
 *
 * So on 2026-10-25 the sentence `docs/93` had deleted from the submission
 * email - *"We email you when it is decided, and tell you exactly what to
 * change if anything needs changing"* - was still sitting on the screen
 * immediately above the submit button, which is the most load-bearing place
 * in the product for it to be false. Two correct assertions and one unswept
 * surface read, from the outside, exactly like coverage.
 *
 * This file sweeps the surfaces instead of naming one, so the next screen
 * someone adds is covered before they think about it.
 *
 * ── THE TWO RULES ───────────────────────────────────────────────────────────
 *
 * ⛔ No promise of an email when a campaign is DECIDED. `under_review`
 *    transitions only to `active` or `suspended`; the suspend path reaches
 *    `notifyCampaignStatusChange`, which returns early for anything outside
 *    `['completed','archived']` and addresses DONORS, of which an unpublished
 *    campaign has none. A refused campaign notifies nobody and that is still
 *    open (`docs/93`). Only the approval half may be promised.
 *
 * ⛔ No turnaround time, anywhere (`docs/78` quotes none deliberately,
 *    because no reviewed user campaign has ever been published and there is
 *    nothing to average).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');

/**
 * Directories holding screens an ORGANISER reads about their own campaign.
 *
 * Not `src/components/admin/` - an admin reading a queue is a different
 * audience with a different vocabulary (`docs/110` §4), and nothing there
 * promises the organiser anything.
 */
const SURFACE_DIRS = [
  'src/app/share-your-story',
  'src/components/dashboard',
  'src/app/dashboard',
  'src/components/verification',
];

/** Strip block comments (including JSX `{/* … *\/}`) and line comments. */
function strippedSource(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function sweep(): { file: string; code: string }[] {
  const out: { file: string; code: string }[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        out.push({ file: relative(ROOT, p), code: strippedSource(p) });
      }
    }
  };
  for (const d of SURFACE_DIRS) walk(resolve(ROOT, d));
  return out;
}

const SURFACES = sweep();

/**
 * The rules, as predicates, so the same list can be run against a synthetic
 * offender to prove each one discriminates.
 */
const FORBIDDEN: { name: string; re: RegExp }[] = [
  {
    name: 'promises an email when the campaign is decided',
    re: /email you (when|as soon as|once) (it|yours|your campaign) is (decided|reviewed)|when it is decided|either way,? we will (email|write|tell)/i,
  },
  {
    name: 'promises to say exactly what needs changing',
    re: /tell you exactly what(?: to change)?/i,
  },
  {
    /*
      A turnaround for the REVIEW, not any duration at all.

      ⚠️ The first version of this rule matched `within \d+ days` anywhere and
      flagged `FundraiserPreviewModal.tsx`, which says donors may request a
      refund "normally within 30 days of giving". That is the refund window,
      it is stated the same way on `/refund-policy`, and it is hedged and
      true - a false positive, not a defect. So the time phrase must sit in
      the same sentence as a word about review or publication.
    */
    name: 'quotes a turnaround time for the review',
    re: /(?:review(?:ed|s|ing)?|approv\w*|decid\w*|decision|goes live|publish\w*)[^.]{0,80}?\b(?:within|in)\s+\d+\s*(?:hours?|days?|business days?)\b|\b(?:within|in)\s+\d+\s*(?:hours?|days?|business days?)\b[^.]{0,80}?(?:review(?:ed|s|ing)?|approv\w*|decid\w*|decision|goes live|publish\w*)/i,
  },
  {
    /*
      ⛔ A SECOND turnaround rule, because the first one could not see the two
      live violations `docs/121` found in a directory it already swept.

      `CampaignVerificationDashboard` said "You will be notified by email once
      a decision has been made. **This typically takes 1 to 2 business
      days.**" and "our team will review your documents **within 1-2 business
      days**". The rule above missed BOTH, for two different reasons, and
      neither is a coverage gap - the file was in `SURFACES`:

        - the first sentence puts "decision" and the duration on opposite
          sides of a full stop, and that rule deliberately requires them in
          the SAME sentence (`[^.]{0,80}`);
        - "1-2" breaks `\d+\s*(?:days)` at the hyphen, and "takes 1 to 2" has
          no `within`/`in` at all.

      ⚠️ So this rule needs no proximity and no lead-in word. It can afford
      that because **"business days" is a turnaround promise and nothing
      else** - the false positive the rule above was narrowed for is a refund
      window ("normally within 30 days of giving"), which is calendar days.
      A test below asserts that sentence still passes.
    */
    name: 'quotes a turnaround in business days',
    re: /\b\d+\s*(?:[-\u2013]|\s+to\s+)?\s*\d*\s*business\s+days?\b/i,
  },
];

describe('the sweep is real', () => {
  it('found the organiser screens', () => {
    // A path typo or an emptied list would make every assertion below pass
    // vacuously, which is the failure mode this whole file is about.
    expect(SURFACES.length).toBeGreaterThan(20);
  });

  it('includes the screen the rule was broken on', () => {
    expect(SURFACES.map((s) => s.file)).toContain(
      'src/app/share-your-story/ShareYourStoryForm.tsx',
    );
  });

  it('⚠️ every rule fires on a synthetic offender', () => {
    /*
      A check that cannot fail is not a check. These are the exact sentences
      that were live in the product, so if a regex stops matching them it has
      stopped meaning anything.
    */
    const offender = `
      We email you when it is decided, and tell you exactly what to change
      if anything needs changing. Our editorial team reviews your campaign,
      typically within 24 hours.
      You will be notified by email once a decision has been made. This
      typically takes 1 to 2 business days.
    `;
    for (const rule of FORBIDDEN) {
      expect(rule.re.test(offender), `rule "${rule.name}" matched nothing`).toBe(true);
    }
  });

  it('⚠️ and the business-days rule does not fire on a refund window', () => {
    /*
      The reason that rule can skip the proximity requirement the one above it
      needs. `FundraiserPreviewModal` says donors may request a refund
      "normally within 30 days of giving", which is the refund window, is
      stated the same way on `/refund-policy`, and is true. Calendar days, not
      business days - and the distinction is the whole licence for the looser
      pattern, so it is asserted rather than assumed.
    */
    const businessDays = FORBIDDEN.find((r) => r.name === 'quotes a turnaround in business days');
    expect(businessDays, 'the business-days rule is gone').toBeTruthy();
    expect(businessDays!.re.test('request a refund normally within 30 days of giving')).toBe(false);
    expect(businessDays!.re.test('It should reach your bank in about 2 working days')).toBe(false);
    // And it still fires on the two sentences that were live.
    expect(businessDays!.re.test('This typically takes 1 to 2 business days.')).toBe(true);
    expect(businessDays!.re.test('review your documents within 1-2 business days')).toBe(true);
  });
});

describe('the turnaround rule does not flag an honest duration', () => {
  it('⚠️ leaves the refund window alone', () => {
    /*
      The false positive that shaped the rule. `FundraiserPreviewModal.tsx`
      says a refund may be requested "normally within 30 days of giving",
      which `/refund-policy` says too. A rule that forbids every duration
      would push somebody to delete a true, useful sentence to get green.
    */
    const honest =
      'Donors can request a refund by email, normally within 30 days of ' +
      'giving. Requests are reviewed case by case.';
    const rule = FORBIDDEN.find((r) => r.name.includes('turnaround'))!;
    expect(rule.re.test(honest)).toBe(false);
  });
});

describe('⛔ promises no organiser screen may make', () => {
  for (const rule of FORBIDDEN) {
    it(`nothing ${rule.name}`, () => {
      const offenders = SURFACES.filter((s) => rule.re.test(s.code)).map((s) => s.file);
      expect(
        offenders,
        `these organiser screens ${rule.name}:\n  ${offenders.join('\n  ')}\n` +
          'See docs/93 (a refused campaign notifies nobody) and docs/78 ' +
          '(no turnaround time is quoted anywhere).',
      ).toEqual([]);
    });
  }
});

describe('the wizard names the ID check before the organiser commits', () => {
  const wizard = strippedSource(
    resolve(ROOT, 'src/app/share-your-story/ShareYourStoryForm.tsx'),
  );

  it('says a photo ID is needed', () => {
    /*
      docs/110: the six wizard screens never mentioned verification at all,
      so an organiser learned about it only after submitting - and then only
      if they found one grey line on the dashboard.
    */
    expect(wizard).toMatch(/photo ID/i);
  });

  it('says what the ID check is FOR', () => {
    // "Verification required" on its own reads as paperwork. The sentence
    // has to connect it to the money, which is the whole docs/110 finding.
    const next = wizard.slice(
      wizard.indexOf('What happens next?'),
      wizard.indexOf('What happens next?') + 1_500,
    );
    expect(next.length).toBeGreaterThan(100);
    expect(next).toMatch(/pay you|send you|send anyone money/i);
    expect(next).toMatch(/photo ID/i);
  });

  it('still promises the half that is true', () => {
    // The approval email genuinely sends, so this one may be said.
    expect(wizard).toMatch(/email you if it goes live/i);
  });
});

describe('the public pages tell a prospective organiser too', () => {
  /*
    The user-visible half of the same finding: somebody deciding WHETHER to
    start a campaign could not learn that an ID check exists. Both pages
    render the ladder or answer the question directly.
  */
  const pages = [
    'src/app/how-it-works/page.tsx',
    'src/app/share-your-story/page.tsx',
  ];

  for (const page of pages) {
    it(`${page} mentions the ID check`, () => {
      const code = strippedSource(resolve(ROOT, page));
      expect(code).toMatch(/photo ID/i);
      expect(code).toMatch(/pay you|send you any money/i);
    });
  }

  it('how-it-works renders the shared outline rather than its own list', () => {
    // docs/110's rule: do not add a seventh partial idea of the journey.
    const code = strippedSource(resolve(ROOT, 'src/app/how-it-works/page.tsx'));
    expect(code).toContain('organiserJourneyOutline');
  });
});
