import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const openAiCtor = vi.fn();

vi.mock('openai', () => ({
  default: class {
    constructor(opts: Record<string, unknown>) {
      openAiCtor(opts);
    }
  },
}));

const ORIGINAL_ENV = { ...process.env };

async function loadOpenrouter() {
  vi.resetModules();
  const mod = await import('./openrouter');
  mod.__resetAiClientsForTests();
  openAiCtor.mockClear();
  return mod;
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'primary-key';
  process.env.OPENROUTER_API_KEY_FALLBACK = 'fallback-key';
  delete process.env.AI_REQUEST_TIMEOUT_MS;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('OpenRouter client bounds (P1-12)', () => {
  it('bounds the primary client with a timeout and no SDK retries', async () => {
    const mod = await loadOpenrouter();

    // The Proxy is lazy; touching it constructs the client.
    void mod.ai.chat;

    expect(openAiCtor).toHaveBeenCalledTimes(1);
    const opts = openAiCtor.mock.calls[0][0];
    // Without these, openai@6 defaults apply: a 10-MINUTE timeout and 2
    // internal retries, which silently tripled every attempt in call-ai.ts.
    expect(opts.timeout).toBe(mod.AI_REQUEST_TIMEOUT_MS);
    expect(opts.timeout).toBeLessThanOrEqual(120_000);
    expect(opts.maxRetries).toBe(0);
  });

  it('bounds the fallback-key client identically', async () => {
    const mod = await loadOpenrouter();

    const fallback = mod.getAiFallbackClient();
    expect(fallback).not.toBeNull();

    const opts = openAiCtor.mock.calls[0][0];
    expect(opts.timeout).toBe(mod.AI_REQUEST_TIMEOUT_MS);
    expect(opts.maxRetries).toBe(0);
  });

  it('preserves the fallback-key behaviour and the model ladder', async () => {
    const mod = await loadOpenrouter();

    // Construct the primary first so call[0] is the primary client.
    void mod.ai.chat;

    // Both are intentional and must survive the transport fix.
    expect(mod.getAiFallbackClient()).not.toBeNull();
    expect(mod.PRIMARY_MODEL).toBeTruthy();
    expect(mod.FALLBACK_MODEL).toContain(':free');
    expect(mod.TERTIARY_MODEL).toContain(':free');

    // Routing stays on OpenRouter, and auth/attribution headers are untouched.
    const opts = openAiCtor.mock.calls[0][0];
    expect(opts.baseURL).toBe('https://openrouter.ai/api/v1');
    expect(opts.apiKey).toBe('primary-key');
    expect(opts.defaultHeaders).toMatchObject({ 'X-Title': 'LastDonor.org' });
  });

  it('returns null for the fallback client when no second key is set', async () => {
    delete process.env.OPENROUTER_API_KEY_FALLBACK;
    const mod = await loadOpenrouter();
    expect(mod.getAiFallbackClient()).toBeNull();
  });

  it('honours AI_REQUEST_TIMEOUT_MS within a sane clamp', async () => {
    process.env.AI_REQUEST_TIMEOUT_MS = '15000';
    const mod = await loadOpenrouter();
    expect(mod.AI_REQUEST_TIMEOUT_MS).toBe(15_000);
  });

  it('clamps a timeout that would outlive the shortest cron budget', async () => {
    process.env.AI_REQUEST_TIMEOUT_MS = '600000'; // the openai@6 default
    const mod = await loadOpenrouter();
    // maxDuration is 120s on the tightest route; one request may never exceed it.
    expect(mod.AI_REQUEST_TIMEOUT_MS).toBe(120_000);
  });

  it('falls back to the default on a garbage timeout value', async () => {
    process.env.AI_REQUEST_TIMEOUT_MS = 'not-a-number';
    const mod = await loadOpenrouter();
    expect(mod.AI_REQUEST_TIMEOUT_MS).toBe(60_000);
  });
});
