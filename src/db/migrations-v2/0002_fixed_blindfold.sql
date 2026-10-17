ALTER TABLE "campaigns" ADD COLUMN "didit_session_id" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "didit_session_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_campaigns_didit_session_id" ON "campaigns" USING btree ("didit_session_id");