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

const state = vi.hoisted(() => ({ queue: [] as unknown[][], offsets: [] as number[] }));

vi.mock('@/db', () => {
  const chain = () => {
    const rows = state.queue.shift() ?? [];
    const self: Record<string, unknown> = {
      from: () => self,
      where: () => self,
      orderBy: () => self,
      // `offset` arrived with crawlable pagination (docs/145). A mock chain is
      // a hand-written list of the builder methods the page happens to call
      // today, so adding one to the query breaks it with
      // `self.offset is not a function` - and that is the ONLY thing this mock
      // can tell you about the query. It cannot evaluate the offset, which is
      // why the slice arithmetic is proven against a real Postgres instead
      // (docs/124, docs/130).
      offset: (n: number) => {
        state.offsets.push(n);
        return self;
      },
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

const CampaignsPage = (await import('./(index)/page')).default;

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
 * Queue the result sets the page reads.
 * `matched` may be omitted when no filter is active: it then equals `active`,
 * which is what the real aggregate returns for an unfiltered listing.
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
  /*
    The two tab counts became one FILTER-aggregate row in docs/87
    amendment 5, and `docs/166` folded the MATCHED count into that same
    scan - so the page now reads TWO result sets, not three. The
    assertions below are unchanged: what the header says is the point,
    not how many round trips produced it.

    ⚠️ `matched` defaults to `active`, and that is FIDELITY, not
    convenience. With no filter applied, `count(*) FILTER (WHERE
    browseConditions(...))` reduces to the listed count - so a mock that
    left it 0 would be a result the database could never produce, and a
    test passing against it would prove nothing (`docs/128` §6: a fixture
    Postgres would never emit is not evidence).
  */
  state.queue = [rows, [{ active, completed, matched: matched ?? active }]];
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
  state.offsets = [];
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

/* ------------------------------------------------------------------ */
/*  Crawlable pagination (docs/145)                                    */
/*                                                                    */
/*  The listing applied NO offset: ?page=1, ?page=2 and ?page=99 all   */
/*  returned the same twelve rows, and the only "more" control was a   */
/*  <button>, so nothing past the first page existed in any HTML a     */
/*  crawler could read.                                               */
/*                                                                    */
/*  ⚠️ These drive the REAL page component. The db mock records the    */
/*  offset the query asks for - which is all a mock can prove here.    */
/*  That the offset actually partitions the rows is executed against a */
/*  real Postgres in `pagination.integration.test.ts` (docs/124).      */
/* ------------------------------------------------------------------ */
describe('/campaigns pagination', () => {
  it('asks the database for a DIFFERENT slice on page 2', async () => {
    // The symptom, at the only place a unit test can see it. Against the
    // original code there is no `.offset()` call at all, so `offsets` is empty.
    mockDb({ rows: TWELVE, active: 14 });
    await renderPage({ page: '2' });

    expect(state.offsets).toContain(12);
  });

  it('asks for offset 0 on page 1, and on a URL with no page param', async () => {
    mockDb({ rows: TWELVE, active: 14 });
    await renderPage({ page: '1' });
    expect(state.offsets).toContain(0);

    state.offsets = [];
    mockDb({ rows: TWELVE, active: 14 });
    await renderPage({});
    expect(state.offsets).toContain(0);
  });

  it('renders page links as real anchors, not buttons', async () => {
    mockDb({ rows: TWELVE, active: 14 });
    await renderPage({});

    const nav = screen.getByRole('navigation', { name: 'Campaign listing pages' });
    const next = screen.getByRole('link', { name: 'Next' });
    expect(nav).toBeInTheDocument();
    expect(next).toHaveAttribute('href', '/campaigns?page=2');
    expect(screen.getByRole('link', { name: 'Page 2' })).toHaveAttribute(
      'href',
      '/campaigns?page=2',
    );
  });

  it('page 1 is the bare URL, never ?page=1', async () => {
    // Two addresses for one document is the duplicate this avoids.
    mockDb({ rows: TWELVE, active: 14 });
    await renderPage({ page: '2' });

    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/campaigns');
    expect(screen.getByRole('link', { name: 'Page 1' })).toHaveAttribute('href', '/campaigns');
  });

  it('carries the active filters across pages', async () => {
    mockDb({ rows: TWELVE, active: 40, matched: 30 });
    await renderPage({ category: 'medical', sort: 'newest', page: '2' });

    const next = screen.getByRole('link', { name: 'Next' });
    expect(next.getAttribute('href')).toContain('category=medical');
    expect(next.getAttribute('href')).toContain('sort=newest');
    expect(next.getAttribute('href')).toContain('page=3');
  });

  it('renders NO pagination when everything fits on one page', async () => {
    // Control: without this, a rule that merely looks for a nav could be
    // satisfied by rendering the strip unconditionally.
    mockDb({ rows: TWELVE.slice(0, 5), active: 5 });
    await renderPage({});

    expect(screen.queryByRole('navigation', { name: 'Campaign listing pages' })).toBeNull();
  });

  it('the current page is marked, and is not a link to itself', async () => {
    mockDb({ rows: TWELVE, active: 14 });
    await renderPage({ page: '2' });

    expect(screen.queryByRole('link', { name: 'Page 2' })).toBeNull();
    expect(screen.getByText('2', { selector: '[aria-current="page"]' })).toBeInTheDocument();
  });

  it('past the end, blames the URL and not the platform', async () => {
    // docs/45's defect class: the stock empty state reads "No active
    // campaigns at the moment. Check back soon." while 14 campaigns exist.
    mockDb({ rows: [], active: 14 });
    await renderPage({ page: '99' });

    expect(pageText()).toContain('There is no page 99');
    expect(pageText()).toContain('This listing has 2 pages');
    expect(pageText()).not.toContain('No active campaigns at the moment');
    expect(screen.getByRole('link', { name: 'Go to the first page' })).toHaveAttribute(
      'href',
      '/campaigns',
    );
  });

  it('a junk page param is treated as page 1 rather than erroring', async () => {
    mockDb({ rows: TWELVE, active: 14 });
    await renderPage({ page: 'not-a-number' });

    expect(state.offsets).toContain(0);
    expect(pageText()).not.toContain('There is no page');
  });
});
