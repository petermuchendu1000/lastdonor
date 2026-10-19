import type { Campaign, Donation, User, CampaignCategory, DonationPhase, CampaignStatus } from '@/types';

let counter = 0;
function nextId() {
  counter++;
  return `00000000-0000-4000-a000-${String(counter).padStart(12, '0')}`;
}

export function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  const id = overrides.id ?? nextId();
  return {
    id,
    title: 'Help the Johnson Family Rebuild',
    slug: 'help-johnson-family-rebuild',
    status: 'active' as CampaignStatus,
    heroImageUrl: 'https://example.com/hero.webp',
    galleryImages: [],
    photoCredit: null,
    youtubeUrl: null,
    storyHtml: '<p>Their home was destroyed by a tornado.</p>',
    goalAmount: 5_000_00, // $5,000 in cents
    raisedAmount: 1_250_00, // $1,250 in cents
    donorCount: 15,
    category: 'disaster' as CampaignCategory,
    location: 'Joplin, MO',
    subjectName: 'The Johnson Family',
    subjectHometown: 'Joplin, MO',
    impactTiers: [
      { amount: 2500, label: 'Provides meals for a week' },
      { amount: 5000, label: 'Covers temporary shelter' },
      { amount: 10000, label: 'Helps rebuild a room' },
    ],
    campaignProfile: null,
    campaignOrganizer: null,
    fundUsagePlan: null,
    source: 'manual',
    simulationFlag: false,
    simulationConfig: null,
    createdAt: new Date('2026-01-15T00:00:00Z'),
    updatedAt: new Date('2026-01-15T00:00:00Z'),
    publishedAt: new Date('2026-01-15T12:00:00Z'),
    completedAt: null,
    lastDonorId: null,
    lastDonorName: null,
    lastDonorAmount: null,
    creatorId: null,
    beneficiaryRelation: null,
    verificationStatus: 'unverified' as const,
    cancellationReason: null,
    cancellationNotes: null,
    cancelledAt: null,
    pausedAt: null,
    pausedReason: null,
    suspendedAt: null,
    suspendedReason: null,
    verificationReviewerId: null,
    verificationReviewedAt: null,
    verificationNotes: null,
    totalReleasedAmount: 0,
    totalWithdrawnAmount: 0,
    stripeVerificationId: null,
    stripeVerificationUrl: null,
    diditSessionId: null,
    diditSessionUrl: null,
    seedDonationCount: 0,
    messageCount: 0,
    updateCount: 0,
    ...overrides,
  };
}

export function buildDonation(overrides: Partial<Donation> = {}): Donation {
  const id = overrides.id ?? nextId();
  return {
    id,
    campaignId: overrides.campaignId ?? nextId(),
    userId: null,
    stripePaymentId: `pi_test_${id}`,
    provider: 'stripe',
    providerReference: `pi_test_${id}`,
    amount: 5000, // $50.00
    currency: 'usd',
    donorName: 'Jane Doe',
    donorEmail: 'jane@example.com',
    donorLocation: 'Portland, OR',
    shareLinkId: null,
    message: 'Stay strong!',
    isAnonymous: false,
    isRecurring: false,
    phaseAtTime: 'first_believers' as DonationPhase,
    source: 'real',
    refunded: false,
    subscribedToUpdates: false,
    createdAt: new Date('2026-01-16T12:00:00Z'),
    ...overrides,
  };
}

export function buildUser(overrides: Partial<User> = {}): User {
  const id = overrides.id ?? nextId();
  return {
    id,
    email: `user-${id.slice(-4)}@example.com`,
    emailVerified: null,
    passwordHash: null,
    name: 'Test User',
    image: null,
    location: null,
    avatarUrl: null,
    role: 'donor',
    totalDonated: 0,
    campaignsSupported: 0,
    lastDonorCount: 0,
    badges: [],
    preferences: {},
    phone: null,
    phoneE164: null,
    phoneVerifiedAt: null,
    smsConsentAt: null,
    donorType: 'individual',
    organizationName: null,
    address: null,
    lastDonationAt: null,
    donorScore: 0,
    securityQuestion: null,
    securityAnswerHash: null,
    campaignsCreated: 0,
    stripeConnectAccountId: null,
    stripeConnectStatus: 'not_started',
    stripeConnectOnboardedAt: null,
    payoutCurrency: null,
    failedLoginCount: 0,
    failedLoginWindowStart: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function resetFactoryCounter() {
  counter = 0;
}
