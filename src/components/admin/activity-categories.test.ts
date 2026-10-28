import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { resolve } from 'node:path';

import { ACTIVITY_CATEGORIES, getEventCategory } from './ActivityCenter';

/*
  ─────────────────────────────────────────────────────────────────────────
  EVERY AUDIT EVENT THE CODE WRITES MUST BE REACHABLE FROM A CHIP.  docs/137
  ─────────────────────────────────────────────────────────────────────────

  `/admin/activity` is a forensic surface: it is where somebody goes to ask
  what happened. Its category chips were a hand-written map listing 20 event
  types while the code wrote 94, and the chip filter read that map DIRECTLY
  while the badge derived its label from a function - two paths for one
  question.

  Measured against production data before the fix: pressing "campaigns"
  showed 20 of 62 campaign rows and silently dropped 42, including all 14
  `campaign.published` rows.

  ⚠️ This test DERIVES the event types from `src/` rather than listing them,
  for the same reason the fix derives the category: a list restated here
  would drift exactly as the one it replaces did.
*/

const ROOT = process.cwd();

/** Every `eventType: '...'` literal written anywhere in src/. */
function writtenEventTypes(): string[] {
  const files = globSync('src/**/*.{ts,tsx}', { cwd: ROOT })
    .filter((f) => !/\.test\.(ts|tsx)$/.test(f));
  const found = new Set<string>();
  for (const f of files) {
    const src = readFileSync(resolve(ROOT, f), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    /*
      ⚠️ Read the WHOLE expression after `eventType:`, not just a literal
      sitting immediately after it. The first version of this scan matched
      `eventType:\s*'(...)'` and therefore missed

        eventType: isFirstPublication ? 'campaign.published' : 'campaign.status_changed'

      - which is `admin/campaigns/[campaignId]/route.ts:159`, and those two
      are the MOST common campaign events in production (14 and 10 rows).
      The anti-vacuity control below is what caught it. `docs/120` made the
      same point about `.set(variable)`: a literal-only sweep misses the
      site that matters.
    */
    for (const m of src.matchAll(/eventType:\s*([^,\n]+)/g)) {
      for (const lit of m[1].matchAll(/'([a-z0-9_.]+)'/g)) found.add(lit[1]);
    }
  }
  return [...found].sort();
}

const TYPES = writtenEventTypes();

describe('the activity filter can reach every audit event', () => {
  /*
    ── ANTI-VACUITY CONTROL, FIRST ──
    If the scan stopped matching, every rule below would pass over an empty
    list. 94 types existed when this was written.
  */
  it('⚠️ the scan finds the event types, and finds a lot of them', () => {
    expect(TYPES.length).toBeGreaterThan(60);
    // Families that must exist for the rules below to mean anything.
    expect(TYPES).toEqual(expect.arrayContaining([
      'campaign.published', 'donation.recorded', 'cron.reconcile',
    ]));
  });

  /*
    ── THE RULE ──
    Not "is it categorised" but "can a human SELECT it": the category a type
    resolves to must be one of the chips actually rendered.
  */
  it('⛔ every written event type resolves to a chip that exists', () => {
    const unreachable = TYPES.filter(
      (t) => !(ACTIVITY_CATEGORIES as readonly string[]).includes(getEventCategory(t)),
    );
    expect(
      unreachable,
      `these events resolve to no selectable chip:\n${unreachable.join('\n')}`,
    ).toEqual([]);
  });

  /*
    ── THE REGRESSION THE DEFECT WAS ──
    The enumerated map listed 5 campaign types of the 13 the code writes, so
    8 were badged "campaigns" by the function and hidden by the chip. Assert
    the whole family lands in one place.
  */
  it('⛔ ALL campaign events are in the campaigns chip, not just the once-listed five', () => {
    const campaignTypes = TYPES.filter((t) => t.startsWith('campaign.'));
    expect(campaignTypes.length).toBeGreaterThanOrEqual(10);

    const misplaced = campaignTypes.filter((t) => getEventCategory(t) !== 'campaigns');
    expect(
      misplaced,
      `campaign events that the campaigns chip would hide:\n${misplaced.join('\n')}`,
    ).toEqual([]);

    // The four the old map omitted and production actually holds.
    for (const t of ['campaign.published', 'campaign.submitted', 'campaign.cancelled', 'campaign.paused']) {
      expect(getEventCategory(t), `${t} must be reachable under "campaigns"`).toBe('campaigns');
    }
  });

  /*
    ── THE ROOT CAUSE, PINNED ──
    The stale list was the symptom; the defect was that the FILTER and the
    BADGE answered "which category is this?" by different means, so a row
    could be badged `campaigns` and then hidden by the `campaigns` chip.
    Read as text because the wiring is what matters, not the value.
  */
  it('⛔ the filter decides the category with getEventCategory, not a second lookup', () => {
    const src = readFileSync(resolve(ROOT, 'src/components/admin/ActivityCenter.tsx'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const at = src.indexOf('if (categoryFilter)');
    expect(at, 'the category filter vanished').toBeGreaterThan(-1);
    const block = src.slice(at, at + 400);
    expect(block, 'the filter must call getEventCategory').toMatch(/getEventCategory\(/);
    expect(block, 'the filter must not enumerate event types itself').not.toMatch(/\.includes\(a\.eventType\)/);
  });

  /*
    ── THE CONTROL ──
    Without this, `getEventCategory = () => 'other'` plus an "other" chip
    would satisfy every rule above. The families must stay distinguishable.
  */
  it('⚠️ CONTROL: the chips still separate the families', () => {
    expect(getEventCategory('donation.recorded')).toBe('donations');
    expect(getEventCategory('campaign.published')).toBe('campaigns');
    expect(getEventCategory('user.login')).toBe('users');
    expect(getEventCategory('cron.reconcile')).toBe('system');
    // And something with no family of its own still has somewhere to go.
    expect(getEventCategory('blog_pipeline_skipped')).toBe('other');
    expect((ACTIVITY_CATEGORIES as readonly string[])).toContain('other');
  });
});
