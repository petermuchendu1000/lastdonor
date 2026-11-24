/**
 * The guard that protects a bystander's phone.
 *
 * The attack it exists for: an attacker posts a stranger's number to a public
 * initiate route repeatedly. The stranger's handset fills with M-Pesa prompts
 * they did not ask for, and after 10 unanswered pushes PayHero blocks that
 * number from receiving STK requests for 24 hours — so the attacker has
 * denied a real person the ability to pay for anything through that provider.
 * At 50 unanswered pushes in 6 hours PayHero restricts our whole account too.
 *
 * An IP rate limit does not address it, because the protected party is the
 * number and a distributed caller changes IP freely. `docs/85` reached the
 * same conclusion about six-digit codes and put the counter on the row.
 *
 * ── Why the mock is table-aware ───────────────────────────────────────────
 *
 * There are TWO M-Pesa rails and the guard counts both (docs/182). A mock
 * that answered every `.from()` with the same rows would double every count
 * and could not express "three pushes on one rail and two on the other", which
 * is the single most important case here — it is the one that used to be
 * allowed, because each rail's table was counted alone.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const PHONE = '+254713572703';

type Row = { status: string; createdAt: Date };

const rows: { payhero: Row[]; palpluss: Row[] } = { payhero: [], palpluss: [] };

vi.mock('@/db', async () => {
  const { getTableName } = await import('drizzle-orm');

  /* Which bucket a drizzle table object stands for. */
  const bucket = (table: unknown): 'payhero' | 'palpluss' =>
    getTableName(table as never) === 'palpluss_payment_requests' ? 'palpluss' : 'payhero';

  const build = (mode: 'latest' | 'count') => ({
    from: (table: unknown) => {
      const mine = rows[bucket(table)];
      return {
        where: () =>
          mode === 'count'
            ? Promise.resolve([{ n: mine.length }])
            : {
                orderBy: () => ({
                  limit: () =>
                    Promise.resolve(
                      mine.length
                        ? [[...mine].sort((a, b) => +b.createdAt - +a.createdAt)[0]]
                        : [],
                    ),
                }),
              },
      };
    },
  });

  return {
    db: {
      // The count query selects `{ n: count() }`; the latest query selects
      // `{ status, createdAt }`.
      select: (cols: Record<string, unknown>) => build('n' in cols ? 'count' : 'latest'),
    },
  };
});

const {
  checkPhoneAbuseGuard,
  cooldownMsFor,
  newerAttempt,
  PROMPT_LIFETIME_MS,
  RETRY_COOLDOWN_MS,
  MAX_PUSHES_PER_NUMBER_PER_HOUR,
} = await import('@/lib/mpesa-abuse-guard');

const { MIN_PUSH_INTERVAL_MS } = await import('@/lib/palpluss');

beforeEach(() => {
  rows.payhero.length = 0;
  rows.palpluss.length = 0;
});

function push(status: string, ageMs: number, rail: 'payhero' | 'palpluss' = 'payhero') {
  rows[rail].push({ status, createdAt: new Date(Date.now() - ageMs) });
}

describe('a number with no history', () => {
  it('is allowed', async () => {
    expect(await checkPhoneAbuseGuard(PHONE, 'payhero')).toEqual({ allowed: true });
    expect(await checkPhoneAbuseGuard(PHONE, 'palpluss')).toEqual({ allowed: true });
  });
});

describe('one live prompt at a time', () => {
  it('refuses a second push while one is still pending', async () => {
    push('pending', 5_000);

    const verdict = await checkPhoneAbuseGuard(PHONE, 'payhero');

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('unreachable');
    expect(verdict.rule).toBe('prompt_in_flight');
    // The donor is told to look at their phone, not that something failed.
    expect(verdict.message).toMatch(/already an M-Pesa request/i);
    expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('allows again once the prompt can no longer be live', async () => {
    push('pending', PROMPT_LIFETIME_MS + 1_000);
    expect((await checkPhoneAbuseGuard(PHONE, 'payhero')).allowed).toBe(true);
  });

  /*
   * A donor who taps Pay twice in two seconds must get one prompt, not two.
   * Two prompts on one handset is both confusing and a step towards the
   * 10-push block.
   */
  it('collapses a double tap into the existing prompt', async () => {
    push('pending', 500);
    const verdict = await checkPhoneAbuseGuard(PHONE, 'payhero');
    expect(verdict.allowed).toBe(false);
  });

  /*
   * THE CROSS-RAIL CASE. A prompt raised through PayHero is on the same
   * handset as one raised through Palpluss, so the rail the second request
   * names is irrelevant to this rule.
   */
  it('refuses a push on EITHER rail while the other rail has a live prompt', async () => {
    push('pending', 5_000, 'payhero');

    const viaPalpluss = await checkPhoneAbuseGuard(PHONE, 'palpluss');
    expect(viaPalpluss.allowed).toBe(false);
    if (viaPalpluss.allowed) throw new Error('unreachable');
    expect(viaPalpluss.rule).toBe('prompt_in_flight');

    rows.payhero.length = 0;
    push('pending', 5_000, 'palpluss');

    const viaPayhero = await checkPhoneAbuseGuard(PHONE, 'payhero');
    expect(viaPayhero.allowed).toBe(false);
  });
});

describe('cooldown after a resolved attempt', () => {
  it('refuses an immediate retry after a failure', async () => {
    push('failed', 1_000);

    const verdict = await checkPhoneAbuseGuard(PHONE, 'payhero');

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('unreachable');
    expect(verdict.rule).toBe('cooldown');
  });

  it('allows a retry once the cooldown has passed', async () => {
    push('failed', RETRY_COOLDOWN_MS + 500);
    expect((await checkPhoneAbuseGuard(PHONE, 'payhero')).allowed).toBe(true);
  });

  it('applies the cooldown to a succeeded attempt too', async () => {
    // A donor giving twice in five seconds is far more likely to be a double
    // submit than two gifts.
    push('succeeded', 1_000);
    expect((await checkPhoneAbuseGuard(PHONE, 'payhero')).allowed).toBe(false);
  });

  /*
   * ⛔ THE RAIL ARGUMENT, and the reason the parameter is required rather
   * than defaulted.
   *
   * Palpluss throttles at two pushes per phone per minute and reports a
   * refusal as `result_code: "17"` — not an HTTP error — so a push past its
   * throttle looks accepted and silently raises no prompt. PayHero's 20s
   * cooldown permits three a minute, which is correct for PayHero and too
   * permissive here.
   *
   * This asserts the DIFFERENCE, with the same history in both arms, so a
   * single shared cooldown cannot satisfy it whichever value were chosen.
   */
  it('holds a Palpluss push longer than a PayHero one after the same attempt', async () => {
    const age = RETRY_COOLDOWN_MS + 1_000;
    expect(age).toBeLessThan(MIN_PUSH_INTERVAL_MS);

    push('failed', age, 'payhero');

    expect((await checkPhoneAbuseGuard(PHONE, 'payhero')).allowed).toBe(true);

    const viaPalpluss = await checkPhoneAbuseGuard(PHONE, 'palpluss');
    expect(viaPalpluss.allowed).toBe(false);
    if (viaPalpluss.allowed) throw new Error('unreachable');
    expect(viaPalpluss.rule).toBe('cooldown');
  });

  it('allows a Palpluss push once ITS longer interval has passed', async () => {
    push('failed', MIN_PUSH_INTERVAL_MS + 500, 'palpluss');
    expect((await checkPhoneAbuseGuard(PHONE, 'palpluss')).allowed).toBe(true);
  });

  it('maps each rail to its own interval', () => {
    expect(cooldownMsFor('payhero')).toBe(RETRY_COOLDOWN_MS);
    expect(cooldownMsFor('palpluss')).toBe(MIN_PUSH_INTERVAL_MS);
    // ⛔ ANTI-VACUITY: if the two ever became equal, the test above would pass
    // against a single shared cooldown, which is the defect it exists for.
    expect(cooldownMsFor('palpluss')).toBeGreaterThan(cooldownMsFor('payhero'));
  });
});

describe('the hourly ceiling, which is what protects a bystander', () => {
  it('refuses once the cap is reached', async () => {
    for (let i = 0; i < MAX_PUSHES_PER_NUMBER_PER_HOUR; i++) {
      push('failed', MIN_PUSH_INTERVAL_MS + 1_000 + i);
    }

    const verdict = await checkPhoneAbuseGuard(PHONE, 'payhero');

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('unreachable');
    expect(verdict.rule).toBe('hourly_cap');
    // Points at support, because a person seeing this may be the victim.
    expect(verdict.message).toMatch(/support@lastdonor\.org/);
  });

  it('allows the last push below the cap', async () => {
    for (let i = 0; i < MAX_PUSHES_PER_NUMBER_PER_HOUR - 1; i++) {
      push('failed', MIN_PUSH_INTERVAL_MS + 1_000 + i);
    }
    expect((await checkPhoneAbuseGuard(PHONE, 'payhero')).allowed).toBe(true);
  });

  /*
   * ⛔ THE DEFECT ADDING A SECOND RAIL WOULD HAVE CREATED.
   *
   * Split across the two tables, no single table reaches the ceiling — so a
   * per-table count allows the push, and the handset has had five prompts
   * either way. Nothing would have failed; the control would simply have
   * halved in strength because of work in another file.
   *
   * The ages clear BOTH cooldowns so this test can only be refused by the
   * hourly rule, and the assertion names that rule rather than just `false`.
   */
  it('counts both rails towards one ceiling', async () => {
    const clear = MIN_PUSH_INTERVAL_MS + 1_000;
    push('failed', clear + 1, 'payhero');
    push('failed', clear + 2, 'payhero');
    push('failed', clear + 3, 'payhero');
    push('failed', clear + 4, 'palpluss');
    push('failed', clear + 5, 'palpluss');
    expect(rows.payhero.length).toBeLessThan(MAX_PUSHES_PER_NUMBER_PER_HOUR);
    expect(rows.palpluss.length).toBeLessThan(MAX_PUSHES_PER_NUMBER_PER_HOUR);

    for (const rail of ['payhero', 'palpluss'] as const) {
      const verdict = await checkPhoneAbuseGuard(PHONE, rail);
      expect(verdict.allowed, `refused on ${rail}`).toBe(false);
      if (verdict.allowed) throw new Error('unreachable');
      expect(verdict.rule).toBe('hourly_cap');
    }
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

describe('newerAttempt', () => {
  const at = (ms: number): { pending: boolean; createdAt: Date } => ({
    pending: false,
    createdAt: new Date(ms),
  });

  it('returns the only attempt when one rail has none', () => {
    expect(newerAttempt(at(10), null)?.createdAt.getTime()).toBe(10);
    expect(newerAttempt(null, at(10))?.createdAt.getTime()).toBe(10);
  });

  it('returns null when neither rail has one', () => {
    expect(newerAttempt(null, null)).toBeNull();
  });

  /*
   * Picking the OLDER row is a silent weakening rather than a visible bug:
   * the older one is likelier to have aged past both windows, so the guard
   * would simply allow pushes it should refuse. Asserted in both argument
   * orders so a comparison that ignores one side cannot pass.
   */
  it('picks the newer of two, in either argument order', () => {
    expect(newerAttempt(at(10), at(20))?.createdAt.getTime()).toBe(20);
    expect(newerAttempt(at(20), at(10))?.createdAt.getTime()).toBe(20);
  });

  it('carries the pending flag of the row it picked', () => {
    const older = { pending: true, createdAt: new Date(10) };
    const newer = { pending: false, createdAt: new Date(20) };
    expect(newerAttempt(older, newer)?.pending).toBe(false);
    expect(newerAttempt(newer, older)?.pending).toBe(false);
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
