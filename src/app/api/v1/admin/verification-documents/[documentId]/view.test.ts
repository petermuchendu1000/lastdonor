/**
 * An admin must be able to open an identity document (docs/88 F2).
 *
 * `verificationDocuments.fileUrl` holds `supabase-private://<bucket>/<key>`,
 * a reference to an object in a PRIVATE bucket. The admin list endpoint
 * returned it raw and the review queue rendered `<a href={doc.fileUrl}>`,
 * so clicking View handed the browser an unknown URL scheme and nothing
 * happened. The organiser side signed correctly all along; the admin side
 * never called `parseStorageRef` at all.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

const DOC_ID = '44444444-4444-4444-4444-444444444444';
const SIGNED = 'https://proj.supabase.co/storage/v1/object/sign/verification/k?token=abc';

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  signed: { signedUrl: null as string | null, error: null as string | null },
  signCalls: [] as Array<[string, string]>,
}));

vi.mock('@/lib/auth', () => ({
  requireRole: async () => ({ user: { id: 'admin-1', role: 'admin' } }),
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
}));

vi.mock('@/db', () => {
  const chain = { from: () => chain, where: () => chain, limit: async () => state.rows };
  return { db: { select: () => chain, update: () => ({ set: () => ({ where: async () => {} }) }), insert: () => ({ values: async () => {} }) } };
});

vi.mock('@/lib/supabase-storage', () => ({
  parseStorageRef: (v: string) =>
    v.startsWith('supabase-private://') ? { bucket: 'verification', key: v.split('/').pop()! } : null,
  createSignedObjectUrl: async (bucket: string, key: string) => {
    state.signCalls.push([bucket, key]);
    return state.signed;
  },
}));

const { GET } = await import('./route');
const params = Promise.resolve({ documentId: DOC_ID });

beforeEach(() => {
  state.rows = [{ id: DOC_ID, fileUrl: 'supabase-private://verification/passport.pdf' }];
  state.signed = { signedUrl: SIGNED, error: null };
  state.signCalls = [];
});

describe('opening a document', () => {
  it('redirects to a signed URL instead of a private reference', async () => {
    const res = await GET({} as NextRequest, { params });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(SIGNED);
  });

  it('signs the bucket and key parsed from the stored reference', async () => {
    await GET({} as NextRequest, { params });
    expect(state.signCalls).toEqual([['verification', 'passport.pdf']]);
  });

  /* The redirect target is a time-limited credential. */
  it('is never cached', async () => {
    const res = await GET({} as NextRequest, { params });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('never hands back the raw private reference', async () => {
    const res = await GET({} as NextRequest, { params });
    expect(res.headers.get('location')).not.toContain('supabase-private://');
  });
});

describe('when it cannot produce a URL', () => {
  it('404s an unknown document', async () => {
    state.rows = [];
    expect((await GET({} as NextRequest, { params })).status).toBe(404);
  });

  it('500s an unparseable reference rather than redirecting nowhere', async () => {
    state.rows = [{ id: DOC_ID, fileUrl: 'not-a-reference' }];
    expect((await GET({} as NextRequest, { params })).status).toBe(500);
  });

  it('500s when signing fails', async () => {
    state.signed = { signedUrl: null, error: 'boom' };
    expect((await GET({} as NextRequest, { params })).status).toBe(500);
  });
});

/* The half that made the bug invisible: the link itself. */
describe('the review queue links to the signing route', () => {
  const QUEUE = readFileSync(join(process.cwd(), 'src/components/admin/VerificationQueue.tsx'), 'utf8');
  const code = QUEUE.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  it('does not render the stored reference as an href', () => {
    expect(code).not.toContain('href={doc.fileUrl}');
  });

  it('points at the admin document route', () => {
    expect(code).toContain('/api/v1/admin/verification-documents/${doc.id}');
  });
});
