/**
 * Bulk-email recipient selection in the admin UI — the UI half of 224e069.
 *
 * The API was reworked so recipients are chosen by an explicit
 * `recipientFilter` and an un-scoped send needs `confirmAllDonors: true`
 * (`src/app/api/v1/admin/bulk-emails/[id]/send/route.ts`). The dashboard could
 * produce neither, so the broadest send was unreachable and a draft it created
 * carried whatever filter the schema defaulted to. These tests pin the three
 * controls that close that gap:
 *
 *  - the filter selector offers exactly `RECIPIENT_FILTERS`, and the count the
 *    create response resolves is shown before anything is sent;
 *  - an un-scoped send is blocked until a confirmation naming the real number
 *    of people is ticked, and then posts `confirmAllDonors: true`;
 *  - the fail-closed `VALIDATION_ERROR` for an unrecoverable filter renders the
 *    two routes the server names, not a generic failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkEmailDashboard } from '@/components/admin/BulkEmailDashboard';
import { RECIPIENT_FILTERS } from '@/lib/validators/verification';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** Radix' modal dialog puts `pointer-events: none` on <body> in jsdom. */
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

const BROAD_DRAFT = {
  id: '11111111-1111-4111-8111-111111111111',
  templateName: 'custom',
  subject: 'Platform update',
  recipientCount: 1284,
  sentCount: 0,
  failedCount: 0,
  status: 'draft',
  campaignId: null as string | null,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-10-14T00:00:00.000Z',
};

const SCOPED_DRAFT = {
  ...BROAD_DRAFT,
  id: '22222222-2222-4222-8222-222222222222',
  subject: 'Campaign wrap-up',
  recipientCount: 42,
  campaignId: '33333333-3333-4333-8333-333333333333',
};

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };
let calls: Call[] = [];

/** `sendResponse` / `createResponse` are the parsed JSON those POSTs return. */
function mockFetch(opts: {
  items?: unknown[];
  sendResponse?: unknown;
  createResponse?: unknown;
} = {}) {
  const items = opts.items ?? [BROAD_DRAFT, SCOPED_DRAFT];
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({
      url: String(url),
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    if (String(url).includes('/send')) {
      return {
        ok: true,
        status: 200,
        json: async () =>
          opts.sendResponse ?? {
            ok: true,
            data: { id: 'x', status: 'completed', sentCount: 1, failedCount: 0, recipientCount: 1 },
          },
      };
    }
    if (method === 'POST') {
      return {
        ok: true,
        status: 201,
        json: async () =>
          opts.createResponse ?? {
            ok: true,
            data: {
              id: '44444444-4444-4444-8444-444444444444',
              subject: 'Fresh draft',
              recipientCount: 73,
              recipientFilter: 'guest_donors',
              campaignId: null,
            },
          },
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: { items, pagination: { page: 1, limit: 20, total: items.length, totalPages: 1 } },
      }),
    };
  }) as unknown as typeof fetch;
}

async function renderDashboard(opts?: Parameters<typeof mockFetch>[0]) {
  mockFetch(opts);
  render(<BulkEmailDashboard />);
  await screen.findByText('Platform update');
}

/** Open the send dialog for a listed draft. */
async function openSendDialog(subject: string) {
  const u = user();
  const row = screen.getByText(subject).closest('tr')!;
  await u.click(within(row).getByRole('button', { name: 'Send' }));
  await screen.findByText('Send Bulk Email');
  return u;
}

const sendCalls = () => calls.filter((c) => c.url.includes('/send') && c.method === 'POST');

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
});

describe('recipient-filter selector', () => {
  it('offers exactly the filters the API accepts', async () => {
    await renderDashboard();
    await user().click(screen.getByRole('button', { name: 'New Draft' }));

    const select = screen.getByLabelText('Recipients') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([...RECIPIENT_FILTERS]);
  });

  it('posts the chosen filter and shows the resolved count before any send', async () => {
    await renderDashboard();
    const u = user();
    await u.click(screen.getByRole('button', { name: 'New Draft' }));

    await u.type(screen.getByLabelText('Subject'), 'Fresh draft');
    await u.type(screen.getByLabelText('Body (HTML)'), '<p>Hello {{donor_name}}</p>');
    await u.selectOptions(screen.getByLabelText('Recipients'), 'guest_donors');
    await u.click(screen.getByRole('button', { name: 'Create Draft' }));

    await waitFor(() => {
      const create = calls.find(
        (c) => c.url === '/api/v1/admin/bulk-emails' && c.method === 'POST',
      );
      expect(create).toBeDefined();
      expect(create!.body!.recipientFilter).toBe('guest_donors');
    });

    // The count comes back on the create response, so it is on screen while the
    // draft is still a draft.
    expect(await screen.findByText(/resolves to 73 recipient\(s\)/)).toBeInTheDocument();
    expect(sendCalls()).toHaveLength(0);
  });

  it('omits an empty campaign ID rather than posting a blank one', async () => {
    await renderDashboard();
    const u = user();
    await u.click(screen.getByRole('button', { name: 'New Draft' }));
    await u.type(screen.getByLabelText('Subject'), 'Fresh draft');
    await u.type(screen.getByLabelText('Body (HTML)'), '<p>Body copy here</p>');
    await u.click(screen.getByRole('button', { name: 'Create Draft' }));

    await waitFor(() => {
      const create = calls.find(
        (c) => c.url === '/api/v1/admin/bulk-emails' && c.method === 'POST',
      );
      expect(create).toBeDefined();
      expect('campaignId' in create!.body!).toBe(false);
    });
  });
});

describe('un-scoped send is gated on an explicit confirmation', () => {
  it('states the real number of people and blocks the send until ticked', async () => {
    await renderDashboard();
    const u = await openSendDialog('Platform update');

    expect(screen.getByText(/to 1284 recipient\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/entire donor base: 1284 people/)).toBeInTheDocument();

    const checkbox = screen.getByLabelText(
      /I confirm this email should go to all 1284 donors/,
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    const sendNow = screen.getByRole('button', { name: 'Send Now' });
    expect(sendNow).toBeDisabled();

    await u.click(sendNow);
    expect(sendCalls()).toHaveLength(0);

    await u.click(checkbox);
    expect(sendNow).toBeEnabled();
  });

  it('posts confirmAllDonors once confirmed', async () => {
    await renderDashboard();
    const u = await openSendDialog('Platform update');

    await u.click(screen.getByLabelText(/I confirm this email should go to all 1284 donors/));
    await u.click(screen.getByRole('button', { name: 'Send Now' }));

    await waitFor(() => expect(sendCalls()).toHaveLength(1));
    const call = sendCalls()[0];
    expect(call.url).toBe(`/api/v1/admin/bulk-emails/${BROAD_DRAFT.id}/send`);
    expect(call.body).toEqual({ confirmAllDonors: true });
  });

  it('resets the confirmation when the dialog is reopened', async () => {
    await renderDashboard();
    const u = await openSendDialog('Platform update');

    await u.click(screen.getByLabelText(/I confirm this email should go to all 1284 donors/));
    await u.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Send Bulk Email')).not.toBeInTheDocument());

    await openSendDialog('Platform update');
    expect(
      (screen.getByLabelText(/I confirm this email should go to all 1284 donors/) as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(screen.getByRole('button', { name: 'Send Now' })).toBeDisabled();
  });

  it('asks for no confirmation on a campaign-scoped draft', async () => {
    await renderDashboard();
    const u = await openSendDialog('Campaign wrap-up');

    expect(screen.queryByLabelText(/I confirm this email should go to all/)).not.toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Send Now' }));

    await waitFor(() => expect(sendCalls()).toHaveLength(1));
    expect(sendCalls()[0].body).toEqual({});
  });
});

describe('unrecoverable recipient filter', () => {
  const UNRECOVERABLE = {
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      message:
        'The recipient filter for this draft could not be recovered from the audit trail. Re-create the draft, or re-send with an explicit "recipientFilter".',
      requestId: 'r1',
    },
  };

  it('renders the two actionable routes instead of a generic failure', async () => {
    await renderDashboard({ sendResponse: UNRECOVERABLE });
    const u = await openSendDialog('Campaign wrap-up');
    await u.click(screen.getByRole('button', { name: 'Send Now' }));

    expect(
      await screen.findByText(/recipient filter could not be recovered/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Re-create the draft with the form above, or pick the filter now/)).toBeInTheDocument();
    expect(screen.getByLabelText('Recipient filter')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-send With This Filter' })).toBeDisabled();
  });

  it('re-sends with the filter the admin picks', async () => {
    await renderDashboard({ sendResponse: UNRECOVERABLE });
    const u = await openSendDialog('Campaign wrap-up');
    await u.click(screen.getByRole('button', { name: 'Send Now' }));
    await screen.findByLabelText('Recipient filter');

    await u.selectOptions(screen.getByLabelText('Recipient filter'), 'registered_donors');
    const retry = screen.getByRole('button', { name: 'Re-send With This Filter' });
    expect(retry).toBeEnabled();
    await u.click(retry);

    await waitFor(() => expect(sendCalls()).toHaveLength(2));
    expect(sendCalls()[1].body).toEqual({ recipientFilter: 'registered_donors' });
  });
});
