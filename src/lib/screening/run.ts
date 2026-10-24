/**
 * Screening one document, end to end: fetch, rasterise, read, decide, record.
 *
 * ── WHY THIS IS NOT IN THE UPLOAD REQUEST ───────────────────────────────────
 *
 * [VERIFIED 2026-10-24] The vision read took **3.4s to 29.5s** on documents of
 * the same shape, and 27.5s on a PDF through the rasteriser. Holding an upload
 * request open for half a minute while an organiser waits - in the middle of
 * the emergency that brought them here - is not a trade worth making, and a
 * provider outage would turn their upload into an error.
 *
 * So screening runs after the fact, from `cron/screen-documents`, and the
 * upload stays fast and independent of OpenRouter being up.
 *
 * ── WHAT IT MAY CHANGE ──────────────────────────────────────────────────────
 *
 * One column, one direction: `verification_documents.status` to `approved`,
 * and only when `decideScreening` returns no flags. `reviewer_id` stays NULL,
 * which is itself the record that no person approved it. It never touches
 * `campaigns.verification_status`, so it cannot authorise a payout or lift the
 * raise cap - see the note on `documentScreenings` in `schema.ts`.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { campaigns, documentScreenings, verificationDocuments } from '@/db/schema';
import { downloadPrivateObject, parseStorageRef } from '@/lib/supabase-storage';
import { decideScreening, type ExtractedFields, type ScreeningDecision } from './decide';
import { rasterisePdfFirstPage, RasterisationError } from './rasterise';
import {
  readDocumentImage,
  isVisionMimeType,
  APPROVED_VISION_MODELS,
  VisionUnavailableError,
} from './vision';

/** Percentage, stored as an integer - see the column comment. */
function toPercent(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

/**
 * A document whose page 1 was read but which has more pages has NOT been read.
 *
 * Extracted so it can be tested on its own: "approved on the strength of page
 * 1 of 9" is a different claim from "the document was checked", and it is the
 * kind of difference that disappears into an inline conditional and never gets
 * asserted. Only the first page is ever rendered (`rasterise.ts`), so this is
 * the rule that stops a multi-page document being approved on a fragment.
 */
export function downgradeForUnreadPages(
  decision: ScreeningDecision,
  hasMorePages: boolean,
  pageCount: number | null,
): { action: 'auto_approve' | 'needs_human'; flags: string[]; summary: string } {
  if (!hasMorePages) {
    return { action: decision.action, flags: [...decision.flags], summary: decision.summary };
  }
  if (decision.action === 'needs_human') {
    // Already going to a person; do not overwrite the more specific reason.
    return { action: 'needs_human', flags: [...decision.flags], summary: decision.summary };
  }
  return {
    action: 'needs_human',
    flags: [...decision.flags, 'pages_not_read'],
    summary: `Only page 1 of ${pageCount ?? 'several'} was read. Please review the rest.`,
  };
}

export interface ScreenOneResult {
  documentId: string;
  action: 'auto_approve' | 'needs_human';
  flags: string[];
  approved: boolean;
  error: string | null;
}

/**
 * Documents waiting to be screened: still `pending`, and with no screening row.
 *
 * The `isNull` on the joined id is what makes the job idempotent at selection
 * time; the UNIQUE constraint on `document_id` is what makes it idempotent
 * even if two runs overlap.
 */
export async function findUnscreenedDocuments(limit: number): Promise<
  { documentId: string; campaignId: string }[]
> {
  const rows = await db
    .select({
      documentId: verificationDocuments.id,
      campaignId: verificationDocuments.campaignId,
    })
    .from(verificationDocuments)
    .leftJoin(documentScreenings, eq(documentScreenings.documentId, verificationDocuments.id))
    .where(and(eq(verificationDocuments.status, 'pending'), isNull(documentScreenings.id)))
    .orderBy(verificationDocuments.createdAt)
    .limit(limit);
  return rows;
}

/**
 * Screen one document.
 *
 * Never throws for a document-level problem: a failure is a recorded
 * `needs_human` row, because a screening job that dies on one bad upload
 * stops screening every document behind it.
 */
export async function screenDocument(documentId: string): Promise<ScreenOneResult> {
  // Query 1. Two tables, one round trip - the pool allows three concurrent
  // queries per entry point (docs/87) and this is sequential anyway.
  const [row] = await db
    .select({
      id: verificationDocuments.id,
      campaignId: verificationDocuments.campaignId,
      documentType: verificationDocuments.documentType,
      fileUrl: verificationDocuments.fileUrl,
      mimeType: verificationDocuments.mimeType,
      status: verificationDocuments.status,
      trustedName: campaigns.diditVerifiedName,
    })
    .from(verificationDocuments)
    .innerJoin(campaigns, eq(campaigns.id, verificationDocuments.campaignId))
    .where(eq(verificationDocuments.id, documentId))
    .limit(1);

  if (!row) {
    return { documentId, action: 'needs_human', flags: ['extraction_failed'], approved: false, error: 'document not found' };
  }

  let extracted: ExtractedFields | null = null;
  let modelUsed: string | null = null;
  let latencyMs: number | null = null;
  let pageCount: number | null = null;
  let hasMorePages = false;
  let error: string | null = null;

  try {
    const ref = parseStorageRef(row.fileUrl);
    if (!ref) throw new Error('storage reference is unreadable');

    const { bytes, error: dlError } = await downloadPrivateObject(ref.bucket, ref.key);
    if (!bytes) throw new Error(`download failed: ${dlError ?? 'unknown'}`);

    let imageBytes = bytes;
    let imageMime = row.mimeType;

    if (row.mimeType === 'application/pdf') {
      const page = await rasterisePdfFirstPage(bytes);
      imageBytes = page.png;
      imageMime = 'image/png';
      pageCount = page.pageCount;
      hasMorePages = page.hasMorePages;
    } else if (!isVisionMimeType(row.mimeType)) {
      throw new Error(`${row.mimeType} cannot be screened`);
    }

    const read = await readDocumentImage({ bytes: imageBytes, mimeType: imageMime });
    modelUsed = read.modelUsed;
    latencyMs = read.latencyMs;
    extracted = {
      issuer: read.issuer,
      personName: read.personName,
      totalAmountText: read.totalAmountText,
      currency: read.currency,
      reference: read.reference,
      textLength: read.textLength,
    };
  } catch (e) {
    // Every failure shape lands here as a recorded reason, never as a throw:
    // a provider outage, a missing poppler, a corrupt upload, a 200-with-error.
    error =
      e instanceof VisionUnavailableError || e instanceof RasterisationError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e);
  }

  const decision = decideScreening({
    documentType: row.documentType,
    extracted,
    trustedName: row.trustedName,
    modelUsed,
    approvedModels: APPROVED_VISION_MODELS,
  });

  const { action, flags, summary } = downgradeForUnreadPages(decision, hasMorePages, pageCount);

  // Query 2. `onConflictDoNothing` on the unique document_id: if a concurrent
  // run got here first, this one records nothing and approves nothing.
  const inserted = await db
    .insert(documentScreenings)
    .values({
      documentId: row.id,
      campaignId: row.campaignId,
      action,
      flags: sql`${JSON.stringify(flags)}::jsonb`,
      summary,
      nameMatchKind: decision.nameMatch.kind,
      nameMatchScore: toPercent(decision.nameMatch.score),
      nameMatchDistance: decision.nameMatch.distance,
      extracted: extracted ? sql`${JSON.stringify(extracted)}::jsonb` : null,
      modelUsed,
      latencyMs,
      pageCount,
      hasMorePages,
      error,
    })
    .onConflictDoNothing({ target: documentScreenings.documentId })
    .returning({ id: documentScreenings.id });

  if (inserted.length === 0) {
    return { documentId, action, flags: [...flags], approved: false, error: 'already screened' };
  }

  let approved = false;
  if (action === 'auto_approve') {
    // Query 3. Keyed on `status = 'pending'`, so a document a person has
    // already decided on cannot be overwritten by a late-arriving job.
    const result = await db
      .update(verificationDocuments)
      .set({
        status: 'approved',
        // reviewerId stays NULL: that is the record that no person approved it.
        reviewerNotes: summary,
        reviewedAt: new Date(),
      })
      .where(and(eq(verificationDocuments.id, row.id), eq(verificationDocuments.status, 'pending')))
      .returning({ id: verificationDocuments.id });
    approved = result.length > 0;
  }

  return { documentId, action, flags: [...flags], approved, error };
}
