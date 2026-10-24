import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/*
  The storage client is built ON FIRST USE, not when this module is imported.

  ## What the eager version broke

  It used to be a module-scope `createClient(supabaseUrl ?? '', ...)`, with a
  `console.warn` above it when the env vars were absent. The `?? ''` looks
  like it tolerates a missing variable and does the opposite:
  `createClient('')` throws `supabaseUrl is required`. So the warning printed
  "not set", as if execution would continue, and the next statement threw.

  `next build` imports every route to collect page data, so **any build
  without Supabase credentials failed entirely** - not the storage routes,
  the whole build:

      Supabase Storage: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set
      Error: supabaseUrl is required.
      > Build error occurred
      [Error: Failed to collect page data for
       /api/v1/admin/verification-documents/[documentId]]

  Nothing caught it for two reasons, and both are worth recording. The
  `build` job had never executed in CI (docs/50, docs/97) - its first ever
  run is what produced the trace above. And the test suite had already met
  this exact wall and worked around it rather than reported it:
  `test/security/verification-document-privacy.test.ts` carries a
  `vi.hoisted` block stubbing both variables, with the comment
  "`@supabase/supabase-js` throws from `createClient('')`, so the storage
  module cannot be imported at all without these." A workaround in a test
  kept a defect in the code invisible.

  ## Why lazy is the right shape, not just the convenient one

  Collecting page data for a route does not need a storage client, so the
  build has no business requiring storage credentials. Deferring
  construction means a missing credential fails *where it matters* - inside
  the request that actually wants to read or write an object, which can
  return a 500 - instead of taking down the build. It also means a
  contributor without Supabase credentials can build the app.

  Reading `process.env` inside the function rather than at module scope is
  deliberate: it makes the laziness real, so a variable set after import is
  still seen. See docs/97 §5.4.
*/

/** Raised when storage is used on a deployment that has no credentials. */
export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      'Supabase storage is not configured: SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY must both be set. This is a deployment ' +
        'configuration problem, not a caller error - no upload, signed URL ' +
        'or public URL can be produced without them.',
    );
    this.name = 'StorageNotConfiguredError';
  }
}

let cachedClient: SupabaseClient | null = null;

/** The storage client, constructed once, on demand. */
function storageClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new StorageNotConfiguredError();
  }

  cachedClient = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  return cachedClient;
}

/**
 * Storage surface used across the app as `supabase.storage.from(...)`.
 *
 * A getter rather than a client instance, so importing this module costs
 * nothing and every existing call site keeps working unchanged.
 */
export const supabase = {
  get storage(): SupabaseClient['storage'] {
    return storageClient().storage;
  },
};

/**
 * Public bucket. Everything in it is served from
 * `/storage/v1/object/public/<bucket>/<path>` with no authentication, forever.
 * Only content that is *meant* to be world-readable belongs here: avatars,
 * campaign photos, gallery images.
 */
export const BUCKET_NAME = 'media';

/**
 * Private bucket for identity and medical evidence (audit P0-1).
 *
 * Verification documents — government IDs, medical records, death
 * certificates — were previously uploaded into `BUCKET_NAME` and persisted as
 * `getPublicUrl(...)`, i.e. a permanent unauthenticated URL. No private access
 * path existed anywhere in the codebase (`grep -rn createSignedUrl src/`
 * returned zero hits). They now go here, and are only ever read through
 * `createSignedObjectUrl`.
 *
 * ⚠️ OPERATOR ACTION REQUIRED — this bucket is NOT created by code.
 * Supabase buckets are provisioned out of band; creating one from application
 * code would mean the running app can change its own storage ACLs, which is
 * exactly the privilege this fix is trying to remove. Create it in the Supabase
 * dashboard (Storage → New bucket) with **Public = off**. Until it exists,
 * verification-document uploads fail closed with a 500 rather than silently
 * writing PII somewhere world-readable.
 */
export const PRIVATE_BUCKET_NAME =
  process.env.SUPABASE_PRIVATE_BUCKET ?? 'verification';

/**
 * Object-key prefixes that may never live in the public bucket and may never
 * be turned into a public URL. Matching is on the storage key, so it holds
 * regardless of which route does the uploading.
 */
export const PRIVATE_PATH_PREFIXES = [
  'verification-documents/',
  // P0-1b: info-request responses are the documents a campaigner sends when an
  // admin asks for further verification evidence - the same category of
  // sensitive material as verification-documents/, and they were going to the
  // public bucket by the same mechanism until 2026-10-14. See docs/32 §1.
  'info-request-responses/',
] as const;

/**
 * TTL for issued signed URLs, in seconds.
 *
 * 15 minutes. Long enough for an admin to open a PDF or image in a reviewer
 * tab, short enough that a URL leaked through a referrer header, a screenshot
 * or a browser history export is dead before it is useful. This also makes
 * true the claim `docs/06:248` and `docs/21:388,1775` have been making since
 * before this control existed.
 */
export const SIGNED_URL_TTL_SECONDS = 900;

/** Scheme used to persist a private object reference in place of a URL. */
const PRIVATE_REF_SCHEME = 'supabase-private';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

/** Raised when code attempts to expose a private object publicly. */
export class PrivateObjectError extends Error {
  constructor(path: string) {
    super(
      `Refusing to build a public URL for private storage key "${path}". ` +
      `Keys under ${PRIVATE_PATH_PREFIXES.join(', ')} must be served via ` +
      `createSignedObjectUrl() to an authorised caller only.`,
    );
    this.name = 'PrivateObjectError';
  }
}

export function validateFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return `Invalid file type. Allowed: ${ALLOWED_TYPES.join(', ')}`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`;
  }
  return null;
}

/** Normalise a storage key: no leading slash, no traversal segments. */
function normaliseKey(path: string): string {
  return path.replace(/^\/+/, '');
}

/** True when this object key holds content that must never be public. */
export function isPrivateStoragePath(path: string): boolean {
  const key = normaliseKey(path).toLowerCase();
  return PRIVATE_PATH_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Build a public URL for an object in the public bucket.
 *
 * Fails closed for private keys. This is the assertion behind docs/31 §1.2's
 * acceptance criterion "no code path can produce a public URL for a
 * `verification-documents/` key": it holds for every caller, including the
 * `folder`-parameterised `/api/v1/upload` route, not just the verification
 * route that was fixed.
 */
export function getPublicUrl(path: string): string {
  if (isPrivateStoragePath(path)) {
    throw new PrivateObjectError(path);
  }
  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Upload an object into the private bucket.
 * Refuses keys that are not under a private prefix, so the private bucket
 * cannot quietly become a second general-purpose store.
 */
export async function uploadPrivateObject(
  path: string,
  body: Buffer | Uint8Array | ArrayBuffer | Blob,
  options: { contentType: string; upsert?: boolean },
): Promise<{ error: { message: string } | null }> {
  const key = normaliseKey(path);
  if (!isPrivateStoragePath(key)) {
    return {
      error: {
        message:
          `Key "${key}" is not under a private prefix ` +
          `(${PRIVATE_PATH_PREFIXES.join(', ')}); refusing private upload.`,
      },
    };
  }

  const { error } = await supabase.storage
    .from(PRIVATE_BUCKET_NAME)
    .upload(key, body, {
      contentType: options.contentType,
      // Private objects are never served from a CDN, so a long cache control
      // buys nothing and only widens the window of an intermediary copy.
      cacheControl: 'no-store',
      upsert: options.upsert ?? false,
    });

  return { error: error ? { message: error.message } : null };
}

/**
 * Reference stored in the database in place of a URL.
 *
 * `verificationDocuments.fileUrl` is `NOT NULL` and repairing migrations is
 * out of scope here (see CLAUDE.md), so the column keeps holding a string —
 * but a deliberately non-dereferenceable one. If this value leaks through a
 * log, an API response or a mis-scoped select, it grants nothing.
 */
export function privateObjectRef(path: string): string {
  return `${PRIVATE_REF_SCHEME}://${PRIVATE_BUCKET_NAME}/${normaliseKey(path)}`;
}

/**
 * Resolve a stored `fileUrl` value back to a (bucket, key) pair.
 *
 * Handles three shapes:
 *   1. `supabase-private://<bucket>/<key>` — written by this module.
 *   2. A legacy public URL `…/storage/v1/object/public/<bucket>/<key>` —
 *      written before this fix. Returned so admin review keeps working on
 *      already-uploaded documents, which still need signing even while they
 *      sit in the public bucket awaiting the migration script.
 *   3. A bare key.
 *
 * Returns `null` when the value cannot be parsed, so callers 404 rather than
 * guessing.
 */
export function parseStorageRef(
  stored: string,
): { bucket: string; key: string } | null {
  if (!stored) return null;
  const value = stored.trim();

  if (value.startsWith(`${PRIVATE_REF_SCHEME}://`)) {
    const rest = value.slice(`${PRIVATE_REF_SCHEME}://`.length);
    const slash = rest.indexOf('/');
    if (slash <= 0 || slash === rest.length - 1) return null;
    return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
  }

  if (/^https?:\/\//i.test(value)) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return null;
    }
    const m = /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/.exec(
      parsed.pathname,
    );
    if (!m) return null;
    return { bucket: m[1], key: decodeURIComponent(m[2]) };
  }

  // Bare key, assumed to live in the private bucket.
  if (value.includes('..')) return null;
  return { bucket: PRIVATE_BUCKET_NAME, key: normaliseKey(value) };
}

/**
 * Issue a short-lived signed URL for a stored object.
 *
 * The ONLY read path for verification documents. Callers must have already
 * established authorisation — this function performs no authorisation of its
 * own, it just mints the credential.
 */
/**
 * Read a private object's BYTES, server-side.
 *
 * Distinct from `createSignedObjectUrl` on purpose: that mints a credential a
 * browser can follow, this one never produces a shareable handle at all. Used
 * by document screening (`src/lib/screening/`), which has to put the file in
 * front of a model and must not create a URL to do it.
 *
 * Performs NO authorisation. The only caller is a cron-authenticated job
 * (`verifyCronAuth`), and any new caller must establish its own.
 */
export async function downloadPrivateObject(
  bucket: string,
  key: string,
): Promise<{ bytes: Buffer | null; error: string | null }> {
  if (!key || key.includes('..')) {
    return { bytes: null, error: 'Invalid storage key' };
  }

  const { data, error } = await supabase.storage.from(bucket).download(normaliseKey(key));
  if (error || !data) {
    return { bytes: null, error: error?.message ?? 'Failed to download object' };
  }
  return { bytes: Buffer.from(await data.arrayBuffer()), error: null };
}

export async function createSignedObjectUrl(
  bucket: string,
  key: string,
  expiresInSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<{ signedUrl: string | null; error: string | null }> {
  if (!key || key.includes('..')) {
    return { signedUrl: null, error: 'Invalid storage key' };
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(normaliseKey(key), expiresInSeconds);

  if (error || !data?.signedUrl) {
    return { signedUrl: null, error: error?.message ?? 'Failed to sign URL' };
  }
  return { signedUrl: data.signedUrl, error: null };
}
