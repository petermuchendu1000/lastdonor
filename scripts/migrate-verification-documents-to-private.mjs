#!/usr/bin/env node
/**
 * Migrate verification documents out of the PUBLIC bucket (audit P0-1).
 *
 * Context
 * -------
 * Before the P0-1 fix, `/api/v1/user-campaigns/[id]/verification/documents`
 * uploaded government IDs, medical records and death certificates into the
 * public `media` bucket and persisted `getPublicUrl(...)` — a permanent,
 * unauthenticated URL — into `verification_documents.file_url`.
 *
 * The code fix stops NEW uploads from going there. This script moves the ones
 * already uploaded: it copies each object from `media/verification-documents/…`
 * into the private bucket under the same key, rewrites `file_url` to the
 * `supabase-private://…` reference the application now expects, and only then
 * deletes the public copy.
 *
 * Run order (matters)
 * -------------------
 *   1. OPERATOR: create the private bucket in the Supabase dashboard
 *      (Storage → New bucket, name = SUPABASE_PRIVATE_BUCKET or "verification",
 *      Public = OFF). This script will not create it.
 *   2. Deploy the application code containing the P0-1 fix.
 *   3. Run this script with --dry-run and read the plan.
 *   4. Run it for real.
 *   5. Re-run `docs/31` §0.1's check: a previously-working
 *      `/storage/v1/object/public/media/verification-documents/...` URL must
 *      now return 400/403 unauthenticated.
 *
 * Any URL already handed out is burned regardless of this script — the objects
 * were world-readable for the whole period they existed. Treat every document
 * uploaded before the fix as disclosed, and re-request anything still needed
 * for an open review.
 *
 * Usage
 * -----
 *   node scripts/migrate-verification-documents-to-private.mjs --dry-run
 *   node scripts/migrate-verification-documents-to-private.mjs
 *   node scripts/migrate-verification-documents-to-private.mjs --keep-public
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL.
 * Idempotent: rows already holding a `supabase-private://` reference are skipped.
 */

import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

const DRY_RUN = process.argv.includes('--dry-run');
const KEEP_PUBLIC = process.argv.includes('--keep-public');

const PUBLIC_BUCKET = 'media';
const PRIVATE_BUCKET = process.env.SUPABASE_PRIVATE_BUCKET ?? 'verification';
const PRIVATE_REF_SCHEME = 'supabase-private';
const PREFIX = 'verification-documents/';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DATABASE_URL) {
  console.error(
    'Missing env. Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL.',
  );
  process.exit(1);
}

const storage = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
}).storage;

// Migrations use port 5432 (session mode); prepare:false for the 6543 pooler.
const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });

/** Pull the object key out of a legacy public URL, or null. */
function keyFromPublicUrl(value) {
  if (!value || !/^https?:\/\//i.test(value)) return null;
  let parsed;
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

async function main() {
  console.log(
    `${DRY_RUN ? '[DRY RUN] ' : ''}Migrating ${PUBLIC_BUCKET}/${PREFIX}* -> ${PRIVATE_BUCKET}/${PREFIX}*`,
  );

  // Verify the private bucket exists before touching anything.
  const { data: buckets, error: bucketErr } = await storage.listBuckets();
  if (bucketErr) {
    console.error('Could not list buckets:', bucketErr.message);
    process.exit(1);
  }
  const target = buckets.find((b) => b.name === PRIVATE_BUCKET);
  if (!target) {
    console.error(
      `Private bucket "${PRIVATE_BUCKET}" does not exist. Create it in the ` +
      `Supabase dashboard with Public = OFF, then re-run. This script will ` +
      `not create or reconfigure buckets.`,
    );
    process.exit(1);
  }
  if (target.public) {
    console.error(
      `Bucket "${PRIVATE_BUCKET}" exists but is PUBLIC. Set Public = OFF ` +
      `before migrating, or this script would move PII from one world-readable ` +
      `bucket to another.`,
    );
    process.exit(1);
  }

  const rows = await sql`
    SELECT id, file_url
    FROM verification_documents
    ORDER BY created_at
  `;

  let moved = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (String(row.file_url).startsWith(`${PRIVATE_REF_SCHEME}://`)) {
      skipped++;
      continue;
    }

    const ref = keyFromPublicUrl(row.file_url);
    if (!ref) {
      console.warn(`  ! ${row.id}: unrecognised file_url, left untouched`);
      failed++;
      continue;
    }
    if (ref.bucket !== PUBLIC_BUCKET || !ref.key.startsWith(PREFIX)) {
      console.warn(
        `  ! ${row.id}: key ${ref.bucket}/${ref.key} is outside ${PUBLIC_BUCKET}/${PREFIX}, left untouched`,
      );
      failed++;
      continue;
    }

    const newRef = `${PRIVATE_REF_SCHEME}://${PRIVATE_BUCKET}/${ref.key}`;
    console.log(`  ${row.id}: ${ref.bucket}/${ref.key} -> ${newRef}`);
    if (DRY_RUN) {
      moved++;
      continue;
    }

    // Download from public, upload to private, rewrite the row, then delete
    // the public copy. Ordered so a crash leaves the document readable to
    // admins rather than orphaned.
    const { data: blob, error: dlErr } = await storage
      .from(PUBLIC_BUCKET)
      .download(ref.key);
    if (dlErr || !blob) {
      console.error(`    download failed: ${dlErr?.message ?? 'no body'}`);
      failed++;
      continue;
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    const { error: upErr } = await storage
      .from(PRIVATE_BUCKET)
      .upload(ref.key, buffer, {
        contentType: blob.type || 'application/octet-stream',
        cacheControl: 'no-store',
        upsert: true,
      });
    if (upErr) {
      console.error(`    upload failed: ${upErr.message}`);
      failed++;
      continue;
    }

    await sql`
      UPDATE verification_documents
      SET file_url = ${newRef}
      WHERE id = ${row.id}
    `;

    if (!KEEP_PUBLIC) {
      const { error: rmErr } = await storage
        .from(PUBLIC_BUCKET)
        .remove([ref.key]);
      if (rmErr) {
        console.error(
          `    WARNING: private copy and row are updated but the public copy ` +
          `remains at ${PUBLIC_BUCKET}/${ref.key}: ${rmErr.message}`,
        );
      }
    }

    moved++;
  }

  console.log(
    `\n${DRY_RUN ? '[DRY RUN] ' : ''}moved=${moved} already-private=${skipped} failed=${failed}`,
  );
  if (failed > 0) {
    console.log(
      'Rows reported as failed still point at the public bucket. Resolve each ' +
      'before considering P0-1 closed.',
    );
  }

  // Sweep for orphans: objects under the prefix with no row referencing them.
  const { data: listed, error: listErr } = await storage
    .from(PUBLIC_BUCKET)
    .list(PREFIX.replace(/\/$/, ''), { limit: 1000 });
  if (!listErr && listed?.length) {
    console.log(
      `\n${listed.length} entr${listed.length === 1 ? 'y' : 'ies'} still listed under ` +
      `${PUBLIC_BUCKET}/${PREFIX} (sub-folders count as one entry each). ` +
      `Inspect and remove any remaining objects manually.`,
    );
  }

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end({ timeout: 1 });
  process.exit(1);
});
