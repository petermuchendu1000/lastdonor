import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbExecute = vi.fn();
const balanceRetrieve = vi.fn();
const pingRedis = vi.fn();
const getWalletBalance = vi.fn();
const isPayHeroConfigured = vi.fn();
const isPalplussConfigured = vi.fn();

vi.mock('@/db', () => ({ db: { execute: (...a: unknown[]) => dbExecute(...a) } }));
vi.mock('@/lib/stripe', () => ({
  stripe: { balance: { retrieve: () => balanceRetrieve() } },
}));
vi.mock('@/lib/locks', () => ({ pingRedis: () => pingRedis() }));
vi.mock('@/lib/payhero', () => ({
  getWalletBalance: () => getWalletBalance(),
  isPayHeroConfigured: () => isPayHeroConfigured(),
}));
/*
  ⚠️ `docs/185` added a Palpluss check to this route, and the FIRST symptom was
  this file failing to collect: *"No LASTDONOR_REFERENCE_PREFIX export is
  defined on the @/lib/payhero mock"*. The payhero mock above is wholesale, and
  `palpluss.ts` imported that constant `from './payhero'` - so mocking one rail
  silently broke the other. The constant moved to `mpesa-prompt.ts`, which both
  rails may own equally; this mock is narrow for the same reason.
*/
vi.mock('@/lib/palpluss', () => ({
  isPalplussConfigured: () => isPalplussConfigured(),
}));

const { GET } = await import('./route');

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  dbExecute.mockReset().mockResolvedValue(undefined);
  balanceRetrieve.mockReset().mockResolvedValue({});
  pingRedis.mockReset().mockResolvedValue({ configured: true, ok: true });
  isPayHeroConfigured.mockReset().mockReturnValue(true);
  isPalplussConfigured.mockReset().mockReturnValue(true);
  // 2239 KES of float at a flat 8.9 per collection is ~251 collections,
  // comfortably above the low-float threshold. This is the real figure
  // measured after the first live collection.
  getWalletBalance.mockReset().mockResolvedValue({
    currency: 'KES', availableBalance: 2239.1, walletStatus: 'PENDING',
  });
});

describe('GET /api/v1/health (deep readiness, NOT the Fly probe)', () => {
  it('checks Redis alongside the database and Stripe', async () => {
    const body = await (await GET()).json();

    // Redis was previously never checked at all, while being load-bearing for
    // distributed rate limiting and (as of P1-11) cron overlap locks.
    /*
      ⛔ `palpluss` added by `docs/185`. The flip left this endpoint reporting
      `payhero: ok` - authenticated, float healthy - for a rail no currency
      routes to, while saying nothing about the one collecting every shilling.
      "Can this platform take money?" had no answer here.
    */
    expect(Object.keys(body.checks).sort()).toEqual([
      'database',
      'palpluss',
      'payhero',
      'redis',
      'stripe',
    ]);
    expect(pingRedis).toHaveBeenCalledTimes(1);
  });

  it('is healthy and 200 when every dependency answers', async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('healthy');
    expect(body.checks.redis.status).toBe('ok');
    expect(typeof body.checks.redis.latencyMs).toBe('number');
  });

  it('degrades to 503 when only Redis is unreachable', async () => {
    pingRedis.mockResolvedValue({ configured: true, ok: false, error: 'ETIMEDOUT' });

    const response = await GET();
    // A Redis outage must be visible here - this is the endpoint a human or an
    // uptime monitor reads. It is only safe because nothing restarts on it.
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe('degraded');
    expect(body.checks.redis.status).toBe('error');
    expect(body.checks.database.status).toBe('ok');
    expect(body.checks.stripe.status).toBe('ok');
  });

  it('distinguishes an unconfigured Redis from an unreachable one', async () => {
    pingRedis.mockResolvedValue({ configured: false, ok: false, error: 'not configured' });
    const body = await (await GET()).json();
    // A deploy mistake and an Upstash incident need different responses.
    expect(body.checks.redis.error).toMatch(/not configured/i);

    pingRedis.mockResolvedValue({ configured: true, ok: false, error: 'ETIMEDOUT' });
    const body2 = await (await GET()).json();
    expect(body2.checks.redis.error).toMatch(/unreachable/i);
  });

  it('survives pingRedis throwing rather than resolving', async () => {
    pingRedis.mockImplementation(() => {
      throw new Error('boom');
    });

    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).checks.redis.status).toBe('error');
  });

  it('still reports every other check when Stripe fails', async () => {
    balanceRetrieve.mockRejectedValue(new Error('stripe down'));

    const body = await (await GET()).json();
    expect(body.checks.stripe.status).toBe('error');
    expect(body.checks.redis.status).toBe('ok');
    expect(body.checks.database.status).toBe('ok');
  });

  it('leaks no dependency error detail to the caller', async () => {
    dbExecute.mockRejectedValue(new Error('password authentication failed for user "postgres"'));
    const raw = JSON.stringify(await (await GET()).json());
    expect(raw).not.toContain('password');
  });

  /*
    docs/72: a dead Stripe key made every donation fail for three weeks while
    this endpoint correctly reported `degraded` and nobody read it. The KES
    rail gets the same visibility from the start.
  */
  describe('the M-Pesa rail', () => {
    it('reports unconfigured credentials as an error, not silence', async () => {
      isPayHeroConfigured.mockReturnValue(false);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.checks.payhero.status).toBe('error');
      expect(body.checks.payhero.error).toMatch(/not configured/i);
      expect(body.checks.payhero.error).toMatch(/cannot be collected/i);
      // Nothing was asked of PayHero, because there is nothing to ask with.
      expect(getWalletBalance).not.toHaveBeenCalled();
    });

    /*
      ⛔ The rail that actually collects since `docs/185`.

      ⚠️ Its check is CONFIGURATION ONLY, and that is smaller than PayHero's
      above because `src/lib/palpluss.ts` exposes no balance read at all -
      there is nothing to probe. Palpluss's fee is prepaid from a service
      wallet and an empty wallet refuses collection before Safaricom is
      reached (`docs/180`), so this rail has NO float monitor and `docs/150`'s
      alert has no equivalent here. Recorded as open rather than implied.
    */
    it('reports an unconfigured Palpluss key as an error, not silence', async () => {
      isPalplussConfigured.mockReturnValue(false);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.checks.palpluss.status).toBe('error');
      expect(body.checks.palpluss.error).toMatch(/not configured/i);
      expect(body.checks.palpluss.error).toMatch(/cannot be collected/i);
    });

    it('CONTROL: a configured Palpluss key is reported ok, so the rule can pass', async () => {
      /*
        Without this, a check hardwired to `error` would satisfy the rule above
        while reporting the platform permanently broken.
      */
      const body = await (await GET()).json();
      expect(body.checks.palpluss.status).toBe('ok');
    });

    it('reports a rejected credential as an error', async () => {
      getWalletBalance.mockRejectedValue(new Error('PayHero API error 401'));

      const body = await (await GET()).json();

      expect(body.checks.payhero.status).toBe('error');
      expect(body.checks.payhero.error).toMatch(/check failed/i);
    });

    /*
      The fee float is a real ceiling on collecting at all: PayHero debits the
      service wallet a flat KES 8.9 per collection while the donation itself
      settles to the bank channel. When the float runs out, collections fail
      for a reason no donor can act on.
    */
    it('reports a low fee float while it is still fixable', async () => {
      // ~11 collections left at 8.9 each.
      getWalletBalance.mockResolvedValue({
        currency: 'KES', availableBalance: 100, walletStatus: 'PENDING',
      });

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.checks.payhero.status).toBe('error');
      expect(body.checks.payhero.error).toMatch(/float is low/i);
      expect(body.checks.payhero.error).toMatch(/Top up/i);
    });

    /*
      This route is public (PUBLIC_API_ROUTES), and the balance belongs to an
      account shared with BETWOIN LTD. Publishing it would leak another
      company's operating float to anyone who curls the URL.
    */
    it('never publishes the balance, only a derived count', async () => {
      getWalletBalance.mockResolvedValue({
        currency: 'KES', availableBalance: 100, walletStatus: 'PENDING',
      });

      const text = await (await GET()).text();

      expect(text).not.toContain('100');
      expect(text).not.toContain('2239');
      expect(text).not.toMatch(/availableBalance|available_balance/);
      expect(text).toMatch(/11 more collections/);
    });

    it('does not publish the balance when the float is healthy either', async () => {
      const text = await (await GET()).text();

      expect(text).not.toContain('2239');
      expect(text).not.toMatch(/availableBalance|available_balance/);
    });
  });
});
