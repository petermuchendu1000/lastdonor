/**
 * The public campaign listing must return every field its only consumer needs.
 *
 * ── THE DEFECT, reproduced in a browser on 2026-10-26 ───────────────────────
 *
 * `/campaigns` server-renders 12 cards and appends the rest from
 * `GET /api/v1/campaigns` when somebody presses "Load more". That route's
 * select carried no `currency`, while `CampaignGrid`'s `CampaignData` requires
 * one — so appended rows arrived with `currency: undefined` and fell through
 * to `<Money>`'s USD default.
 *
 * On a fixture where EVERY campaign is KES:
 *
 *     first page (server-rendered)   12 cards   0 dollars   "Ksh 18,400"
 *     appended  (from this route)     5 cards   5 dollars   "$12,350"
 *
 * Same campaigns, same rows, two different currencies, one click apart.
 *
 * ⚠️ NOTHING COULD HAVE CAUGHT IT. `CampaignGrid.tsx` parses the response with
 * `json.data as CampaignData[]` — an unchecked cast — so TypeScript was told
 * to believe the shape rather than check it, and a missing field is
 * `undefined` at runtime with no error anywhere. A unit test of the component
 * passes fixtures that have the field; a test of the route asserts the fields
 * somebody remembered to assert.
 *
 * ── WHY THIS TEST IS SHAPED THIS WAY ────────────────────────────────────────
 *
 * It does not pin today's field list. It DERIVES the required keys from
 * `CampaignGrid.tsx`'s own interface and the selected keys from the route, and
 * asserts the second covers the first — the `docs/109` pattern, where both
 * ends come from source so they cannot drift apart silently. Adding a required
 * field to `CampaignData` and forgetting the route now fails here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTE = 'src/app/api/v1/campaigns/route.ts';
const GRID = 'src/components/campaign/CampaignGrid.tsx';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

/** Keys of the `CampaignData` interface that are not optional. */
function requiredConsumerKeys(): string[] {
  const src = read(GRID);
  const start = src.indexOf('interface CampaignData');
  expect(start, `${GRID} must declare interface CampaignData`).toBeGreaterThan(-1);
  const body = src.slice(src.indexOf('{', start) + 1, src.indexOf('\n}', start));
  const keys: string[] = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    const m = t.match(/^(\w+)(\??):/);
    if (m && m[2] !== '?') keys.push(m[1]);
  }
  return keys;
}

/** Keys the route's first `.select({...})` projects. */
function selectedKeys(): string[] {
  const src = read(ROUTE);
  const start = src.indexOf('.select({');
  expect(start, `${ROUTE} must contain a .select({...})`).toBeGreaterThan(-1);
  const body = src.slice(start + '.select({'.length, src.indexOf('})', start));
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return Array.from(withoutComments.matchAll(/(\w+)\s*:/g), (m) => m[1]);
}

describe('GET /api/v1/campaigns returns what CampaignGrid requires', () => {
  it('derives a non-trivial set of required keys from the consumer', () => {
    // Guards the test itself: if the parse silently returned [], the
    // assertion below would pass against any route at all (Gate: a check
    // that cannot fail is not a check).
    const keys = requiredConsumerKeys();
    expect(keys.length).toBeGreaterThanOrEqual(8);
    expect(keys).toContain('id');
    expect(keys).toContain('currency');
  });

  it('derives a non-trivial set of selected keys from the route', () => {
    const keys = selectedKeys();
    expect(keys.length).toBeGreaterThanOrEqual(8);
    expect(keys).toContain('id');
  });

  it('⛔ selects every field the grid requires, currency included', () => {
    const required = requiredConsumerKeys();
    const selected = new Set(selectedKeys());
    const missing = required.filter((k) => !selected.has(k));
    expect(
      missing,
      `GET ${ROUTE} does not return ${missing.join(', ')}, which ${GRID} requires. ` +
        'Appended "Load more" rows will carry undefined for those fields, and the ' +
        'cast `json.data as CampaignData[]` will not catch it.',
    ).toEqual([]);
  });

  it('still parses the response with a cast, so this test is the only guard', () => {
    /*
      Recorded deliberately. If somebody replaces the cast with a runtime
      schema parse, that is strictly better and this assertion should be
      deleted along with it - but while the cast is there, nothing else in
      the codebase compares these two lists.
    */
    expect(read(GRID)).toContain('as CampaignData[]');
  });
});
