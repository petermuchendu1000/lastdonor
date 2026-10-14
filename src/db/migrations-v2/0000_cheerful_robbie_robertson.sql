CREATE TYPE "public"."audit_severity" AS ENUM('info', 'warning', 'error', 'critical');--> statement-breakpoint
CREATE TYPE "public"."blog_category" AS ENUM('campaign_story', 'impact_report', 'news');--> statement-breakpoint
CREATE TYPE "public"."blog_source" AS ENUM('ai_generated', 'manual', 'refresh');--> statement-breakpoint
CREATE TYPE "public"."blog_topic_status" AS ENUM('pending', 'generating', 'generated', 'published', 'rejected', 'stale');--> statement-breakpoint
CREATE TYPE "public"."bulk_email_status" AS ENUM('draft', 'sending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."campaign_category" AS ENUM('medical', 'disaster', 'military', 'veterans', 'memorial', 'first-responders', 'community', 'essential-needs', 'emergency', 'charity', 'education', 'animal', 'environment', 'business', 'competition', 'creative', 'event', 'faith', 'family', 'sports', 'travel', 'volunteer', 'wishes');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'last_donor_zone', 'completed', 'archived', 'paused', 'under_review', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."donation_phase" AS ENUM('first_believers', 'the_push', 'closing_in', 'last_donor_zone');--> statement-breakpoint
CREATE TYPE "public"."donation_source" AS ENUM('real', 'seed');--> statement-breakpoint
CREATE TYPE "public"."donor_type" AS ENUM('individual', 'corporate', 'foundation');--> statement-breakpoint
CREATE TYPE "public"."impact_update_status" AS ENUM('pending', 'submitted', 'approved', 'rejected', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."info_request_status" AS ENUM('pending', 'responded', 'expired', 'closed');--> statement-breakpoint
CREATE TYPE "public"."interaction_type" AS ENUM('email', 'call', 'meeting', 'note');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('donation_refunded', 'donation_refund_reversed', 'campaign_completed', 'campaign_archived', 'campaign_status_changed', 'role_changed', 'account_deleted', 'new_message', 'message_flagged', 'campaign_donation_received', 'campaign_milestone', 'campaign_message_received', 'withdrawal_processed', 'campaign_submitted', 'campaign_paused', 'campaign_resumed', 'campaign_suspended', 'campaign_cancelled', 'info_request', 'info_request_reminder', 'milestone_approved', 'milestone_rejected', 'fund_released', 'verification_approved', 'verification_rejected', 'verification_documents_submitted', 'bulk_refund_processed', 'withdrawal_completed', 'withdrawal_failed', 'abandoned_donation', 'donor_reengagement', 'creator_inactivity');--> statement-breakpoint
CREATE TYPE "public"."refund_batch_status" AS ENUM('processing', 'completed', 'partial_failure');--> statement-breakpoint
CREATE TYPE "public"."refund_record_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."stripe_connect_status" AS ENUM('not_started', 'onboarding_started', 'pending_verification', 'verified', 'restricted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."support_channel" AS ENUM('site_chat', 'whatsapp', 'email', 'phone', 'social_media');--> statement-breakpoint
CREATE TYPE "public"."support_conversation_status" AS ENUM('open', 'assigned', 'pending_user', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."support_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('donor', 'editor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'pending', 'verified', 'submitted_for_review', 'documents_uploaded', 'identity_verified', 'fully_verified', 'info_requested', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_status" AS ENUM('requested', 'approved', 'processing', 'completed', 'rejected', 'failed');--> statement-breakpoint
CREATE TABLE "accounts" (
	"userId" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model" text NOT NULL,
	"prompt_type" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"campaign_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"event_type" text NOT NULL,
	"actor_id" uuid,
	"actor_role" "user_role",
	"actor_ip" text,
	"target_type" text,
	"target_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb,
	"severity" "audit_severity" DEFAULT 'info' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blog_generation_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"post_id" uuid,
	"step" text NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blog_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"body_html" text NOT NULL,
	"excerpt" text,
	"cover_image_url" text,
	"author_name" text NOT NULL,
	"author_bio" text,
	"category" "blog_category" NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "blog_source" DEFAULT 'manual' NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"primary_keyword" text,
	"secondary_keywords" jsonb DEFAULT '[]'::jsonb,
	"seo_score" integer,
	"word_count" integer,
	"readability_score" integer,
	"internal_links" jsonb DEFAULT '[]'::jsonb,
	"external_links" jsonb DEFAULT '[]'::jsonb,
	"faq_data" jsonb,
	"topic_id" uuid,
	"scheduled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cause_category" text,
	CONSTRAINT "blog_posts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "blog_topic_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"primary_keyword" text NOT NULL,
	"secondary_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"search_intent" text,
	"target_word_count" integer DEFAULT 3000 NOT NULL,
	"cause_category" text,
	"priority_score" integer DEFAULT 50 NOT NULL,
	"seasonal_boost" integer DEFAULT 0 NOT NULL,
	"news_hook" text,
	"source_news_id" uuid,
	"content_brief" jsonb,
	"outline" jsonb,
	"status" "blog_topic_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"generated_post_id" uuid,
	"rejected_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_topic_queue_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "bulk_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sent_by" uuid NOT NULL,
	"template_name" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"recipient_count" integer NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"status" "bulk_email_status" DEFAULT 'draft' NOT NULL,
	"campaign_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid,
	"donor_name" text DEFAULT 'Anonymous' NOT NULL,
	"donor_location" text,
	"message" text NOT NULL,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"donation_id" uuid,
	"flagged" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_seed_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"message" text NOT NULL,
	"persona" text,
	"phase" "donation_phase" NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body_html" text NOT NULL,
	"update_type" text,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"amount" integer NOT NULL,
	"status" "withdrawal_status" DEFAULT 'requested' NOT NULL,
	"stripe_connect_account" text,
	"stripe_transfer_id" text,
	"processed_by" uuid,
	"notes" text,
	"failure_reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_withdrawals_amount_check" CHECK ("campaign_withdrawals"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"hero_image_url" text NOT NULL,
	"gallery_images" jsonb DEFAULT '[]'::jsonb,
	"photo_credit" text,
	"youtube_url" text,
	"story_html" text NOT NULL,
	"goal_amount" integer NOT NULL,
	"raised_amount" integer DEFAULT 0 NOT NULL,
	"donor_count" integer DEFAULT 0 NOT NULL,
	"category" "campaign_category" NOT NULL,
	"location" text,
	"subject_name" text NOT NULL,
	"subject_hometown" text,
	"impact_tiers" jsonb DEFAULT '[]'::jsonb,
	"campaign_profile" jsonb,
	"campaign_organizer" jsonb,
	"fund_usage_plan" text,
	"source" text DEFAULT 'manual',
	"simulation_flag" boolean DEFAULT false NOT NULL,
	"simulation_config" jsonb DEFAULT 'null'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_donor_id" uuid,
	"last_donor_name" text,
	"last_donor_amount" integer,
	"creator_id" uuid,
	"beneficiary_relation" text,
	"verification_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"cancellation_reason" text,
	"cancellation_notes" text,
	"cancelled_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"paused_reason" text,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"verification_reviewer_id" uuid,
	"verification_reviewed_at" timestamp with time zone,
	"verification_notes" text,
	"total_released_amount" integer DEFAULT 0 NOT NULL,
	"total_withdrawn_amount" integer DEFAULT 0 NOT NULL,
	"stripe_verification_id" text,
	"stripe_verification_url" text,
	"seed_donation_count" integer DEFAULT 0 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"update_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "campaigns_slug_unique" UNIQUE("slug"),
	CONSTRAINT "campaigns_raised_nonneg" CHECK ("campaigns"."raised_amount" >= 0),
	CONSTRAINT "campaigns_goal_positive" CHECK ("campaigns"."goal_amount" > 0),
	CONSTRAINT "campaigns_donor_count_nonneg" CHECK ("campaigns"."donor_count" >= 0),
	CONSTRAINT "campaigns_released_nonneg" CHECK ("campaigns"."total_released_amount" >= 0),
	CONSTRAINT "campaigns_released_lte_raised" CHECK ("campaigns"."total_released_amount" <= "campaigns"."raised_amount"),
	CONSTRAINT "campaigns_withdrawn_nonneg" CHECK ("campaigns"."total_withdrawn_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid,
	"stripe_payment_id" text NOT NULL,
	"amount" integer NOT NULL,
	"donor_name" text DEFAULT 'Anonymous' NOT NULL,
	"donor_email" text NOT NULL,
	"donor_location" text,
	"message" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"phase_at_time" "donation_phase" NOT NULL,
	"source" "donation_source" DEFAULT 'real' NOT NULL,
	"refunded" boolean DEFAULT false NOT NULL,
	"subscribed_to_updates" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donations_amount_check" CHECK ("donations"."amount" >= 500)
);
--> statement-breakpoint
CREATE TABLE "donor_campaign_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donor_email" text NOT NULL,
	"user_id" uuid,
	"campaign_id" uuid NOT NULL,
	"subscribed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unsubscribed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "donor_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donor_id" uuid NOT NULL,
	"related_donor_id" uuid,
	"organization_name" text,
	"relationship_type" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_pool_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donation_id" uuid NOT NULL,
	"source_campaign_id" uuid NOT NULL,
	"target_campaign_id" uuid,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"allocated_at" timestamp with time zone,
	"disbursed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "impact_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"submitted_by" uuid,
	"title" text,
	"body_html" text,
	"photos" jsonb DEFAULT '[]'::jsonb,
	"receipt_urls" jsonb DEFAULT '[]'::jsonb,
	"status" "impact_update_status" DEFAULT 'pending' NOT NULL,
	"due_date" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"reviewer_id" uuid,
	"reviewer_notes" text,
	"reviewed_at" timestamp with time zone,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"last_reminder_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "info_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"target_user" uuid NOT NULL,
	"request_type" text NOT NULL,
	"details" text NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"status" "info_request_status" DEFAULT 'pending' NOT NULL,
	"pause_campaign" boolean DEFAULT false NOT NULL,
	"response_text" text,
	"response_files" jsonb DEFAULT '[]'::jsonb,
	"responded_at" timestamp with time zone,
	"reminder_sent" boolean DEFAULT false NOT NULL,
	"escalated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interaction_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donor_id" uuid NOT NULL,
	"staff_id" uuid,
	"type" "interaction_type" NOT NULL,
	"subject" text NOT NULL,
	"body" text,
	"contacted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keyword_rotation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"keyword" text NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"summary" text,
	"article_body" text,
	"image_url" text,
	"category" "campaign_category",
	"relevance_score" integer,
	"campaign_created" boolean DEFAULT false NOT NULL,
	"campaign_id" uuid,
	"admin_flagged" boolean DEFAULT false NOT NULL,
	"admin_override_category" "campaign_category",
	"admin_notes" text,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_items_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"source" text,
	CONSTRAINT "newsletter_subscribers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"link" text,
	"read" boolean DEFAULT false NOT NULL,
	"email_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"initiated_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"total_donations" integer NOT NULL,
	"total_amount" integer NOT NULL,
	"refunded_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"status" "refund_batch_status" DEFAULT 'processing' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"donation_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"stripe_refund_id" text,
	"status" "refund_record_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"email_sent" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_records_amount_check" CHECK ("refund_records"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "support_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"user_email" text,
	"user_name" text,
	"channel" "support_channel" NOT NULL,
	"subject" text,
	"status" "support_conversation_status" DEFAULT 'open' NOT NULL,
	"priority" "support_priority" DEFAULT 'normal' NOT NULL,
	"assigned_to" uuid,
	"tier" integer DEFAULT 1 NOT NULL,
	"campaign_id" uuid,
	"external_conversation_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"password_hash" text,
	"name" text,
	"image" text,
	"location" text,
	"avatar_url" text,
	"role" "user_role" DEFAULT 'donor' NOT NULL,
	"total_donated" integer DEFAULT 0 NOT NULL,
	"campaigns_supported" integer DEFAULT 0 NOT NULL,
	"last_donor_count" integer DEFAULT 0 NOT NULL,
	"phone" text,
	"donor_type" "donor_type" DEFAULT 'individual' NOT NULL,
	"organization_name" text,
	"address" jsonb,
	"last_donation_at" timestamp with time zone,
	"campaigns_created" integer DEFAULT 0 NOT NULL,
	"donor_score" integer DEFAULT 0 NOT NULL,
	"badges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"security_question" text,
	"security_answer_hash" text,
	"stripe_connect_account_id" text,
	"stripe_connect_status" "stripe_connect_status" DEFAULT 'not_started' NOT NULL,
	"stripe_connect_onboarded_at" timestamp with time zone,
	"payout_currency" text,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"failed_login_window_start" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_stripe_connect_account_id_unique" UNIQUE("stripe_connect_account_id"),
	CONSTRAINT "users_total_donated_nonneg" CHECK ("users"."total_donated" >= 0),
	CONSTRAINT "users_campaigns_supported_nonneg" CHECK ("users"."campaigns_supported" >= 0),
	CONSTRAINT "users_last_donor_count_nonneg" CHECK ("users"."last_donor_count" >= 0),
	CONSTRAINT "users_donor_score_nonneg" CHECK ("users"."donor_score" >= 0),
	CONSTRAINT "users_failed_login_nonneg" CHECK ("users"."failed_login_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "verification_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"document_type" text NOT NULL,
	"file_url" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"description" text,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" uuid,
	"reviewer_notes" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_generation_logs" ADD CONSTRAINT "blog_generation_logs_topic_id_blog_topic_queue_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."blog_topic_queue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_generation_logs" ADD CONSTRAINT "blog_generation_logs_post_id_blog_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."blog_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_topic_id_blog_topic_queue_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."blog_topic_queue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_emails" ADD CONSTRAINT "bulk_emails_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_emails" ADD CONSTRAINT "bulk_emails_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_messages" ADD CONSTRAINT "campaign_messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_messages" ADD CONSTRAINT "campaign_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_messages" ADD CONSTRAINT "campaign_messages_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_seed_messages" ADD CONSTRAINT "campaign_seed_messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_updates" ADD CONSTRAINT "campaign_updates_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_withdrawals" ADD CONSTRAINT "campaign_withdrawals_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_withdrawals" ADD CONSTRAINT "campaign_withdrawals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_withdrawals" ADD CONSTRAINT "campaign_withdrawals_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_last_donor_id_users_id_fk" FOREIGN KEY ("last_donor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_verification_reviewer_id_users_id_fk" FOREIGN KEY ("verification_reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_campaign_subscriptions" ADD CONSTRAINT "donor_campaign_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_campaign_subscriptions" ADD CONSTRAINT "donor_campaign_subscriptions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_relationships" ADD CONSTRAINT "donor_relationships_donor_id_users_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_relationships" ADD CONSTRAINT "donor_relationships_related_donor_id_users_id_fk" FOREIGN KEY ("related_donor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_pool_allocations" ADD CONSTRAINT "fund_pool_allocations_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_pool_allocations" ADD CONSTRAINT "fund_pool_allocations_source_campaign_id_campaigns_id_fk" FOREIGN KEY ("source_campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_pool_allocations" ADD CONSTRAINT "fund_pool_allocations_target_campaign_id_campaigns_id_fk" FOREIGN KEY ("target_campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_updates" ADD CONSTRAINT "impact_updates_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_updates" ADD CONSTRAINT "impact_updates_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_updates" ADD CONSTRAINT "impact_updates_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_requests" ADD CONSTRAINT "info_requests_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_requests" ADD CONSTRAINT "info_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_requests" ADD CONSTRAINT "info_requests_target_user_users_id_fk" FOREIGN KEY ("target_user") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_logs" ADD CONSTRAINT "interaction_logs_donor_id_users_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_logs" ADD CONSTRAINT "interaction_logs_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_batches" ADD CONSTRAINT "refund_batches_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_batches" ADD CONSTRAINT "refund_batches_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_batch_id_refund_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."refund_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_created_at" ON "ai_usage_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_model" ON "ai_usage_logs" USING btree ("model");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_prompt_type" ON "ai_usage_logs" USING btree ("prompt_type");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_event_type" ON "audit_logs" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_timestamp" ON "audit_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_actor_id" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_target_id" ON "audit_logs" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "idx_blog_gen_logs_topic" ON "blog_generation_logs" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "idx_blog_gen_logs_step" ON "blog_generation_logs" USING btree ("step");--> statement-breakpoint
CREATE INDEX "idx_blog_gen_logs_created" ON "blog_generation_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_blog_posts_published" ON "blog_posts" USING btree ("published","published_at");--> statement-breakpoint
CREATE INDEX "idx_blog_posts_topic_id" ON "blog_posts" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "idx_blog_topic_queue_status" ON "blog_topic_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_blog_topic_queue_priority" ON "blog_topic_queue" USING btree ("priority_score");--> statement-breakpoint
CREATE INDEX "idx_blog_topic_queue_category" ON "blog_topic_queue" USING btree ("cause_category");--> statement-breakpoint
CREATE INDEX "idx_bulk_emails_status" ON "bulk_emails" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_campaign_messages_campaign" ON "campaign_messages" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_messages_user" ON "campaign_messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_messages_created" ON "campaign_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_campaign_messages_flagged" ON "campaign_messages" USING btree ("flagged");--> statement-breakpoint
CREATE INDEX "idx_seed_messages_campaign_used" ON "campaign_seed_messages" USING btree ("campaign_id","used");--> statement-breakpoint
CREATE INDEX "idx_campaign_withdrawals_campaign" ON "campaign_withdrawals" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_withdrawals_status" ON "campaign_withdrawals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_campaign_withdrawals_requested_by" ON "campaign_withdrawals" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "idx_campaign_withdrawals_idem" ON "campaign_withdrawals" USING btree ("campaign_id","requested_by","notes");--> statement-breakpoint
CREATE INDEX "idx_campaigns_status" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_campaigns_category" ON "campaigns" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_campaigns_status_category" ON "campaigns" USING btree ("status","category");--> statement-breakpoint
CREATE INDEX "idx_campaigns_published_at" ON "campaigns" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_campaigns_simulation_flag" ON "campaigns" USING btree ("simulation_flag");--> statement-breakpoint
CREATE INDEX "idx_campaigns_creator_id" ON "campaigns" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_campaigns_stripe_verification_id" ON "campaigns" USING btree ("stripe_verification_id");--> statement-breakpoint
CREATE INDEX "idx_donations_campaign_id" ON "donations" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_donations_user_id" ON "donations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_donations_created_at" ON "donations" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_donations_stripe_payment_id" ON "donations" USING btree ("stripe_payment_id");--> statement-breakpoint
CREATE INDEX "idx_donor_subs_campaign" ON "donor_campaign_subscriptions" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_donor_subs_email" ON "donor_campaign_subscriptions" USING btree ("donor_email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_donor_subs_email_campaign" ON "donor_campaign_subscriptions" USING btree ("donor_email","campaign_id");--> statement-breakpoint
CREATE INDEX "idx_donor_relationships_donor_id" ON "donor_relationships" USING btree ("donor_id");--> statement-breakpoint
CREATE INDEX "idx_donor_relationships_related_id" ON "donor_relationships" USING btree ("related_donor_id");--> statement-breakpoint
CREATE INDEX "idx_fund_pool_status" ON "fund_pool_allocations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_fund_pool_source" ON "fund_pool_allocations" USING btree ("source_campaign_id");--> statement-breakpoint
CREATE INDEX "idx_fund_pool_target" ON "fund_pool_allocations" USING btree ("target_campaign_id");--> statement-breakpoint
CREATE INDEX "idx_impact_updates_campaign" ON "impact_updates" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_impact_updates_status" ON "impact_updates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_impact_updates_due_date" ON "impact_updates" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "idx_info_requests_campaign" ON "info_requests" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_info_requests_status" ON "info_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_info_requests_deadline" ON "info_requests" USING btree ("deadline");--> statement-breakpoint
CREATE INDEX "idx_info_requests_target_user" ON "info_requests" USING btree ("target_user");--> statement-breakpoint
CREATE INDEX "idx_interaction_logs_donor_id" ON "interaction_logs" USING btree ("donor_id");--> statement-breakpoint
CREATE INDEX "idx_interaction_logs_staff_id" ON "interaction_logs" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "idx_interaction_logs_contacted_at" ON "interaction_logs" USING btree ("contacted_at");--> statement-breakpoint
CREATE INDEX "idx_keyword_rotation_category" ON "keyword_rotation" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_keyword_rotation_category_keyword" ON "keyword_rotation" USING btree ("category","keyword");--> statement-breakpoint
CREATE INDEX "idx_news_items_fetched_at" ON "news_items" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "idx_news_items_campaign_created" ON "news_items" USING btree ("campaign_created");--> statement-breakpoint
CREATE INDEX "idx_news_items_admin_flagged" ON "news_items" USING btree ("admin_flagged");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_id" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_read" ON "notifications" USING btree ("user_id","read");--> statement-breakpoint
CREATE INDEX "idx_notifications_created_at" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_refund_batches_campaign" ON "refund_batches" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_refund_batches_status" ON "refund_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_refund_records_batch" ON "refund_records" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_refund_records_donation" ON "refund_records" USING btree ("donation_id");--> statement-breakpoint
CREATE INDEX "idx_support_conversations_status" ON "support_conversations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_support_conversations_user" ON "support_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_support_conversations_channel" ON "support_conversations" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "idx_users_donor_score" ON "users" USING btree ("donor_score");--> statement-breakpoint
CREATE INDEX "idx_users_donor_type" ON "users" USING btree ("donor_type");--> statement-breakpoint
CREATE INDEX "idx_users_last_donation_at" ON "users" USING btree ("last_donation_at");--> statement-breakpoint
CREATE INDEX "idx_users_total_donated" ON "users" USING btree ("total_donated");--> statement-breakpoint
CREATE INDEX "idx_verification_docs_campaign" ON "verification_documents" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_verification_docs_status" ON "verification_documents" USING btree ("status");