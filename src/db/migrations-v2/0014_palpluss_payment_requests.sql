CREATE TYPE "public"."palpluss_request_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
ALTER TYPE "public"."payment_provider" ADD VALUE 'palpluss';--> statement-breakpoint
CREATE TABLE "palpluss_payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"palpluss_transaction_id" text NOT NULL,
	"account_reference" text NOT NULL,
	"provider_checkout_id" text,
	"campaign_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount" integer NOT NULL,
	"credited_amount_minor" integer NOT NULL,
	"credited_currency" text NOT NULL,
	"fx_rate_micro" bigint NOT NULL,
	"fx_margin_bps" integer NOT NULL,
	"fx_quoted_at" timestamp with time zone NOT NULL,
	"phone_e164" text NOT NULL,
	"msisdn_sent" text NOT NULL,
	"channel_id" text,
	"status" "palpluss_request_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"provider_reference" text,
	"donation_id" uuid,
	"donor_name" text DEFAULT 'Anonymous' NOT NULL,
	"donor_email" text NOT NULL,
	"donor_location" text,
	"message" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"subscribed_to_updates" boolean DEFAULT false NOT NULL,
	"share_link_id" uuid,
	"last_checked_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "palpluss_requests_amount_positive" CHECK ("palpluss_payment_requests"."amount" > 0),
	CONSTRAINT "palpluss_requests_currency_iso4217" CHECK ("palpluss_payment_requests"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "palpluss_requests_credited_amount_positive" CHECK ("palpluss_payment_requests"."credited_amount_minor" > 0),
	CONSTRAINT "palpluss_requests_credited_currency_iso4217" CHECK ("palpluss_payment_requests"."credited_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "palpluss_requests_fx_rate_positive" CHECK ("palpluss_payment_requests"."fx_rate_micro" > 0),
	CONSTRAINT "palpluss_requests_fx_margin_bounded" CHECK ("palpluss_payment_requests"."fx_margin_bps" >= 0 AND "palpluss_payment_requests"."fx_margin_bps" <= 10000)
);
--> statement-breakpoint
ALTER TABLE "palpluss_payment_requests" ADD CONSTRAINT "palpluss_payment_requests_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "palpluss_payment_requests" ADD CONSTRAINT "palpluss_payment_requests_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "palpluss_payment_requests" ADD CONSTRAINT "palpluss_payment_requests_share_link_id_campaign_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."campaign_share_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "palpluss_payment_requests" ADD CONSTRAINT "palpluss_requests_campaign_credited_currency_fk" FOREIGN KEY ("campaign_id","credited_currency") REFERENCES "public"."campaigns"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_palpluss_requests_tx_id" ON "palpluss_payment_requests" USING btree ("palpluss_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_palpluss_requests_account_ref" ON "palpluss_payment_requests" USING btree ("account_reference");--> statement-breakpoint
CREATE INDEX "idx_palpluss_requests_campaign" ON "palpluss_payment_requests" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_palpluss_requests_status" ON "palpluss_payment_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_palpluss_requests_phone_created" ON "palpluss_payment_requests" USING btree ("phone_e164","created_at");