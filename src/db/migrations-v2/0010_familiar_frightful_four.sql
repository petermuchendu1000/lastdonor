CREATE TABLE "campaign_collaborators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid,
	"invited_email" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_collaborators_email_lower" CHECK ("campaign_collaborators"."invited_email" = lower("campaign_collaborators"."invited_email")),
	CONSTRAINT "campaign_collaborators_accepted_has_user" CHECK ("campaign_collaborators"."accepted_at" is null or "campaign_collaborators"."user_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "campaign_collaborators" ADD CONSTRAINT "campaign_collaborators_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_collaborators" ADD CONSTRAINT "campaign_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_collaborators" ADD CONSTRAINT "campaign_collaborators_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_campaign_collaborators_token" ON "campaign_collaborators" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_campaign_collaborators_campaign" ON "campaign_collaborators" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_collaborators_user" ON "campaign_collaborators" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_campaign_collaborators_live" ON "campaign_collaborators" USING btree ("campaign_id","invited_email") WHERE "campaign_collaborators"."revoked_at" is null;