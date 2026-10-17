import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ListCount } from '@/components/admin/ListCount';

/*
  docs/88 F16. The defect was a screen stating two different totals: a
  true `count(*)` in the filter tile and the length of a capped fetch in
  the footer. These tests pin the two halves of the fix - what the line
  says, and that no admin list goes back to printing the capped length
  as if it were the whole table.
*/

describe('ListCount', () => {
  it('reports only the page range when nothing is truncated', () => {
    render(<ListCount from={1} to={25} shown={38} loaded={38} total={38} noun="users" />);

    expect(screen.getByText(/Showing 1.25 of 38/)).toBeInTheDocument();
    expect(screen.queryByText(/Loaded the newest/)).not.toBeInTheDocument();
  });

  it('names both numbers when the fetch cap hid rows', () => {
    render(<ListCount from={1} to={25} shown={200} loaded={200} total={238} noun="users" />);

    // The number the reader can page to...
    expect(screen.getByText(/Showing 1.25 of 200/)).toBeInTheDocument();
    // ...and the number that exists. Before the fix only the first was
    // shown, and it read "of 200" on a table holding 238.
    expect(
      screen.getByText(/Loaded the newest 200 of 238 users/),
    ).toBeInTheDocument();
  });

  it('warns that search and filters only see the loaded rows', () => {
    render(<ListCount from={1} to={3} shown={3} loaded={200} total={238} noun="users" />);

    // 3 of 200 matched the filter, but the filter never saw 38 of the
    // rows at all. Saying "3" alone would be the same lie in miniature.
    expect(screen.getByText(/Showing 1.3 of 3/)).toBeInTheDocument();
    expect(
      screen.getByText(/Search and filters apply to those 200 only/),
    ).toBeInTheDocument();
  });

  it('still warns when a filter matched nothing in the loaded rows', () => {
    render(<ListCount from={0} to={0} shown={0} loaded={200} total={238} noun="users" />);

    expect(screen.getByText(/Loaded the newest 200 of 238 users/)).toBeInTheDocument();
  });

  it('groups thousands so 1200 is not misread as 120', () => {
    render(<ListCount from={1} to={25} shown={200} loaded={200} total={1200} noun="donations" />);

    expect(screen.getByText(/1,200 donations/)).toBeInTheDocument();
  });
});

/*
  Ratchet. Every admin list that caps its fetch must report the cap
  through ListCount; none may hand-roll a footer whose "of" is the
  length of the capped array.
*/
describe('admin list footers (docs/88 F16 ratchet)', () => {
  const dir = join(process.cwd(), 'src/components/admin');
  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx') && f !== 'ListCount.tsx',
  );

  it('has no hand-rolled "Showing ... of <array>.length" footer left', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      // Matches the two shapes that existed: "of {sorted.length}" and
      // "of {paged.length} / {filtered.length}" on a Showing line.
      for (const line of src.split('\n')) {
        if (!line.includes('Showing ')) continue;
        if (/of\s*\{?\s*(sorted|filtered|paged|items|rows)\.length/.test(line)) {
          offenders.push(`${f}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('routes every capped admin list through ListCount', () => {
    // Components fed by a page that applies a server-side LIMIT.
    const capped = [
      'UsersList.tsx',
      'DonationsList.tsx',
      'BlogPostsList.tsx',
      'TopicQueueList.tsx',
      'NewsFeedMonitor.tsx',
      'GovernancePanel.tsx',
      'VerificationQueue.tsx',
      'PayoutsDashboard.tsx',
    ];
    const missing = capped.filter(
      (f) => !readFileSync(join(dir, f), 'utf8').includes('<ListCount'),
    );
    expect(missing).toEqual([]);
  });
});

/*
  docs/88 F18. A `<table>` inside a card with `overflow-hidden` and no
  scrollable wrapper clips its right-hand columns at 390px with no way
  to reach them: the card hides the overflow and nothing scrolls. Six
  tables in four components were in that state. Measured on
  /admin/governance: a 422px-wide table in a 390px viewport, with
  `overflow-x: hidden` on the clipping ancestor.
*/
describe('admin tables are reachable on a phone (docs/88 F18 ratchet)', () => {
  const dir = join(process.cwd(), 'src/components/admin');
  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'),
  );

  it('wraps every table in a horizontally scrollable element', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(join(dir, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('<table')) return;
        const above = lines.slice(Math.max(0, i - 6), i).join('\n');
        if (!above.includes('overflow-x-auto')) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
