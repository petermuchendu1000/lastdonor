import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { formatMoney } from '@/lib/money/format';
import { verifyDonationReturn } from '@/lib/donations/verify-return';
import type { DonationReturnState } from '@/lib/donations/verify-return';
import { auth } from '@/lib/auth';
import { logError } from '@/lib/errors';
import { appBaseUrl } from '@/lib/unsubscribe-tokens';
import { mintShareLink, shareUrl } from '@/lib/share-links';
import { publicCampaignPath } from '@/lib/campaign-links';
import { DonatePageClient } from './client';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** `?donation=` values Stripe or our own links use for a payment that did not complete. */
const CANCELLED_PARAMS = new Set(['cancel', 'cancelled', 'canceled', 'failed', 'declined']);

async function getDonatableCampaign(slug: string) {
  const [campaign] = await db
    .select({
      id: campaigns.id,
      slug: campaigns.slug,
      title: campaigns.title,
      subjectName: campaigns.subjectName,
      raisedAmount: campaigns.raisedAmount,
      goalAmount: campaigns.goalAmount,
      donorCount: campaigns.donorCount,
      status: campaigns.status,
      /*
        For the back link only, and added to a select that already runs
        (`docs/87`, `docs/131`). `/campaigns/[slug]` requires this column, so
        a link built from the slug alone can 404 on a campaign this route
        serves.
      */
      publishedAt: campaigns.publishedAt,
      currency: campaigns.currency,
    })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.slug, slug),
        or(
          eq(campaigns.status, 'active'),
          eq(campaigns.status, 'last_donor_zone'),
        ),
      ),
    )
    .limit(1);

  return campaign ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const campaign = await getDonatableCampaign(slug);

  if (!campaign) {
    return { title: 'Campaign Not Found' };
  }

  return {
    title: `Donate to ${campaign.title}`,
    /*
      `formatMoney`, not the USD-hardcoded helper, and not `<Money>`: this is
      a META DESCRIPTION, so it must be a string. A KES campaign was
      advertising "$18,400 raised" to every search engine and link preview.
    */
    description: `Make a donation to help ${campaign.subjectName}. ${formatMoney(
      campaign.raisedAmount,
      campaign.currency,
      'exact',
    )} raised of ${formatMoney(campaign.goalAmount, campaign.currency, 'exact')} goal.`,
    robots: { index: false },
  };
}

export default async function DonatePage({ params, searchParams }: PageProps) {
  const [{ slug }, resolvedParams] = await Promise.all([params, searchParams]);
  const campaign = await getDonatableCampaign(slug);

  if (!campaign) {
    notFound();
  }

  // `amount` in the URL is a form preselection and nothing more. It is a
  // number the visitor typed, so it may seed an empty form, but it must never
  // be echoed back as a confirmed donation. See docs/42.
  const rawAmount = typeof resolvedParams.amount === 'string'
    ? parseInt(resolvedParams.amount, 10)
    : undefined;
  const initialAmount = rawAmount && rawAmount >= 500 && rawAmount <= 10_000_000
    ? rawAmount
    : undefined;

  const sessionId = typeof resolvedParams.session_id === 'string'
    ? resolvedParams.session_id
    : undefined;
  const paymentIntentId = typeof resolvedParams.payment_intent === 'string'
    ? resolvedParams.payment_intent
    : undefined;

  // Any `?donation=` value means the visitor arrived from (or claims to have
  // arrived from) the payment flow. What happened is decided by Stripe, never
  // by the query string: `donation=success` with no verifiable id renders the
  // pending state, and `donation=cancel` with a succeeded intent renders the
  // receipt the donor is owed.
  const donationParam = typeof resolvedParams.donation === 'string'
    ? resolvedParams.donation
    : undefined;

  let returnState: DonationReturnState | undefined;
  let confirmedAmount: number | undefined;

  if (donationParam) {
    if (sessionId || paymentIntentId) {
      const verified = await verifyDonationReturn({
        campaignId: campaign.id,
        sessionId,
        paymentIntentId,
      });
      returnState = verified.state;
      // An amount is handed to the client only alongside a verified success.
      // No other state may display a figure.
      confirmedAmount = verified.state === 'succeeded'
        ? verified.amountCents ?? undefined
        : undefined;
    } else if (CANCELLED_PARAMS.has(donationParam)) {
      // Stripe sends no id on a cancel return, and there is nothing to look
      // up. Tell the donor their payment did not go through instead of
      // dropping them on a blank form.
      returnState = 'failed';
    } else {
      // `donation=success` with nothing to verify. This is the hand-typed and
      // link-shared case.
      returnState = 'unverified';
    }
  }

  /*
   * Mint this donor's attributed share link, but ONLY on a Stripe-verified
   * success. Two reasons it is gated that tightly:
   *
   *   - every mint writes a row, so minting on page render would create one
   *     per visit rather than one per donor;
   *   - docs/42 established that nothing may be rendered from an unverified
   *     `?donation=success`. A share link saying "anyone who gives through
   *     this is credited to you" is a claim about a donation, so it is held
   *     to the same bar as the receipt.
   *
   * Best-effort: a failure here must not cost the donor their receipt, so it
   * degrades to the plain campaign URL. See docs/57.
   */
  let attributedShareUrl: string | undefined;
  if (returnState === 'succeeded') {
    try {
      const session = await auth();
      const link = await mintShareLink({
        campaignId: campaign.id,
        userId: session?.user?.id ?? null,
      });
      attributedShareUrl = shareUrl(link.token, appBaseUrl());
    } catch (error) {
      logError(error, 'campaigns/[slug]/donate#mintShareLink');
    }
  }

  /*
    The back link, resolved once and handed down. `publicCampaignPath` returns
    null when there is no public page, and the client renders the browse
    listing instead of a slug-shaped 404 (`docs/118`, `docs/147`).
  */
  const campaignPath = publicCampaignPath({
    slug: campaign.slug,
    status: campaign.status,
    publishedAt: campaign.publishedAt,
  });
  const backTo = campaignPath
    ? { href: campaignPath, label: 'Back to campaign' }
    : null;

  return (
    <DonatePageClient
      attributedShareUrl={attributedShareUrl}
      campaignId={campaign.id}
      campaignSlug={campaign.slug}
      campaignTitle={campaign.title}
      backTo={backTo}
      raisedAmount={campaign.raisedAmount}
      goalAmount={campaign.goalAmount}
      donorCount={campaign.donorCount}
      currency={campaign.currency}
      initialAmount={initialAmount}
      returnState={returnState}
      confirmedAmount={confirmedAmount}
      sessionId={sessionId}
      paymentIntentId={paymentIntentId}
    />
  );
}
