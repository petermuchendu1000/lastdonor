import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApproxMoney } from './ApproxMoney';
import { MAX_FX_AGE_HOURS } from '@/lib/money/fx-convert';
import type { FxSnapshot } from '@/lib/money/fx-providers';

const fresh = (asOf = new Date().toISOString()): FxSnapshot => ({
  base: 'USD',
  rates: { USD: 1, KES: 129.84786 },
  asOf,
  provider: 'open.er-api.com',
  fetchedAt: new Date().toISOString(),
});

describe('the label shares the figure\u2019s fate', () => {
  /*
    ⚠️ The case this exists for was live on the public campaign page: the
    caller rendered `<span>Goal is </span>` beside this component, and
    because a USD campaign read from the United States converts into itself
    - which tells the reader nothing, so nothing is rendered - every
    production campaign showed "Goal is" followed by empty space.

    A label passed as a PROP cannot outlive the figure. These two tests are
    the whole guarantee, and the second is the one that would have caught it.
  */
  it('prints the label before the figure when there is one', () => {
    render(
      <ApproxMoney
        label="Goal is"
        minor={6_492_393}
        fromCurrency="KES"
        toCurrency="USD"
        snapshot={fresh()}
      />,
    );
    expect(document.body.textContent).toMatch(/Goal is\s*about/);
  });

  it('⛔ prints NOTHING - label included - when the figure cannot be shown', () => {
    const { container } = render(
      <ApproxMoney
        label="Goal is"
        minor={50_000}
        fromCurrency="USD"
        toCurrency="KES"
        snapshot={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(document.body.textContent).not.toMatch(/Goal is/);
  });

  it('⛔ prints nothing when the rate is too stale to use', () => {
    const stale = fresh(
      new Date(Date.now() - (MAX_FX_AGE_HOURS + 1) * 3600_000).toISOString(),
    );
    const { container } = render(
      <ApproxMoney
        label="Goal is"
        minor={50_000}
        fromCurrency="USD"
        toCurrency="KES"
        snapshot={stale}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ApproxMoney', () => {
  it('shows a KES goal as an approximate USD figure', () => {
    // KES 6,492,393 minor = KES 64,923.93 -> about $500
    render(
      <ApproxMoney minor={6_492_393} fromCurrency="KES" toCurrency="USD" snapshot={fresh()} />,
    );
    expect(document.body.textContent).toMatch(/about/i);
    expect(document.body.textContent).toMatch(/\$500/);
  });

  it('says "about" in words, so the figure cannot be read as the amount charged', () => {
    render(<ApproxMoney minor={50_000} fromCurrency="USD" toCurrency="KES" snapshot={fresh()} />);
    expect(document.body.textContent).toMatch(/\babout\b/);
  });

  it('dates the rate it used', () => {
    render(
      <ApproxMoney
        minor={50_000}
        fromCurrency="USD"
        toCurrency="KES"
        snapshot={fresh('2026-10-24T00:02:31Z')}
      />,
    );
    expect(document.body.textContent).toMatch(/2026-10-24/);
  });

  it('renders the attribution link the licence requires', () => {
    render(<ApproxMoney minor={50_000} fromCurrency="USD" toCurrency="KES" snapshot={fresh()} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://www.exchangerate-api.com');
    expect(link.textContent).toMatch(/ExchangeRate-API/i);
  });

  it('can suppress the attribution for a second figure beside the first', () => {
    const { container } = render(
      <ApproxMoney minor={50_000} fromCurrency="USD" toCurrency="KES" snapshot={fresh()} hideAttribution />,
    );
    expect(container.querySelector('a')).toBeNull();
    // but still says "about"
    expect(container.textContent).toMatch(/about/);
  });

  it('renders NOTHING when there is no snapshot', () => {
    const { container } = render(
      <ApproxMoney minor={50_000} fromCurrency="USD" toCurrency="KES" snapshot={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders NOTHING rather than a stale figure', () => {
    const stale = new Date(Date.now() - (MAX_FX_AGE_HOURS + 2) * 3_600_000).toISOString();
    const { container } = render(
      <ApproxMoney minor={50_000} fromCurrency="USD" toCurrency="KES" snapshot={fresh(stale)} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders NOTHING for a currency the snapshot does not cover', () => {
    const { container } = render(
      <ApproxMoney minor={50_000} fromCurrency="USD" toCurrency="ZZZ" snapshot={fresh()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
