import { and, eq, inArray, or } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { DELETED_DONOR_NAME, DELETED_DONOR_PLACEHOLDER } from '@/lib/constants';
import { authEmailIdentifiersFor } from '@/lib/password-reset-tokens';

/**
 * Erasing a person without destroying the records that mention them.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * There were two account-deletion paths and **neither one worked**.
 *
 * `DELETE /api/v1/users/me` ran `tx.delete(users)`. [VERIFIED from the live
 * schema] **36 foreign keys reference `users.id`; 31 are `NO ACTION`** and the
 * transaction nulled or deleted rows in **six** of them. So a user holding any
 * of the other twenty-five raised a foreign-key violation, the transaction
 * rolled back, and the route answered
 * `500 "Failed to delete account. Please try again or contact support."` —
 * advice that can never work. [VERIFIED in production] **three of nine users
 * were blocked, each by a DIFFERENT column** (a share link, invitations they
 * had sent, settings they had edited), which is what showed the handled set of
 * six was arbitrary rather than reasoned.
 *
 * `DELETE /api/v1/admin/users/[id]` had the right idea and a fatal statement.
 * For a user with donations it anonymised the row in place — correct, and the
 * model this module generalises — but its `.set({...})` wrote
 * `badges: null, preferences: null`, and **both columns are `NOT NULL`**
 * (`schema.ts:389-390`, defaults `'[]'` and `'{}'`). So that UPDATE threw and
 * aborted the transaction every time. [VERIFIED against a real Postgres: the
 * statement errors with `null value in column "badges" ... violates not-null
 * constraint` and the row is left completely unchanged.] Its other branch,
 * for a user with no donations, hard-deleted and so had the same foreign-key
 * hole as the self-service route.
 *
 * ⛔ So there was **no working path to remove a person's data from this
 * platform**, against a published commitment on `/privacy` that "personal
 * identifiers are removed within 30 days".
 *
 * ── THE MODEL (owner decision, 2026-10-27) ─────────────────────────────────
 *
 * **Anonymise in place, always.** The `users` row survives carrying nothing
 * but an opaque id; every personal identifier on it is scrubbed, and the
 * address is scrubbed out of every store that mail is sent from. Because the
 * row survives, **no foreign key can ever be violated**, so erasure cannot
 * fail for a reason the person is unable to do anything about.
 *
 * Rejected: a full hard delete cascading through all 31 references. It would
 * destroy `campaign_withdrawals`, `refund_batches`, `institution_vouches` and
 * `verification_documents` — financial and audit records `/privacy` commits to
 * keeping for seven years, and the evidence `docs/108` and `docs/120` rest on.
 *
 * Rejected: erase what is possible and refuse the rest. Honest, but thirteen
 * of the thirty-one columns are `NOT NULL`, so it would leave people
 * permanently unable to delete their account — including two of the three
 * blocked today.
 *
 * ⚠️ This is erasure of the **person**, not of the **record**. A withdrawal
 * still says who requested it; it just no longer says who that was.
 *
 * ── WHY ONE FUNCTION ───────────────────────────────────────────────────────
 *
 * The two routes disagreed about what erasure means, and the weaker one was
 * the admin's: it left the real address in **three** places mail is sent from
 * — `donations.donor_email`, `donor_campaign_subscriptions.donor_email` and
 * `newsletter_subscribers.email` — while the self-service route scrubbed all
 * three and wrote down why. `bulk-email-recipients.ts:110` even justifies its
 * own guard with "Account deletion scrubs `donations.donor_email` …
 * (`users/me/route.ts`)", which was true of one route and false of the other.
 * One implementation is the only way that stays fixed. `docs/124`.
 */

/** The address an anonymised account is left holding. Unique per user. */
export function anonymisedEmail(userId: string): string {
  return `deleted-${userId}@lastdonor.org`;
}

/**
 * Columns on `users` that identify a person, and what they become.
 *
 * ⛔ Exported so a test can compare it against the live column list: the
 * previous scrub was written before `phone_e164`, `phone_verified_at`,
 * `sms_consent_at` (`docs/82`, `docs/85`) and `stripe_connect_account_id`
 * existed, and silently kept leaving them behind as each was added. A list
 * nobody checks against the table it scrubs rots exactly that way.
 *
 * ⚠️ `badges` and `preferences` are `NOT NULL`, so they are reset to their
 * schema defaults rather than nulled. That is the statement that made the
 * admin path throw.
 */
export const USER_PII_SCRUB = {
  name: DELETED_DONOR_NAME,
  image: null,
  avatarUrl: null,
  location: null,
  organizationName: null,
  address: null,
  phone: null,
  phoneE164: null,
  phoneVerifiedAt: null,
  smsConsentAt: null,
  passwordHash: null,
  securityQuestion: null,
  securityAnswerHash: null,
  emailVerified: null,
  stripeConnectAccountId: null,
  badges: [],
  preferences: {},
} as const;

type Tx = Parameters<Parameters<typeof import('@/db').db.transaction>[0]>[0];

/**
 * Scrub one person out of the database, inside the caller's transaction.
 *
 * The caller supplies the transaction and writes its own audit row, because
 * the two callers differ in who the actor is and why.
 */
export async function anonymiseAccount(
  tx: Tx,
  opts: { userId: string; email: string | null },
): Promise<void> {
  const { userId, email } = opts;

  // ── Donations: keep the money, drop the donor ────────────────────────────
  // `donations.donor_email` is a mailing audience (`bulk-email-recipients.ts`),
  // so the placeholder here is load-bearing, not cosmetic.
  await tx
    .update(schema.donations)
    .set({
      donorName: DELETED_DONOR_NAME,
      donorEmail: DELETED_DONOR_PLACEHOLDER,
      message: null,
      userId: null,
    })
    .where(eq(schema.donations.userId, userId));

  await tx
    .update(schema.campaignMessages)
    .set({ userId: null, donorName: DELETED_DONOR_NAME })
    .where(eq(schema.campaignMessages.userId, userId));

  /*
    Erase campaign-update subscriptions outright.

    Nulling `userId` would leave `donor_email` holding the real address in a
    table mail is sent to. Deleted rather than scrubbed to the placeholder
    because `idx_donor_subs_email_campaign` is UNIQUE on
    (donor_email, campaign_id), so two erased people who followed the same
    campaign would collide and abort the transaction.

    Matched on the id OR the address, because a row can carry the address with
    a null userId — a guest donor who registered later.
  */
  await tx
    .delete(schema.donorCampaignSubscriptions)
    .where(
      email
        ? or(
            eq(schema.donorCampaignSubscriptions.userId, userId),
            eq(schema.donorCampaignSubscriptions.donorEmail, email),
          )
        : eq(schema.donorCampaignSubscriptions.userId, userId),
    );

  /*
    Erase the newsletter subscription. There is no userId on this table, so
    the address is the only join.

    Trade-off accepted: no suppression record survives, so the same address
    could subscribe again later. That would be a fresh, affirmative opt-in,
    which is the right outcome for somebody who asked to be forgotten —
    keeping a durable record of them in order to honour the erasure would
    defeat it.
  */
  if (email) {
    await tx.delete(schema.newsletterSubscribers).where(eq(schema.newsletterSubscribers.email, email));
  }

  /*
    Password-reset rows carry the address as PLAINTEXT in `identifier`
    (`reset:<email>`, `reset-cooldown:<email>`), and nothing else ever deletes
    them for a user - `verification_tokens` has no foreign key to `users`, as
    `reset-password/route.ts:97` notes. So an erased person's address survived
    them in a table this function had never looked at. `docs/127`.

    The identifiers come from the module that writes them, not from a second
    list of prefixes here, and they are matched EXACTLY rather than with a
    `LIKE` - `%` and `_` are legal in the local part of an address, and a
    pattern built from one would erase other people's rows.
  */
  if (email) {
    await tx
      .delete(schema.verificationTokens)
      .where(inArray(schema.verificationTokens.identifier, authEmailIdentifiersFor(email)));
  }

  await tx
    .update(schema.supportConversations)
    .set({ userId: null })
    .where(eq(schema.supportConversations.userId, userId));

  /*
    CRM rows go with the person. `interaction_logs.donor_id` and
    `donor_relationships.donor_id` are both NOT NULL, so there is nothing to
    null — and neither is a financial or audit record worth keeping once its
    subject is gone.
  */
  await tx.delete(schema.interactionLogs).where(eq(schema.interactionLogs.donorId, userId));
  await tx
    .delete(schema.donorRelationships)
    .where(
      or(
        eq(schema.donorRelationships.donorId, userId),
        eq(schema.donorRelationships.relatedDonorId, userId),
      ),
    );

  /*
    ⛔ `campaigns.creator_id` is deliberately LEFT POINTING at the anonymised
    row, and the self-service route used to null it.

    That null was there to get past the foreign key. Nothing needs it now the
    row survives, and nulling it costs something real: `docs/119` found 13 of
    14 live campaigns already have no organiser at all, and a campaign with a
    null creator cannot be traced, reminded or paid. The row it points at
    carries no personal data, so keeping the link discloses nothing.
  */

  await tx.update(schema.users).set({ ...USER_PII_SCRUB, email: anonymisedEmail(userId) }).where(
    and(eq(schema.users.id, userId)),
  );
}
