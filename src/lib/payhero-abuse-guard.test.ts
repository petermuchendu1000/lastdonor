/**
 * The guard that protects a bystander's phone.
 *
 * The attack it exists for: an attacker posts a stranger's number to the
 * public initiate route repeatedly. The stranger's handset fills with M-Pesa
 * prompts they did not ask for, and after 10 unanswered pushes PayHero blocks
 * that number from receiving STK requests for 24 hours — so the attacker has
 * denied a real person the ability to pay for anything through that provider.
 * At 50 unanswered pushes in 6 hours PayHero restricts our whole account too.
 *
 * An IP rate limit does not address it, because the protected party is the
 * number and a distributed caller changes IP freely. `docs/85` reached the
 * same conclusion about six-digit codes and put the counter on the row.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const PHONE = '+254713572703';

const rows: { status: string; createdAt: Date }[] = [];

vi.mock('@/db', () => {
  const build = (mode: 'latest' | 'count') => ({
    from: () => ({
      where: () =>
        mode === 'count'
          ? Promise.resolve([{ n: rows.length }])
          : {
              orderBy: () => ({
                limit: () =>
                  Promise.resolve(
                    rows.length
                      ? [[...rows].sort((a, b) => +b.createdAt - +a.createdAt)[0]]
                      : [],
                  ),
              }),
            },
    }),
  });

  return {
    db: {
      // The count query selects `{ n: count() }`; the latest query selects
      // `{ status, createdAt }`.
      select: (cols: Record<string, unknown>) =>
        build('n' in cols ? 'count' : 'latest'),
    },
  };
});

const {
  checkPhoneAbuseGuard,
  PROMPT_LIFETIME_MS,
  RETRY_COOLDOWN_MS,
  MAX_PUSHES_PER_NUMBER_PER_HOUR,
} = await import('@/lib/payhero-abuse-guard');

beforeEach(() => {
  rows.length = 0;
});

function push(status: string, ageMs: number) {
  rows.push({ status, createdAt: new Date(Date.now() - ageMs) });
}

describe('a number with no history', () => {
  it('is allowed', async () => {
    expect(await checkPhoneAbuseGuard(PHONE)).toEqual({ allowed: true });
  });
});

describe('one live prompt at a time', () => {
  it('refuses a second push while one is still pending', async () => {
    push('pending', 5_000);

    const verdict = await checkPhoneAbuseGuard(PHONE);

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('unreachable');
    expect(verdict.rule).toBe('prompt_in_flight');
    // The donor is told to look at their phone, not that something failed.
    expect(verdict.message).toMatch(/already an M-Pesa request/i);
    expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('allows again once the prompt can no longer be live', async () => {
    push('pending', PROMPT_LIFETIME_MS + 1_000);
    expect((await checkPhoneAbuseGuard(PHONE)).allowed).toBe(true);
  });

  /*
   * A donor who taps Pay twice in two seconds must get one prompt, not two.
   * Two prompts on one handset is both confusing and a step towards the
   * 10-push block.
   */
  it('collapses a double tap into the existing prompt', async () => {
    push('pending', 500);
    const verdict = await checkPhoneAbuseGuard(PHONE);
    expect(verdict.allowed).toBe(false);
  });
});

describe('cooldown after a resolved attempt', () => {
  it('refuses an immediate retry after a failure', async () => {
    push('failed', 1_000);

    const verdict = await checkPhoneAbuseGuard(PHONE);

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('unreachable');
    expect(verdict.rule).toBe('cooldown');
  });

  it('allows a retry once the cooldown has passed', async () => {
    push('failed', RETRY_COOLDOWN_MS + 500);
    expect((await checkPhoneAbuseGuard(PHONE)).allowed).toBe(true);
  });

  it('applies the cooldown to a succeeded attempt too', async () => {
    // A donor giving twice in five seconds is far more likely to be a double
    // submit than two gifts.
    push('succeeded', 1_000);
    expect((await checkPhoneAbuseGuard(PHONE)).allowed).toBe(false);
  });
});

describe('the hourly ceiling, which is what protects a bystander', () => {
  it('refuses once the cap is reached', async () => {
    for (let i = 0; i < MAX_PUSHES_PER_NUMBER_PER_HOUR; i++) {
      push('failed', RETRY_COOLDOWN_MS + 1_000 + i);
    }

    const verdict = await checkPhoneAbuseGuard(PHONE);

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('unreachable');
    expect(verdict.rule).toBe('hourly_cap');
    // Points at support, because a person seeing this may be the victim.
    expect(verdict.message).toMatch(/support@lastdonor\.org/);
  });

  it('allows the last push below the cap', async () => {
    for (let i = 0; i < MAX_PUSHES_PER_NUMBER_PER_HOUR - 1; i++) {
      push('failed', RETRY_COOLDOWN_MS + 1_000 + i);
    }
    expect((await checkPhoneAbuseGuard(PHONE)).allowed).toBe(true);
  });

  /*
   * The ceiling is deliberately BELOW PayHero's own threshold of 10. Ours is
   * a guard, theirs is a punishment, and this platform must never be the
   * thing that gets a bystander blocked for a day.
   */
  it('sits comfortably below PayHero’s 10-push block', () => {
    expect(MAX_PUSHES_PER_NUMBER_PER_HOUR).toBeLessThan(10);
  });
});

describe('the constants are honest about what is known', () => {
  /*
   * PROMPT_LIFETIME_MS is an ASSUMPTION, not a measurement. Published
   * figures for the STK prompt timeout disagree - 30s, 60s, "about 90",
   * "1 to 3 minutes depending on the handset" - and none is from Safaricom's
   * own documentation. Set at the long end on purpose: too long costs a donor
   * a wait, too short costs two prompts on one handset.
   */
  it('errs long on the prompt lifetime', () => {
    expect(PROMPT_LIFETIME_MS).toBeGreaterThanOrEqual(3 * 60_000);
  });

  it('keeps the cooldown short enough not to annoy an honest retry', () => {
    expect(RETRY_COOLDOWN_MS).toBeLessThanOrEqual(30_000);
  });
});
