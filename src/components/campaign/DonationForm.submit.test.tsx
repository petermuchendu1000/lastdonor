/**
 * A failed submit used to show the donor absolutely nothing.
 *
 * Live browser audit (2026-10-15), both donation flows: after clicking
 * Donate, the DOM was byte-identical before and after, there was no element
 * with role=alert / aria-live / a class containing "error", and the submit
 * button polled every 250ms never disabled and never showed a pending state.
 * The donor clicks, nothing happens, they click again, they leave. The API was
 * meanwhile answering with specific, field-tagged messages.
 *
 * Separately, three clicks dispatched synchronously in one task produced three
 * create-checkout POSTs, because the only guard was React state that had not
 * flushed yet.
 *
 * These tests pin: the API message reaches the page, the button goes busy, and
 * one burst of clicks is one request.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
  ⛔ These tests drive the DETAILS FORM, and `DonationForm` only renders it
  when a publishable key was built in - without one the card rail cannot
  mount embedded checkout, so the component shows the unavailable notice
  instead (`docs/161`). Production has no key, which is exactly the condition
  being modelled elsewhere, so the key is stubbed HERE and deliberately NOT in
  `test/setup.ts`: a global stub would make every test in the suite render a
  form production never shows, which is how the defect hid.

  `vi.hoisted` because the key is read at MODULE SCOPE, before any beforeEach.
*/
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fixtureKeyNotReal';
});

import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DonationForm } from '@/components/campaign/DonationForm';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const props = {
  campaignId: '550e8400-e29b-41d4-a716-446655440000',
  campaignTitle: 'Help the Johnson Family',
};

/** Requests the form made, in order. */
let calls: { url: string; body: Record<string, unknown> }[] = [];

function mockApi(responder: () => Promise<{ status: number; body: unknown }>) {
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    const { status, body } = await responder();
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  }) as unknown as typeof fetch;
}

async function fillValidDonation() {
  await userEvent.click(screen.getByRole('radio', { name: /^\$25\b/ }));
  await userEvent.type(screen.getByLabelText(/email address/i), 'donor@example.com');
}

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
});

describe('DonationForm submit feedback', () => {
  it('renders the API error message on the page, not only in a toast', async () => {
    mockApi(async () => ({
      status: 404,
      body: {
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Campaign not found or not accepting donations',
        },
      },
    }));

    render(<DonationForm {...props} />);
    await fillValidDonation();
    await userEvent.click(screen.getByRole('button', { name: /donate \$25\.00/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Campaign not found or not accepting donations');
    expect(calls).toHaveLength(1);
  });

  it('surfaces a field-level validation message from the API verbatim', async () => {
    mockApi(async () => ({
      status: 400,
      body: {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Enter a valid email address',
          field: 'donorEmail',
        },
      },
    }));

    render(<DonationForm {...props} />);
    await fillValidDonation();
    await userEvent.click(screen.getByRole('button', { name: /donate \$25\.00/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address');
  });

  it('says something when the network fails', async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    render(<DonationForm {...props} />);
    await fillValidDonation();
    await userEvent.click(screen.getByRole('button', { name: /donate \$25\.00/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/network error/i);
  });

  it('disables the button and shows a pending state while the request is in flight', async () => {
    let release: (value: { status: number; body: unknown }) => void = () => {};
    mockApi(() => new Promise((resolve) => { release = resolve; }));

    render(<DonationForm {...props} />);
    await fillValidDonation();

    const button = screen.getByRole('button', { name: /donate \$25\.00/i });
    await userEvent.click(button);

    const busy = await screen.findByRole('button', { name: /processing/i });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      release({ status: 200, body: { ok: true, data: { clientSecret: 'cs_test_secret', sessionId: 'cs_test' } } });
    });
  });

  it('sends one request for three clicks dispatched in a single task', async () => {
    mockApi(async () => ({
      status: 500,
      body: { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create checkout session' } },
    }));

    render(<DonationForm {...props} />);
    await fillValidDonation();

    const button = screen.getByRole('button', { name: /donate \$25\.00/i });

    // Three synchronous dispatches, no awaits between them: React has not
    // re-rendered, so a state-based guard would still read false on all three.
    await act(async () => {
      button.click();
      button.click();
      button.click();
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/donations/create-checkout']);
  });

  it('never quotes an amount the form will not submit', async () => {
    render(<DonationForm {...props} />);

    const custom = screen.getByPlaceholderText('0.00');
    await userEvent.clear(custom);
    await userEvent.type(custom, '9999999.99');

    expect(screen.queryByRole('button', { name: /donate \$999,999,999\.00/i })).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: /enter an amount up to \$100,000\.00/i });
    expect(button).toBeDisabled();
    expect(screen.getByText('Maximum donation is $100,000')).toBeInTheDocument();
  });
});
