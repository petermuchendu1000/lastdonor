import { describe, it, expect, vi } from 'vitest';
import { retryWithBackoff } from './retry';

/**
 * Regression tests for audit docs/29 P0-4, link 2 of 4.
 *
 * `retryWithBackoff` only reacted to thrown errors, so against an SDK that
 * resolves `{ data: null, error }` instead of throwing (Resend does exactly
 * this, including from inside its own catch block) it performed exactly ONE
 * attempt and reported nothing.
 */

type ResendLike = { data: null | { id: string }; error: null | { name: string; message: string } };

const rateLimited: ResendLike = { data: null, error: { name: 'rate_limit_exceeded', message: 'Too many requests' } };
const sent: ResendLike = { data: { id: 'email_1' }, error: null };

describe('retryWithBackoff - thrown errors (pre-existing contract)', () => {
  it('retries a throwing function up to maxRetries and then rethrows', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(
      retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 0 }),
    ).rejects.toThrow('boom');

    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('returns as soon as a throwing function recovers', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('ok');

    await expect(retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('honours shouldRetry and rethrows immediately when it returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('permanent'));

    await expect(
      retryWithBackoff(fn, { maxRetries: 5, baseDelayMs: 0, shouldRetry: () => false }),
    ).rejects.toThrow('permanent');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('makes exactly one attempt for a resolved value when no isFailure predicate is given', async () => {
    // This is the behaviour that hid the receipt failures: a resolved
    // result-shaped error is indistinguishable from success without a
    // predicate, so callers MUST opt in.
    const fn = vi.fn().mockResolvedValue(rateLimited);

    await expect(retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 0 })).resolves.toBe(rateLimited);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('retryWithBackoff - result-shaped failures (isFailure)', () => {
  it('retries a resolved failure value maxRetries times', async () => {
    const fn = vi.fn<() => Promise<ResendLike>>().mockResolvedValue(rateLimited);

    const result = await retryWithBackoff(fn, {
      maxRetries: 2,
      baseDelayMs: 0,
      isFailure: (r) => Boolean(r.error),
    });

    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    // The last failing value is RETURNED, not thrown, so callers keep using
    // the SDK's own { data, error } contract.
    expect(result).toBe(rateLimited);
  });

  it('stops retrying as soon as the predicate reports success', async () => {
    const fn = vi
      .fn<() => Promise<ResendLike>>()
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValue(sent);

    const result = await retryWithBackoff(fn, {
      maxRetries: 4,
      baseDelayMs: 0,
      isFailure: (r) => Boolean(r.error),
    });

    expect(fn).toHaveBeenCalledTimes(2);
    expect(result).toBe(sent);
  });

  it('still returns the value on the first attempt when the predicate says success', async () => {
    const fn = vi.fn<() => Promise<ResendLike>>().mockResolvedValue(sent);

    await expect(
      retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 0, isFailure: (r) => Boolean(r.error) }),
    ).resolves.toBe(sent);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('applies backoff delays between result-shaped retries', async () => {
    const fn = vi.fn<() => Promise<ResendLike>>().mockResolvedValue(rateLimited);
    const started = Date.now();

    await retryWithBackoff(fn, {
      maxRetries: 2,
      baseDelayMs: 20,
      isFailure: (r) => Boolean(r.error),
    });

    // Two delays: 20 * 2^0 * j + 20 * 2^1 * j, with j in [0.5, 1.5) -> >= 30ms
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
