import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── Enums ──────────────────────────────────────────────────────────────────

export const campaignStatusEnum = pgEnum('campaign_status', [
  'draft',
  'active',
  'last_donor_zone',
  'completed',
  'archived',
  'paused',
  'under_review',
  'suspended',
  'cancelled',
]);

export const campaignCategoryEnum = pgEnum('campaign_category', [
  'medical',
  'disaster',
  'military',
  'veterans',
  'memorial',
  'first-responders',
  'community',
  'essential-needs',
  'emergency',
  'charity',
  'education',
  'animal',
  'environment',
  'business',
  'competition',
  'creative',
  'event',
  'faith',
  'family',
  'sports',
  'travel',
  'volunteer',
  'wishes',
]);

export const donationPhaseEnum = pgEnum('donation_phase', [
  'first_believers',
  'the_push',
  'closing_in',
  'last_donor_zone',
]);

export const donationSourceEnum = pgEnum('donation_source', ['real', 'seed']);

export const userRoleEnum = pgEnum('user_role', ['donor', 'editor', 'admin']);

export const blogCategoryEnum = pgEnum('blog_category', [
  'campaign_story',
  'impact_report',
  'news',
]);

export const auditSeverityEnum = pgEnum('audit_severity', [
  'info',
  'warning',
  'error',
  'critical',
]);

export const blogTopicStatusEnum = pgEnum('blog_topic_status', [
  'pending',
  'generating',
  'generated',
  'published',
  'rejected',
  'stale',
]);

export const blogSourceEnum = pgEnum('blog_source', [
  'ai_generated',
  'manual',
  'refresh',
]);

export const donorTypeEnum = pgEnum('donor_type', [
  'individual',
  'corporate',
  'foundation',
]);

export const interactionTypeEnum = pgEnum('interaction_type', [
  'email',
  'call',
  'meeting',
  'note',
]);

export const verificationStatusEnum = pgEnum('verification_status', [
  'unverified',
  'pending',
  'verified',
  'submitted_for_review',
  'documents_uploaded',
  'identity_verified',
  'fully_verified',
  'info_requested',
  'rejected',
  'suspended',
]);

export const withdrawalStatusEnum = pgEnum('withdrawal_status', [
  'requested',
  'approved',
  'processing',
  'completed',
  'rejected',
  'failed',
]);

export const stripeConnectStatusEnum = pgEnum('stripe_connect_status', [
  'not_started',
  'onboarding_started',
  'pending_verification',
  'verified',
  'restricted',
  'rejected',
]);



export const impactUpdateStatusEnum = pgEnum('impact_update_status', [
  'pending',
  'submitted',
  'approved',
  'rejected',
  'overdue',
]);

export const infoRequestStatusEnum = pgEnum('info_request_status', [
  'pending',
  'responded',
  'expired',
  'closed',
]);

export const supportChannelEnum = pgEnum('support_channel', [
  'site_chat',
  'whatsapp',
  'email',
  'phone',
  'social_media',
]);

export const documentStatusEnum = pgEnum('document_status', [
  'pending',
  'approved',
  'rejected',
]);

export const refundBatchStatusEnum = pgEnum('refund_batch_status', [
  'processing',
  'completed',
  'partial_failure',
]);

export const refundRecordStatusEnum = pgEnum('refund_record_status', [
  'pending',
  'completed',
  'failed',
]);

export const bulkEmailStatusEnum = pgEnum('bulk_email_status', [
  'draft',
  'sending',
  'completed',
  'failed',
]);

export const supportConversationStatusEnum = pgEnum('support_conversation_status', [
  'open',
  'assigned',
  'pending_user',
  'resolved',
  'closed',
]);

export const supportPriorityEnum = pgEnum('support_priority', [
  'low',
  'normal',
  'high',
  'urgent',
]);

export const notificationTypeEnum = pgEnum('notification_type', [
  'donation_refunded',
  'donation_refund_reversed',
  'campaign_completed',
  'campaign_archived',
  'campaign_status_changed',
  'role_changed',
  'account_deleted',
  'new_message',
  'message_flagged',
  'campaign_donation_received',
  'campaign_milestone', // Donor count milestones (10, 25, 50, 100 donors) - actively used
  'campaign_message_received',
  'withdrawal_processed',
  'campaign_submitted',
  'campaign_paused',
  'campaign_resumed',
  'campaign_suspended',
  'campaign_cancelled',
  'info_request',
  'info_request_reminder',
  'milestone_approved',  // Legacy: kept for historical notifications (PG enum values cannot be removed)
  'milestone_rejected',  // Legacy: kept for historical notifications
  'fund_released',       // Legacy: replaced by lump-sum release via verification approval
  'verification_approved',
  'verification_rejected',
  'verification_documents_submitted',
  'bulk_refund_processed',
  'withdrawal_completed',
  'withdrawal_failed',
  'abandoned_donation',
  'donor_reengagement',
  'creator_inactivity',
]);

// ─── Tables ─────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  passwordHash: text('password_hash'),
  name: text('name'),
  image: text('image'), // Required by NextAuth Drizzle adapter
  location: text('location'),
  avatarUrl: text('avatar_url'),
  role: userRoleEnum('role').notNull().default('donor'),
  totalDonated: integer('total_donated').notNull().default(0),
  campaignsSupported: integer('campaigns_supported').notNull().default(0),
  lastDonorCount: integer('last_donor_count').notNull().default(0),
  /*
    Free text, admin-editable, never validated. Kept as the display value
    a human typed; `phoneE164` below is the one anything sends to.
  */
  phone: text('phone'),
  /*
    The sendable number, normalised by `src/lib/phone.ts`. Nothing may SMS
    a person from `phone` above. See docs/82.

    `phoneVerifiedAt` and `smsConsentAt` are timestamps rather than
    booleans for the same reason the mail consent in docs/41 is: for a
    message somebody did not ask for, "did they agree" is not the question
    anyone ends up needing answered - "when, and is that still current" is.
  */
  phoneE164: text('phone_e164'),
  phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
  smsConsentAt: timestamp('sms_consent_at', { withTimezone: true }),
  donorType: donorTypeEnum('donor_type').notNull().default('individual'),
  organizationName: text('organization_name'),
  address: jsonb('address'),
  lastDonationAt: timestamp('last_donation_at', { withTimezone: true }),
  campaignsCreated: integer('campaigns_created').notNull().default(0),
  donorScore: integer('donor_score').notNull().default(0),
  badges: jsonb('badges').notNull().default(sql`'[]'::jsonb`),
  preferences: jsonb('preferences').notNull().default(sql`'{}'::jsonb`),
  securityQuestion: text('security_question'),
  securityAnswerHash: text('security_answer_hash'),
  stripeConnectAccountId: text('stripe_connect_account_id').unique(),
  stripeConnectStatus: stripeConnectStatusEnum('stripe_connect_status').notNull().default('not_started'),
  stripeConnectOnboardedAt: timestamp('stripe_connect_onboarded_at', { withTimezone: true }),
  payoutCurrency: text('payout_currency'),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  failedLoginWindowStart: timestamp('failed_login_window_start', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
},
(table) => [
  index('idx_users_donor_score').on(table.donorScore),
  index('idx_users_donor_type').on(table.donorType),
  index('idx_users_last_donation_at').on(table.lastDonationAt),
  index('idx_users_total_donated').on(table.totalDonated),
  check('users_total_donated_nonneg', sql`${table.totalDonated} >= 0`),
  check('users_campaigns_supported_nonneg', sql`${table.campaignsSupported} >= 0`),
  check('users_last_donor_count_nonneg', sql`${table.lastDonorCount} >= 0`),
  check('users_donor_score_nonneg', sql`${table.donorScore} >= 0`),
  check('users_failed_login_nonneg', sql`${table.failedLoginCount} >= 0`),
],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    status: campaignStatusEnum('status').notNull().default('draft'),
    heroImageUrl: text('hero_image_url').notNull(),
    galleryImages: jsonb('gallery_images').$type<string[]>().default(sql`'[]'::jsonb`),
    photoCredit: text('photo_credit'),
    youtubeUrl: text('youtube_url'),
    storyHtml: text('story_html').notNull(),
    goalAmount: integer('goal_amount').notNull(),
    raisedAmount: integer('raised_amount').notNull().default(0),
    donorCount: integer('donor_count').notNull().default(0),
    category: campaignCategoryEnum('category').notNull(),
    location: text('location'),
    subjectName: text('subject_name').notNull(),
    subjectHometown: text('subject_hometown'),
    impactTiers: jsonb('impact_tiers').default(sql`'[]'::jsonb`),
    campaignProfile: jsonb('campaign_profile'),
    campaignOrganizer: jsonb('campaign_organizer'),
    fundUsagePlan: text('fund_usage_plan'),
    source: text('source').default('manual'),
    simulationFlag: boolean('simulation_flag').notNull().default(false),
    simulationConfig: jsonb('simulation_config').$type<import('@/types').SimulationConfig | null>().default(null),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastDonorId: uuid('last_donor_id').references(() => users.id),
    lastDonorName: text('last_donor_name'),
    lastDonorAmount: integer('last_donor_amount'),
    creatorId: uuid('creator_id').references(() => users.id),
    beneficiaryRelation: text('beneficiary_relation'),
    verificationStatus: verificationStatusEnum('verification_status').notNull().default('unverified'),
    cancellationReason: text('cancellation_reason'),
    cancellationNotes: text('cancellation_notes'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    pausedReason: text('paused_reason'),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedReason: text('suspended_reason'),
    verificationReviewerId: uuid('verification_reviewer_id').references(() => users.id),
    verificationReviewedAt: timestamp('verification_reviewed_at', { withTimezone: true }),
    verificationNotes: text('verification_notes'),
    totalReleasedAmount: integer('total_released_amount').notNull().default(0),
    totalWithdrawnAmount: integer('total_withdrawn_amount').notNull().default(0),
    stripeVerificationId: text('stripe_verification_id'),
    stripeVerificationUrl: text('stripe_verification_url'),
    /*
      Didit replaced Stripe Identity as the verification provider
      (docs/81). The Stripe columns are kept, not dropped: they hold the
      only record of any verification started under the old provider, and
      dropping a column to tidy up is how history is lost. New sessions
      write the two below.
    */
    diditSessionId: text('didit_session_id'),
    diditSessionUrl: text('didit_session_url'),
    // Echo columns: pre-computed counters to avoid N+1 queries on listing pages
    seedDonationCount: integer('seed_donation_count').notNull().default(0),
    messageCount: integer('message_count').notNull().default(0),
    updateCount: integer('update_count').notNull().default(0),
  },
  (table) => [
    index('idx_campaigns_status').on(table.status),
    index('idx_campaigns_category').on(table.category),
    index('idx_campaigns_status_category').on(table.status, table.category),
    index('idx_campaigns_published_at').on(table.publishedAt),
    index('idx_campaigns_simulation_flag').on(table.simulationFlag),
    index('idx_campaigns_creator_id').on(table.creatorId),
    uniqueIndex('idx_campaigns_stripe_verification_id').on(table.stripeVerificationId),
    uniqueIndex('idx_campaigns_didit_session_id').on(table.diditSessionId),
    check('campaigns_raised_nonneg', sql`${table.raisedAmount} >= 0`),
    check('campaigns_goal_positive', sql`${table.goalAmount} > 0`),
    check('campaigns_donor_count_nonneg', sql`${table.donorCount} >= 0`),
    check('campaigns_released_nonneg', sql`${table.totalReleasedAmount} >= 0`),
    check('campaigns_released_lte_raised', sql`${table.totalReleasedAmount} <= ${table.raisedAmount}`),
    check('campaigns_withdrawn_nonneg', sql`${table.totalWithdrawnAmount} >= 0`),
  ],
);

export const donations = pgTable(
  'donations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    userId: uuid('user_id').references(() => users.id),
    /**
     * Stripe's PaymentIntent id. NULLABLE since 2026-10-19, because a
     * donation taken on the FinoQ rail has no Stripe id and inventing one
     * to satisfy a NOT NULL would corrupt the only replay protection we
     * have.
     *
     * The unique index below is unchanged and still the thing CLAUDE.md
     * says never to drop. Postgres unique indexes permit multiple NULLs,
     * so FinoQ rows do not collide with each other or weaken it, and the
     * `donations_stripe_id_present` check below keeps the guarantee that a
     * Stripe donation always carries one. See docs/94.
     */
    stripePaymentId: text('stripe_payment_id'),
    /**
     * Which rail took the money. Defaulted to `stripe` so every existing
     * row - and every row written by code that predates the second rail -
     * is correctly labelled without a backfill.
     */
    provider: text('provider').notNull().default('stripe'),
    /**
     * The provider's own id for this payment, whichever provider it was.
     * For Stripe this duplicates `stripe_payment_id`; for FinoQ it is the
     * `external_reference` we mint and match the callback against.
     *
     * Nullable only so the column could be added to a live table; the
     * uniqueness that provides cross-provider replay protection is on
     * (provider, provider_reference) below.
     */
    providerReference: text('provider_reference'),
    amount: integer('amount').notNull(),
    /**
     * ISO 4217, lowercase, in MINOR units alongside `amount`.
     *
     * Added 2026-10-19. Every amount in this table was USD by assumption
     * and nothing recorded it, so a second rail would have had
     * `SUM(amount)` adding shillings to dollars and publishing the result
     * as dollars on /transparency. Defaulted to the platform currency, so
     * the existing rows are right without a backfill. See docs/94.
     */
    currency: text('currency').notNull().default('usd'),
    donorName: text('donor_name').notNull().default('Anonymous'),
    donorEmail: text('donor_email').notNull(),
    donorLocation: text('donor_location'),
    message: text('message'),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    isRecurring: boolean('is_recurring').notNull().default(false),
    phaseAtTime: donationPhaseEnum('phase_at_time').notNull(),
    source: donationSourceEnum('source').notNull().default('real'),
    refunded: boolean('refunded').notNull().default(false),
    subscribedToUpdates: boolean('subscribed_to_updates').notNull().default(false),
    /**
     * Which share link brought this donor, if any. Nullable: most donations
     * arrive directly. See `docs/57`.
     */
    shareLinkId: uuid('share_link_id').references(() => campaignShareLinks.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_donations_campaign_id').on(table.campaignId),
    index('idx_donations_share_link_id').on(table.shareLinkId),
    index('idx_donations_user_id').on(table.userId),
    index('idx_donations_created_at').on(table.createdAt),
    uniqueIndex('idx_donations_stripe_payment_id').on(table.stripePaymentId),
    /**
     * Replay protection for every rail, not just Stripe. A provider that
     * redelivers a webhook - which both of ours do - must not be able to
     * write the donation twice.
     */
    uniqueIndex('idx_donations_provider_reference').on(
      table.provider,
      table.providerReference,
    ),
    /**
     * A Stripe donation always has a Stripe id. This is what `notNull()`
     * on `stripe_payment_id` used to guarantee before FinoQ rows needed
     * to omit it.
     */
    check(
      'donations_stripe_id_present',
      sql`${table.provider} <> 'stripe' OR ${table.stripePaymentId} IS NOT NULL`,
    ),
    /*
      NOTE, deliberately not changed here: the minimum below is 500 MINOR
      units of whatever currency the row is in. As $5.00 that is the
      documented floor; as KES 5.00 it is about four US cents. A
      per-currency minimum is a product decision (what is the smallest
      donation worth taking in each market), so it is recorded in docs/94
      rather than guessed at in a CHECK constraint.
    */
    check('donations_amount_check', sql`${table.amount} >= 500`),
  ],
);

/**
 * A share link belongs to one campaign and one sharer.
 *
 * `docs/30` §1 identifies the attributed share loop as GoFundMe's growth
 * engine rather than a feature: a plain share button is not parity, because
 * it cannot tell an organizer which of their supporters actually reached
 * anyone. This table is what makes a share countable.
 *
 * The token is random, not signed. These are looked up in the database on
 * every use, so a signature would add verification cost without adding
 * security - unlike `unsubscribe-tokens`, which must be verifiable with no
 * row to check against. See `docs/57`.
 */
export const campaignShareLinks = pgTable(
  'campaign_share_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    token: text('token').notNull(),
    /** Null for a guest sharer; the link still attributes. */
    userId: uuid('user_id').references(() => users.id),
    /** Visits that resolved this token. Not unique visitors. */
    clickCount: integer('click_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_campaign_share_links_token').on(table.token),
    index('idx_campaign_share_links_campaign_id').on(table.campaignId),
    index('idx_campaign_share_links_user_id').on(table.userId),
  ],
);

export const campaignUpdates = pgTable('campaign_updates', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id),
  title: text('title').notNull(),
  bodyHtml: text('body_html').notNull(),
  updateType: text('update_type'),
  imageUrl: text('image_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const blogPosts = pgTable(
  'blog_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    bodyHtml: text('body_html').notNull(),
    excerpt: text('excerpt'),
    coverImageUrl: text('cover_image_url'),
    authorName: text('author_name').notNull(),
    authorBio: text('author_bio'),
    category: blogCategoryEnum('category').notNull(),
    published: boolean('published').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Pipeline columns (migration 0018)
    source: blogSourceEnum('source').notNull().default('manual'),
    metaTitle: text('meta_title'),
    metaDescription: text('meta_description'),
    primaryKeyword: text('primary_keyword'),
    secondaryKeywords: jsonb('secondary_keywords').default(sql`'[]'::jsonb`),
    seoScore: integer('seo_score'),
    wordCount: integer('word_count'),
    readabilityScore: integer('readability_score'),
    internalLinks: jsonb('internal_links').default(sql`'[]'::jsonb`),
    externalLinks: jsonb('external_links').default(sql`'[]'::jsonb`),
    faqData: jsonb('faq_data'),
    topicId: uuid('topic_id').references(() => blogTopicQueue.id, { onDelete: 'set null' }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    causeCategory: text('cause_category'),
  },
  (table) => [
    index('idx_blog_posts_published').on(table.published, table.publishedAt),
    index('idx_blog_posts_topic_id').on(table.topicId),
  ],
);

export const newsletterSubscribers = pgTable('newsletter_subscribers', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  subscribedAt: timestamp('subscribed_at', { withTimezone: true }).notNull().defaultNow(),
  unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
  source: text('source'),
});

// ─── Blog Topic Queue ───────────────────────────────

export const blogTopicQueue = pgTable(
  'blog_topic_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    primaryKeyword: text('primary_keyword').notNull(),
    secondaryKeywords: jsonb('secondary_keywords').notNull().default(sql`'[]'::jsonb`),
    searchIntent: text('search_intent'),
    targetWordCount: integer('target_word_count').notNull().default(3000),
    causeCategory: text('cause_category'),
    priorityScore: integer('priority_score').notNull().default(50),
    seasonalBoost: integer('seasonal_boost').notNull().default(0),
    newsHook: text('news_hook'),
    sourceNewsId: uuid('source_news_id'),
    contentBrief: jsonb('content_brief'),
    outline: jsonb('outline'),
    status: blogTopicStatusEnum('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    generatedPostId: uuid('generated_post_id'),
    rejectedReason: text('rejected_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_blog_topic_queue_status').on(table.status),
    index('idx_blog_topic_queue_priority').on(table.priorityScore),
    index('idx_blog_topic_queue_category').on(table.causeCategory),
  ],
);

// ─── Blog Generation Logs ───────────────────────────

export const blogGenerationLogs = pgTable(
  'blog_generation_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topicId: uuid('topic_id').notNull().references(() => blogTopicQueue.id, { onDelete: 'cascade' }),
    postId: uuid('post_id').references(() => blogPosts.id, { onDelete: 'set null' }),
    step: text('step').notNull(),
    model: text('model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    success: boolean('success').notNull().default(true),
    errorMessage: text('error_message'),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_blog_gen_logs_topic').on(table.topicId),
    index('idx_blog_gen_logs_step').on(table.step),
    index('idx_blog_gen_logs_created').on(table.createdAt),
  ],
);

export const newsItems = pgTable(
  'news_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    url: text('url').notNull().unique(),
    source: text('source').notNull(),
    summary: text('summary'),
    articleBody: text('article_body'),
    imageUrl: text('image_url'),
    category: campaignCategoryEnum('category'),
    relevanceScore: integer('relevance_score'),
    campaignCreated: boolean('campaign_created').notNull().default(false),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    adminFlagged: boolean('admin_flagged').notNull().default(false),
    adminOverrideCategory: campaignCategoryEnum('admin_override_category'),
    adminNotes: text('admin_notes'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_news_items_fetched_at').on(table.fetchedAt),
    index('idx_news_items_campaign_created').on(table.campaignCreated),
    index('idx_news_items_admin_flagged').on(table.adminFlagged),
  ],
);

export const keywordRotation = pgTable(
  'keyword_rotation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    category: text('category').notNull(),
    keyword: text('keyword').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_keyword_rotation_category').on(table.category),
    uniqueIndex('idx_keyword_rotation_category_keyword').on(table.category, table.keyword),
  ],
);

export const campaignSeedMessages = pgTable(
  'campaign_seed_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    message: text('message').notNull(),
    persona: text('persona'),
    phase: donationPhaseEnum('phase').notNull(),
    used: boolean('used').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_seed_messages_campaign_used').on(table.campaignId, table.used),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    eventType: text('event_type').notNull(),
    actorId: uuid('actor_id'),
    actorRole: userRoleEnum('actor_role'),
    actorIp: text('actor_ip'),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    details: jsonb('details').default(sql`'{}'::jsonb`),
    severity: auditSeverityEnum('severity').notNull().default('info'),
  },
  (table) => [
    index('idx_audit_logs_event_type').on(table.eventType),
    index('idx_audit_logs_timestamp').on(table.timestamp),
    index('idx_audit_logs_actor_id').on(table.actorId),
    index('idx_audit_logs_target_id').on(table.targetId),
  ],
);

export const interactionLogs = pgTable(
  'interaction_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    donorId: uuid('donor_id')
      .notNull()
      .references(() => users.id),
    staffId: uuid('staff_id')
      .references(() => users.id),
    type: interactionTypeEnum('type').notNull(),
    subject: text('subject').notNull(),
    body: text('body'),
    contactedAt: timestamp('contacted_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_interaction_logs_donor_id').on(table.donorId),
    index('idx_interaction_logs_staff_id').on(table.staffId),
    index('idx_interaction_logs_contacted_at').on(table.contactedAt),
  ],
);

export const donorRelationships = pgTable(
  'donor_relationships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    donorId: uuid('donor_id')
      .notNull()
      .references(() => users.id),
    relatedDonorId: uuid('related_donor_id')
      .references(() => users.id),
    organizationName: text('organization_name'),
    relationshipType: text('relationship_type').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_donor_relationships_donor_id').on(table.donorId),
    index('idx_donor_relationships_related_id').on(table.relatedDonorId),
  ],
);

// ─── NextAuth.js tables (via @auth/drizzle-adapter) ─────────────────────────

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
  ],
);

export const sessions = pgTable('sessions', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: uuid('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.identifier, table.token] }),
  ],
);

/**
 * One-time codes for phone verification over SMS.
 *
 * A separate table rather than an `sms:+254…` identifier in
 * `verification_tokens`, which `docs/82` floated. Two reasons, and the
 * second is the deciding one:
 *
 *   - `verification_tokens` is NextAuth's table, keyed on
 *     (identifier, token). You cannot look up "the live code for this
 *     user" without already knowing the code, so there is nowhere to hang
 *     a failed-attempt count.
 *   - A six-digit code is one in a million, which an IP rate limit does
 *     not protect: an attacker spreading guesses across addresses walks
 *     straight through it. The counter has to live on the CODE. That is
 *     `attempts` below, and it is what makes the guess budget five rather
 *     than unbounded.
 *
 * The code itself is never stored — only a SHA-256 of it, like a password.
 * A database read must not hand somebody a working code.
 */
export const phoneVerificationCodes = pgTable(
  'phone_verification_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The E.164 number being proved, not the one currently on the user. */
    phoneE164: text('phone_e164').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One live code per person: minting a new one deletes the old.
    uniqueIndex('idx_phone_verification_codes_user').on(table.userId),
  ],
);

// ─── AI Usage Logs ─────────────────────────────────────────────────────────

export const aiUsageLogs = pgTable(
  'ai_usage_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    model: text('model').notNull(),
    promptType: text('prompt_type').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    success: boolean('success').notNull().default(true),
    errorMessage: text('error_message'),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ai_usage_logs_created_at').on(table.createdAt),
    index('idx_ai_usage_logs_model').on(table.model),
    index('idx_ai_usage_logs_prompt_type').on(table.promptType),
  ],
);

// ─── Fund Pool Allocations (Dual Campaign System) ───────────────────────────

export const fundPoolAllocations = pgTable(
  'fund_pool_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    donationId: uuid('donation_id')
      .notNull()
      .references(() => donations.id),
    sourceCampaignId: uuid('source_campaign_id')
      .notNull()
      .references(() => campaigns.id),
    targetCampaignId: uuid('target_campaign_id').references(() => campaigns.id),
    amount: integer('amount').notNull(),
    status: text('status').notNull().default('pending'),
    allocatedAt: timestamp('allocated_at', { withTimezone: true }),
    disbursedAt: timestamp('disbursed_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_fund_pool_status').on(table.status),
    index('idx_fund_pool_source').on(table.sourceCampaignId),
    index('idx_fund_pool_target').on(table.targetCampaignId),
  ],
);

// ─── Campaign Messages (Dual Campaign System) ──────────────────────────────

export const campaignMessages = pgTable(
  'campaign_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    userId: uuid('user_id').references(() => users.id),
    donorName: text('donor_name').notNull().default('Anonymous'),
    donorLocation: text('donor_location'),
    message: text('message').notNull(),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    donationId: uuid('donation_id').references(() => donations.id),
    flagged: boolean('flagged').notNull().default(false),
    hidden: boolean('hidden').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_campaign_messages_campaign').on(table.campaignId),
    index('idx_campaign_messages_user').on(table.userId),
    index('idx_campaign_messages_created').on(table.createdAt),
    index('idx_campaign_messages_flagged').on(table.flagged),
  ],
);

// ─── Campaign Withdrawals ────────────────────────────────────────────────────

export const campaignWithdrawals = pgTable(
  'campaign_withdrawals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    amount: integer('amount').notNull(),
    status: withdrawalStatusEnum('status').notNull().default('requested'),
    stripeConnectAccount: text('stripe_connect_account'),
    stripeTransferId: text('stripe_transfer_id'),
    processedBy: uuid('processed_by').references(() => users.id),
    notes: text('notes'),
    failureReason: text('failure_reason'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_campaign_withdrawals_campaign').on(table.campaignId),
    index('idx_campaign_withdrawals_status').on(table.status),
    index('idx_campaign_withdrawals_requested_by').on(table.requestedBy),
    index('idx_campaign_withdrawals_idem').on(table.campaignId, table.requestedBy, table.notes),
    check('campaign_withdrawals_amount_check', sql`${table.amount} > 0`),
  ],
);

// ─── Site Settings (key-value) ──────────────────────────────────────────────

export const siteSettings = pgTable('site_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id),
});

// ─── Notifications ──────────────────────────────────────────────────────────

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    link: text('link'),
    read: boolean('read').notNull().default(false),
    emailSent: boolean('email_sent').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_notifications_user_id').on(table.userId),
    index('idx_notifications_user_read').on(table.userId, table.read),
    index('idx_notifications_created_at').on(table.createdAt),
  ],
);

// ─── Trust & Verification System ────────────────────────────────────────────

export const verificationDocuments = pgTable(
  'verification_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    documentType: text('document_type').notNull(),
    fileUrl: text('file_url').notNull(),
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull(),
    mimeType: text('mime_type').notNull(),
    description: text('description'),
    status: documentStatusEnum('status').notNull().default('pending'),
    reviewerId: uuid('reviewer_id').references(() => users.id),
    reviewerNotes: text('reviewer_notes'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_verification_docs_campaign').on(table.campaignId),
    index('idx_verification_docs_status').on(table.status),
  ],
);

// ─── Impact Updates ─────────────────────────────────────────────────────────

export const impactUpdates = pgTable(
  'impact_updates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    submittedBy: uuid('submitted_by').references(() => users.id),
    title: text('title'),
    bodyHtml: text('body_html'),
    photos: jsonb('photos').default(sql`'[]'::jsonb`),
    receiptUrls: jsonb('receipt_urls').default(sql`'[]'::jsonb`),
    status: impactUpdateStatusEnum('status').notNull().default('pending'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewerId: uuid('reviewer_id').references(() => users.id),
    reviewerNotes: text('reviewer_notes'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reminderCount: integer('reminder_count').notNull().default(0),
    lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_impact_updates_campaign').on(table.campaignId),
    index('idx_impact_updates_status').on(table.status),
    index('idx_impact_updates_due_date').on(table.dueDate),
  ],
);

export const infoRequests = pgTable(
  'info_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    targetUser: uuid('target_user')
      .notNull()
      .references(() => users.id),
    requestType: text('request_type').notNull(),
    details: text('details').notNull(),
    deadline: timestamp('deadline', { withTimezone: true }).notNull(),
    status: infoRequestStatusEnum('status').notNull().default('pending'),
    pauseCampaign: boolean('pause_campaign').notNull().default(false),
    responseText: text('response_text'),
    responseFiles: jsonb('response_files').default(sql`'[]'::jsonb`),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    reminderSent: boolean('reminder_sent').notNull().default(false),
    escalated: boolean('escalated').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_info_requests_campaign').on(table.campaignId),
    index('idx_info_requests_status').on(table.status),
    index('idx_info_requests_deadline').on(table.deadline),
    index('idx_info_requests_target_user').on(table.targetUser),
  ],
);

export const donorCampaignSubscriptions = pgTable(
  'donor_campaign_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    donorEmail: text('donor_email').notNull(),
    userId: uuid('user_id').references(() => users.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    subscribed: boolean('subscribed').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_donor_subs_campaign').on(table.campaignId),
    index('idx_donor_subs_email').on(table.donorEmail),
    uniqueIndex('idx_donor_subs_email_campaign').on(table.donorEmail, table.campaignId),
  ],
);

export const refundBatches = pgTable(
  'refund_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    initiatedBy: uuid('initiated_by')
      .notNull()
      .references(() => users.id),
    reason: text('reason').notNull(),
    totalDonations: integer('total_donations').notNull(),
    totalAmount: integer('total_amount').notNull(),
    refundedCount: integer('refunded_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    status: refundBatchStatusEnum('status').notNull().default('processing'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_refund_batches_campaign').on(table.campaignId),
    index('idx_refund_batches_status').on(table.status),
  ],
);

export const refundRecords = pgTable(
  'refund_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => refundBatches.id),
    donationId: uuid('donation_id')
      .notNull()
      .references(() => donations.id),
    amount: integer('amount').notNull(),
    stripeRefundId: text('stripe_refund_id'),
    status: refundRecordStatusEnum('status').notNull().default('pending'),
    errorMessage: text('error_message'),
    emailSent: boolean('email_sent').notNull().default(false),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_refund_records_batch').on(table.batchId),
    index('idx_refund_records_donation').on(table.donationId),
    check('refund_records_amount_check', sql`${table.amount} > 0`),
  ],
);

export const bulkEmails = pgTable(
  'bulk_emails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sentBy: uuid('sent_by')
      .notNull()
      .references(() => users.id),
    templateName: text('template_name').notNull(),
    subject: text('subject').notNull(),
    bodyHtml: text('body_html').notNull(),
    recipientCount: integer('recipient_count').notNull(),
    sentCount: integer('sent_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    status: bulkEmailStatusEnum('status').notNull().default('draft'),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_bulk_emails_status').on(table.status),
  ],
);

export const supportConversations = pgTable(
  'support_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id),
    userEmail: text('user_email'),
    userName: text('user_name'),
    channel: supportChannelEnum('channel').notNull(),
    subject: text('subject'),
    status: supportConversationStatusEnum('status').notNull().default('open'),
    priority: supportPriorityEnum('priority').notNull().default('normal'),
    assignedTo: uuid('assigned_to').references(() => users.id),
    tier: integer('tier').notNull().default(1),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    externalConversationId: text('external_conversation_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_support_conversations_status').on(table.status),
    index('idx_support_conversations_user').on(table.userId),
    index('idx_support_conversations_channel').on(table.channel),
  ],
);
