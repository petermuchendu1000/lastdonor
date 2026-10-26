'use client';

import { useRouter } from 'next/navigation';
import { SidebarDonationSummary } from '@/components/campaign/SidebarDonationSummary';
import { ImpactTiers } from '@/components/campaign/ImpactTiers';
import { StickyMobileDonateBar } from '@/components/campaign/StickyMobileDonateBar';
import { DonorFeed, type DonorFeedItem } from '@/components/campaign/DonorFeed';
import { MessageWall, type MessageItem } from '@/components/campaign/MessageWall';
import { MessageForm } from '@/components/campaign/MessageForm';
import { MessageWallProvider } from '@/components/campaign/MessageWallContext';
import type { ImpactTier } from '@/types';

// ─── Sidebar: conversion funnel only ────────────────────────────────────────

interface CampaignSidebarClientProps {
  campaignSlug: string;
  raisedAmount: number;
  /** The campaign's own currency - never assumed to be USD (`docs/92`). */
  currency: string;
  goalAmount: number;
  donorCount: number;
  impactTiers: ImpactTier[];
  shareUrl: string;
  shareTitle: string;
}

export function CampaignSidebarClient({
  campaignSlug,
  raisedAmount,
  currency,
  goalAmount,
  donorCount,
  impactTiers,
  shareUrl,
  shareTitle,
}: CampaignSidebarClientProps) {
  const router = useRouter();
  const donateHref = `/campaigns/${campaignSlug}/donate`;

  return (
    <>
      <SidebarDonationSummary
        raisedAmount={raisedAmount}
        goalAmount={goalAmount}
        currency={currency}
        donorCount={donorCount}
        donateHref={donateHref}
        shareUrl={shareUrl}
        shareTitle={shareTitle}
        campaignSlug={campaignSlug}
      />

      {impactTiers.length > 0 && (
        <ImpactTiers
          tiers={impactTiers}
          currency={currency}
          onSelectAmount={(cents) => router.push(`${donateHref}?amount=${cents}`)}
        />
      )}

      <StickyMobileDonateBar
        raisedAmount={raisedAmount}
        goalAmount={goalAmount}
        currency={currency}
        donateHref={donateHref}
      />
    </>
  );
}

// ─── Community: social proof + engagement ────────────────────────────────────

interface CampaignCommunityClientProps {
  campaignSlug: string;
  initialDonors: DonorFeedItem[];
  initialMessages: MessageItem[];
}

export function CampaignCommunityClient({
  campaignSlug,
  initialDonors,
  initialMessages,
}: CampaignCommunityClientProps) {
  return (
    <>
      <DonorFeed
        campaignSlug={campaignSlug}
        initialDonors={initialDonors}
      />

      <MessageWallProvider>
        <MessageForm campaignSlug={campaignSlug} />
        <MessageWall
          campaignSlug={campaignSlug}
          initialMessages={initialMessages}
        />
      </MessageWallProvider>
    </>
  );
}
