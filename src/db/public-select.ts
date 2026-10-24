/**
 * Public-safe column selections for database queries.
 *
 * ═══════════════════════════════════════════════════════════════════
 * SECURITY-CRITICAL: PUBLIC DATA BOUNDARY
 * ═══════════════════════════════════════════════════════════════════
 *
 * These select objects define the ONLY columns that may appear
 * in public-facing API responses and SSR-rendered pages.
 *
 * NEVER add these columns to any public select:
 *   - simulationFlag     (reveals campaign type)
 *   - simulationConfig   (reveals simulation parameters)
 *   - source             (reveals campaign origin)
 *   - campaignProfile    (reveals trajectory/simulation config)
 *
 * Any change to this file requires security review.
 * ═══════════════════════════════════════════════════════════════════
 */

import { campaigns, donations, campaignMessages } from '@/db/schema';

/** Full public campaign detail - used for single-campaign views. */
export const publicCampaignSelect = {
  id: campaigns.id,
  title: campaigns.title,
  slug: campaigns.slug,
  status: campaigns.status,
  heroImageUrl: campaigns.heroImageUrl,
  galleryImages: campaigns.galleryImages,
  photoCredit: campaigns.photoCredit,
  youtubeUrl: campaigns.youtubeUrl,
  storyHtml: campaigns.storyHtml,
  goalAmount: campaigns.goalAmount,
  raisedAmount: campaigns.raisedAmount,
  // Needed by `PendingVerificationBadge`: the pre-verification cap is a
  // per-currency figure, so the badge cannot name it without this.
  currency: campaigns.currency,
  donorCount: campaigns.donorCount,
  category: campaigns.category,
  location: campaigns.location,
  subjectName: campaigns.subjectName,
  subjectHometown: campaigns.subjectHometown,
  impactTiers: campaigns.impactTiers,
  campaignOrganizer: campaigns.campaignOrganizer,
  fundUsagePlan: campaigns.fundUsagePlan,
  createdAt: campaigns.createdAt,
  updatedAt: campaigns.updatedAt,
  publishedAt: campaigns.publishedAt,
  completedAt: campaigns.completedAt,
  lastDonorId: campaigns.lastDonorId,
  lastDonorName: campaigns.lastDonorName,
  lastDonorAmount: campaigns.lastDonorAmount,
  creatorId: campaigns.creatorId,
  verificationStatus: campaigns.verificationStatus,
  totalReleasedAmount: campaigns.totalReleasedAmount,
  pausedReason: campaigns.pausedReason,
  suspendedReason: campaigns.suspendedReason,
  cancellationReason: campaigns.cancellationReason,
  cancellationNotes: campaigns.cancellationNotes,
  cancelledAt: campaigns.cancelledAt,
} as const;

/** Compact campaign card - used for listings and grids. */
export const publicCampaignCardSelect = {
  id: campaigns.id,
  title: campaigns.title,
  slug: campaigns.slug,
  status: campaigns.status,
  heroImageUrl: campaigns.heroImageUrl,
  category: campaigns.category,
  location: campaigns.location,
  subjectName: campaigns.subjectName,
  subjectHometown: campaigns.subjectHometown,
  campaignOrganizer: campaigns.campaignOrganizer,
  goalAmount: campaigns.goalAmount,
  raisedAmount: campaigns.raisedAmount,
  donorCount: campaigns.donorCount,
  publishedAt: campaigns.publishedAt,
  verificationStatus: campaigns.verificationStatus,
} as const;

/** Public donation fields - never includes source, stripePaymentId, donorEmail etc. */
export const publicDonationSelect = {
  id: donations.id,
  donorName: donations.donorName,
  donorLocation: donations.donorLocation,
  amount: donations.amount,
  message: donations.message,
  isAnonymous: donations.isAnonymous,
  createdAt: donations.createdAt,
} as const;

/** Public message fields - never includes flagged, hidden, userId, donationId. */
export const publicMessageSelect = {
  id: campaignMessages.id,
  donorName: campaignMessages.donorName,
  donorLocation: campaignMessages.donorLocation,
  message: campaignMessages.message,
  isAnonymous: campaignMessages.isAnonymous,
  createdAt: campaignMessages.createdAt,
} as const;
