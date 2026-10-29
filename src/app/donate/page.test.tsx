/**
 * /donate is the orange navbar CTA on every page, and it was a dead end.
 *
 * Verified against production on 2026-10-15: `GENERAL_FUND_CAMPAIGN_ID`
 * (src/lib/constants.ts) is a hardcoded uuid with no matching campaigns row,
 * so POST /api/v1/donations/create-checkout answered every submit with
 * 404 NOT_FOUND "Campaign not found or not accepting donations". The page
 * rendered a complete, inviting donation form in front of that. The
 * constant's own comment says the id "must match the actual row in the
 * campaigns table"; it did not.
 *
 * Production data cannot be created from here, so the fix is to stop lying at
 * the code level: check the fund server-side, and when it is not donatable
 * show the donor why and send them somewhere they can actually give. See
 * docs/42.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DonatePage from '@/app/donate/page';

/**
 * Rows the mocked database will answer the general fund lookup with.
 *
 * ⚠️ The shape follows the query, which now selects `currency` rather than
 * `id` (`docs/147`): the fund's own currency chooses the rail, so a row
 * without one cannot pick a form and the page must refuse.
 */
let fundRows: { currency: string }[] = [];
/** Set when the lookup should behave like a database fault. */
let dbThrows = false;

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (dbThrows) throw new Error('pool wedged');
            return fundRows;
          },
        }),
      }),
    }),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/donate',
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

async function renderPage() {
  render(await DonatePage());
}

beforeEach(() => {
  vi.clearAllMocks();
  fundRows = [];
  dbThrows = false;
  global.fetch = vi.fn() as unknown as typeof fetch;
});

describe('/donate general fund', () => {
  it('shows no donation form when the general fund campaign does not exist', async () => {
    await renderPage();

    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /donate/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/general fund is not accepting donations right now/i),
    ).toBeInTheDocument();
  });

  it('points the donor at somewhere they can actually give', async () => {
    await renderPage();

    const link = screen.getByRole('link', { name: /browse active fundraisers/i });
    expect(link).toHaveAttribute('href', '/campaigns');
  });

  it('does not blame the donor or their card', async () => {
    await renderPage();

    expect(screen.getByText(/nothing is wrong with your card or your account/i)).toBeInTheDocument();
  });

  it('fails closed when the lookup itself fails', async () => {
    dbThrows = true;
    await renderPage();

    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/general fund is not accepting donations right now/i),
    ).toBeInTheDocument();
  });

  it('renders the donation form once the fund exists and is donatable', async () => {
    fundRows = [{ currency: 'USD' }];
    await renderPage();

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/general fund is not accepting donations right now/i),
    ).not.toBeInTheDocument();
  });

  /*
    ── The rail is the fund's, not the page's (docs/147) ─────────────────────

    `/donate` hardcoded the Stripe form and told donors their money was taken
    "in U.S. dollars by Stripe". The live rail is M-Pesa, and
    `create-checkout` answers 400 WRONG_PAYMENT_RAIL for a KES campaign while
    `payhero/initiate` answers it for a USD one - so the wrong form here is
    not a cosmetic mismatch, it is a donation that cannot complete.

    Each case below would pass against a page that rendered ONE form, so all
    three are asserted: the right form present AND the other one absent.
  */
  describe('the rail comes from the fund currency', () => {
    it('KES renders the M-Pesa form and no card form', async () => {
      fundRows = [{ currency: 'KES' }];
      await renderPage();

      expect(screen.getByLabelText(/m-pesa number/i)).toBeInTheDocument();
      expect(screen.getByText(/paid by M-Pesa/i)).toBeInTheDocument();
      // The card form's own field, absent.
      expect(screen.queryByLabelText(/card/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/U\.S\. dollars by Stripe/i)).not.toBeInTheDocument();
    });

    it('USD renders the card form and no M-Pesa field', async () => {
      fundRows = [{ currency: 'USD' }];
      await renderPage();

      expect(screen.queryByLabelText(/m-pesa number/i)).not.toBeInTheDocument();
      expect(screen.getByText(/paid by card/i)).toBeInTheDocument();
    });

    it('refuses a currency the platform cannot collect, rather than guessing', async () => {
      // A real possibility: `WORLD_CURRENCY_EXPONENTS` knows 152 currencies
      // and `CURRENCIES` can collect two (docs/103).
      fundRows = [{ currency: 'EUR' }];
      await renderPage();

      expect(screen.queryByLabelText(/m-pesa number/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
      expect(
        screen.getByText(/general fund is not accepting donations right now/i),
      ).toBeInTheDocument();
    });
  });
});
