/**
 * "Load More" must continue from the page you are ON.
 *
 * ## The bug this prevents (docs/145)
 *
 * `page.tsx` passed `initialCursor = String(PAGE_SIZE)` - a CONSTANT. While
 * the listing could only ever be page one, `12` was correct by coincidence.
 * Adding offset pagination arms it: `CampaignGrid` hands that value to the
 * listing API as `cursor`, which `api-helpers.ts:47-49` reads as an absolute
 * OFFSET. On page 2 it would therefore ask for rows 12-24 - the rows already
 * on screen - and `CampaignGrid`'s id dedupe (`:78-80`) would discard every
 * one, so the button would spin and append nothing.
 *
 * ⚠️ The cursor is not in the DOM; it only surfaces when the button is
 * pressed. So this file mocks `CampaignGrid` to capture its props, which is
 * why it is separate from `page.test.tsx` - that file asserts on what the
 * real grid renders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const state = vi.hoisted(() => ({
  queue: [] as unknown[][],
  props: [] as Record<string, unknown>[],
}));

vi.mock('@/db', () => {
  const chain = () => {
    const rows = state.queue.shift() ?? [];
    const self: Record<string, unknown> = {
      from: () => self,
      where: () => self,
      orderBy: () => self,
      offset: () => self,
      limit: () => self,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return self;
  };
  return { db: { select: chain } };
});

// `CampaignFilters` is a client component calling `useRouter`, which throws
// `invariant expected app router to be mounted` outside a Next runtime.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/components/campaign/CampaignGrid', () => ({
  CampaignGrid: (props: Record<string, unknown>) => {
    state.props.push(props);
    return null;
  },
}));

const CampaignsPage = (await import('./(index)/page')).default;

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    slug: `campaign-${i}`,
    title: `Campaign ${i}`,
    heroImageUrl: '/images/hero.webp',
    subjectName: `Person ${i}`,
    subjectHometown: null,
    campaignOrganizer: null,
    category: 'medical',
    raisedAmount: 0,
    currency: 'USD',
    goalAmount: 10000,
    donorCount: 0,
    location: null,
    status: 'active',
    publishedAt: new Date('2026-10-01'),
  }));
}

/** The page reads: rows, tab counts, and (only when filtered) the match count. */
function queueDb({ rowCount, active }: { rowCount: number; active: number }) {
  state.queue = [rows(rowCount), [{ active, completed: 0 }]];
}

async function gridPropsFor(params: Record<string, string>) {
  state.props = [];
  // The element tree has to be RENDERED: returning it does not invoke the
  // children, so the mocked grid never records its props.
  render(await CampaignsPage({ searchParams: Promise.resolve(params) }));
  expect(state.props).toHaveLength(1);
  return state.props[0]!;
}

beforeEach(() => {
  state.queue = [];
  state.props = [];
});

describe('the Load More cursor continues from the current page', () => {
  it('is a full page in when the listing is on page 2', async () => {
    // 13 rows come back for the overfetch, so hasMore is true.
    queueDb({ rowCount: 13, active: 40 });
    const props = await gridPropsFor({ page: '2' });

    expect(props.initialHasMore).toBe(true);
    // ⛔ 24, not 12. 12 is the rows already on screen.
    expect(props.initialCursor).toBe('24');
  });

  it('is one page in on page 1', async () => {
    queueDb({ rowCount: 13, active: 40 });
    const props = await gridPropsFor({ page: '1' });

    expect(props.initialCursor).toBe('12');
  });

  it('advances by exactly one page per page', async () => {
    // The property, not three pinned numbers.
    const seen: number[] = [];
    for (const page of ['1', '2', '3', '4']) {
      queueDb({ rowCount: 13, active: 400 });
      const props = await gridPropsFor({ page });
      seen.push(Number(props.initialCursor));
    }
    expect(seen).toEqual([12, 24, 36, 48]);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]! - seen[i - 1]!).toBe(12);
    }
  });

  it('⚠️ the cursor NEVER equals the offset of the page being displayed', async () => {
    // The precise shape of the bug: a cursor equal to this page's own offset
    // re-requests the visible rows, which the id dedupe then throws away.
    for (const [page, ownOffset] of [['2', 12], ['3', 24], ['5', 48]] as const) {
      queueDb({ rowCount: 13, active: 400 });
      const props = await gridPropsFor({ page });
      expect(Number(props.initialCursor)).toBeGreaterThan(ownOffset);
    }
  });

  it('is null when there is nothing after this page', async () => {
    // Control: without this, "always return offset + 12" would satisfy the
    // rules above while offering a button that loads an empty set.
    queueDb({ rowCount: 5, active: 5 });
    const props = await gridPropsFor({});

    expect(props.initialHasMore).toBe(false);
    expect(props.initialCursor).toBeNull();
  });

  it('hands the grid only the page size, never the overfetched row', async () => {
    queueDb({ rowCount: 13, active: 40 });
    const props = await gridPropsFor({ page: '2' });

    expect((props.initialCampaigns as unknown[]).length).toBe(12);
  });
});
