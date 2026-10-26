import { auth } from '@/lib/auth';
import { db } from '@/db';
import { donorCampaignSubscriptions, campaigns, users } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { formatMoney } from '@/lib/money/format';
import { SubscriptionsClient } from './client';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Subscriptions - Dashboard - LastDonor.org',
  robots: { index: false },
};

export default async function SubscriptionsPage() {
  const session = (await auth())!;

  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, session.user!.id))
    .limit(1);

  if (!user?.email) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-foreground">Campaign Subscriptions</h1>
        <p className="mt-2 text-sm text-muted-foreground">No email address found for your account.</p>
      </div>
    );
  }

  const subs = await db
    .select({
      id: donorCampaignSubscriptions.id,
      campaignId: donorCampaignSubscriptions.campaignId,
      createdAt: donorCampaignSubscriptions.createdAt,
      campaignTitle: campaigns.title,
      campaignSlug: campaigns.slug,
      campaignStatus: campaigns.status,
      campaignHeroImageUrl: campaigns.heroImageUrl,
      campaignRaisedAmount: campaigns.raisedAmount,
      campaignGoalAmount: campaigns.goalAmount,
      // Selected because it is RENDERED; without it both figures below were
      // formatted as USD whatever currency the campaign is in (`docs/92`).
      campaignCurrency: campaigns.currency,
    })
    .from(donorCampaignSubscriptions)
    .innerJoin(campaigns, eq(donorCampaignSubscriptions.campaignId, campaigns.id))
    .where(
      and(
        eq(donorCampaignSubscriptions.donorEmail, user.email),
        eq(donorCampaignSubscriptions.subscribed, true),
      ),
    )
    .orderBy(desc(donorCampaignSubscriptions.createdAt));

  const serialized = subs.map((s) => ({
    id: s.id,
    campaignSlug: s.campaignSlug,
    campaignTitle: s.campaignTitle,
    campaignStatus: s.campaignStatus,
    campaignHeroImageUrl: s.campaignHeroImageUrl,
    /*
      `formatMoney`, not `<Money>`: this page serialises STRINGS to its client
      component, so the figure has to be formatted here.
    */
    campaignRaisedFormatted: formatMoney(s.campaignRaisedAmount, s.campaignCurrency, 'exact'),
    campaignGoalFormatted: formatMoney(s.campaignGoalAmount, s.campaignCurrency, 'exact'),
    subscribedAt: s.createdAt.toISOString(),
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">Campaign Subscriptions</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Campaigns you are subscribed to. You will receive notifications and emails when there are updates.
      </p>
      <SubscriptionsClient email={user.email} initialSubscriptions={serialized} />
    </div>
  );
}
