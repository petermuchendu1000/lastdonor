CREATE TABLE "document_screenings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"action" text NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text NOT NULL,
	"name_match_kind" text NOT NULL,
	"name_match_score" integer NOT NULL,
	"name_match_distance" integer,
	"extracted" jsonb,
	"model_used" text,
	"latency_ms" integer,
	"page_count" integer,
	"has_more_pages" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_screenings_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
ALTER TABLE "document_screenings" ADD CONSTRAINT "document_screenings_document_id_verification_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."verification_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_screenings" ADD CONSTRAINT "document_screenings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_document_screenings_campaign" ON "document_screenings" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_document_screenings_action" ON "document_screenings" USING btree ("action");