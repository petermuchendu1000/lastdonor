CREATE TYPE "public"."payhero_request_status" AS ENUM('pending', 'succeeded', 'failed', 'abandoned');--> statement-breakpoint
CREATE TABLE "payhero_payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_reference" text NOT NULL,
	"payhero_reference" text,
	"checkout_request_id" text,
	"campaign_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount" integer NOT NULL,
	"phone_e164" text NOT NULL,
	"msisdn_sent" text NOT NULL,
	"channel_id" integer NOT NULL,
	"status" "payhero_request_status" DEFAULT 'pending' NOT NULL,
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
	CONSTRAINT "payhero_requests_amount_positive" CHECK ("payhero_payment_requests"."amount" > 0),
	CONSTRAINT "payhero_requests_currency_iso4217" CHECK ("payhero_payment_requests"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "payhero_payment_requests" ADD CONSTRAINT "payhero_payment_requests_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payhero_payment_requests" ADD CONSTRAINT "payhero_payment_requests_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payhero_payment_requests" ADD CONSTRAINT "payhero_payment_requests_share_link_id_campaign_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."campaign_share_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payhero_payment_requests" ADD CONSTRAINT "payhero_requests_campaign_currency_fk" FOREIGN KEY ("campaign_id","currency") REFERENCES "public"."campaigns"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payhero_requests_external_ref" ON "payhero_payment_requests" USING btree ("external_reference");--> statement-breakpoint
CREATE INDEX "idx_payhero_requests_payhero_ref" ON "payhero_payment_requests" USING btree ("payhero_reference");--> statement-breakpoint
CREATE INDEX "idx_payhero_requests_campaign" ON "payhero_payment_requests" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_payhero_requests_status" ON "payhero_payment_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payhero_requests_phone_created" ON "payhero_payment_requests" USING btree ("phone_e164","created_at");