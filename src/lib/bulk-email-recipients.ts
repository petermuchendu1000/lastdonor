/**
 * Bulk-email recipient resolution — one predicate for preview and for send.
 *
 * ## What was wrong (audit P0)
 *
 * `POST /api/v1/admin/bulk-emails` used `recipientFilter` only to compute a
 * preview count and to write an audit field; `bulk_emails` has no
 * `recipient_filter` column, so the admin's choice was thrown away. The send
 * route then applied its own *fixed* predicate ("every real, un-refunded
 * donation, optionally scoped to a campaign"), so the confirmation dialog's
 * "Send to N recipient(s)" was unrelated to who actually received the mail.
 *
 * Worse, `campaignId` is optional, so a draft created without one resolved to
 * **every donor who has ever donated**, consulting no opt-out source at all.
 *
 * ## What this module guarantees
 *
 * - A single `resolveBulkEmailRecipients()` is used by both the preview count
 *   and the send, so the number shown is the number mailed.
 * - Every resolution applies all three opt-out sources the platform actually
 *   holds (see `filterOptedOut`).
 * - A hard ceiling (`bulkEmailRecipientCeiling()`) that callers must enforce.
 *
 * The filter itself cannot be stored on `bulk_emails` (no column, and
 * migrations are frozen — CLAUDE.md). It is persisted in
 * `audit_logs.details.recipientFilter` on the `bulk_email.created` row and
 * read back at send time by `loadPersistedRecipientFilter()`. If that row is
 * missing, the send must fail closed rather than guess.
 */
import { db } from '@/db';
import { donations, donorCampaignSubscriptions, newsletterSubscribers, users, auditLogs } from '@/db/schema';
import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import { RECIPIENT_FILTERS } from '@/lib/validators/verification';

export type RecipientFilter = (typeof RECIPIENT_FILTERS)[number];

export type BulkEmailRecipient = {
  email: string;
  name: string;
  donationAmount?: number;
  campaignTitle?: string;
  /** `newsletter_subscribers.id` when we hold one for this address. */
  subscriberId?: string | null;
};

/** Default hard ceiling on a single bulk send. Override with BULK_EMAIL_MAX_RECIPIENTS. */
export const DEFAULT_BULK_EMAIL_CEILING = 5000;

export function bulkEmailRecipientCeiling(): number {
  const raw = Number(process.env.BULK_EMAIL_MAX_RECIPIENTS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_BULK_EMAIL_CEILING;
}

export function isRecipientFilter(value: unknown): value is RecipientFilter {
  return typeof value === 'string' && (RECIPIENT_FILTERS as readonly string[]).includes(value);
}

/* ─── The predicate ──────────────────────────────────────────────────────── */

/**
 * Candidate rows for a filter, *before* opt-out suppression.
 *
 * `subscribed_donors` is sourced from `donor_campaign_subscriptions` (it is the
 * only filter that is not a property of a donation) and requires a campaign:
 * without one there is no subscription list to read, so it yields nothing
 * rather than silently widening to every donor.
 */
async function resolveCandidates(
  filter: RecipientFilter,
  campaignId: string | null,
): Promise<BulkEmailRecipient[]> {
  if (filter === 'subscribed_donors') {
    if (!campaignId) return [];

    const subs = await db
      .select({ donorEmail: donorCampaignSubscriptions.donorEmail })
      .from(donorCampaignSubscriptions)
      .where(
        and(
          eq(donorCampaignSubscriptions.campaignId, campaignId),
          eq(donorCampaignSubscriptions.subscribed, true),
        ),
      );

    const emails = [...new Set(subs.map((s) => s.donorEmail))];
    if (emails.length === 0) return [];

    const rows = await db
      .select({
        donorEmail: donations.donorEmail,
        donorName: donations.donorName,
        amount: donations.amount,
      })
      .from(donations)
      .where(and(eq(donations.source, 'real'), inArray(donations.donorEmail, emails)));

    const byEmail = dedupeByEmail(rows);
    // Subscribers with no surviving donation row still get the mail.
    for (const email of emails) {
      if (!byEmail.has(email)) byEmail.set(email, { email, name: 'Donor' });
    }
    return [...byEmail.values()];
  }

  const conditions = [
    eq(donations.source, 'real'),
    eq(donations.refunded, filter === 'refunded_donors'),
  ];

  if (campaignId) conditions.push(eq(donations.campaignId, campaignId));
  if (filter === 'registered_donors') conditions.push(sql`${donations.userId} IS NOT NULL`);
  if (filter === 'guest_donors') conditions.push(sql`${donations.userId} IS NULL`);

  const rows = await db
    .select({
      donorEmail: donations.donorEmail,
      donorName: donations.donorName,
      amount: donations.amount,
    })
    .from(donations)
    .where(and(...conditions));

  return [...dedupeByEmail(rows).values()];
}

/** Deduplicate by email, keeping the largest donation for display. */
function dedupeByEmail(
  rows: { donorEmail: string; donorName: string | null; amount: number }[],
): Map<string, BulkEmailRecipient> {
  const byEmail = new Map<string, BulkEmailRecipient>();
  for (const row of rows) {
    const existing = byEmail.get(row.donorEmail);
    if (!existing || row.amount > (existing.donationAmount ?? 0)) {
      byEmail.set(row.donorEmail, {
        email: row.donorEmail,
        name: row.donorName || 'Donor',
        donationAmount: row.amount,
      });
    }
  }
  return byEmail;
}

/* ─── Opt-out suppression ────────────────────────────────────────────────── */

/**
 * Drop anyone who has opted out, via any of the three sources the platform
 * actually holds. The send route previously consulted none of them.
 *
 *  1. `newsletter_subscribers.unsubscribed_at` — a global opt-out from
 *     bulk/marketing mail, and the only one that works for guest donors.
 *  2. `donor_campaign_subscriptions.subscribed = false` — a per-campaign
 *     opt-out; only applicable to a campaign-scoped send.
 *  3. `users.preferences` — `emailNotifications === false` (the global gate
 *     `src/lib/notifications.ts` already honours) or
 *     `emailCampaignUpdates === false`.
 *
 * Also attaches `subscriberId` so the send site can mint a one-click
 * unsubscribe link for the addresses we hold a newsletter row for.
 */
export async function filterOptedOut(
  candidates: BulkEmailRecipient[],
  campaignId: string | null,
): Promise<BulkEmailRecipient[]> {
  if (candidates.length === 0) return [];

  const emails = candidates.map((c) => c.email);

  const [newsletterRows, campaignOptOuts, userRows] = await Promise.all([
    db
      .select({
        id: newsletterSubscribers.id,
        email: newsletterSubscribers.email,
        unsubscribedAt: newsletterSubscribers.unsubscribedAt,
      })
      .from(newsletterSubscribers)
      .where(inArray(newsletterSubscribers.email, emails)),
    campaignId
      ? db
          .select({ donorEmail: donorCampaignSubscriptions.donorEmail })
          .from(donorCampaignSubscriptions)
          .where(
            and(
              eq(donorCampaignSubscriptions.campaignId, campaignId),
              eq(donorCampaignSubscriptions.subscribed, false),
              inArray(donorCampaignSubscriptions.donorEmail, emails),
            ),
          )
      : Promise.resolve([] as { donorEmail: string }[]),
    db
      .select({ email: users.email, preferences: users.preferences })
      .from(users)
      .where(inArray(users.email, emails)),
  ]);

  const subscriberIdByEmail = new Map<string, string>();
  const globallyUnsubscribed = new Set<string>();
  for (const row of newsletterRows) {
    subscriberIdByEmail.set(row.email, row.id);
    if (row.unsubscribedAt) globallyUnsubscribed.add(row.email);
  }

  const campaignUnsubscribed = new Set(campaignOptOuts.map((r) => r.donorEmail));

  const prefOptedOut = new Set<string>();
  for (const row of userRows) {
    const prefs = row.preferences as Record<string, unknown> | null;
    if (prefs?.emailNotifications === false || prefs?.emailCampaignUpdates === false) {
      prefOptedOut.add(row.email);
    }
  }

  return candidates
    .filter(
      (c) =>
        !globallyUnsubscribed.has(c.email) &&
        !campaignUnsubscribed.has(c.email) &&
        !prefOptedOut.has(c.email),
    )
    .map((c) => ({ ...c, subscriberId: subscriberIdByEmail.get(c.email) ?? null }));
}

/**
 * The authoritative recipient list for a (filter, campaign) pair.
 *
 * Both the create-time preview count and the send call this, so the count an
 * admin confirms is the count that is mailed.
 */
export async function resolveBulkEmailRecipients(
  filter: RecipientFilter,
  campaignId: string | null,
): Promise<BulkEmailRecipient[]> {
  const candidates = await resolveCandidates(filter, campaignId);
  return filterOptedOut(candidates, campaignId);
}

/** Preview count. Defined as the length of the list the send would use. */
export async function countBulkEmailRecipients(
  filter: RecipientFilter,
  campaignId: string | null,
): Promise<number> {
  return (await resolveBulkEmailRecipients(filter, campaignId)).length;
}

/* ─── Filter persistence (no migration available) ────────────────────────── */

/**
 * Read the filter chosen at draft-creation time back out of the audit trail.
 *
 * `bulk_emails` has no column for it and migrations are frozen (CLAUDE.md), so
 * `audit_logs.details.recipientFilter` on the `bulk_email.created` row is the
 * only existing durable home. Returns `null` when no usable value is stored —
 * callers must then refuse the send rather than fall back to a default, which
 * is exactly the failure that let one POST reach the whole donor base.
 */
export async function loadPersistedRecipientFilter(
  bulkEmailId: string,
): Promise<RecipientFilter | null> {
  const [row] = await db
    .select({ details: auditLogs.details })
    .from(auditLogs)
    .where(and(eq(auditLogs.eventType, 'bulk_email.created'), eq(auditLogs.targetId, bulkEmailId)))
    .orderBy(desc(auditLogs.timestamp))
    .limit(1);

  const details = row?.details as Record<string, unknown> | null | undefined;
  const value = details?.recipientFilter;
  return isRecipientFilter(value) ? value : null;
}
