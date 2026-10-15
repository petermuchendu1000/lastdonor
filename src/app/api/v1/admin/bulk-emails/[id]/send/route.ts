import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { bulkEmails, auditLogs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { resend } from '@/lib/resend';
import { retryWithBackoff } from '@/lib/utils/retry';
import { bulkOpSemaphore } from '@/lib/concurrency-limiter';
import {
  resolveBulkEmailRecipients,
  loadPersistedRecipientFilter,
  bulkEmailRecipientCeiling,
  isRecipientFilter,
  type BulkEmailRecipient,
  type RecipientFilter,
} from '@/lib/bulk-email-recipients';
import { unsubscribeMechanism, mailingPostalAddress } from '@/lib/unsubscribe-tokens';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';
import type { UserRole } from '@/types';

const FROM_ADDRESS = 'LastDonor.org <noreply@lastdonor.org>';

type RouteParams = { params: Promise<{ id: string }> };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/v1/admin/bulk-emails/[id]/send - Check send status of a bulk email.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const requestId = randomUUID();
  const { id } = await params;

  try {
    await requireRole(['admin']);

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid bulk email ID', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const [email] = await db
      .select()
      .from(bulkEmails)
      .where(eq(bulkEmails.id, id))
      .limit(1);

    if (!email) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Bulk email not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        id: email.id,
        status: email.status,
        recipientCount: email.recipientCount,
        sentCount: email.sentCount,
        failedCount: email.failedCount,
        startedAt: email.startedAt,
        completedAt: email.completedAt,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError, { status: 403 });
    }
    console.error('[GET /api/v1/admin/bulk-emails/[id]/send]', error);
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to check status', requestId } } satisfies ApiError, { status: 500 });
  }
}

/**
 * POST /api/v1/admin/bulk-emails/[id]/send - Trigger sending a draft bulk email.
 *
 * Resolves recipients from the associated campaign's donation records,
 * interpolates {{variables}} per recipient, and sends emails via Resend.
 * Updates sentCount/failedCount as it goes.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = randomUUID();
  const { id } = await params;

  try {
    const session = await requireRole(['admin']);

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid bulk email ID', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const [email] = await db
      .select()
      .from(bulkEmails)
      .where(eq(bulkEmails.id, id))
      .limit(1);

    if (!email) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Bulk email not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    if (email.status !== 'draft') {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: `Cannot send a bulk email with status "${email.status}"`, requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => null)) as
      | { confirmAllDonors?: unknown; recipientFilter?: unknown }
      | null;

    // ── Blast radius gate (P0) ───────────────────────────────────────────
    // `campaignId` is optional on a draft, and the old resolver simply
    // omitted the campaign predicate when it was absent — so one POST, with
    // no second confirmation and no cap, mailed every donor who had ever
    // donated. An unscoped send now needs an explicit flag.
    if (!email.campaignId && body?.confirmAllDonors !== true) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'This draft is not scoped to a campaign, so sending it would mail the entire donor base. Re-send with { "confirmAllDonors": true } to confirm.', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    // ── Recipient filter (P0) ────────────────────────────────────────────
    // The filter the admin chose at draft time is persisted in
    // `audit_logs.details` (there is no `bulk_emails.recipient_filter`
    // column and migrations are frozen — CLAUDE.md). Fail closed when it
    // cannot be recovered: guessing a default is what made the preview count
    // and the actual audience unrelated.
    const bodyFilter = body?.recipientFilter;
    const persistedFilter = await loadPersistedRecipientFilter(id);
    const effectiveFilter: RecipientFilter | null =
      persistedFilter ?? (isRecipientFilter(bodyFilter) ? bodyFilter : null);

    if (!effectiveFilter) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'The recipient filter for this draft could not be recovered from the audit trail. Re-create the draft, or re-send with an explicit "recipientFilter".', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    // ── Sender identity (CAN-SPAM) ───────────────────────────────────────
    const postalAddress = mailingPostalAddress();

    // Resolve unique recipients with the same helper that produced the
    // preview count, minus everyone who has opted out (newsletter
    // unsubscribes, per-campaign unsubscribes, and user preferences).
    const recipients = await resolveBulkEmailRecipients(effectiveFilter, email.campaignId);

    // ── Hard ceiling ─────────────────────────────────────────────────────
    const ceiling = bulkEmailRecipientCeiling();
    if (recipients.length > ceiling) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: `This send would reach ${recipients.length} recipients, above the ${ceiling} hard ceiling. Narrow the filter or scope it to a campaign.`, requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    // Mark as sending (only once every gate above has passed)
    await db.update(bulkEmails).set({
      status: 'sending',
      startedAt: new Date(),
    }).where(eq(bulkEmails.id, id));

    // Acquire semaphore to prevent pool exhaustion from concurrent bulk sends
    const releaseSemaphore = await bulkOpSemaphore.acquire();

    let sentCount = 0;
    let failedCount = 0;

    try {
      // Phase 1: Send all emails OUTSIDE any DB connection hold.
      // Collect results in memory, persist in batches.
      for (const recipient of recipients) {
        const interpolatedSubject = interpolate(email.subject, recipient);
        const unsub = unsubscribeMechanism(recipient.subscriberId);
        const interpolatedBody =
          interpolate(email.bodyHtml, recipient) + unsubscribeFooter(unsub.url, postalAddress);

        try {
          const { error: sendError } = await retryWithBackoff(
            () => resend.emails.send({
              from: FROM_ADDRESS,
              to: recipient.email,
              subject: interpolatedSubject,
              html: interpolatedBody,
              headers: unsub.headers,
            }),
            // Resend resolves { data: null, error } rather than throwing.
            { maxRetries: 2, baseDelayMs: 500, isFailure: (result) => Boolean(result?.error) },
          );

          if (sendError) {
            failedCount++;
            console.error(`[bulk-email] Failed to send to ${recipient.email}:`, sendError);
          } else {
            sentCount++;
          }
        } catch (err) {
          failedCount++;
          console.error(`[bulk-email] Threw while sending to ${recipient.email}:`, err);
        }

        // Update progress periodically (every 25 emails) - brief DB touch
        if ((sentCount + failedCount) % 25 === 0) {
          await db.update(bulkEmails).set({ sentCount, failedCount }).where(eq(bulkEmails.id, id));
        }
      }
    } finally {
      releaseSemaphore();
    }

    // Phase 2: Final DB update (single write)
    const finalStatus = failedCount === 0 ? 'completed' : (sentCount === 0 ? 'failed' : 'completed');
    await db.update(bulkEmails).set({
      sentCount,
      failedCount,
      recipientCount: recipients.length,
      status: finalStatus as 'completed' | 'failed',
      completedAt: new Date(),
    }).where(eq(bulkEmails.id, id));

    await db.insert(auditLogs).values({
      eventType: 'bulk_email.sent',
      actorId: session.user?.id ?? null,
      actorRole: session.user?.role as UserRole,
      targetType: 'bulk_email',
      targetId: id,
      severity: 'info',
      details: {
        sentCount,
        failedCount,
        recipientCount: recipients.length,
        recipientFilter: effectiveFilter,
        campaignId: email.campaignId,
        allDonorsConfirmed: !email.campaignId,
        postalAddressPresent: Boolean(postalAddress),
      },
    });

    return NextResponse.json({
      ok: true,
      data: { id, status: finalStatus, sentCount, failedCount, recipientCount: recipients.length },
    });
  } catch (error) {
    // On unhandled error, mark as failed
    await db.update(bulkEmails).set({ status: 'failed' }).where(eq(bulkEmails.id, id)).catch(() => {});

    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError, { status: 403 });
    }
    console.error('[POST /api/v1/admin/bulk-emails/[id]/send]', error);
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to send bulk email', requestId } } satisfies ApiError, { status: 500 });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compliance footer appended to every bulk message.
 *
 * The body was previously shipped exactly as the admin typed it: no
 * unsubscribe link, no List-Unsubscribe header, no sender address. The postal
 * address line is omitted entirely when `MAILING_POSTAL_ADDRESS` is unset —
 * never substituted with a placeholder (see `mailingPostalAddress`).
 */
function unsubscribeFooter(unsubUrl: string, postalAddress: string | null): string {
  const addressLine = postalAddress
    ? `<p style="margin:0 0 6px">${escapeHtml(postalAddress)}</p>`
    : '';
  return `
<hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0"/>
<div style="font-size:12px;color:#6B7280;text-align:center">
  <p style="margin:0 0 6px">You are receiving this because you donated on LastDonor.org.</p>
  ${addressLine}
  <p style="margin:0"><a href="${escapeHtml(unsubUrl)}" style="color:#0F766E">Unsubscribe</a></p>
</div>`;
}

/** Minimal HTML escaping for values interpolated into email markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Replace {{variable}} placeholders with recipient-specific values. */
function interpolate(template: string, recipient: BulkEmailRecipient): string {
  return template
    .replace(/\{\{donor_name\}\}/gi, recipient.name)
    .replace(/\{\{donation_amount\}\}/gi, recipient.donationAmount ? `$${(recipient.donationAmount / 100).toFixed(2)}` : '')
    .replace(/\{\{campaign_title\}\}/gi, recipient.campaignTitle ?? '')
    .replace(/\{\{support_channels\}\}/gi, 'Email: support@lastdonor.org');
}
