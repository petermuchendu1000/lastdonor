ALTER TABLE "campaigns" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "beneficiary_consent_at" timestamp with time zone;