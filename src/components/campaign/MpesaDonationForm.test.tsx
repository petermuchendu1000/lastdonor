/**
 * The M-Pesa donation form.
 *
 * What these tests are actually protecting:
 *
 *  - **A double tap must not send two PIN prompts.** Two unanswered prompts
 *    are two of the ten that get a donor's number blocked by PayHero for 24
 *    hours, so this is not merely a duplicate-charge guard.
 *  - **The waiting screen must move the donor's attention to their phone.**
 *    Research on payment waits is consistent that the damage comes from not
 *    knowing whether to wait or walk away.
 *  - **The failure copy must not invent a cause.** PayHero reports a
 *    cancelled prompt, an expired prompt and insufficient funds all as the
 *    single value FAILED.
 *  - **Every figure is in shillings, never dollars.**
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MpesaDonationForm,
  MAX_POLL_ATTEMPTS,
  POLL_INTERVAL_MS,
} from './MpesaDonationForm';
import { PROMPT_LIFETIME_MS } from '@/lib/mpesa-prompt';
import { mpesaRailFor } from '@/lib/mpesa-rail';

const MAX_POLL_ATTEMPTS_EXPECTED = MAX_POLL_ATTEMPTS;

/**
 * The path a currency's own rail serves, derived here independently of the
 * form's `RAIL_PATHS` table.
 *
 * Deriving matters: the whole point of the change these tests cover is that
 * one line in the currency table moves every donor to the other rail, so a
 * literal here would turn a working form into a failing test.
 */
function initiatePathFor(currency: string): string {
  const rail = mpesaRailFor(currency);
  expect(rail, `${currency} routes to no M-Pesa rail`).not.toBeNull();
  return `/api/v1/donations/${rail}/initiate`;
}

/**
 * The unresolved screen is found by its CONTROL, not by its prose.
 *
 * ⚠️ My first version matched the heading text, so rewording it failed three
 * tests - the rule pinned today's copy instead of the property (`docs/159`
 * §5.2). "Check again" is a functional requirement, not wording: nothing
 * sweeps `payhero_payment_requests`, so the donor's own re-ask is the only
 * path by which a late settlement is ever discovered. The `failed` screen's
 * button says "Try again", so the two cannot be confused.
 */
function unresolvedScreen() {
  return screen.queryByRole('button', { name: /^Check again$/i });
}

const CAMPAIGN_ID = '11111111-1111-1111-1111-111111111111';

const BACK_TO_CAMPAIGN = { href: '/campaigns/help-wanjiku', label: 'Back to campaign' };

function renderForm(backTo: { href: string; label: string } | null = BACK_TO_CAMPAIGN) {
  return render(
    <MpesaDonationForm
      campaignId={CAMPAIGN_ID}
      campaignTitle="Help Wanjiku"
      backTo={backTo}
      currency="KES"
    />,
  );
}

/**
 * A USD campaign collected over the KES rail - the docs/168 case.
 *
 * The rate is the live production one, 129.901648 KES per USD, with the
 * owner's margin of 0.
 */
const USD_OVER_MPESA = {
  chargeCurrency: 'KES',
  chargeExponent: 2,
  creditExponent: 2,
  rateMicro: 129_901_648,
  marginBps: 0,
  roundUpToMultiple: 100,
} as const;

function renderCrossCurrencyForm() {
  return render(
    <MpesaDonationForm
      campaignId={CAMPAIGN_ID}
      campaignTitle="Help Keisha"
      backTo={BACK_TO_CAMPAIGN}
      currency="USD"
      charge={USD_OVER_MPESA}
    />,
  );
}

const fetchMock = vi.fn();

/** A never-resolving promise, to hold the form mid-submit. */
function pending<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function initiateOk(reference = 'LD-abc') {
  return {
    ok: true,
    json: async () => ({ ok: true, data: { reference, maskedPhone: '•••• 703' } }),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/M-Pesa number/i), '0713572703');
  await user.type(screen.getByLabelText(/^Email$/i), 'donor@example.com');
  // Anchored: an unanchored /Ksh 50/ also matches the "Ksh 500" tile.
  await user.click(screen.getByRole('button', { name: /K(sh|ES)\s*50$/i }));
}

describe('amounts are shillings', () => {
  it('renders the preset ladder in KES, never in dollars', () => {
    renderForm();
    const tiles = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    const ladder = tiles.filter((t) => /K(sh|ES)/.test(t));

    expect(ladder.length).toBeGreaterThanOrEqual(6);
    for (const tile of ladder) expect(tile).not.toContain('$');
  });

  it('bottoms the ladder out at the platform floor, so the smallest tile is payable', () => {
    renderForm();
    expect(screen.getByRole('button', { name: /K(sh|ES)\s*50$/i })).toBeTruthy();
  });

  it('shows no dollar sign anywhere on the form', () => {
    const { container } = renderForm();
    expect(container.textContent).not.toContain('$');
  });

  it('states the fee ledger with a zero platform fee', () => {
    const { container } = renderForm();

    // The 0% line IS a claim (`docs/59`), so its wording stays pinned.
    expect(screen.getByText(/LastDonor platform fee/i)).toBeTruthy();

    /*
      ⚠️ The total row is found STRUCTURALLY - the last <dt> in the ledger -
      and not by its label. This line read /Total charged today/i and broke
      when that copy was corrected (`docs/175`): the row's LABEL is not a
      claim, the fee line above it is, and pinning copy that is free to
      change is what `docs/161` §6.1 had to undo in four of its own tests.
    */
    const dl = container.querySelector('dl');
    const terms = dl ? Array.from(dl.querySelectorAll('dt')) : [];
    expect(terms.length, 'the ledger lost its rows').toBeGreaterThanOrEqual(3);
    const total = terms[terms.length - 1];
    expect(total.textContent?.trim(), 'the total row has no label').toBeTruthy();
    expect(total.nextElementSibling?.textContent, 'the total row states no figure').toMatch(
      /Ksh/,
    );
  });
});

describe('bounds', () => {
  it('refuses to submit below the floor and says the real range', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Or enter an amount/i), '10');
    await user.type(screen.getByLabelText(/M-Pesa number/i), '0713572703');
    await user.type(screen.getByLabelText(/^Email$/i), 'donor@example.com');

    expect(screen.getByText(/Enter between/i).textContent).toMatch(/50/);
    expect(screen.getByRole('button', { name: /Enter an amount to continue/i })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an amount above the M-Pesa per-transaction limit', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Or enter an amount/i), '250001');
    expect(screen.getByText(/Enter between/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps submit disabled without a phone number', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: /K(sh|ES)\s*50$/i }));
    await user.type(screen.getByLabelText(/^Email$/i), 'donor@example.com');

    expect(screen.getByRole('button', { name: /Send M-Pesa request/i })).toBeDisabled();
  });
});

describe('the double-tap latch', () => {
  /*
   * The reason this is a `useRef` and not state: React state is not
   * synchronous, so two clicks in the same tick both read the old value. Two
   * prompts on one handset is both confusing and two of the ten unanswered
   * pushes that get the donor's number blocked for a day.
   */
  it('sends exactly one request when the button is tapped twice', async () => {
    const user = userEvent.setup();
    const held = pending<unknown>();
    fetchMock.mockReturnValue(held.promise);

    renderForm();
    await fillValidForm(user);

    const button = screen.getByRole('button', { name: /Send M-Pesa request/i });
    await user.click(button);
    await user.click(button);
    await user.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    /*
      ⚠️ DERIVED, not the literal this line used to hold. The form picks its
      rail from the currency table now, so a hardcoded `payhero` path here
      would fail the day the owner points KES at Palpluss - reporting a
      correct form as broken. `which rail the form drives` below is where
      that choice is actually under test.
    */
    expect(fetchMock.mock.calls[0][0]).toBe(initiatePathFor('KES'));

    await act(async () => { held.resolve(initiateOk()); });
  });

  it('posts the amount in minor units and the typed phone number', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(initiateOk());

    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      campaignId: CAMPAIGN_ID,
      amount: 5_000, // KES 50.00 in minor units
      phone: '0713572703',
      donorEmail: 'donor@example.com',
    });
    // An STK push is a single authorised debit, not a mandate.
    expect(body.isRecurring).toBeUndefined();
  });
});

describe('the waiting screen', () => {
  it('tells the donor to look at their phone, first', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(initiateOk());

    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    await waitFor(() => expect(screen.getByText(/Check your phone/i)).toBeTruthy());
    // The amount is restated with the instruction, in shillings.
    expect(screen.getByText(/Enter your M-Pesa PIN/i)).toBeTruthy();
  });

  it('is announced to assistive technology as a live status', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(initiateOk());

    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    await waitFor(() => {
      const status = screen.getByRole('status');
      expect(status.getAttribute('aria-live')).toBe('polite');
    });
  });

  it('warns against starting a second payment', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(initiateOk());

    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    await waitFor(() =>
      expect(screen.getByText(/Do not start another payment/i)).toBeTruthy(),
    );
  });

  it('shows an elapsed count rather than a progress bar', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(initiateOk());

    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    // A progress bar would be a lie: we do not know how long the donor will
    // take, and the prompt lifetime itself is still an assumption.
    await waitFor(() => expect(screen.getByText(/Waiting for your confirmation/i)).toBeTruthy());
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('polls the status endpoint with our own reference', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/initiate')) return Promise.resolve(initiateOk('LD-xyz'));
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, data: { state: 'pending', keepPolling: true, message: null } }),
      });
    });

    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    await waitFor(() => {
      const polls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/status'));
      expect(polls.length).toBeGreaterThanOrEqual(1);
      expect(String(polls[0][0])).toContain('reference=LD-xyz');
    });
  });
});

describe('outcomes', () => {
  it('shows a receipt-shaped thank-you on success', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/initiate')) return Promise.resolve(initiateOk());
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, data: { state: 'succeeded', keepPolling: false, message: null } }),
      });
    });

    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    await waitFor(() => expect(screen.getByText(/your donation is in/i)).toBeTruthy());
    // The M-Pesa SMS is the donor's own proof; say so rather than implying
    // ours is the only record.
    expect(screen.getByText(/M-Pesa confirmation message is your receipt/i)).toBeTruthy();
  });

  /*
   * PayHero collapses cancelled, expired and insufficient-funds into one
   * value, FAILED. Naming one of them would be inventing a reason the donor
   * may know to be wrong, and being told the wrong reason is worse than being
   * told none.
   */
  it('does not assert a single cause on failure', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/initiate')) return Promise.resolve(initiateOk());
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            state: 'failed',
            keepPolling: false,
            message: 'The payment did not go through. Nothing has been charged.',
          },
        }),
      });
    });

    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const alert = screen.getByRole('alert').textContent ?? '';

    expect(alert).toMatch(/nothing has been charged/i);
    // Offered as possibilities, not as the reason.
    expect(alert).toMatch(/usually means/i);
    expect(alert).toMatch(/cancelled/i);
    expect(alert).toMatch(/timed out/i);
    expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy();
  });

  /*
    `reversed` - the Palpluss rail's own terminal state (`docs/181` §3.4).
    Money moved and came back, so this screen sits between the two it must not
    become: the failed screen (which says nothing was charged, and then offers
    three causes none of which is a reversal) and the unrecorded one (which
    opens "your payment went through" and stops there).
  */
  it('reports a reversal as its own outcome, claiming neither failure nor success', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/initiate')) return Promise.resolve(initiateOk());
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            state: 'reversed',
            keepPolling: false,
            // The route's own wording.
            message:
              'The money left your account and was sent back. No donation was recorded.',
          },
        }),
      });
    });

    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    /*
      ⚠️ Found via the alert region, not via the text. Matching /sent back/i
      directly threw "Found multiple elements" - the heading and the message
      both say it, which is the screen reading correctly.
    */
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toMatch(/sent back/i);

    // ⛔ Something WAS charged, so docs/158's reassurance would be false.
    expect(alert).not.toMatch(/nothing (?:has been|was) charged/i);
    // ⛔ And no donation exists, so nobody is thanked for one.
    expect(alert).not.toMatch(/thank you|your donation is in/i);
    // ⛔ The failed screen's three causes are all false of a reversal.
    expect(alert).not.toMatch(/usually means|cancelled|timed out/i);
    // ⛔ No turnaround and no date: the reversal is the rail's, not ours.
    expect(alert).not.toMatch(/business days|\d+\s*days/i);
    // It points at the one record that can settle it, and offers a human.
    expect(alert).toMatch(/M-Pesa messages/i);
    expect(alert).toMatch(/support@lastdonor\.org/i);
    // Net nothing was taken, so retrying cannot double-pay - unlike the
    // unrecorded screen, which deliberately offers no retry.
    expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy();
  });

  it('CONTROL: a reversal is not shown as the unresolved screen', async () => {
    /*
      ⛔ The regression this is really about. Before the `reversed` branch
      existed the state fell through to `keepPolling === false` and rendered
      "We could not confirm this payment" - about an outcome the server had
      just confirmed precisely. That screen is identified by its "Check
      again" control (`docs/159` §5.2: by the property, not the prose).
    */
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/initiate')) return Promise.resolve(initiateOk());
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          data: { state: 'reversed', keepPolling: false, message: null },
        }),
      });
    });

    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(unresolvedScreen(), 'a reversal rendered the unresolved screen').toBeNull();
    // And with no server message it still says what happened, from its own
    // fallback rather than silence.
    expect(screen.getByRole('alert').textContent).toMatch(/sent back/i);
  });

  it('lets the donor retry after a failure, and sends exactly one new request', async () => {
    const user = userEvent.setup();
    let initiates = 0;
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/initiate')) {
        initiates += 1;
        return Promise.resolve(initiateOk(`LD-${initiates}`));
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          data: { state: 'failed', keepPolling: false, message: 'The payment did not go through.' },
        }),
      });
    });

    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /Try again/i }));

    // Back on the form with the latch released, not stuck.
    expect(screen.getByLabelText(/M-Pesa number/i)).toBeTruthy();
    expect(initiates).toBe(1);
  });

  it('surfaces the server message when initiation is refused', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'There is already an M-Pesa request waiting on this number.',
        },
      }),
    });

    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    await waitFor(() =>
      expect(screen.getByText(/already an M-Pesa request waiting/i)).toBeTruthy(),
    );
    // Stays on the form so the donor can act, and the latch is released.
    expect(screen.getByLabelText(/M-Pesa number/i)).toBeTruthy();
  });

  it('says nothing was charged when the network fails', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new Error('offline'));

    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    await waitFor(() =>
      expect(screen.getByText(/nothing has been charged/i)).toBeTruthy(),
    );
  });
});

// ─── The unknown outcome: the one refusal that must not invite a retry ──────

describe('an unknown payment outcome latches the pay button', () => {
  /*
    `docs/158`. The server answers PAYMENT_OUTCOME_UNKNOWN when the gateway
    never replied, and its message ends "Please do not send it again until you
    have checked" - while the refusal walk measured the pay button still
    ENABLED directly beneath it. An instruction and its opposite in one
    viewport, and a blind retry there is how somebody pays twice.
  */
  function refusal(code: string, message: string) {
    return { ok: false, status: 503, json: async () => ({ ok: false, error: { code, message } }) };
  }

  const UNKNOWN_MESSAGE =
    'We lost contact with M-Pesa while starting your payment, so we cannot tell you whether ' +
    'it went through. Please do not send it again until you have checked.';

  it('⛔ disables the pay button and asks the donor to confirm first', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(refusal('PAYMENT_OUTCOME_UNKNOWN', UNKNOWN_MESSAGE));
    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot tell you whether/i);
    expect(screen.getByRole('button', { name: /Send M-Pesa request/i })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /checked my M-Pesa messages/i })).toBeInTheDocument();
  });

  it('re-enables it only once they say they checked', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(refusal('PAYMENT_OUTCOME_UNKNOWN', UNKNOWN_MESSAGE));
    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));
    await user.click(screen.getByRole('checkbox', { name: /checked my M-Pesa messages/i }));

    expect(screen.getByRole('button', { name: /Send M-Pesa request/i })).toBeEnabled();
  });

  it('⚠️ ANTI-VACUITY: another refusal does NOT latch it', async () => {
    /*
      Without this the rule is satisfied by latching on every error, which
      would put a confirmation in front of donors whose money we know was
      never touched - the cap refusal, for one, is decided before the gateway
      is called at all.
    */
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      refusal(
        'CAP_EXCEEDED',
        'This campaign can accept up to Ksh 50,000.00 before the organiser’s ID is ' +
          'checked. Nothing has been charged.',
      ),
    );
    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/up to Ksh 50,000/i);
    expect(screen.getByRole('button', { name: /Send M-Pesa request/i })).toBeEnabled();
    expect(screen.queryByRole('checkbox', { name: /checked my M-Pesa messages/i })).toBeNull();
  });
});

// ─── The poll must stop. docs/159. ─────────────────────────────────────────

describe('the poll has a stop condition', () => {
  /*
    The server computes `keepPolling: false` once the prompt can no longer be
    live (`status/route.ts:194`) precisely to end the loop, and the client read
    the field and used it only to set a message. The effect's cleanup depends
    on `phase`/`reference`/`poll`, none of which change, so the 5s interval ran
    for as long as the tab stayed open - and each poll of a still-`pending` row
    makes a fresh outbound `getTransactionStatus` call (`settlement:105`, which
    has no age guard). [VERIFIED in a real browser too: 5 polls in 26s after
    the stop signal, screen still reading "Waiting for your confirmation 28s".]
  */
  function body(data: Record<string, unknown>) {
    return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
  }
  const LIVE = body({ state: 'pending', amount: 5000, currency: 'KES', keepPolling: true, message: null });
  const EXPIRED = body({
    state: 'pending', amount: 5000, currency: 'KES', keepPolling: false,
    message: 'We have not heard back about this payment.',
  });
  const SERVER_ERROR = {
    ok: false, status: 500,
    json: async () => ({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'nope' } }),
  };

  let statusCalls = 0;
  let statusResponse: unknown = LIVE;

  function route() {
    statusCalls = 0;
    statusResponse = LIVE;
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/status')) {
        statusCalls += 1;
        return Promise.resolve(statusResponse);
      }
      return Promise.resolve(initiateOk());
    });
  }

  /** Reach the waiting screen with a LIVE prompt, as a real donor does. */
  async function toWaiting() {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));
    await vi.advanceTimersByTimeAsync(100);
    expect(screen.getByText(/Check your phone/i)).toBeTruthy();
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    route();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('⛔ stops once the server says the prompt can no longer be live', async () => {
    await toWaiting();
    await vi.advanceTimersByTimeAsync(10_000); // two live polls
    expect(statusCalls, 'should be polling a live prompt').toBeGreaterThan(1);

    statusResponse = EXPIRED;
    await vi.advanceTimersByTimeAsync(6_000); // it sees the stop signal
    const atStop = statusCalls;

    await vi.advanceTimersByTimeAsync(120_000); // two more minutes
    expect(
      statusCalls - atStop,
      `kept polling ${statusCalls - atStop} more times after keepPolling:false. The ` +
        'server sends that field to end the loop, and each poll of a pending row also ' +
        'hits PayHero again.',
    ).toBe(0);
    expect(unresolvedScreen(), 'the unresolved screen must be shown').toBeTruthy();
  });

  it('⛔ is bounded even when the server never says to stop', async () => {
    /*
      No assumption about PayHero's timing is needed here: the settlement
      service has NO try/catch, so an unreachable provider throws through to
      the route's catch and answers 500 - and a 500 carries no `keepPolling`
      to obey. Without a ceiling this is an unbounded request loop from every
      open tab.
    */
    await toWaiting();
    statusResponse = SERVER_ERROR;
    await vi.advanceTimersByTimeAsync(20 * 60_000); // twenty minutes
    expect(
      statusCalls,
      `made ${statusCalls} polls in twenty minutes; the ceiling is ${36 + 12}`,
    ).toBeLessThanOrEqual(MAX_POLL_ATTEMPTS_EXPECTED);
    expect(unresolvedScreen(), 'the unresolved screen must be shown').toBeTruthy();
  });

  it('⚠️ ANTI-VACUITY: a live prompt is still polled, and absence is not a stop', async () => {
    /*
      Without this the fix is satisfied by never polling at all. The second
      half pins the `=== false` decision: a payload that OMITS keepPolling is
      an unexpected shape, not an instruction to stop, and three pre-existing
      waiting-screen tests (whose mock answers the status poll with an INITIATE
      payload) are exactly that case.
    */
    await toWaiting();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(statusCalls, 'a live prompt must keep being polled').toBeGreaterThan(4);
    expect(unresolvedScreen()).toBeNull();

    statusResponse = body({ state: 'pending', amount: 5000, currency: 'KES' });
    const before = statusCalls;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(
      statusCalls - before,
      'a payload with no keepPolling field must not be read as "stop"',
    ).toBeGreaterThan(1);
  });

  it('⛔ the unresolved screen claims nothing about the money', async () => {
    /*
      `docs/158`'s rule on this screen: the row is still `pending` server-side
      and PayHero may yet settle it, so this is the one place that must NOT
      reassure and must not condemn. The property, not the wording - a reword
      is fine, a claim is not.
    */
    /*
      ⚠️ BOTH paths. The screen renders the server's own message when there is
      one and its own fallback when there is not, and the ceiling path passes
      `null` - so a reassurance planted in the fallback is invisible to a test
      that only drives the expiry path. An injection writing "nothing has been
      charged" into that fallback did NOT fire against the first version of
      this test (`docs/159` §5.2).
    */
    for (const [name, resp, wait] of [
      ['server said the prompt is dead', EXPIRED, 6_000],
      ['the client hit its own ceiling', SERVER_ERROR, 20 * 60_000],
    ] as const) {
      cleanup();
      route();
      await toWaiting();
      statusResponse = resp;
      await vi.advanceTimersByTimeAsync(wait);
      expect(unresolvedScreen(), `${name}: screen must be shown`).toBeTruthy();
      assertClaimsNothing(name);
    }
  });

  function assertClaimsNothing(name: string) {
    const text = document.body.textContent ?? '';
    for (const claim of [
      /nothing has been charged/i,
      /did not go through/i,
      /was not charged/i,
      /payment failed/i,
      /we sent your money back/i,
    ]) {
      expect(claim.test(text), `${name}: must not claim ${claim}`).toBe(false);
    }
    // And it must say what to do instead, or it is merely silent.
    expect(/M-Pesa messages/i.test(text), `${name}: must point at their own records`).toBe(true);
    expect(/paying again pays twice/i.test(text), `${name}: must warn against paying twice`).toBe(true);
  }

  it('⛔ the ceiling must outlast the prompt, whatever the prompt becomes', () => {
    /*
      The invariant: a ceiling below PROMPT_LIFETIME_MS / POLL_INTERVAL_MS
      abandons a donor who is still typing their PIN.

      ⚠️ This reads the component's OWN constant and derives the requirement
      from the SHARED one. Recomputing the same expression here would compare
      the arithmetic with itself - it would pass against any ceiling, however
      wrong, and fail the day PROMPT_LIFETIME_MS legitimately changes. The
      harness caught exactly that: halving the prompt lifetime failed a test
      that had pinned 36 (`docs/159` §5.2).
    */
    const pollsToCoverPrompt = Math.ceil(PROMPT_LIFETIME_MS / POLL_INTERVAL_MS);
    expect(pollsToCoverPrompt, 'sanity: the prompt must span several polls').toBeGreaterThan(2);
    expect(
      MAX_POLL_ATTEMPTS,
      `ceiling ${MAX_POLL_ATTEMPTS} does not outlast the ${pollsToCoverPrompt} polls a live ` +
        'prompt needs, so the browser would give up while the prompt is still answerable',
    ).toBeGreaterThan(pollsToCoverPrompt);
  });
});

/*
  ── THE DONOR MUST SEE WHAT LEAVES THEIR PHONE (docs/168) ─────────────────

  A USD campaign is now collectable over the M-Pesa rail, which charges
  shillings. The donor enters the amount in the campaign's currency, as
  GoFundMe does, so the campaign is credited exactly what they chose - but
  the figure on the button they press has to be the one their handset will
  be debited, or the form says "$5.00" while Ksh 650.00 leaves the account.
*/
describe('a USD campaign collected over the KES rail', () => {
  it('states the M-Pesa charge on the pay button, not the campaign amount', async () => {
    const user = userEvent.setup();
    renderCrossCurrencyForm();

    // $5.00, the USD floor. 5 x 129.901648 = 649.51, rounded UP to a whole
    // shilling because PayHero refuses fractions.
    await user.type(screen.getByLabelText(/Or enter an amount/i), '5');

    const pay = await screen.findByRole('button', { name: /Send M-Pesa request/i });
    expect(pay).toHaveTextContent(/Ksh\s*650\.00/);
    /*
      ⛔ CONTROL. Without this the assertion passes against a button that
      happens to contain "Ksh 650.00" somewhere alongside the dollar figure,
      which would still be two amounts in two currencies on one control.
    */
    expect(pay).not.toHaveTextContent(/\$\s*5\.00/);
  });

  it('discloses the rate and that there is no margin', async () => {
    const user = userEvent.setup();
    renderCrossCurrencyForm();
    await user.type(screen.getByLabelText(/Or enter an amount/i), '5');

    expect(
      await screen.findByText(/129\.90 KES per USD/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/no conversion margin/i)).toBeInTheDocument();
  });

  it('still credits the campaign in ITS currency - the donation line stays USD', async () => {
    const user = userEvent.setup();
    renderCrossCurrencyForm();
    await user.type(screen.getByLabelText(/Or enter an amount/i), '5');

    // "Your donation" is what the campaign receives, in the campaign's money.
    const donation = screen.getByText('Your donation').closest('div');
    expect(donation).toHaveTextContent(/\$\s*5\.00/);
  });

  /*
    ⛔ CONTROL for the whole block: a same-currency campaign must be
    unchanged. Without it, "the button shows Ksh" would also pass if the
    form had simply been hardcoded to shillings for everyone.
  */
  it('CONTROL: a KES campaign is unaffected and discloses no conversion', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/Or enter an amount/i), '50');

    const pay = await screen.findByRole('button', { name: /Send M-Pesa request/i });
    expect(pay).toHaveTextContent(/Ksh\s*50\.00/);
    expect(screen.queryByText(/conversion margin/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/KES per/i)).not.toBeInTheDocument();
  });
});

/**
 * Which rail the form drives.
 *
 * ⛔ THE INVARIANT: the rail that charges is the rail whose currency is on the
 * pay button. The form derives it from the BILLED currency - the same value it
 * prints - so the figure the donor agreed to and the API that takes it cannot
 * come apart.
 *
 * ⚠️ These are behavioural on purpose. `mpesa-rail.test.ts` can read that the
 * form contains `mpesaRailFor(billedCurrency)`, but `mpesaRailFor(currency)`
 * compiles, reads just as sensibly, and differs only in that it sends every
 * cross-currency donor to a refusal screen - so the distinction is invisible
 * to any structural rule and has to be driven (`docs/162` §5.1).
 */
describe('which rail the form drives', () => {
  function renderUnsupportedRail() {
    // A card campaign with no M-Pesa quote: nothing here can be collected
    // over a handset, which is the one state `paths` is null in.
    return render(
      <MpesaDonationForm
        campaignId={CAMPAIGN_ID}
        campaignTitle="Help Keisha"
        backTo={BACK_TO_CAMPAIGN}
        currency="USD"
      />,
    );
  }

  it('posts to the rail its own currency routes to', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(initiateOk());

    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    expect(fetchMock.mock.calls[0][0]).toBe(initiatePathFor('KES'));
  });

  it('⛔ a USD campaign charged in shillings posts to the SHILLING rail', async () => {
    /*
      ⛔ THE DISCRIMINATING CASE. The campaign is USD, which routes to the card
      rail, and the charge is KES. If the rail were taken from the CAMPAIGN's
      currency this form would resolve no rail at all, render the refusal
      below, and never call anything - so this test distinguishes the two
      spellings where no text rule can.
    */
    const user = userEvent.setup();
    /*
      ⚠️ Held mid-submit, as the double-tap test does. With a resolved
      `initiateOk()` the form reaches the waiting screen and its first poll
      fires, so `toHaveBeenCalledTimes(1)` saw two calls - the form working,
      and my assertion counting the wrong thing.
    */
    const held = pending<unknown>();
    fetchMock.mockReturnValue(held.promise);

    renderCrossCurrencyForm();
    await user.type(screen.getByLabelText(/Or enter an amount/i), '5');
    await user.type(screen.getByLabelText(/M-Pesa number/i), '0713572703');
    await user.type(screen.getByLabelText(/^Email$/i), 'donor@example.com');
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(initiatePathFor('KES'));

    await act(async () => { held.resolve(initiateOk()); });
  });

  it('polls the status route of the SAME rail it initiated on', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('/initiate')
          ? initiateOk()
          : {
              ok: true,
              json: async () => ({
                ok: true,
                data: { state: 'pending', keepPolling: true, message: null },
              }),
            },
      ),
    );

    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Send M-Pesa request/i }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/status'))).toBe(true),
    );
    const statusCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/status'))!;
    const initiated = String(fetchMock.mock.calls[0][0]);
    expect(String(statusCall[0]).split('?')[0]).toBe(initiated.replace('/initiate', '/status'));
  });

  it('⛔ refuses, and asks for nothing, when no rail collects the billed currency', async () => {
    /*
      Fail closed. Both render sites gate on the same derivation so this
      should be unreachable - but a form that cannot be paid is better than
      one whose submit the server refuses after the donor has typed their
      number and email.
    */
    renderUnsupportedRail();

    /*
      ⚠️ Identified by its PROPERTY - an announced refusal with no fields to
      fill - and not by its wording. My first version matched the copy, which
      is `docs/160` §5.2's mistake: the words are free to improve, and what
      must not change is that nothing can be submitted.
    */
    expect(screen.getByRole('alert').textContent?.length).toBeGreaterThan(20);
    expect(screen.queryByRole('button', { name: /Send M-Pesa request/i })).toBeNull();
    expect(screen.queryByLabelText(/M-Pesa number/i)).toBeNull();
    expect(screen.queryByLabelText(/Or enter an amount/i)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CONTROL: the refusal is not shown for a currency a rail does collect', () => {
    /*
      ⛔ Without this, hiding the form for EVERYBODY would satisfy the rule
      above - and the two campaigns differ only in their currency.
    */
    /*
      ⚠️ Checked by the FIELDS, the exact inverse of the rule above. My first
      version looked for the pay button and failed: with no amount entered yet
      it is labelled "Enter an amount to continue", so that assertion could
      not have passed on a working form either.
    */
    renderForm();
    expect(screen.getByLabelText(/M-Pesa number/i)).toBeTruthy();
    expect(screen.getByLabelText(/^Email$/i)).toBeTruthy();
    expect(screen.queryByRole('alert'), 'the form rendered a refusal').toBeNull();
  });
});

/**
 * Round up at the moment of giving.
 *
 * `round-up.test.ts` proves the arithmetic. These prove the CONTROL IS
 * WIRED: that pressing it moves the amount the form will actually post, and
 * therefore the figure on the pay button. A correct decider that nothing
 * calls is the defect `docs/170` §11.4 is named for.
 */
describe('round up at the moment of giving', () => {
  function amountInput() {
    return screen.getByLabelText(/Or enter an amount/i);
  }
  function payButton() {
    return screen.getByRole('button', { name: /Send M-Pesa request|Enter an amount/i });
  }
  function roundUpButton() {
    return screen.queryByRole('button', { name: /^Round up to/i });
  }

  it('offers the next round figure and moves the amount when taken', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(amountInput(), '650');

    const offer = roundUpButton();
    expect(offer).toBeTruthy();
    expect(offer).toHaveTextContent(/K(sh|ES)\s*700\.00/);

    await user.click(offer!);

    // The amount the form will POST moved, and so did the pay button.
    expect(amountInput()).toHaveValue(700);
    expect(payButton()).toHaveTextContent(/Ksh\s*700\.00/);
  });

  it('ANTI-VACUITY: offers nothing on a figure already round', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(amountInput(), '700');
    expect(roundUpButton()).toBeNull();
  });

  /*
    ⛔ The floor tile must never be offered a round-up. Ksh 50.00 is not a
    multiple of Ksh 100.00, so the bare arithmetic offered to DOUBLE the
    smallest gift the platform accepts — aimed at the donor who chose the
    cheapest tile. Caught by a test, fixed in `roundUpOffer`, pinned here in
    the DOM because that is where the nudge would have appeared.
  */
  it('never offers to round up the floor preset', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: /K(sh|ES)\s*50$/i }));
    expect(roundUpButton()).toBeNull();
  });

  it('rounds the CREDIT in the campaign currency, and the charge re-derives', async () => {
    const user = userEvent.setup();
    renderCrossCurrencyForm();
    await user.type(amountInput(), '5.40');

    // The offer is in USD - what the campaign is credited.
    const offer = roundUpButton();
    expect(offer).toBeTruthy();
    expect(offer).toHaveTextContent(/\$\s*6\.00/);

    await user.click(offer!);

    /*
      $6.00 at 129.901648 is Ksh 779.41, rounded up to the whole shilling
      PayHero takes: Ksh 780.00. The donor pays the converted figure; the
      campaign is credited the $6.00 they chose. Had the control rounded the
      CHARGE instead, the credit would still read $5.40 and the difference
      would be platform margin (docs/168).
    */
    expect(payButton()).toHaveTextContent(/Ksh\s*780\.00/);
    expect(payButton()).not.toHaveTextContent(/\$\s*6\.00/);
  });
});
