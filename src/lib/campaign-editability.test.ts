/**
 * The organiser is offered Edit exactly when the editor will open.
 *
 * ── ⚠️ WHY THIS IS NOT A "THE TWO ENDS AGREE" TEST ──────────────────────────
 *
 * The obvious shape, and the one `docs/109` used, is: parse the page's own
 * literal and assert the shared constant equals it. That works when there are
 * two independent copies.
 *
 * Here `edit/page.tsx` now CALLS `isOrganiserEditable`, so there is one
 * decider and no drift is possible - which makes "they agree" a check that
 * cannot fail (Gate 4). So the rules below guard the thing that CAN still go
 * wrong: a fourth site hardcoding the pair again, and the journey step going
 * back to offering the button unconditionally.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'node:fs';

import {
  ORGANISER_EDITABLE_STATUSES,
  isOrganiserEditable,
} from './campaign-editability';

const ROOT = resolve(__dirname, '../..');

/** Comments blanked, length preserved (the docs/116 §4 lesson). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

const read = (p: string) => stripComments(readFileSync(resolve(ROOT, p), 'utf8'));

/** Every value the campaign_status enum can hold. */
const ALL_STATUSES = [
  'draft', 'active', 'last_donor_zone', 'completed', 'archived',
  'paused', 'under_review', 'suspended', 'cancelled',
] as const;

describe('isOrganiserEditable', () => {
  it('⛔ refuses `under_review` - the reported symptom', () => {
    /*
      Every campaign a person submits is `under_review` (`docs/78`/`docs/79`),
      and that is the whole time they are waiting. The journey told them
      "Done. You can still edit it. [Edit]" and the button bounced.
    */
    expect(isOrganiserEditable('under_review')).toBe(false);
  });

  it('allows exactly draft and active', () => {
    expect([...ORGANISER_EDITABLE_STATUSES].sort()).toEqual(['active', 'draft']);
  });

  it('covers every status in the enum, one way or the other', () => {
    for (const status of ALL_STATUSES) {
      const allowed = (ORGANISER_EDITABLE_STATUSES as readonly string[]).includes(status);
      expect(isOrganiserEditable(status), status).toBe(allowed);
    }
  });

  it('⛔ fails toward hiding the button, not toward a dead one', () => {
    expect(isOrganiserEditable(null)).toBe(false);
    expect(isOrganiserEditable(undefined)).toBe(false);
    expect(isOrganiserEditable('')).toBe(false);
    expect(isOrganiserEditable('something_new')).toBe(false);
  });
});

describe('⛔ the journey offers Edit only when the editor opens', () => {
  const journey = read('src/lib/organiser-journey.ts');

  it('the write step consults the shared rule', () => {
    expect(journey).toContain('isOrganiserEditable(f.status)');
  });

  it('⛔ its href and action are conditional, not literals', () => {
    /*
      Both renderers show a button on `step.href && step.action`
      (`JourneyChecklist.tsx:92`, `NextStepRow.tsx:121`), so an unconditional
      pair IS the defect - there is nothing else between the step and the
      organiser.
    */
    const start = journey.indexOf("id: 'write'");
    expect(start, "the write step moved - this rule is now blind").toBeGreaterThan(-1);
    const block = journey.slice(start, start + 600);
    expect(block).toMatch(/href: editable \?/);
    expect(block).toMatch(/action: editable \?/);
  });

  it('⛔ and does not still claim the campaign can be changed', () => {
    const start = journey.indexOf("id: 'write'");
    const block = journey.slice(start, start + 600);
    // The unconditional sentence was the other half of the lie.
    expect(block).not.toMatch(/detail: 'Done\. You can still edit it\.'/);
    expect(block).toMatch(/detail: editable/);
  });
});

describe('⛔ the editable rule is not written out anywhere else', () => {
  it('no file hardcodes the pair for an editability decision', () => {
    /*
      It was in TWO places - `edit/page.tsx:63` and `[id]/page.tsx:150` - and
      the journey consulted neither. One decider now; this stops a fourth.

      ⚠️ `validators/campaign.ts` is EXEMPT and that is not laziness: its
      `status: z.enum(['draft', 'active'])` is which status an ADMIN may
      CREATE a campaign in. It holds the same two values for unrelated
      reasons, and folding them together would make a change to admin
      creation silently change what an organiser may edit.
    */
    const EXEMPT = ['src/lib/validators/campaign.ts', 'src/lib/campaign-editability.ts'];
    const offenders = globSync('src/**/*.{ts,tsx}', { cwd: ROOT })
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => !/\.(test|spec)\.tsx?$/.test(f))
      .filter((f) => !EXEMPT.includes(f))
      .filter((f) => /\[\s*'draft'\s*,\s*'active'\s*\]/.test(read(f)));

    expect(
      offenders,
      'use isOrganiserEditable from @/lib/campaign-editability (docs/119)',
    ).toEqual([]);
  });

  it('and the two screens that used to hardcode it now call the helper', () => {
    // The control: without this, DELETING both call sites would satisfy the
    // rule above while leaving nothing enforcing editability at all.
    expect(read('src/app/dashboard/campaigns/[id]/edit/page.tsx')).toContain(
      'isOrganiserEditable(campaign.status)',
    );
    expect(read('src/app/dashboard/campaigns/[id]/page.tsx')).toContain(
      'isOrganiserEditable(campaign.status)',
    );
  });
});
