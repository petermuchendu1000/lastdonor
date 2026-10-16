CREATE TABLE "campaign_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid,
	"click_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "share_link_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign_share_links" ADD CONSTRAINT "campaign_share_links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_share_links" ADD CONSTRAINT "campaign_share_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_campaign_share_links_token" ON "campaign_share_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_campaign_share_links_campaign_id" ON "campaign_share_links" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_share_links_user_id" ON "campaign_share_links" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_share_link_id_campaign_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."campaign_share_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_donations_share_link_id" ON "donations" USING btree ("share_link_id");