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
import { PROMPT_LIFETIME_MS } from '@/lib/payhero-prompt';

const MAX_POLL_ATTEMPTS_EXPECTED = MAX_POLL_ATTEMPTS;

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
    renderForm();
    expect(screen.getByText(/LastDonor platform fee/i)).toBeTruthy();
    expect(screen.getByText(/Total charged today/i)).toBeTruthy();
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
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/donations/payhero/initiate');

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
