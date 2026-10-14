/**
 * Verification documents must never be world-readable — audit P0-1,
 * remediation docs/31 §1.2.
 *
 * Before this fix, `src/lib/supabase-storage.ts:14` put verification documents
 * in the same bucket as avatars (`media`, public) and
 * `.../verification/documents/route.ts:144` persisted `getPublicUrl(...)` — a
 * permanent unauthenticated URL — into `verificationDocuments.fileUrl`, for
 * government IDs, medical records and death certificates.
 * `grep -rn createSignedUrl src/` returned zero hits: there was no private
 * read path anywhere.
 *
 * docs/31 §1.2 states the acceptance criteria these tests encode:
 *   - no code path can produce a public URL for a `verification-documents/` key
 *   - `grep -r getPublicUrl` shows no verification-document call site
 *   - an unauthenticated and a non-admin request both fail
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../..');
const ROUTE = 'src/app/api/v1/user-campaigns/[id]/verification/documents/route.ts';

// `@supabase/supabase-js` throws from `createClient('')`, so the storage module
// cannot be imported at all without these. Hoisted above the `vi.mock`
// factories, which call `importActual` on it.
vi.hoisted(() => {
  process.env.SUPABASE_URL ||= 'https://test-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
});

/** Source text with comments removed, so a doc comment cannot satisfy or
 *  break an assertion about what the code does. */
function codeOf(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// ── 1. The storage layer fails closed ──────────────────────────────────────

describe('P0-1: the storage layer cannot publish a verification document', () => {
  it('refuses to build a public URL for a verification-documents key', async () => {
    const { getPublicUrl, PrivateObjectError } = await import('@/lib/supabase-storage');
    expect(() =>
      getPublicUrl('verification-documents/campaign-1/doc.pdf'),
    ).toThrow(PrivateObjectError);
  });

  it('refuses regardless of a leading slash or key casing', async () => {
    const { getPublicUrl } = await import('@/lib/supabase-storage');
    expect(() => getPublicUrl('/verification-documents/c/d.pdf')).toThrow();
    expect(() => getPublicUrl('Verification-Documents/c/d.pdf')).toThrow();
  });

  it('closes the /api/v1/upload folder parameter too', async () => {
    // `/api/v1/upload` builds its key from a caller-supplied `folder`. Without
    // a check in getPublicUrl, `folder=verification-documents` would mint a
    // public URL under the private prefix from a route nobody audited.
    const { getPublicUrl } = await import('@/lib/supabase-storage');
    expect(() => getPublicUrl('verification-documents/attacker.png')).toThrow();
  });

  it('still serves genuinely public keys', async () => {
    const { getPublicUrl, isPrivateStoragePath } = await import('@/lib/supabase-storage');
    expect(isPrivateStoragePath('avatars/u1/a.png')).toBe(false);
    expect(isPrivateStoragePath('campaign-photos/x.jpg')).toBe(false);
    expect(() => getPublicUrl('avatars/u1/a.png')).not.toThrow();
  });

  it('declares a private bucket distinct from the public one', async () => {
    const { BUCKET_NAME, PRIVATE_BUCKET_NAME } = await import('@/lib/supabase-storage');
    expect(BUCKET_NAME).toBe('media');
    expect(PRIVATE_BUCKET_NAME).not.toBe(BUCKET_NAME);
    expect(PRIVATE_BUCKET_NAME.length).toBeGreaterThan(0);
  });

  it('issues signed URLs with a TTL of at most 15 minutes', async () => {
    const { SIGNED_URL_TTL_SECONDS } = await import('@/lib/supabase-storage');
    expect(SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(900);
    expect(SIGNED_URL_TTL_SECONDS).toBeGreaterThan(0);
  });

  it('refuses a private upload for a key outside the private prefix', async () => {
    const { uploadPrivateObject } = await import('@/lib/supabase-storage');
    const { error } = await uploadPrivateObject('avatars/u1/a.png', Buffer.from(''), {
      contentType: 'image/png',
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not under a private prefix/);
  });

  it('refuses to sign a key containing traversal segments', async () => {
    // importActual: the module-level vi.mock below replaces this export.
    const { createSignedObjectUrl } = await vi.importActual<
      typeof import('@/lib/supabase-storage')
    >('@/lib/supabase-storage');
    const { signedUrl, error } = await createSignedObjectUrl(
      'verification',
      '../media/avatars/u1/a.png',
    );
    expect(signedUrl).toBeNull();
    expect(error).toMatch(/Invalid storage key/);
  });
});

// ── 2. What is persisted is not a URL ──────────────────────────────────────

describe('P0-1: stored references are not dereferenceable', () => {
  it('privateObjectRef produces a non-HTTP reference', async () => {
    const { privateObjectRef } = await import('@/lib/supabase-storage');
    const ref = privateObjectRef('verification-documents/c1/doc.pdf');
    expect(ref).not.toMatch(/^https?:\/\//);
    expect(ref).toMatch(/^supabase-private:\/\//);
    expect(ref).not.toContain('/object/public/');
  });

  it('round-trips a stored reference back to bucket and key', async () => {
    const { privateObjectRef, parseStorageRef, PRIVATE_BUCKET_NAME } =
      await import('@/lib/supabase-storage');
    const key = 'verification-documents/c1/doc.pdf';
    expect(parseStorageRef(privateObjectRef(key))).toEqual({
      bucket: PRIVATE_BUCKET_NAME,
      key,
    });
  });

  it('parses a LEGACY public URL so pre-fix rows remain reviewable', async () => {
    const { parseStorageRef } = await import('@/lib/supabase-storage');
    const legacy =
      'https://ntnrcedafgmeyajmzvga.supabase.co/storage/v1/object/public/media/' +
      'verification-documents/c1/doc.pdf';
    expect(parseStorageRef(legacy)).toEqual({
      bucket: 'media',
      key: 'verification-documents/c1/doc.pdf',
    });
  });

  it('returns null for junk rather than guessing a key', async () => {
    const { parseStorageRef } = await import('@/lib/supabase-storage');
    expect(parseStorageRef('')).toBeNull();
    expect(parseStorageRef('https://evil.example.com/doc.pdf')).toBeNull();
    expect(parseStorageRef('../../etc/passwd')).toBeNull();
  });
});

// ── 3. The route no longer publishes, and reads are admin-only ─────────────

describe('P0-1: the upload route writes privately', () => {
  const source = codeOf(ROUTE);

  it('does not import or call getPublicUrl', () => {
    expect(source).not.toMatch(/getPublicUrl/);
  });

  it('does not write into the public bucket', () => {
    expect(source).not.toMatch(/BUCKET_NAME/);
    expect(source).toMatch(/uploadPrivateObject/);
  });

  it('persists a private reference into fileUrl', () => {
    expect(source).toMatch(/fileUrl:\s*privateObjectRef\(/);
  });

  it('does not return a document URL from the upload response', () => {
    const postResponse = source.slice(
      source.indexOf('.returning({ id: verificationDocuments.id'),
      source.indexOf('} catch (error) {'),
    );
    expect(postResponse).not.toMatch(/fileUrl/);
    expect(postResponse).not.toMatch(/\burl\b/);
  });

  it('exposes a read path that requires the admin role', () => {
    expect(source).toMatch(/export async function GET/);
    expect(source).toMatch(/requireRole\(\['admin'\]\)/);
    expect(source).toMatch(/createSignedObjectUrl/);
  });

  it('authorises before looking the document up', () => {
    const getBody = source.slice(source.indexOf('export async function GET'));
    const authAt = getBody.indexOf('requireRole');
    const queryAt = getBody.indexOf('db\n      .select');
    const selectAt = queryAt === -1 ? getBody.indexOf('.select(') : queryAt;
    expect(authAt).toBeGreaterThan(-1);
    expect(selectAt).toBeGreaterThan(authAt);
  });

  it('scopes the document to the campaign in the path', () => {
    const getBody = source.slice(source.indexOf('export async function GET'));
    expect(getBody).toMatch(/doc\.campaignId\s*!==\s*campaignId/);
  });

  it('maps UnauthorizedError to 401 and ForbiddenError to 403', () => {
    const getBody = source.slice(source.indexOf('export async function GET'));
    expect(getBody).toMatch(/UnauthorizedError[\s\S]*?status:\s*401/);
    expect(getBody).toMatch(/ForbiddenError[\s\S]*?status:\s*403/);
  });
});

// ── 4. The GET handler, exercised ──────────────────────────────────────────

const authMock = vi.hoisted(() => ({
  requireRole: vi.fn(),
  auth: vi.fn(),
}));

const storageMock = vi.hoisted(() => ({
  createSignedObjectUrl: vi.fn(),
}));

const dbRows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock('@/lib/auth', async () => {
  class UnauthorizedError extends Error {
    constructor() { super('Unauthorized'); this.name = 'UnauthorizedError'; }
  }
  class ForbiddenError extends Error {
    constructor() { super('Forbidden'); this.name = 'ForbiddenError'; }
  }
  return {
    auth: authMock.auth,
    requireRole: authMock.requireRole,
    UnauthorizedError,
    ForbiddenError,
  };
});

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => dbRows.value }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: async () => [] }) }),
  },
}));

vi.mock('@/lib/supabase-storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase-storage')>(
    '@/lib/supabase-storage',
  );
  return { ...actual, createSignedObjectUrl: storageMock.createSignedObjectUrl };
});

describe('P0-1: GET issues a signed URL only to an admin', () => {
  beforeEach(() => {
    dbRows.value = [];
    storageMock.createSignedObjectUrl.mockReset();
    authMock.requireRole.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  async function callGet(documentId = 'doc-1', campaignId = 'camp-1') {
    const { GET } = await import(
      '@/app/api/v1/user-campaigns/[id]/verification/documents/route'
    );
    const { NextRequest } = await import('next/server');
    const req = new NextRequest(
      `https://lastdonor.test/api/v1/user-campaigns/${campaignId}/verification/documents?documentId=${documentId}`,
    );
    const res = await GET(req, { params: Promise.resolve({ id: campaignId }) });
    return { status: res.status, body: await res.json() };
  }

  it('returns 401 when there is no session', async () => {
    const { UnauthorizedError } = await import('@/lib/auth');
    authMock.requireRole.mockRejectedValue(new UnauthorizedError());
    const { status, body } = await callGet();
    expect(status).toBe(401);
    expect(body.ok).toBe(false);
    expect(storageMock.createSignedObjectUrl).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-admin role, including the uploader', async () => {
    const { ForbiddenError } = await import('@/lib/auth');
    authMock.requireRole.mockRejectedValue(new ForbiddenError());
    const { status, body } = await callGet();
    expect(status).toBe(403);
    expect(body.ok).toBe(false);
    expect(storageMock.createSignedObjectUrl).not.toHaveBeenCalled();
  });

  it('issues a signed URL for an admin', async () => {
    authMock.requireRole.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } });
    dbRows.value = [{
      id: 'doc-1',
      campaignId: 'camp-1',
      fileUrl: 'supabase-private://verification/verification-documents/camp-1/doc.pdf',
      fileName: 'id.pdf',
      mimeType: 'application/pdf',
    }];
    storageMock.createSignedObjectUrl.mockResolvedValue({
      signedUrl: 'https://ntnrcedafgmeyajmzvga.supabase.co/storage/v1/object/sign/verification/x?token=t',
      error: null,
    });

    const { status, body } = await callGet();
    expect(status).toBe(200);
    expect(body.data.url).toContain('/object/sign/');
    expect(body.data.expiresInSeconds).toBeLessThanOrEqual(900);
    expect(authMock.requireRole).toHaveBeenCalledWith(['admin']);
    expect(storageMock.createSignedObjectUrl).toHaveBeenCalledWith(
      'verification',
      'verification-documents/camp-1/doc.pdf',
    );
  });

  it('404s when the document belongs to a different campaign', async () => {
    authMock.requireRole.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } });
    dbRows.value = [{
      id: 'doc-1',
      campaignId: 'some-other-campaign',
      fileUrl: 'supabase-private://verification/verification-documents/other/doc.pdf',
      fileName: 'id.pdf',
      mimeType: 'application/pdf',
    }];

    const { status } = await callGet('doc-1', 'camp-1');
    expect(status).toBe(404);
    expect(storageMock.createSignedObjectUrl).not.toHaveBeenCalled();
  });

  it('400s without a documentId', async () => {
    authMock.requireRole.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } });
    const { GET } = await import(
      '@/app/api/v1/user-campaigns/[id]/verification/documents/route'
    );
    const { NextRequest } = await import('next/server');
    const req = new NextRequest(
      'https://lastdonor.test/api/v1/user-campaigns/camp-1/verification/documents',
    );
    const res = await GET(req, { params: Promise.resolve({ id: 'camp-1' }) });
    expect(res.status).toBe(400);
  });
});

// ── 5. Operator handover is recorded in code, not only in a chat log ───────

describe('P0-1: the manual operator steps are documented at the code', () => {
  it('supabase-storage records that the private bucket is created by hand', async () => {
    const source = readFileSync(resolve(ROOT, 'src/lib/supabase-storage.ts'), 'utf-8');
    expect(source).toMatch(/OPERATOR ACTION REQUIRED/);
    expect(source).toMatch(/Public = off/i);
  });

  it('a migration script exists for objects already in the public bucket', () => {
    const source = readFileSync(
      resolve(ROOT, 'scripts/migrate-verification-documents-to-private.mjs'),
      'utf-8',
    );
    expect(source).toMatch(/--dry-run/);
    // It must refuse to run against a bucket that is still public.
    expect(source).toMatch(/is PUBLIC/);
  });
});
