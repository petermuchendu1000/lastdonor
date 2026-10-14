import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * P0-1b (docs/29, docs/32 §1) — info-request response documents must never be
 * publicly readable.
 *
 * These are the files a campaigner uploads when an admin asks for further
 * verification evidence: the same category of sensitive material as
 * verification-documents/ (government IDs, medical records). Until 2026-10-14
 * they were written to the PUBLIC bucket and persisted as getPublicUrl(), i.e.
 * a non-expiring unauthenticated URL, by exactly the same mechanism as P0-1.
 *
 * docs/29 missed this route, so these tests exist to make the omission
 * impossible to repeat rather than merely fixed once.
 */

vi.hoisted(() => {
  // supabase-storage throws at import without these.
  process.env.SUPABASE_URL ??= 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
});

const ROOT = resolve(__dirname, '../..');
const ROUTE = resolve(ROOT, 'src/app/api/v1/info-requests/[requestId]/route.ts');

/** Route source with comments stripped, so a doc comment can neither satisfy
 *  nor break an assertion about what the code actually does. */
function routeCode(): string {
  return readFileSync(ROUTE, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('P0-1b: info-request responses are private', () => {
  it('declares info-request-responses/ as a private prefix', async () => {
    const { PRIVATE_PATH_PREFIXES } = await import('@/lib/supabase-storage');
    expect(PRIVATE_PATH_PREFIXES).toContain('info-request-responses/');
  });

  it('refuses to mint a public URL for an info-request response key', async () => {
    const { getPublicUrl, PrivateObjectError } = await import('@/lib/supabase-storage');
    expect(() =>
      getPublicUrl('info-request-responses/campaign-1/req-1/file.pdf'),
    ).toThrow(PrivateObjectError);
  });

  it('treats the key as private regardless of a leading slash', async () => {
    const { isPrivateStoragePath } = await import('@/lib/supabase-storage');
    expect(isPrivateStoragePath('info-request-responses/a/b/c.pdf')).toBe(true);
    expect(isPrivateStoragePath('/info-request-responses/a/b/c.pdf')).toBe(true);
  });

  it('accepts the key for a private upload', async () => {
    const { isPrivateStoragePath } = await import('@/lib/supabase-storage');
    // uploadPrivateObject refuses keys outside a private prefix, so this is the
    // precondition for the route's upload succeeding at all.
    expect(isPrivateStoragePath('info-request-responses/x/y/z.docx')).toBe(true);
  });

  it('the route does not call getPublicUrl or write to the public bucket', () => {
    const code = routeCode();
    expect(code).not.toMatch(/getPublicUrl\s*\(/);
    expect(code).not.toMatch(/BUCKET_NAME/);
    expect(code).not.toMatch(/supabase\.storage/);
  });

  it('the route uploads via uploadPrivateObject', () => {
    expect(routeCode()).toMatch(/uploadPrivateObject\s*\(/);
  });

  it('the route persists a non-dereferenceable reference, not a URL', () => {
    const code = routeCode();
    expect(code).toMatch(/privateObjectRef\s*\(/);
    // The stored value must not be fetchable: a link in this column is what
    // made P0-1b a leak, since it is rendered straight into admin HTML.
    expect(code).not.toMatch(/url:\s*getPublicUrl/);
  });

  it('privateObjectRef produces a reference no HTTP client can follow', async () => {
    const { privateObjectRef } = await import('@/lib/supabase-storage');
    const ref = privateObjectRef('info-request-responses/c/r/f.pdf');
    expect(ref).not.toMatch(/^https?:\/\//);
    expect(ref.startsWith('supabase-private://')).toBe(true);
  });

  it('no route under src/app/api writes a public URL for a private prefix', async () => {
    // Catches the next instance of this class anywhere in the API surface,
    // which is the part docs/29 got wrong by auditing one route and not the
    // category.
    const { globSync } = await import('fs');
    void globSync;
    const { execSync } = await import('child_process');
    const hits = execSync(
      `grep -rlE "getPublicUrl" ${resolve(ROOT, 'src/app/api')} || true`,
      { encoding: 'utf-8' },
    )
      .split('\n')
      .filter(Boolean);

    for (const file of hits) {
      const code = readFileSync(file, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const callsPublicUrl = /getPublicUrl\s*\(/.test(code);
      const touchesPrivatePrefix =
        /verification-documents\//.test(code) || /info-request-responses\//.test(code);
      expect(
        callsPublicUrl && touchesPrivatePrefix,
        `${file} calls getPublicUrl() and references a private prefix`,
      ).toBe(false);
    }
  });
});
