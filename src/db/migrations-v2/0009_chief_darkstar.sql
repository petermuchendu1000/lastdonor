CREATE TYPE "public"."institution_kind" AS ENUM('nonprofit', 'faith', 'hospital', 'university', 'school', 'government', 'employer', 'other');--> statement-breakpoint
CREATE TYPE "public"."institution_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."verification_source" AS ENUM('documents', 'institution_vouch');--> statement-breakpoint
CREATE TABLE "institution_vouches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"representative_name" text NOT NULL,
	"representative_role" text NOT NULL,
	"representative_email" text NOT NULL,
	"relationship" text NOT NULL,
	"statement" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoked_reason" text,
	CONSTRAINT "institution_vouches_revocation_complete" CHECK (("institution_vouches"."revoked_at" is null) = ("institution_vouches"."revoked_by" is null))
);
--> statement-breakpoint
CREATE TABLE "trusted_institutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "institution_kind" NOT NULL,
	"country" text NOT NULL,
	"website" text,
	"registration_id" text,
	"registration_verified_at" timestamp with time zone,
	"status" "institution_status" DEFAULT 'active' NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by" uuid NOT NULL,
	"verification_notes" text,
	"monthly_vouch_limit" integer DEFAULT 10 NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trusted_institutions_country_iso" CHECK ("trusted_institutions"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "trusted_institutions_vouch_limit" CHECK ("trusted_institutions"."monthly_vouch_limit" between 0 and 1000)
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "verification_source" "verification_source";--> statement-breakpoint
ALTER TABLE "institution_vouches" ADD CONSTRAINT "institution_vouches_institution_id_trusted_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."trusted_institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_vouches" ADD CONSTRAINT "institution_vouches_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_vouches" ADD CONSTRAINT "institution_vouches_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_vouches" ADD CONSTRAINT "institution_vouches_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_institutions" ADD CONSTRAINT "trusted_institutions_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_institution_vouches_campaign" ON "institution_vouches" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_institution_vouches_institution" ON "institution_vouches" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "idx_institution_vouches_created_at" ON "institution_vouches" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_institution_vouches_live" ON "institution_vouches" USING btree ("institution_id","campaign_id") WHERE "institution_vouches"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "idx_trusted_institutions_status" ON "trusted_institutions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_trusted_institutions_kind" ON "trusted_institutions" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_trusted_institutions_name_country" ON "trusted_institutions" USING btree (lower("name"),"country");