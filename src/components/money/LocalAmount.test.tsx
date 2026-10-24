import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocalAmount } from './LocalAmount';
import type { FxSnapshot } from '@/lib/money/fx-providers';

const snapshot = (): FxSnapshot => ({
  base: 'USD',
  rates: { USD: 1, KES: 129.84786, UGX: 3700, NGN: 1600 },
  asOf: new Date().toISOString(),
  provider: 'open.er-api.com',
  fetchedAt: new Date().toISOString(),
});

/**
 * Stand in for a browser in a given place.
 *
 * Only `Intl.DateTimeFormat` is stubbed, never `Intl.NumberFormat` - the
 * money formatting under test must stay real, or these tests would assert
 * against a mock of the thing they are checking.
 */
function stubBrowser(timeZone: string | null, languages: string[]) {
  vi.stubGlobal('navigator', { languages, language: languages[0] });
  vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
    resolvedOptions: () => ({ timeZone }),
  } as unknown as Intl.DateTimeFormat);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LocalAmount', () => {
  it('shows a KES goal in the visitor\'s own currency when the timezone says Uganda', async () => {
    stubBrowser('Africa/Kampala', ['en-US']);
    render(
      <LocalAmount minor={6_492_393} fromCurrency="KES" fallbackCurrency="USD" snapshot={snapshot()} />,
    );
    // The timezone wins over the en-US language tag.
    expect(await screen.findByText(/UGX|USh/)).toBeInTheDocument();
  });

  it('renders NOTHING once it knows the visitor is in the campaign\'s own currency', async () => {
    stubBrowser('Africa/Nairobi', ['en-KE']);
    const { container } = render(
      <LocalAmount minor={6_492_393} fromCurrency="KES" fallbackCurrency="USD" snapshot={snapshot()} />,
    );
    // Converting KES into KES for a Kenyan tells them nothing, so the
    // fallback is dropped rather than kept.
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('keeps the fallback when the browser gives nothing detectable', async () => {
    stubBrowser('UTC', ['en']);
    render(
      <LocalAmount minor={6_492_393} fromCurrency="KES" fallbackCurrency="USD" snapshot={snapshot()} />,
    );
    // 'en' must NOT be maximized to US - the fallback is shown because
    // nothing was detected, not because America was inferred.
    expect(await screen.findByText(/\$/)).toBeInTheDocument();
  });

  it('renders nothing at all with no fallback and no detection', async () => {
    stubBrowser('UTC', ['en']);
    const { container } = render(
      <LocalAmount minor={50_000} fromCurrency="USD" fallbackCurrency={null} snapshot={snapshot()} />,
    );
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders nothing when there is no rate snapshot', async () => {
    stubBrowser('Africa/Kampala', ['en-US']);
    const { container } = render(
      <LocalAmount minor={6_492_393} fromCurrency="KES" fallbackCurrency="USD" snapshot={null} />,
    );
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
