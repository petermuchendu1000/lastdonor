/**
 * Ratchet: importing the storage module must not require credentials.
 *
 * ## The defect this pins
 *
 * `src/lib/supabase-storage.ts` used to call `createClient()` at module
 * scope with `createClient(supabaseUrl ?? '', ...)`. The `?? ''` reads as
 * tolerance for a missing variable and is the opposite:
 * `createClient('')` throws `supabaseUrl is required`. A `console.warn`
 * sat immediately above it, printing "not set" as though execution would
 * continue.
 *
 * `next build` imports every route handler to collect page data, so a
 * build with no Supabase credentials failed **entirely** — not gracefully,
 * and not only for storage routes:
 *
 *     Error: supabaseUrl is required.
 *     > Build error occurred
 *     [Error: Failed to collect page data for
 *      /api/v1/admin/verification-documents/[documentId]]
 *
 * ## Why it stayed hidden
 *
 * Two independent reasons, both worth knowing:
 *
 * 1. The `build` job had never executed in CI (`docs/50`, `docs/97`). Its
 *    first run in this repository's history is what produced that trace.
 * 2. `test/security/verification-document-privacy.test.ts` had already hit
 *    this exact wall and **worked around it**, with a `vi.hoisted` block
 *    stubbing both variables and the comment "`@supabase/supabase-js`
 *    throws from `createClient('')`, so the storage module cannot be
 *    imported at all without these."
 *
 * That second one is the more useful lesson: a workaround written to get a
 * test passing kept a build-breaking defect invisible. The workaround is
 * still there and is still correct for that file's purposes — it needs a
 * usable client — but it must no longer be the only thing standing between
 * this module and an import failure.
 *
 * So this file asserts the property directly: **no credentials, clean
 * import.** It is the only test that deliberately imports the module with
 * the environment stripped.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
const saved = new Map<string, string | undefined>();

for (const k of KEYS) saved.set(k, process.env[k]);

function stripCredentials(): void {
  for (const k of KEYS) delete process.env[k];
}

beforeEach(() => {
  // A fresh module registry per test, so the cached client from one test
  // cannot satisfy the next one and make a regression look fine.
  vi.resetModules();
  stripCredentials();
});

afterAll(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('supabase-storage imports without credentials', () => {
  it('loads the module at all with the environment stripped', async () => {
    // The whole point. Before the fix this rejected, and `next build` died
    // with it while collecting page data.
    const mod = await import('./supabase-storage');
    expect(mod.BUCKET_NAME).toBe('media');
    expect(typeof mod.isPrivateStoragePath).toBe('function');
  });

  it('still answers the questions that need no client', async () => {
    const { isPrivateStoragePath, validateFile, PRIVATE_BUCKET_NAME } =
      await import('./supabase-storage');

    expect(isPrivateStoragePath('verification-documents/a.pdf')).toBe(true);
    expect(isPrivateStoragePath('avatars/u1/a.png')).toBe(false);
    expect(PRIVATE_BUCKET_NAME).not.toBe('media');
    expect(
      validateFile({ type: 'image/png', size: 1024 } as File),
    ).toBeNull();
  });

  it('refuses a private key BEFORE it complains about credentials', async () => {
    /*
      Ordering matters and is not incidental. A private storage key must be
      refused whether or not storage happens to be configured, so the
      `PrivateObjectError` check has to come first. If the credential check
      moved ahead of it, a deployment with no credentials would report a
      configuration problem for a request that should be reported as an
      attempt to publish private data — and the security assertion in
      docs/31 §1.2 would be answering a different question.
    */
    const { getPublicUrl, PrivateObjectError } = await import('./supabase-storage');
    expect(() => getPublicUrl('verification-documents/a.pdf')).toThrow(
      PrivateObjectError,
    );
  });

  it('raises a named, actionable error when a client is genuinely needed', async () => {
    const { getPublicUrl, StorageNotConfiguredError } =
      await import('./supabase-storage');

    // A public key with no credentials is the one case that must reach the
    // client, so this is where the configuration error belongs.
    expect(() => getPublicUrl('avatars/u1/a.png')).toThrow(
      StorageNotConfiguredError,
    );
    expect(() => getPublicUrl('avatars/u1/a.png')).toThrow(
      /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it('reads the environment lazily, not at import time', async () => {
    /*
      Proves the laziness is real rather than a reshuffle. The module is
      imported with nothing set, the variables appear afterwards, and the
      client is then built successfully. A module-scope read would have
      captured `undefined` and kept failing.
    */
    const { getPublicUrl, supabase } = await import('./supabase-storage');

    process.env.SUPABASE_URL = 'https://lazy-probe.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'lazy-probe-key';

    expect(getPublicUrl('avatars/u1/a.png')).toBe(
      'https://lazy-probe.supabase.co/storage/v1/object/public/media/avatars/u1/a.png',
    );
    expect(typeof supabase.storage.from).toBe('function');
  });
});
