/**
 * The browse listing must not contradict itself (docs/45).
 *
 * A live audit of production found `/campaigns?close_to_target=1` printing
 * "12 active campaigns" directly above "No active campaigns at the moment.
 * Check back soon." on one screen: the count was the UNFILTERED total, and the
 * empty state told the visitor to wait for the platform when the actual remedy
 * was to clear their own filter. There was no visible Clear control either, so
 * the only exit was the browser Back button.
 *
 * These tests drive the real page component against a mocked DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/* ------------------------------------------------------------------ */
/*  Mocks                                                             */
/*                                                                    */
/*  The page issues, in this order: the campaign rows, the unfiltered  */
/*  active count, the completed count, and (only when a filter is      */
/*  active) the filtered count.                                       */
/* ------------------------------------------------------------------ */

const state = vi.hoisted(() => ({ queue: [] as unknown[][] }));

vi.mock('@/db', () => {
  const chain = () => {
    const rows = state.queue.shift() ?? [];
    const self: Record<string, unknown> = {
      from: () => self,
      where: () => self,
      orderBy: () => self,
      limit: () => self,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return self;
  };
  return { db: { select: chain } };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

const CampaignsPage = (await import('./page')).default;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function campaignRow(n: number) {
  return {
    id: `id-${n}`,
    slug: `campaign-${n}`,
    title: `Campaign ${n}`,
    heroImageUrl: '/images/hero.webp',
    subjectName: `Person ${n}`,
    subjectHometown: 'Memphis, TN',
    campaignOrganizer: null,
    category: 'medical',
    raisedAmount: 0,
    goalAmount: 10000,
    donorCount: 0,
    location: 'Memphis, TN',
    status: 'active',
    publishedAt: new Date('2026-10-01'),
  };
}

const TWELVE = Array.from({ length: 12 }, (_, i) => campaignRow(i + 1));

/**
 * Queue the four result sets the page reads.
 * `matched` is omitted when no filter is active, exactly as the page does.
 */
function mockDb({
  rows,
  active = 12,
  completed = 0,
  matched,
}: {
  rows: unknown[];
  active?: number;
  completed?: number;
  matched?: number;
}) {
  state.queue = [rows, [{ count: active }], [{ count: completed }]];
  if (matched !== undefined) state.queue.push([{ count: matched }]);
}

async function renderPage(params: Record<string, string>) {
  const ui = await CampaignsPage({ searchParams: Promise.resolve(params) });
  render(ui);
}

/** The whole header + listing as one flat string, whitespace collapsed. */
function pageText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

beforeEach(() => {
  state.queue = [];
});

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('/campaigns with an active filter and zero results', () => {
  it('says the filters matched nothing, not that the platform is empty', async () => {
    mockDb({ rows: [], matched: 0 });
    await renderPage({ close_to_target: '1' });

    expect(screen.getByText('No campaigns match these filters.')).toBeInTheDocument();
    expect(pageText()).not.toContain('No active campaigns at the moment');
  });

  it('offers a keyboard reachable Clear filters control', async () => {
    mockDb({ rows: [], matched: 0 });
    await renderPage({ close_to_target: '1' });

    const clear = screen.getAllByRole('link', { name: 'Clear filters' });
    expect(clear.length).toBeGreaterThan(0);
    expect(clear[0]).toHaveAttribute('href', '/campaigns');
  });

  it('does not print a count that contradicts the list beneath it', async () => {
    mockDb({ rows: [], matched: 0 });
    await renderPage({ close_to_target: '1' });

    const text = pageText();
    // The old header claimed "12 active campaigns" above an empty list.
    expect(text).not.toMatch(/12 active campaigns(?! match)/);
    expect(text).toContain('0 of 12 active campaigns match these filters');
  });

  it('labels a partial match against the unfiltered total', async () => {
    mockDb({ rows: [campaignRow(1)], matched: 1 });
    await renderPage({ q: 'fire' });

    expect(pageText()).toContain('1 of 12 active campaigns match these filters');
  });

  it('applies the same treatment to a location that matches nothing', async () => {
    mockDb({ rows: [], matched: 0 });
    await renderPage({ location: 'zzzz' });

    expect(screen.getByText('No campaigns match these filters.')).toBeInTheDocument();
    expect(pageText()).toContain('0 of 12 active campaigns match these filters');
  });

  it('keeps the unfiltered header when no filter is active', async () => {
    mockDb({ rows: TWELVE });
    await renderPage({});

    const text = pageText();
    expect(text).toContain('12 active campaigns');
    expect(text).not.toContain('match these filters');
    expect(screen.queryByText('No campaigns match these filters.')).not.toBeInTheDocument();
  });
});

describe('/campaigns with a value it cannot apply', () => {
  it('reports an unrecognized category instead of silently listing everything', async () => {
    mockDb({ rows: TWELVE });
    await renderPage({ category: 'bogus' });

    const text = pageText();
    expect(text).toContain('category “bogus”');
    expect(text).toContain('is not one we recognize, so it was not applied');
    // The unfiltered list is still shown, deliberately and with the plain count.
    expect(text).toContain('12 active campaigns');
    expect(screen.getByText('Campaign 1')).toBeInTheDocument();
  });

  it('resolves the displayed label slug disaster-relief rather than reporting it', async () => {
    mockDb({ rows: [campaignRow(1)], matched: 1 });
    await renderPage({ category: 'disaster-relief' });

    // A resolved category renders the category hero branch, so there is no
    // notice and the campaign is listed.
    expect(pageText()).not.toContain('is not one we recognize');
    expect(screen.getByText('Campaign 1')).toBeInTheDocument();
    // That branch used to omit the filter bar entirely, leaving no exit.
    expect(screen.getByRole('button', { name: /Clear filters/ })).toBeInTheDocument();
  });

  it('reports an unrecognized sort', async () => {
    mockDb({ rows: TWELVE });
    await renderPage({ sort: 'bogus' });

    const text = pageText();
    expect(text).toContain('sort order “bogus”');
    expect(text).toContain('is not one we recognize, so it was not applied');
  });

  it('points status=completed at the page that serves it', async () => {
    mockDb({ rows: TWELVE });
    await renderPage({ status: 'completed' });

    const link = screen.getByRole('link', { name: 'See completed campaigns' });
    expect(link).toHaveAttribute('href', '/completed-campaigns');
    expect(pageText()).toContain('This page lists campaigns that are still raising money');
  });

  it('reports an unrecognized status', async () => {
    mockDb({ rows: TWELVE });
    await renderPage({ status: 'bogus' });

    expect(pageText()).toContain('status “bogus”');
  });

  it('shows no notice for a clean URL', async () => {
    mockDb({ rows: TWELVE });
    await renderPage({});

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(pageText()).not.toContain('is not one we recognize');
  });
});

describe('/campaigns header copy', () => {
  it('leaves the review claim exactly as the owner decision left it', async () => {
    mockDb({ rows: TWELVE });
    await renderPage({});

    expect(screen.getByText('Each one reviewed before going live')).toBeInTheDocument();
  });
});
