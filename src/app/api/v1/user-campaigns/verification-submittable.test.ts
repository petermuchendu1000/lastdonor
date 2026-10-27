/**
 * The state the ID check leaves an organiser in must be a state they can act
 * from.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * The intended path to being paid is:
 *
 *   pass the Didit ID check  →  `identity_verified`
 *   →  upload supporting documents
 *   →  submit them for review
 *   →  an admin presses `approve_t2`  →  `fully_verified`
 *   →  `withdraw/route.ts` will finally accept a request
 *
 * `identity_verified` was missing from `submittableStates` in
 * `verification/submit/route.ts`, so that route answered **409 "Cannot submit
 * verification from status: identity_verified"**. `canSubmitForReview` in
 * `CampaignVerificationDashboard` excluded it as well, so no control rendered
 * to produce the 409 — and Step 2, the upload form, renders only once
 * `identityVerified || documents.length > 0`.
 *
 * Those three facts compose into a closed loop: **the only state in which an
 * organiser can attach a first document is the only state from which they
 * cannot submit it.** They passed the ID check, were emailed "One more step:
 * send us papers — our team will look at them", uploaded a hospital letter,
 * and then nothing they could do moved anything. No control, no "under
 * review" banner, and no admin told — because the admin notification lives on
 * the route they could not reach.
 *
 * Production had never exercised it: zero Didit sessions, zero verification
 * documents, zero campaigns past `unverified`. `docs/121`.
 *
 * ── WHY THIS SHAPE OF TEST ──────────────────────────────────────────────────
 *
 * Both ends are read from source and compared to each other, the `docs/109`
 * shape. Pinning today's list would pass just as happily against the defect
 * if somebody retyped it; what matters is the RELATIONSHIP — the status the
 * webhook writes on success has to be one the submit route accepts, and the
 * component's gate has to agree with the route's.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../../..');

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/^(\s*)\/\/.*$/gm, (m, indent: string) => indent + ' '.repeat(m.length - indent.length));
}
const read = (p: string) => stripComments(readFileSync(resolve(ROOT, p), 'utf-8'));

const SUBMIT_ROUTE = read('src/app/api/v1/user-campaigns/[id]/verification/submit/route.ts');
const DASHBOARD = read('src/components/verification/CampaignVerificationDashboard.tsx');
const DIDIT = read('src/lib/didit.ts');

/** String literals inside the first `[...]` after `marker`. */
function literalsAfter(source: string, marker: string): string[] {
  const at = source.indexOf(marker);
  if (at === -1) return [];
  const open = source.indexOf('[', at);
  const close = source.indexOf(']', open);
  if (open === -1 || close === -1) return [];
  return [...source.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const SUBMITTABLE = literalsAfter(SUBMIT_ROUTE, 'const submittableStates');
const CANNOT_SUBMIT = literalsAfter(DASHBOARD, 'const canSubmitForReview');

describe('the sweep found both ends', () => {
  it('read the route and the component', () => {
    expect(SUBMITTABLE.length, 'submittableStates not parsed').toBeGreaterThan(2);
    expect(CANNOT_SUBMIT.length, 'canSubmitForReview exclusion set not parsed').toBeGreaterThan(1);
  });
});

describe('⛔ the status the ID check grants is a status you can act from', () => {
  /**
   * What `mapDiditStatus` writes when Didit approves. Read from source so the
   * test follows the mapping rather than assuming it.
   */
  it('mapDiditStatus still grants identity_verified on approval', () => {
    expect(DIDIT).toMatch(/Approved[\s\S]{0,120}?identity_verified/);
  });

  it('⛔ and the submit route accepts that status', () => {
    expect(SUBMITTABLE).toContain('identity_verified');
  });

  it('⛔ and the component offers the control in that status', () => {
    expect(CANNOT_SUBMIT).not.toContain('identity_verified');
  });

  it('⛔ the two ends agree on every status', () => {
    /*
      The real rule. A status the route accepts but the component hides is a
      dead end; a status the component offers but the route refuses is a
      button that 409s - the `docs/93` and `docs/119` shapes respectively.
    */
    const componentOffers = (status: string) => !CANNOT_SUBMIT.includes(status);
    const mismatches = SUBMITTABLE.filter((s) => !componentOffers(s)).map(
      (s) => `${s}: route accepts, component hides`,
    );
    expect(mismatches).toEqual([]);
  });
});

describe('the states that must stay unsubmittable', () => {
  it.each(['documents_uploaded', 'submitted_for_review', 'fully_verified'])(
    '%s is not submittable again',
    (status) => {
      /*
        The control. Widening `submittableStates` must not become "anything
        goes": re-submitting something already with a reviewer, or already
        fully verified, would reset its place in the queue.
      */
      expect(SUBMITTABLE).not.toContain(status);
      expect(CANNOT_SUBMIT).toContain(status);
    },
  );
});

describe('⛔ submitting is what tells an admin', () => {
  it('the route notifies admins, which is why reaching it matters', () => {
    /*
      Uploading a document writes no audit row and notifies nobody; the ONLY
      thing that tells an admin a campaign is waiting on them is this call. A
      status that cannot reach this route is a campaign nobody will ever look
      at.
    */
    expect(SUBMIT_ROUTE).toMatch(/notifyAdminsVerificationSubmitted/);
  });

  it('and it moves the campaign to a reviewable status', () => {
    expect(SUBMIT_ROUTE).toMatch(/verificationStatus:\s*'documents_uploaded'/);
  });
});
