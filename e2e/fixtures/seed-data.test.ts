/**
 * The E2E fixture's safety guard, tested.
 *
 * This file exists for one assertion above all: **the fixture must refuse to
 * write to anything that is not obviously disposable.** It INSERTs and
 * DELETEs rows, and the only connection string this project actually has is
 * production (`docs/98` §1). The accident this prevents is the one `docs/98`
 * §6 refused to set up — a misconfigured `DATABASE_URL` pointed at the live
 * donation ledger.
 *
 * The guard is pure (it reads `process.env` and throws), so it is tested
 * here as a unit, with no database. The seeding itself is proven by running
 * the suite, not by mocking drizzle.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { assertDatabaseIsDisposable, E2E_FIXTURE_IDS, E2E_FX_FIXTURE } from './seed-data';
import { FX_SNAPSHOT_KEY } from '@/lib/money/fx-store.server';
import { isKnownCurrency, isCollectableCurrency } from '@/lib/money/world-currencies';

const KEYS = ['DATABASE_URL', 'E2E_ALLOW_NONLOCAL_DB'] as const;
const saved = new Map<string, string | undefined>();
for (const k of KEYS) saved.set(k, process.env[k]);

beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('E2E fixture: database guard', () => {
  it('refuses when DATABASE_URL is unset', () => {
    expect(() => assertDatabaseIsDisposable()).toThrow(/DATABASE_URL is not set/);
  });

  it('refuses a URL it cannot parse', () => {
    process.env.DATABASE_URL = 'not-a-url';
    expect(() => assertDatabaseIsDisposable()).toThrow(/not a parseable URL/);
  });

  it.each([
    ['localhost', 'postgresql://u:p@localhost:5432/db'],
    ['127.0.0.1', 'postgresql://u:p@127.0.0.1:55432/db'],
    // The hostname a Postgres service container answers on in GitHub Actions.
    ['the CI service container', 'postgresql://postgres:postgres@postgres:5432/lastdonor_test'],
  ])('allows %s', (_label, url) => {
    process.env.DATABASE_URL = url;
    expect(() => assertDatabaseIsDisposable()).not.toThrow();
  });

  /*
    The important half. Each of these is a real shape this project's
    DATABASE_URL has actually taken, and every one must be refused.
  */
  it.each([
    ['the Supabase pooler', 'postgresql://u:p@aws-0-eu-west-1.pooler.supabase.com:6543/postgres'],
    ['a Supabase direct host', 'postgresql://u:p@db.abcdefghijklmnop.supabase.co:5432/postgres'],
    ['a Fly internal host', 'postgresql://u:p@lastdonor-db.internal:5432/postgres'],
    ['any other remote host', 'postgresql://u:p@db.example.com:5432/postgres'],
  ])('refuses %s', (_label, url) => {
    process.env.DATABASE_URL = url;
    expect(() => assertDatabaseIsDisposable()).toThrow(/refusing to seed a non-local database/);
  });

  it('allows a non-local host only behind an explicit opt-in, and says so', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@db.example.com:5432/postgres';
    process.env.E2E_ALLOW_NONLOCAL_DB = '1';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => assertDatabaseIsDisposable()).not.toThrow();

    // The escape hatch must be loud. A silent override is how the accident
    // happens anyway, six months from now, to somebody else.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/INSERTS and DELETES/);
  });

  it('treats only the exact string "1" as opt-in', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@db.example.com:5432/postgres';
    for (const value of ['true', 'yes', '0', '']) {
      process.env.E2E_ALLOW_NONLOCAL_DB = value;
      expect(
        () => assertDatabaseIsDisposable(),
        `E2E_ALLOW_NONLOCAL_DB=${JSON.stringify(value)} must not open the gate`,
      ).toThrow(/refusing to seed a non-local database/);
    }
  });
});

describe('E2E fixture: ids', () => {
  it('uses well-formed uuids, so teardown targets what it claims to', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const id of E2E_FIXTURE_IDS.campaigns) expect(id).toMatch(uuid);
    expect(E2E_FIXTURE_IDS.blogPost).toMatch(uuid);
    expect(E2E_FIXTURE_IDS.user).toMatch(uuid);
    expect(E2E_FIXTURE_IDS.campaignUpdate).toMatch(uuid);
  });

  it('includes the general fund id the donate page actually looks up', async () => {
    /*
      `/donate` hides the donation form unless a row with this exact id is
      donatable (docs/42). If the fixture ever seeds a fresh uuid instead,
      nine donate-button tests fail against a form that was never rendered,
      and the failure points at the form rather than at the fixture.
    */
    const { GENERAL_FUND_CAMPAIGN_ID } = await import('@/lib/constants');
    expect(E2E_FIXTURE_IDS.campaigns).toContain(GENERAL_FUND_CAMPAIGN_ID);
  });

  it('keeps every id distinct', () => {
    const all = [
      ...E2E_FIXTURE_IDS.campaigns,
      E2E_FIXTURE_IDS.blogPost,
      E2E_FIXTURE_IDS.user,
      E2E_FIXTURE_IDS.campaignUpdate,
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('the seeded exchange-rate snapshot', () => {
  /*
    The fixture hardcodes the settings key because `fx-store.server.ts` is
    `server-only` and throws under `tsx`. This is the guard that makes the
    literal safe: under Vitest, `server-only` is aliased to a stub
    (`vitest.config.ts`), so the real constant CAN be imported here and
    compared.
  */
  it('uses the SAME key the application reads', () => {
    expect(E2E_FX_FIXTURE.key).toBe(FX_SNAPSHOT_KEY);
  });

  it('covers every currency the local-currency spec asserts', () => {
    for (const code of ['USD', 'KES', 'UGX', 'NGN', 'TZS']) {
      expect(E2E_FX_FIXTURE.rates).toHaveProperty(code);
      expect(E2E_FX_FIXTURE.rates[code as 'USD']).toBeGreaterThan(0);
    }
  });

  it('is USD-based, or every conversion off it would be scaled', () => {
    expect(E2E_FX_FIXTURE.rates.USD).toBe(1);
  });

  it('includes KNOWN-but-not-COLLECTABLE currencies, which is the case that broke', () => {
    /*
      The snapshot reader once rebuilt its rate table from the COLLECTABLE
      currencies only, so a stored UGX rate was discarded on read and nothing
      outside KES could ever be displayed. A fixture carrying only collectable
      currencies could not have caught that, so it carries these on purpose.
    */
    for (const code of ['UGX', 'NGN', 'TZS']) {
      expect(isKnownCurrency(code), `${code} must be known`).toBe(true);
      expect(isCollectableCurrency(code), `${code} must NOT be collectable`).toBe(false);
    }
  });
});
