/**
 * What was agreed, and when.
 *
 * The rule that matters most is the one about NOT recording: a
 * `beneficiaryConsentAt` on a campaign whose organiser is the beneficiary
 * would be a consent nobody was ever asked for, which is worse than no
 * record at all.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  TERMS_VERSION,
  consentRecord,
  requiresBeneficiaryConsent,
} from '@/lib/campaign-consent';
import { BENEFICIARY_RELATIONS } from '@/lib/validators/user-campaign';

const NOW = new Date('2026-10-25T12:00:00.000Z');

describe('requiresBeneficiaryConsent', () => {
  it('⛔ is false only when the organiser IS the beneficiary', () => {
    expect(requiresBeneficiaryConsent('self')).toBe(false);
    for (const r of BENEFICIARY_RELATIONS.filter((x) => x !== 'self')) {
      expect(requiresBeneficiaryConsent(r), r).toBe(true);
    }
  });

  it('covers every relation the validator accepts', () => {
    // If a relation is added and this rule is not considered, the new value
    // silently falls into "needs consent" - which is the safe side, and this
    // asserts the set is the one being reasoned about.
    expect(BENEFICIARY_RELATIONS).toContain('self');
    expect(BENEFICIARY_RELATIONS.length).toBeGreaterThan(1);
  });

  it('treats a missing relation as not requiring consent', () => {
    // Nobody was named, so there is nobody to have asked. The campaign is
    // still created; it simply records no beneficiary consent.
    expect(requiresBeneficiaryConsent(null)).toBe(false);
    expect(requiresBeneficiaryConsent(undefined)).toBe(false);
    expect(requiresBeneficiaryConsent('')).toBe(false);
  });
});

describe('consentRecord', () => {
  it('stamps the terms acceptance with the supplied clock and version', () => {
    const r = consentRecord({ relation: 'family', now: NOW });
    expect(r.termsAcceptedAt).toBe(NOW);
    expect(r.termsVersion).toBe(TERMS_VERSION);
  });

  it('records the beneficiary consent for a campaign run for somebody else', () => {
    expect(consentRecord({ relation: 'friend', now: NOW }).beneficiaryConsentAt).toBe(NOW);
  });

  it('⛔ records NO beneficiary consent when the organiser is the beneficiary', () => {
    /*
      The wizard shows no second notice for `self`, so a timestamp here
      would attest to something that was never on screen. Null is the
      honest value.
    */
    expect(consentRecord({ relation: 'self', now: NOW }).beneficiaryConsentAt).toBeNull();
  });

  it('agrees with the predicate for every relation', () => {
    for (const r of BENEFICIARY_RELATIONS) {
      const rec = consentRecord({ relation: r, now: NOW });
      expect(rec.beneficiaryConsentAt !== null, r).toBe(requiresBeneficiaryConsent(r));
    }
  });

  it('the terms version is a date that can be read in an audit', () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(TERMS_VERSION))).toBe(false);
  });
});

describe('the screen and the record read ONE condition', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
  const codeOnly = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the wizard shows the notice from requiresBeneficiaryConsent', () => {
    const code = codeOnly(read('src/app/share-your-story/ShareYourStoryForm.tsx'));
    expect(code).toContain('requiresBeneficiaryConsent(form.beneficiaryRelation)');
    /*
      The inline duplicate must not come back IN THIS DECISION. Scoped to
      the assignment rather than the whole file: the wizard legitimately
      compares the relation to 'self' elsewhere, in the draft-restore repair
      that fixes an inconsistent saved draft. A rule broad enough to catch
      that would be a rule somebody deletes.
    */
    const assignment = /const showBeneficiaryConsent\s*=\s*([^;]+);/.exec(code)?.[1] ?? '';
    expect(assignment).toContain('requiresBeneficiaryConsent');
    expect(assignment).not.toContain("!== 'self'");
  });

  it('the route records it from the same module', () => {
    const code = codeOnly(read('src/app/api/v1/user-campaigns/route.ts'));
    expect(code).toContain('consentRecord(');
  });

  it('⛔ the route stamps its OWN clock, not a client field', () => {
    /*
      `agreedToTerms`, `confirmedTruthful` and `beneficiaryConsent` arrive as
      hard-coded `true` from the browser. A record built from those is a
      claim the submitter made about themselves.
    */
    const code = codeOnly(read('src/app/api/v1/user-campaigns/route.ts'));
    expect(code).toContain('now: new Date()');
    expect(code).not.toMatch(/termsAcceptedAt:\s*data\./);
    expect(code).not.toMatch(/beneficiaryConsentAt:\s*data\./);
  });
});
