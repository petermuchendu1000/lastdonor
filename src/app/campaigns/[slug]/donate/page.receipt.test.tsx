/**
 * The donate page must never render a donation receipt it cannot prove.
 *
 * Found in a live browser audit of production (2026-10-15): the page decided
 * "the payment succeeded" from the query string. Any visitor could load
 *
 *   /campaigns/<real-person>/donate?donation=success&amount=10000000
 *
 * and get "Thank you. Your $100,000.00 donation to <campaign> is on its way",
 * with WhatsApp / Facebook / X share buttons, on the real domain, naming a
 * real beneficiary, on a page that simultaneously said "$0 raised". No Stripe
 * call, no database read, nothing verified. See docs/42.
 *
 * A real Stripe payment cannot be exercised here (the deployed publishable key
 * is the empty string, so Stripe.js throws on page load), so these tests drive
 * the real server component with the Stripe SDK mocked, and pin the three
 * things that matter:
 *
 *   1. donation=success with nothing verifiable renders no receipt;
 *   2. a genuinely succeeded payment belonging to a DIFFERENT campaign renders
 *      no receipt on this campaign;
 *   3. the amount shown is the one Stripe reported, not the one in the URL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
  ⛔ This test asserts the DETAILS FORM renders. `DonationForm` only renders it
  when a publishable key was built in - without one the card rail cannot mount
  embedded checkout, so it shows the unavailable notice instead (`docs/161`).
  Production has no key, so the key is stubbed HERE and deliberately NOT in
  `test/setup.ts`: a global stub would make every test in the suite render a
  form production never shows, which is how that defect hid.

  `vi.hoisted` because the key is read at MODULE SCOPE, before any beforeEach.
*/
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fixtureKeyNotReal';
});
import { render, screen, waitFor } from '@testing-library/react';
import DonatePage from '@/app/campaigns/[slug]/donate/page';

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222';

const campaignRow = {
  id: CAMPAIGN_ID,
  slug: 'alicia-reeves',
  title: 'Help Alicia Reeves',
  subjectName: 'Alicia Reeves',
  raisedAmount: 0,
  goalAmount: 5_000_000,
  donorCount: 0,
  status: 'active',
  // Required since migration 0005: the page renders every figure in the
  // campaign's own currency and picks the payment rail from it.
  currency: 'USD',
};

/*
 * The page now mints an attributed share link on a verified success, which
 * pulls in NextAuth. This suite is about what the receipt renders, so the
 * session is stubbed rather than stood up. See docs/57.
 */
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('@/lib/share-links', () => ({
  mintShareLink: vi.fn(async () => ({ id: 'link-1', token: 'tok_test_123456' })),
  shareUrl: (t: string) => `https://lastdonor.org/s/${t}`,
}));

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [campaignRow],
        }),
      }),
    }),
  },
}));

const stripeMock = vi.hoisted(() => ({
  sessions: { retrieve: vi.fn() },
  intents: { retrieve: vi.fn() },
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { retrieve: stripeMock.sessions.retrieve } },
    paymentIntents: { retrieve: stripeMock.intents.retrieve },
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  notFound: () => {
    throw new Error('notFound');
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

async function renderPage(searchParams: Record<string, string>) {
  const ui = await DonatePage({
    params: Promise.resolve({ slug: campaignRow.slug }),
    searchParams: Promise.resolve(searchParams),
  });
  render(ui);
}

/** Everything that may only appear once a payment is verified. */
function expectNoReceipt() {
  expect(screen.queryByText(/thank you/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/is on its way/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/receipt is on its way/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/multiply your impact/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /whatsapp/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/\$100,000\.00/)).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  // The pending screen re-asks the server; keep it answering "still pending".
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, state: 'processing', amount: null }),
  })) as unknown as typeof fetch;
});

describe('donate page: receipts require Stripe', () => {
  it('renders no receipt for donation=success with no session or intent id', async () => {
    await renderPage({ donation: 'success', amount: '10000000' });

    expectNoReceipt();
    expect(screen.getByText(/we are confirming your payment/i)).toBeInTheDocument();
    // Nothing was asked of Stripe because there was no id to ask about.
    expect(stripeMock.sessions.retrieve).not.toHaveBeenCalled();
    expect(stripeMock.intents.retrieve).not.toHaveBeenCalled();
  });

  it('renders no receipt when a succeeded payment belongs to a different campaign', async () => {
    stripeMock.sessions.retrieve.mockResolvedValue({
      id: 'cs_test_other',
      payment_intent: 'pi_test_other',
      payment_status: 'paid',
      status: 'complete',
      amount_total: 2500,
      metadata: { campaignId: OTHER_CAMPAIGN_ID },
    });
    stripeMock.intents.retrieve.mockResolvedValue({
      id: 'pi_test_other',
      status: 'succeeded',
      amount: 2500,
      amount_received: 2500,
      metadata: { campaignId: OTHER_CAMPAIGN_ID },
    });

    await renderPage({
      donation: 'success',
      amount: '10000000',
      session_id: 'cs_test_other',
    });

    expectNoReceipt();
    expect(screen.queryByText(/\$25\.00 donation/)).not.toBeInTheDocument();
    expect(screen.getByText(/we are confirming your payment/i)).toBeInTheDocument();
  });

  it('shows the amount Stripe reported and ignores the amount in the URL', async () => {
    stripeMock.sessions.retrieve.mockResolvedValue({
      id: 'cs_test_ok',
      payment_intent: 'pi_test_ok',
      payment_status: 'paid',
      status: 'complete',
      amount_total: 2500,
      metadata: { campaignId: CAMPAIGN_ID },
    });
    stripeMock.intents.retrieve.mockResolvedValue({
      id: 'pi_test_ok',
      status: 'succeeded',
      amount: 2500,
      amount_received: 2500,
      metadata: { campaignId: CAMPAIGN_ID },
    });

    await renderPage({
      donation: 'success',
      amount: '10000000',
      session_id: 'cs_test_ok',
    });

    expect(screen.getByText(/thank you/i)).toBeInTheDocument();
    expect(screen.getByText('$25.00')).toBeInTheDocument();
    expect(screen.queryByText(/\$100,000\.00/)).not.toBeInTheDocument();
    expect(stripeMock.sessions.retrieve).toHaveBeenCalledWith('cs_test_ok');
  });

  it('does not take a verified receipt away if the confirm call comes back unverified', async () => {
    // The receipt was established server-side. A later, flakier answer from
    // the confirm route may add nothing to it, but it must not retract it.
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, state: 'unverified', amount: null }),
    })) as unknown as typeof fetch;

    stripeMock.sessions.retrieve.mockResolvedValue({
      id: 'cs_test_ok',
      payment_intent: 'pi_test_ok',
      payment_status: 'paid',
      status: 'complete',
      amount_total: 2500,
      metadata: { campaignId: CAMPAIGN_ID },
    });
    stripeMock.intents.retrieve.mockResolvedValue({
      id: 'pi_test_ok',
      status: 'succeeded',
      amount: 2500,
      amount_received: 2500,
      metadata: { campaignId: CAMPAIGN_ID },
    });

    await renderPage({ donation: 'success', session_id: 'cs_test_ok' });

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.getByText(/thank you/i)).toBeInTheDocument();
    expect(screen.getByText('$25.00')).toBeInTheDocument();
    expect(screen.queryByText(/we are confirming your payment/i)).not.toBeInTheDocument();
  });

  it('renders no receipt when Stripe cannot be reached', async () => {
    stripeMock.sessions.retrieve.mockRejectedValue(new Error('connect ETIMEDOUT'));

    await renderPage({
      donation: 'success',
      amount: '10000000',
      session_id: 'cs_test_ok',
    });

    expectNoReceipt();
    expect(screen.getByText(/we are confirming your payment/i)).toBeInTheDocument();
  });

  it('renders no receipt for an id Stripe does not know', async () => {
    stripeMock.sessions.retrieve.mockRejectedValue(
      Object.assign(new Error('No such checkout session'), { statusCode: 404 }),
    );

    await renderPage({ donation: 'success', session_id: 'cs_made_up' });

    expectNoReceipt();
    expect(screen.getByText(/we are confirming your payment/i)).toBeInTheDocument();
  });

  it('tells the donor the payment failed when Stripe says the intent was not paid', async () => {
    stripeMock.sessions.retrieve.mockResolvedValue({
      id: 'cs_test_declined',
      payment_intent: 'pi_test_declined',
      payment_status: 'unpaid',
      status: 'open',
      amount_total: 2500,
      metadata: { campaignId: CAMPAIGN_ID },
    });
    stripeMock.intents.retrieve.mockResolvedValue({
      id: 'pi_test_declined',
      status: 'requires_payment_method',
      amount: 2500,
      amount_received: 0,
      metadata: { campaignId: CAMPAIGN_ID },
    });

    await renderPage({ donation: 'success', session_id: 'cs_test_declined' });

    expectNoReceipt();
    expect(screen.getByText(/your donation was not completed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('acknowledges a cancelled return instead of showing an empty form', async () => {
    await renderPage({ donation: 'cancel' });

    expectNoReceipt();
    expect(screen.getByText(/your donation was not completed/i)).toBeInTheDocument();
    expect(screen.getByText(/you have not been charged/i)).toBeInTheDocument();
  });

  it('shows the plain donation form when there is no donation param', async () => {
    await renderPage({ amount: '2500' });

    expectNoReceipt();
    expect(screen.queryByText(/we are confirming your payment/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });
});
