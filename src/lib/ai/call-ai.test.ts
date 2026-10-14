import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Stubs ──────────────────────────────────────────────────────────────────

const create = vi.fn();

function fakeClient() {
  return { chat: { completions: { create } } };
}

vi.mock('./openrouter', () => ({
  ai: fakeClient(),
  getAiFallbackClient: () => fakeClient(),
  PRIMARY_MODEL: 'test/primary',
  FALLBACK_MODEL: 'test/secondary:free',
  TERTIARY_MODEL: 'test/tertiary:free',
  AI_REQUEST_TIMEOUT_MS: 60_000,
}));

vi.mock('@/lib/monitoring/ai-cost-tracker', () => ({
  // A plain function, not vi.fn(): restoreAllMocks() between tests would strip
  // a mockResolvedValue and leave callAI calling .catch on undefined.
  logAIUsage: () => Promise.resolve(),
  // $1 per 1k input tokens: makes the spend ceiling reachable in one call.
  estimateCostUsd: (_m: string, inputTokens: number) => inputTokens / 1_000,
}));

vi.mock('@/lib/server-logger', () => ({
  pipelineLog: vi.fn(),
  pipelineError: vi.fn(),
}));

const ORIGINAL_ENV = { ...process.env };

async function loadCallAI() {
  vi.resetModules();
  const mod = await import('./call-ai');
  mod.__resetAiBudgetForTests();
  create.mockClear();
  return mod;
}

/**
 * A non-429 provider error. Chosen deliberately: the 429 branch sleeps 2s
 * between attempts, which would make these tests slow rather than clearer. The
 * ladder rotates on either.
 */
function providerError(): Error & { status: number } {
  return Object.assign(new Error('upstream 503'), { status: 503 });
}

function completion(content: string, inputTokens = 1) {
  return {
    usage: { prompt_tokens: inputTokens, completion_tokens: 1 },
    choices: [{ message: { content }, finish_reason: 'stop' }],
  };
}

/** Make Date.now() controllable without touching timers. */
function installClock() {
  const base = Date.now();
  let offset = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => base + offset);
  return { advance: (ms: number) => { offset += ms; } };
}

beforeEach(() => {
  create.mockReset();
  delete process.env.AI_CALL_DEADLINE_MS;
  delete process.env.AI_MAX_ATTEMPTS_PER_WINDOW;
  delete process.env.AI_MAX_SPEND_USD_PER_WINDOW;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

const PROMPT = { systemPrompt: 's', userPrompt: 'u', parseJson: false as const };

describe('callAI HTTP request ceiling (P1-12)', () => {
  it('issues at most MAX_ATTEMPTS_PER_CALL requests when every model fails', async () => {
    const { callAI, MAX_ATTEMPTS_PER_CALL } = await loadCallAI();
    create.mockRejectedValue(providerError());

    await expect(callAI(PROMPT)).rejects.toThrow();

    // Before the fix the SDK's own maxRetries: 2 sat underneath this ladder, so
    // 8 attempts meant up to 24 HTTP requests. With maxRetries: 0 upstream,
    // attempts and requests are 1:1 and this is a real request budget.
    expect(create.mock.calls.length).toBeLessThanOrEqual(MAX_ATTEMPTS_PER_CALL);
    expect(MAX_ATTEMPTS_PER_CALL).toBeLessThanOrEqual(8);
  });

  it('still succeeds on the first attempt in the happy path', async () => {
    const { callAI } = await loadCallAI();
    create.mockResolvedValue(completion('hello'));

    await expect(callAI(PROMPT)).resolves.toBe('hello');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('still rotates through the ladder to a later model', async () => {
    const { callAI } = await loadCallAI();
    create
      .mockRejectedValueOnce(providerError())
      .mockRejectedValueOnce(providerError())
      .mockResolvedValue(completion('recovered'));

    await expect(callAI(PROMPT)).resolves.toBe('recovered');
    expect(create).toHaveBeenCalledTimes(3);
  });
});

describe('callAI wall-clock deadline (P1-12)', () => {
  it('stops starting attempts once the per-call deadline has passed', async () => {
    // Floored at one request timeout: a deadline below that could never let a
    // single legitimate request finish.
    process.env.AI_CALL_DEADLINE_MS = '60000';
    const { callAI, AI_CALL_DEADLINE_MS } = await loadCallAI();
    expect(AI_CALL_DEADLINE_MS).toBe(60_000);

    const clock = installClock();
    create.mockImplementation(async () => {
      clock.advance(70_000); // one slow request eats the whole deadline
      throw providerError();
    });

    await expect(callAI(PROMPT)).rejects.toThrow(/temporarily unavailable/);

    // Without the deadline the ladder would run all 8 attempts, which at a 60s
    // request timeout is 480s - longer than every caller's maxDuration, so the
    // platform would kill the route mid-write instead of it returning.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not cut short a call that is within its deadline', async () => {
    const { callAI, AI_CALL_DEADLINE_MS } = await loadCallAI();
    expect(AI_CALL_DEADLINE_MS).toBeGreaterThanOrEqual(60_000);

    create
      .mockRejectedValueOnce(providerError())
      .mockResolvedValue(completion('ok'));

    await expect(callAI(PROMPT)).resolves.toBe('ok');
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('callAI per-run runaway ceiling (P1-12)', () => {
  it('refuses to issue any request once the attempt ceiling is reached', async () => {
    process.env.AI_MAX_ATTEMPTS_PER_WINDOW = '8';
    const { callAI } = await loadCallAI();
    create.mockRejectedValue(providerError());

    // First call burns the whole window budget.
    await expect(callAI(PROMPT)).rejects.toThrow();
    const afterFirst = create.mock.calls.length;
    expect(afterFirst).toBe(8);

    // The second call must fail fast without touching the network. This is the
    // runaway case: a provider erroring instantly while a cron loop calls
    // callAI 15 times (publish-campaigns: 3 per story x 5 stories).
    await expect(callAI(PROMPT)).rejects.toThrow(/temporarily unavailable/);
    expect(create.mock.calls.length).toBe(afterFirst);
  });

  it('stops mid-ladder when the ceiling is crossed during a call', async () => {
    process.env.AI_MAX_ATTEMPTS_PER_WINDOW = '3';
    const { callAI } = await loadCallAI();
    create.mockRejectedValue(providerError());

    await expect(callAI(PROMPT)).rejects.toThrow(/temporarily unavailable/);
    expect(create.mock.calls.length).toBe(3);
  });

  it('counts a request that throws, not just one that succeeds', async () => {
    const { callAI, getAiBudgetSnapshot } = await loadCallAI();
    create.mockRejectedValue(providerError());

    await expect(callAI(PROMPT)).rejects.toThrow();
    // A provider that errors or times out on every attempt must still consume
    // budget, or the breaker never trips in the outage it exists for.
    expect(getAiBudgetSnapshot().windowAttempts).toBe(create.mock.calls.length);
  });

  it('enforces an estimated-spend ceiling on paid models', async () => {
    process.env.AI_MAX_SPEND_USD_PER_WINDOW = '0.5';
    const { callAI, getAiBudgetSnapshot } = await loadCallAI();
    // 600 input tokens => $0.60 estimated, over the $0.50 ceiling.
    create.mockResolvedValue(completion('ok', 600));

    await expect(callAI(PROMPT)).resolves.toBe('ok');
    expect(getAiBudgetSnapshot().windowSpendUsd).toBeCloseTo(0.6, 5);

    await expect(callAI(PROMPT)).rejects.toThrow(/temporarily unavailable/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('charges nothing for :free models, so the free pool is not throttled', async () => {
    process.env.AI_MAX_SPEND_USD_PER_WINDOW = '0.5';
    const { callAI, getAiBudgetSnapshot } = await loadCallAI();
    // Primary (paid) fails on both keys; the ladder lands on a :free model.
    create
      .mockRejectedValueOnce(providerError())
      .mockRejectedValueOnce(providerError())
      .mockResolvedValue(completion('free', 5_000));

    await expect(callAI(PROMPT)).resolves.toBe('free');
    expect(getAiBudgetSnapshot().windowSpendUsd).toBe(0);
  });

  it('exposes the ceilings for monitoring', async () => {
    const { getAiBudgetSnapshot } = await loadCallAI();
    const snapshot = getAiBudgetSnapshot();
    expect(snapshot.maxAttemptsPerWindow).toBeGreaterThan(0);
    expect(snapshot.maxSpendUsdPerWindow).toBeGreaterThan(0);
  });
});
