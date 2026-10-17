import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
  docs/88 F8. `/admin/campaigns` fetched every campaign row with no
  LIMIT and counted the status tiles in JS over that same unbounded
  result. Measured in production at 222 campaigns: 222 rendered rows,
  793 KB of HTML, a 15,633px page, 4,871 DOM nodes.

  The two halves have to move together. Capping the fetch while
  leaving the tiles counting JS rows would have turned a slow screen
  into a lying one - a "Draft 210" tile over a list that can only ever
  reach 200 - which is docs/88 F16 all over again.
*/

const PAGE = join(process.cwd(), 'src/app/admin/campaigns/page.tsx');
const LIST = join(process.cwd(), 'src/components/admin/CampaignsList.tsx');

describe('the admin campaigns fetch is bounded (docs/88 F8)', () => {
  const page = readFileSync(PAGE, 'utf8');
  const list = readFileSync(LIST, 'utf8');

  it('caps the row fetch', () => {
    expect(page).toMatch(/\.limit\(FETCH_LIMIT\)/);
    expect(page).toMatch(/const FETCH_LIMIT = 200;/);
  });

  it('counts the status tiles in SQL, not over the fetched rows', () => {
    expect(page).toMatch(/\.groupBy\(campaigns\.status\)/);
    // The JS tally over the fetched array is what made the tiles
    // correct only while the fetch was unbounded.
    expect(page).not.toMatch(/for \(const c of allCampaigns\)/);
  });

  it('passes a total that does not come from the capped array', () => {
    expect(page).toMatch(/totalCampaigns=\{totalCampaigns\}/);
    expect(list).toMatch(/const totalCount = totalCampaigns;/);
    expect(list).not.toMatch(/const totalCount = campaigns\.length/);
  });

  it('reports the cap on screen instead of hiding it', () => {
    expect(list).toMatch(/<ListCount/);
    expect(list).toMatch(/loaded=\{campaigns\.length\}/);
    expect(list).toMatch(/total=\{totalCount\}/);
  });

  it('pages the rows rather than rendering the whole fetch', () => {
    expect(list).toMatch(/const PAGE_SIZE = 25;/);
    expect(list).toMatch(/\{paged\.map\(/);
    expect(list).not.toMatch(/\{filtered\.map\(/);
  });

  it('resets to page 1 when a filter changes', () => {
    // Otherwise a filter applied on page 4 shows an empty table.
    for (const setter of ['setStatusFilter', 'setSearch', 'setCategoryFilter']) {
      const line = list.split('\n').find((l) => l.includes(`${setter}(`) && l.includes('=>') && l.includes('setPage(1)'));
      expect(line, `${setter} should reset the page`).toBeTruthy();
    }
  });
});
