/**
 * docs/43 — the campaign detail page must answer an unknown slug with a 404,
 * and a database that did not answer with a 5xx.
 *
 * Production audit 2026-10-15: `/campaigns/nope-1` took 15.2s (the
 * `DB_QUERY_TIMEOUT_MS` ceiling) and returned a bare, unstyled
 * `500: Internal Server Error` with no header, footer or navigation. The throw
 * escaped from `generateMetadata`, which resolves before the HTML shell is
 * flushed, so no error boundary existed yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const NOT_FOUND = 'TEST_NEXT_NOT_FOUND';

const state = vi.hoisted(() => ({
  /** Resolver for the single `campaigns` lookup the page performs. */
  lookup: (() => Promise.resolve([] as unknown[])) as () => Promise<unknown[]>,
}));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error(NOT_FOUND);
  }),
}));

const cacheMock = vi.hoisted(() => ({ noStore: vi.fn() }));

vi.mock('next/navigation', () => ({ notFound: nav.notFound }));

vi.mock('next/cache', () => ({
  unstable_noStore: cacheMock.noStore,
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('@/db', () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    offset: () => chain,
    limit: () => state.lookup(),
  };
  return { db: { select: () => chain } };
});

const { default: CampaignDetailPage, generateMetadata } = await import('./page');
const { QueryTimeoutError } = await import('@/db/query-timeout');
const { CampaignUnavailableError } = await import('@/lib/campaign-lookup');

const pageProps = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  vi.clearAllMocks();
  state.lookup = () => Promise.resolve([]);
  // The unavailable path logs for Fly's log stream; keep the test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('unknown slug', () => {
  it('resolves to notFound() without waiting on the query bound', async () => {
    state.lookup = () => Promise.resolve([]); // query answered, zero rows

    const started = Date.now();
    await expect(CampaignDetailPage(pageProps('nope-1'))).rejects.toThrow(NOT_FOUND);
    const elapsed = Date.now() - started;

    expect(nav.notFound).toHaveBeenCalledTimes(1);
    // The audit measured 15.2s, the DB_QUERY_TIMEOUT_MS ceiling.
    expect(elapsed).toBeLessThan(2_000);
  });

  it('does not mark the 404 render uncacheable', async () => {
    await expect(CampaignDetailPage(pageProps('nope-1'))).rejects.toThrow(NOT_FOUND);
    expect(cacheMock.noStore).not.toHaveBeenCalled();
  });

  it('returns renderable, non-indexable metadata rather than throwing', async () => {
    const metadata = await generateMetadata(pageProps('nope-1'));
    expect(metadata.title).toBe('Campaign Not Found');
    expect(metadata.robots).toMatchObject({ index: false });
  });
});

describe('database that did not answer', () => {
  it('does NOT render as a 404', async () => {
    state.lookup = () => Promise.reject(new QueryTimeoutError(15_000));

    await expect(CampaignDetailPage(pageProps('alicia-reeves'))).rejects.toThrow(
      CampaignUnavailableError,
    );
    expect(nav.notFound).not.toHaveBeenCalled();
  });

  it('keeps the original cause so Sentry sees the pool wedge, not a page bug', async () => {
    const cause = new QueryTimeoutError(15_000);
    state.lookup = () => Promise.reject(cause);

    const error = await CampaignDetailPage(pageProps('alicia-reeves')).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(CampaignUnavailableError);
    expect((error as Error).cause).toBe(cause);
    expect((error as { code: string }).code).toBe('CAMPAIGN_LOOKUP_UNAVAILABLE');
  });

  it('marks the degraded render uncacheable', async () => {
    state.lookup = () => Promise.reject(new QueryTimeoutError(15_000));

    await expect(CampaignDetailPage(pageProps('alicia-reeves'))).rejects.toThrow();
    expect(cacheMock.noStore).toHaveBeenCalledTimes(1);
  });

  it('also does not 404 on a connection error', async () => {
    state.lookup = () =>
      Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    await expect(CampaignDetailPage(pageProps('alicia-reeves'))).rejects.toThrow(
      CampaignUnavailableError,
    );
    expect(nav.notFound).not.toHaveBeenCalled();
  });

  it('generateMetadata stays renderable so the shell can flush and error.tsx can render', async () => {
    state.lookup = () => Promise.reject(new QueryTimeoutError(15_000));

    const metadata = await generateMetadata(pageProps('alicia-reeves'));
    expect(metadata.title).toContain('temporarily unavailable');
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
