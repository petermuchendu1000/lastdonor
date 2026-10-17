/**
 * Phone verification over SMS.
 *
 * `docs/82` left the storage question open: `verification_tokens` has no
 * attempt counter, so a six-digit code had nothing bounding the guesses.
 * These tests exist mostly to pin that bound — the rest is bookkeeping.
 *
 * The fake `db` below models one real row with mutable state rather than
 * returning canned values, because the thing under test IS the state
 * transition: attempts incrementing, a code being burned, a new code
 * replacing the old one. A stubbed read would assert nothing.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  /** The `phone_verification_codes` table: at most one row per user. */
  codes: [] as Row[],
  /** Writes to `users`. */
  userUpdates: [] as Row[],
  /** Rows a SELECT on `users` should return. */
  users: [] as Row[],
  /** Every sendSms(to, message) call. */
  sms: [] as { to: string; message: string }[],
  /** What the next sendSms should answer. */
  smsResult: null as unknown,
  /** When set, sendSms throws this instead. */
  smsThrows: null as Error | null,
}));

vi.mock('@/lib/africastalking', () => ({
  sendSms: async (to: string, message: string) => {
    state.sms.push({ to, message });
    if (state.smsThrows) throw state.smsThrows;
    return state.smsResult ?? { ok: true, to, messageId: 'ATXid_test', cost: 'KES 0.8000' };
  },
}));

/*
  Dispatch on the SHAPE of each call, not on Drizzle's table internals.
  This module only ever inserts into one table, and its two UPDATE targets
  write disjoint column sets, so the written keys identify the table
  without reaching into the ORM.
*/
vi.mock('@/db', () => ({
  db: {
    select: (projection?: Row) => {
      const keys = Object.keys(projection ?? {}).sort().join(',');
      // `users` is only ever selected for phoneVerifiedAt; everything else
      // in this module reads the codes table.
      const rows = () => (keys === 'phoneVerifiedAt' ? state.users : state.codes);
      const c: Record<string, unknown> = {};
      c.from = () => c;
      c.where = () => c;
      c.limit = async () => rows();
      c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows()).then(resolve);
      return c;
    },
    insert: () => ({
      values: async (v: Row) => {
        state.codes.push({
          id: `row-${state.codes.length + 1}`,
          attempts: 0,
          consumedAt: null,
          ...v,
        });
      },
    }),
    update: () => ({
      set: (v: Row) => ({
        where: async () => {
          const touchesUser = 'phoneVerifiedAt' in v || 'smsConsentAt' in v || 'phoneE164' in v;
          if (touchesUser) state.userUpdates.push(v);
          else if (state.codes[0]) Object.assign(state.codes[0], v);
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        state.codes.length = 0;
      },
    }),
  },
}));

import {
  sendPhoneCode,
  verifyPhoneCode,
  recordSmsConsent,
  generateCode,
  hashCode,
  CODE_LENGTH,
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
} from './phone-verification';

const USER = 'user-1';
const T0 = new Date('2026-10-17T12:00:00Z');

/** The code just minted, read back out of the fake table. */
function mintedCode(): string {
  const text = state.sms.at(-1)!.message;
  return /(\d{6})/.exec(text)![1];
}

beforeEach(() => {
  vi.stubEnv('SMS_DEFAULT_REGION', 'KE');
  vi.stubEnv('AT_USERNAME', 'sandbox');
  state.codes.length = 0;
  state.userUpdates.length = 0;
  state.users.length = 0;
  state.sms.length = 0;
  state.smsResult = null;
  state.smsThrows = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the code itself', () => {
  it('is six digits', () => {
    expect(generateCode()).toMatch(new RegExp(`^\\d{${CODE_LENGTH}}$`));
  });

  /*
    Generated digit by digit rather than as a padded integer, so a code
    starting 0 is as likely as one starting 9 and the space really is 10^6.
    1,000 draws: P(no leading zero at all) = 0.9^1000, which is zero.
  */
  it('can start with a zero', () => {
    const codes = Array.from({ length: 1000 }, generateCode);
    expect(codes.some((c) => c.startsWith('0'))).toBe(true);
  });

  it('is not all the same digit every time', () => {
    expect(new Set(Array.from({ length: 50 }, generateCode)).size).toBeGreaterThan(40);
  });
});

describe('sending', () => {
  it('texts the code to the normalised number', async () => {
    const out = await sendPhoneCode(USER, '0712345678', T0);
    expect(out).toMatchObject({ ok: true, phoneE164: '+254712345678' });
    expect(state.sms).toHaveLength(1);
    expect(state.sms[0].to).toBe('+254712345678');
    expect(state.sms[0].message).toMatch(/^\d{6} is your LastDonor verification code/);
  });

  /*
    docs/84: Africa's Talking accepts `0712345678` and resolves it against
    ITS default region. Our region has to decide, so an unusable number
    never reaches the provider - and is never charged for.
  */
  it('does not call the provider for a number we cannot use', async () => {
    await expect(sendPhoneCode(USER, 'not a phone', T0)).resolves.toEqual({
      ok: false,
      reason: 'invalid_phone',
    });
    expect(state.sms).toHaveLength(0);
    expect(state.codes).toHaveLength(0);
  });

  it('stores a hash, never the code', async () => {
    await sendPhoneCode(USER, '+254712345678', T0);
    const code = mintedCode();
    expect(state.codes[0].codeHash).toBe(hashCode(code));
    expect(JSON.stringify(state.codes[0])).not.toContain(code);
  });

  it('sets a ten-minute expiry', async () => {
    await sendPhoneCode(USER, '+254712345678', T0);
    expect((state.codes[0].expiresAt as Date).getTime()).toBe(T0.getTime() + CODE_TTL_MS);
  });

  it('says when the message went to a simulator rather than a handset', async () => {
    await expect(sendPhoneCode(USER, '+254712345678', T0)).resolves.toMatchObject({
      sandbox: true,
    });
    vi.stubEnv('AT_USERNAME', 'lastdonor');
    state.codes.length = 0;
    await expect(
      sendPhoneCode(USER, '+254712345678', new Date(T0.getTime() + RESEND_COOLDOWN_MS)),
    ).resolves.toMatchObject({ sandbox: false });
  });
});

describe('the resend cooldown', () => {
  it('refuses a second code within a minute', async () => {
    await sendPhoneCode(USER, '+254712345678', T0);
    const out = await sendPhoneCode(USER, '+254712345678', new Date(T0.getTime() + 30_000));
    expect(out).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(state.sms).toHaveLength(1);
  });

  it('allows one after the cooldown, and the old code stops working', async () => {
    await sendPhoneCode(USER, '+254712345678', T0);
    const first = mintedCode();

    const later = new Date(T0.getTime() + RESEND_COOLDOWN_MS);
    await expect(sendPhoneCode(USER, '+254712345678', later)).resolves.toMatchObject({ ok: true });
    const second = mintedCode();

    // Only one live row: a second code must not widen the target.
    expect(state.codes).toHaveLength(1);
    if (first !== second) {
      await expect(verifyPhoneCode(USER, first, later)).resolves.toMatchObject({ ok: false });
    }
    await expect(verifyPhoneCode(USER, second, later)).resolves.toMatchObject({ ok: true });
  });
});

describe('when the provider will not send', () => {
  /*
    The row is dropped so the cooldown does not hold a person hostage for
    a message they never received.
  */
  it('does not leave a code behind after a refusal', async () => {
    state.smsResult = { ok: false, to: '+254712345678', reason: 'InvalidPhoneNumber' };
    await expect(sendPhoneCode(USER, '+254712345678', T0)).resolves.toEqual({
      ok: false,
      reason: 'send_failed',
      detail: 'InvalidPhoneNumber',
    });
    expect(state.codes).toHaveLength(0);
  });

  it('reports a throw as send_failed rather than crashing the route', async () => {
    const err = new Error('nope');
    err.name = 'SmsNotConfiguredError';
    state.smsThrows = err;
    await expect(sendPhoneCode(USER, '+254712345678', T0)).resolves.toEqual({
      ok: false,
      reason: 'send_failed',
      detail: 'SmsNotConfiguredError',
    });
  });
});

describe('verifying', () => {
  it('accepts the right code and records the number as verified', async () => {
    await sendPhoneCode(USER, '0712345678', T0);
    await expect(verifyPhoneCode(USER, mintedCode(), T0)).resolves.toEqual({
      ok: true,
      phoneE164: '+254712345678',
    });
    expect(state.userUpdates[0]).toMatchObject({
      phoneE164: '+254712345678',
      phoneVerifiedAt: T0,
    });
  });

  it('tolerates spaces and dashes a person typed', async () => {
    await sendPhoneCode(USER, '+254712345678', T0);
    const code = mintedCode();
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    await expect(verifyPhoneCode(USER, spaced, T0)).resolves.toMatchObject({ ok: true });
  });

  it('consumes the code, so it cannot be replayed', async () => {
    await sendPhoneCode(USER, '+254712345678', T0);
    const code = mintedCode();
    await verifyPhoneCode(USER, code, T0);
    await expect(verifyPhoneCode(USER, code, T0)).resolves.toEqual({ ok: false, reason: 'no_code' });
  });

  it('rejects an expired code and clears it', async () => {
    await sendPhoneCode(USER, '+254712345678', T0);
    const code = mintedCode();
    const late = new Date(T0.getTime() + CODE_TTL_MS + 1);
    await expect(verifyPhoneCode(USER, code, late)).resolves.toEqual({ ok: false, reason: 'expired' });
    expect(state.codes).toHaveLength(0);
    expect(state.userUpdates).toHaveLength(0);
  });

  it('says nothing is pending when no code was asked for', async () => {
    await expect(verifyPhoneCode(USER, '123456', T0)).resolves.toEqual({
      ok: false,
      reason: 'no_code',
    });
  });
});

/*
  The reason this module has a table of its own. Without a counter on the
  row, a six-digit code is one in a million against unlimited guesses, and
  an IP rate limit does not help - an attacker spreads the guesses.
*/
describe('the guess budget', () => {
  async function mint() {
    state.codes.length = 0;
    state.sms.length = 0;
    await sendPhoneCode(USER, '+254712345678', T0);
    return mintedCode();
  }

  /** A six-digit string that is not `code`. */
  function wrong(code: string): string {
    return code === '000000' ? '111111' : '000000';
  }

  it('counts each wrong guess down from five', async () => {
    const code = await mint();
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await expect(verifyPhoneCode(USER, wrong(code), T0)).resolves.toEqual({
        ok: false,
        reason: 'wrong_code',
        attemptsLeft: MAX_ATTEMPTS - i,
      });
    }
  });

  it('burns the code on the fifth wrong guess', async () => {
    const code = await mint();
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) await verifyPhoneCode(USER, wrong(code), T0);

    await expect(verifyPhoneCode(USER, wrong(code), T0)).resolves.toEqual({
      ok: false,
      reason: 'too_many_attempts',
      attemptsLeft: 0,
    });
    expect(state.codes).toHaveLength(0);
  });

  /* The one that matters: the real code must not work after the budget. */
  it('will not accept the correct code once the budget is spent', async () => {
    const code = await mint();
    for (let i = 0; i < MAX_ATTEMPTS; i++) await verifyPhoneCode(USER, wrong(code), T0);

    await expect(verifyPhoneCode(USER, code, T0)).resolves.toMatchObject({ ok: false });
    expect(state.userUpdates).toHaveLength(0);
  });

  it('a correct guess before the budget runs out still works', async () => {
    const code = await mint();
    await verifyPhoneCode(USER, wrong(code), T0);
    await verifyPhoneCode(USER, wrong(code), T0);
    await expect(verifyPhoneCode(USER, code, T0)).resolves.toMatchObject({ ok: true });
  });
});

describe('consent is a separate act from verification', () => {
  it('verifying a number does not grant it', async () => {
    await sendPhoneCode(USER, '+254712345678', T0);
    await verifyPhoneCode(USER, mintedCode(), T0);
    expect(state.userUpdates[0]).not.toHaveProperty('smsConsentAt');
  });

  it('is a timestamp when granted and null when withdrawn', async () => {
    await recordSmsConsent(USER, true, T0);
    expect(state.userUpdates.at(-1)).toEqual({ smsConsentAt: T0 });

    await recordSmsConsent(USER, false, T0);
    expect(state.userUpdates.at(-1)).toEqual({ smsConsentAt: null });
  });
});
