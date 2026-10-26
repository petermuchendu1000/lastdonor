import { redirect, notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { and, eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { db } from '@/db';
import {
  campaignPayoutDesignations,
  campaigns,
  institutionPayoutAccounts,
  trustedInstitutions,
} from '@/db/schema';
import { PayoutDestinationFlow } from '@/components/payout/PayoutDestinationFlow';
import { DESIGNATABLE_CAMPAIGN_STATUSES } from '@/lib/institutional-payout/decide';

export const metadata: Metadata = {
  title: 'Where the money goes - LastDonor.org',
  robots: { index: false },
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Screens B1-B4 of `docs/113` §11.
 *
 * ⛔ Creator only, and NOT via `canCollaborate`. `change_payout_account` is in
 * `NEVER_DELEGATED` (`docs/111`) and this screen is the door to it. The API it
 * posts to makes the same check; this one keeps a helper from seeing the form
 * at all.
 *
 * ⚠️ THREE queries, run in SEQUENCE and each gating the next. The pool is
 * `max: 5` and `docs/87` caps a request at three CONCURRENT queries; nothing
 * here could be parallel anyway, since the account list is filtered by the
 * campaign's currency.
 */
export default async function PayoutDestinationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idOrSlug } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/dashboard/campaigns');

  const [campaign] = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      status: campaigns.status,
      currency: campaigns.currency,
      creatorId: campaigns.creatorId,
      subjectName: campaigns.subjectName,
    })
    .from(campaigns)
    .where(UUID_REGEX.test(idOrSlug) ? eq(campaigns.id, idOrSlug) : eq(campaigns.slug, idOrSlug))
    .limit(1);

  if (!campaign) notFound();
  /*
    A 404 rather than a 403 for somebody else's campaign: whether a given id
    exists is not something a stranger needs confirmed. Same posture as the
    other dashboard screens.
  */
  if (campaign.creatorId !== session.user.id) notFound();

  const [existing] = await db
    .select({
      id: campaignPayoutDesignations.id,
      accountReference: campaignPayoutDesignations.accountReference,
      lockedAt: campaignPayoutDesignations.lockedAt,
      institutionName: trustedInstitutions.name,
      accountReferenceLabel: institutionPayoutAccounts.accountReferenceLabel,
    })
    .from(campaignPayoutDesignations)
    .innerJoin(
      institutionPayoutAccounts,
      eq(institutionPayoutAccounts.id, campaignPayoutDesignations.payoutAccountId),
    )
    .innerJoin(
      trustedInstitutions,
      eq(trustedInstitutions.id, institutionPayoutAccounts.institutionId),
    )
    .where(
      and(
        eq(campaignPayoutDesignations.campaignId, campaign.id),
        eq(campaignPayoutDesignations.status, 'active'),
      ),
    )
    .limit(1);

  /*
    Only accounts that can actually take THIS campaign's money. The composite
    FK makes a mismatch unstorable (`docs/92`), so filtering here is what
    turns a database error into a list that simply does not offer the wrong
    thing.
  */
  const accounts = existing
    ? []
    : await db
        .select({
          id: institutionPayoutAccounts.id,
          accountReferenceLabel: institutionPayoutAccounts.accountReferenceLabel,
          institutionName: trustedInstitutions.name,
          institutionKind: trustedInstitutions.kind,
          country: trustedInstitutions.country,
        })
        .from(institutionPayoutAccounts)
        .innerJoin(
          trustedInstitutions,
          eq(trustedInstitutions.id, institutionPayoutAccounts.institutionId),
        )
        .where(
          and(
            eq(institutionPayoutAccounts.currency, campaign.currency),
            eq(institutionPayoutAccounts.status, 'active'),
            eq(trustedInstitutions.status, 'active'),
          ),
        )
        .orderBy(trustedInstitutions.name);

  return (
    <PayoutDestinationFlow
      campaignId={campaign.id}
      campaignTitle={campaign.title}
      subjectName={campaign.subjectName}
      canDesignate={(DESIGNATABLE_CAMPAIGN_STATUSES as readonly string[]).includes(campaign.status)}
      existing={
        existing
          ? {
              institutionName: existing.institutionName,
              accountReference: existing.accountReference,
              accountReferenceLabel: existing.accountReferenceLabel,
              locked: Boolean(existing.lockedAt),
            }
          : null
      }
      accounts={accounts}
    />
  );
}
