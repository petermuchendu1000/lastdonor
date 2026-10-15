/**
 * docs/43 — a slug lookup that did not answer must never be reported as "this
 * campaign does not exist".
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  CampaignLookupTimeoutError,
  CampaignUnavailableError,
  lookupCampaign,
  resolveLookupBudgetMs,
} from './campaign-lookup';
import { QueryTimeoutError } from '@/db/query-timeout';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lookupCampaign', () => {
  it('reports a row as found', async () => {
    const result = await lookupCampaign(async () => ({ id: 'c1', slug: 'a' }));
    expect(result).toEqual({ status: 'found', campaign: { id: 'c1', slug: 'a' } });
  });

  it('reports a resolved empty result as missing, without waiting on any budget', async () => {
    const started = Date.now();
    // A 60s budget: if "missing" waited on it, this test could not pass.
    const result = await lookupCampaign(async () => null, 60_000);
    expect(result).toEqual({ status: 'missing' });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('treats undefined (drizzle destructuring a zero-row result) as missing', async () => {
    const rows: Array<{ id: string }> = [];
    const result = await lookupCampaign(async () => rows[0]);
    expect(result).toEqual({ status: 'missing' });
  });

  it('reports a query-timeout rejection as unavailable, NOT as missing', async () => {
    const cause = new QueryTimeoutError(15_000);
    const result = await lookupCampaign(async () => {
      throw cause;
    });
    expect(result).toEqual({ status: 'unavailable', cause });
    expect(result.status).not.toBe('missing');
    // The code the pool wedge of docs/37 produces.
    expect((result as { cause: { code: string } }).cause.code).toBe('DB_QUERY_TIMEOUT');
  });

  it('reports a connection error as unavailable', async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const result = await lookupCampaign(async () => {
      throw cause;
    });
    expect(result).toEqual({ status: 'unavailable', cause });
  });

  it('reports a synchronous throw as unavailable', async () => {
    const result = await lookupCampaign(() => {
      throw new Error('boom');
    });
    expect(result.status).toBe('unavailable');
  });

  it('fails the lookup at its own budget instead of waiting for the query bound', async () => {
    const started = Date.now();
    const result = await lookupCampaign(
      () => new Promise(() => {}), // never settles, like a wedged pool
      25,
    );
    expect(result.status).toBe('unavailable');
    expect((result as { cause: unknown }).cause).toBeInstanceOf(CampaignLookupTimeoutError);
    // Nowhere near the 15s DB_QUERY_TIMEOUT_MS ceiling.
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('does not leave a pending timer behind on the happy path', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    await lookupCampaign(async () => ({ id: 'c1' }), 60_000);
    expect(clear).toHaveBeenCalled();
  });
});

describe('resolveLookupBudgetMs', () => {
  it('defaults to a budget well inside the global query bound', () => {
    expect(resolveLookupBudgetMs(undefined, 15_000, false)).toBe(4_000);
  });

  it('honours an explicit budget', () => {
    expect(resolveLookupBudgetMs('2000', 15_000, false)).toBe(2_000);
  });

  it('is clamped to the global query bound and never widens it', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveLookupBudgetMs('60000', 15_000, false)).toBe(4_000);
    expect(resolveLookupBudgetMs('5000', 3_000, false)).toBe(3_000);
    expect(err).toHaveBeenCalled();
  });

  it('rejects a value small enough to report a cold connection as an outage', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveLookupBudgetMs('10', 15_000, false)).toBe(4_000);
    expect(resolveLookupBudgetMs('not-a-number', 15_000, false)).toBe(4_000);
    expect(err).toHaveBeenCalledTimes(2);
  });

  it('does not tighten the budget during the production build', () => {
    expect(resolveLookupBudgetMs(undefined, 15_000, true)).toBe(15_000);
    expect(resolveLookupBudgetMs('1000', 15_000, true)).toBe(15_000);
  });
});

describe('CampaignUnavailableError', () => {
  it('keeps the underlying cause for Sentry', () => {
    const cause = new QueryTimeoutError(15_000);
    const err = new CampaignUnavailableError('nope-1', cause);
    expect(err.code).toBe('CAMPAIGN_LOOKUP_UNAVAILABLE');
    expect(err.cause).toBe(cause);
    expect(err.message).toContain('nope-1');
  });
});
