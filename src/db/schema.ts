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
  foreignKey,
  unique,
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

/**
 * Which gateway collected a donation.
 *
 * Needed because the gateway is not inferable from the reference and because
 * nearly every money operation is provider-specific: a PayHero donation cannot
 * be refunded through `stripe.refunds.create`, and a Stripe donation cannot be
 * looked up at PayHero. Before this column existed there was one gateway and
 * the question could not arise. See `docs/92`.
 *
 * `seed` is not a gateway and is not listed here: fabricated donations are
 * marked by `donations.source = 'seed'` (docs/33) and carry the provider of
 * whatever rail the campaign would have used.
 */
export const paymentProviderEnum = pgEnum('payment_provider', ['stripe', 'payhero']);

/**
 * The life of one M-Pesa STK push.
 *
 * `pending` — the prompt was queued and we have not been told the outcome.
 * `succeeded` — PayHero reported SUCCESS and a donation row exists.
 * `failed` — PayHero reported FAILED, which covers a donor cancelling, the
 * prompt expiring, and insufficient funds. PayHero does not distinguish
 * those, so neither does this.
 * `abandoned` — never resolved within the window a prompt can live, and the
 * status endpoint still says QUEUED. Not the same as `failed`: nothing is
 * known, rather than known to have failed.
 */
export const payheroRequestStatusEnum = pgEnum('payhero_request_status', [
  'pending',
  'succeeded',
  'failed',
  'abandoned',
]);

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
    /**
     * ISO 4217 code for every amount on this campaign.
     *
     * `goal_amount`, `raised_amount`, `total_released_amount` and
     * `total_withdrawn_amount` are integers in THIS currency's minor unit, as
     * is every `donations.amount` against it. A campaign's currency is fixed at
     * creation and must never change once money has arrived: changing it would
     * silently reinterpret the existing total.
     *
     * Defaults to USD because every campaign that existed before migration
     * 0005 was created with a USD goal by a USD-only codebase. See
     * `src/lib/money/currencies.ts` and `docs/92`.
     */
    currency: text('currency').notNull().default('USD'),
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
    /*
      The organiser's name as read off their identity document by Didit.

      The ONLY trustworthy name the platform holds. `users.name` is
      self-declared, so comparing an uploaded bill against it proves nothing -
      whoever uploaded the document also typed the name. Document screening
      (`src/lib/screening/`) refuses to auto-approve anything while this is
      null, which is the correct behaviour and currently the case for every
      campaign: no Didit session has ever been completed.

      PII: a legal name from a government ID. It is written only by the Didit
      decision path and read only by screening and admin review.
    */
    diditVerifiedName: text('didit_verified_name'),
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
    check('campaigns_currency_iso4217', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    /*
      `id` alone is already the primary key, so this adds no new uniqueness.
      It exists purely so `donations` can carry a COMPOSITE foreign key on
      (campaign_id, currency) — Postgres requires a unique constraint on the
      referenced columns. See the FK on `donations` for what that buys.
    */
    unique('campaigns_id_currency_key').on(table.id, table.currency),
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
     * The gateway's own reference for this payment, unique across the platform.
     *
     * Named for Stripe because Stripe was the only gateway when it was created,
     * and it is NOT renamed here: `idx_donations_stripe_payment_id` is the sole
     * durable protection against a duplicate webhook creating a second donation
     * row (CLAUDE.md forbids dropping it), and the rename is a 20-file
     * mechanical change with no functional benefit to this one. It is recorded
     * as debt in `docs/92` instead.
     *
     * Values are namespaced per provider so two gateways can never collide:
     * `pi_…` from Stripe, `payhero_<reference>` from PayHero, `seed_<uuid>` for
     * fabricated rows (the precedent, set in `src/lib/seed/simulation-engine.ts`).
     * Read `provider` to know which; never pattern-match the prefix to decide
     * what to call.
     */
    stripePaymentId: text('stripe_payment_id').notNull(),
    /**
     * Which gateway took this money.
     *
     * Load-bearing, not informational: every refund path must check it before
     * calling a provider API, because handing a `payhero_…` reference to
     * `stripe.refunds.create` fails, and handing a `pi_…` reference to PayHero
     * 404s. Defaults to `stripe` because every row that could have existed
     * before migration 0005 was a Stripe row — though in fact there were none
     * (`select count(*) from donations` was 0 on 2026-10-21, which is what made
     * this migration safe to do at all).
     */
    provider: paymentProviderEnum('provider').notNull().default('stripe'),
    /**
     * ISO 4217 code this `amount` is denominated in.
     *
     * Always equal to the campaign's currency — enforced by the composite
     * foreign key below, not merely by convention.
     */
    currency: text('currency').notNull().default('USD'),
    amount: integer('amount').notNull(),
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
    index('idx_donations_provider').on(table.provider),
    /*
      Was `amount >= 500`, a USD-cents literal meaning "$5 minimum". Kept as a
      bare positivity check once a second currency arrived, because 500 KES
      minor units is about US$0.04 — so the old constraint imposed a real floor
      on one currency and a meaningless one on the other. The per-currency floor
      moved to `CURRENCIES[code].minDonationMinor` and is enforced by
      `src/lib/validators/donation.ts`. The trade-off accepted: the floor is now
      an application rule with a test behind it, not a database guarantee.
      Positivity stays in the database, because a zero or negative donation
      would corrupt `raised_amount` and no code path should be trusted with it.
    */
    check('donations_amount_check', sql`${table.amount} > 0`),
    check('donations_currency_iso4217', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    /*
      A donation is always denominated in its campaign's currency.

      This composite FK is what makes that a database guarantee rather than a
      convention. Postgres cannot express a cross-table CHECK, and this project
      has no triggers; a composite FK onto `campaigns (id, currency)` gets the
      same guarantee out of machinery already in use. Two consequences, both
      wanted:

        1. Inserting a KES donation against a USD campaign fails outright,
           rather than adding KES minor units into a USD `raised_amount` and
           corrupting every total, the `campaigns_released_lte_raised` CHECK and
           every payout derived from them.
        2. A campaign's currency becomes immutable once any donation exists,
           because the UPDATE would orphan those rows. Changing it afterwards
           would silently reinterpret the money already raised.

      The single-column FK on `campaign_id` is left in place as well; it is
      redundant for integrity but documents the plain relationship.
    */
    foreignKey({
      name: 'donations_campaign_currency_fk',
      columns: [table.campaignId, table.currency],
      foreignColumns: [campaigns.id, campaigns.currency],
    }),
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

// ─── M-Pesa collection requests (docs/92) ──────────────────────────────────

/**
 * An M-Pesa STK push we asked PayHero to send, and what came of it.
 *
 * This table exists for three reasons, all of them forced by how PayHero
 * behaves rather than by preference:
 *
 * 1. **The payment is unverifiable without it.** PayHero's
 *    `transaction-status` resolves only PayHero's own `reference`; our
 *    `external_reference` returns 404 (probed 2026-10-21). So the reference
 *    handed back at initiation has to be persisted the moment we get it, or
 *    the money becomes impossible to confirm.
 *
 * 2. **A donation row cannot be created yet.** A `donations` row means money
 *    arrived. At initiation nothing has happened but a prompt appearing on a
 *    handset, and most prompts are never completed. The donor's context has
 *    to live somewhere until the outcome is known, and `donations` is the
 *    wrong place for a maybe.
 *
 * 3. **It is the isolation boundary.** The PayHero account is shared with
 *    BETWOIN LTD, another of the owner's companies, with 792 transactions and
 *    one shared channel. A callback is only acted on if its
 *    `ExternalReference` matches a row here that WE wrote. Anything else is
 *    the other product's traffic or a forgery, and PayHero's callbacks carry
 *    no signature to tell them apart by.
 */
export const payheroPaymentRequests = pgTable(
  'payhero_payment_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Our own reference, `LD-<uuid>`, sent to PayHero as
     * `external_reference` and echoed back on the callback. Unique, because
     * it is the key a callback is resolved by.
     */
    externalReference: text('external_reference').notNull(),
    /**
     * PayHero's reference, the ONLY key their status endpoint accepts.
     * Nullable only for the instant between insert and the API answering.
     */
    payheroReference: text('payhero_reference'),
    /** Safaricom's checkout id. Informational; often empty. */
    checkoutRequestId: text('checkout_request_id'),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** Always equal to the campaign's currency; enforced by the FK below. */
    currency: text('currency').notNull(),
    /** Minor units, matching `donations.amount`. */
    amount: integer('amount').notNull(),
    /** The normalised number, for the per-number abuse guard. */
    phoneE164: text('phone_e164').notNull(),
    /** What was actually sent to PayHero, in their national format. */
    msisdnSent: text('msisdn_sent').notNull(),
    /** The channel that collected it, asserted against the callback. */
    channelId: integer('channel_id').notNull(),
    status: payheroRequestStatusEnum('status').notNull().default('pending'),
    /** PayHero's own words when it failed, for the donor-facing message. */
    failureReason: text('failure_reason'),
    /** The M-Pesa receipt number, once settled. */
    providerReference: text('provider_reference'),
    /** Set once a donation row exists, which is what makes settling single-shot. */
    donationId: uuid('donation_id').references(() => donations.id),
    // Donor context, held until the outcome is known.
    donorName: text('donor_name').notNull().default('Anonymous'),
    donorEmail: text('donor_email').notNull(),
    donorLocation: text('donor_location'),
    message: text('message'),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    subscribedToUpdates: boolean('subscribed_to_updates').notNull().default(false),
    /** Attribution, resolved at initiation like the Stripe path. See docs/57. */
    shareLinkId: uuid('share_link_id').references(() => campaignShareLinks.id),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_payhero_requests_external_ref').on(table.externalReference),
    index('idx_payhero_requests_payhero_ref').on(table.payheroReference),
    index('idx_payhero_requests_campaign').on(table.campaignId),
    index('idx_payhero_requests_status').on(table.status),
    /*
      The per-number abuse guard reads "how many pushes has this number had
      recently", which is a scan over (phone, created_at).
    */
    index('idx_payhero_requests_phone_created').on(table.phoneE164, table.createdAt),
    check('payhero_requests_amount_positive', sql`${table.amount} > 0`),
    check('payhero_requests_currency_iso4217', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    /*
      Same guarantee as on `donations`: a collection request is always
      denominated in the currency its campaign raises in, enforced by the
      database rather than by convention. See the FK on `donations` for the
      full reasoning.
    */
    foreignKey({
      name: 'payhero_requests_campaign_currency_fk',
      columns: [table.campaignId, table.currency],
      foreignColumns: [campaigns.id, campaigns.currency],
    }),
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

// ─── Document Screening ─────────────────────────────────────────────────────

/**
 * What the machine made of one uploaded verification document.
 *
 * ADVISORY PLUS ONE NARROW ACTION. A row here records what was read and what
 * was decided; the only thing screening may change elsewhere is
 * `verification_documents.status`, and only to `approved`, and only when the
 * flag list is empty. It never writes `campaigns.verification_status`, so it
 * cannot authorise a payout (`withdraw/route.ts` requires `fully_verified`)
 * or lift the pre-verification raise cap (`docs/101`). See
 * `src/lib/screening/decide.ts`.
 *
 * `document_id` is UNIQUE, which is the replay guard: a job that runs twice
 * over the same document cannot screen it twice or approve it twice.
 */
export const documentScreenings = pgTable(
  'document_screenings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .unique()
      .references(() => verificationDocuments.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** 'auto_approve' | 'needs_human'. There is deliberately no auto-reject. */
    action: text('action').notNull(),
    /** Every reason it went to a person. Empty array means it was approved. */
    flags: jsonb('flags').notNull().default(sql`'[]'::jsonb`),
    summary: text('summary').notNull(),
    nameMatchKind: text('name_match_kind').notNull(),
    /**
     * 0-100, an INTEGER percentage.
     *
     * Not a float: this is displayed to a reviewer beside a decision about
     * someone's appeal, and a stored binary float that renders as
     * 0.8200000000000001 undermines the one thing it is there to do.
     */
    nameMatchScore: integer('name_match_score').notNull(),
    nameMatchDistance: integer('name_match_distance'),
    /** The fields read off the document. Null when the read failed entirely. */
    extracted: jsonb('extracted'),
    /** As the PROVIDER reported it, which is what the allowlist is checked against. */
    modelUsed: text('model_used'),
    latencyMs: integer('latency_ms'),
    /** Pages in the source document; only page 1 is ever read. */
    pageCount: integer('page_count'),
    hasMorePages: boolean('has_more_pages').notNull().default(false),
    /** Why the read failed, when it did. */
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_document_screenings_campaign').on(table.campaignId),
    index('idx_document_screenings_action').on(table.action),
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
