CREATE TYPE "public"."designation_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."payout_account_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."payout_rail" AS ENUM('mpesa_paybill');--> statement-breakpoint
ALTER TYPE "public"."institution_kind" ADD VALUE 'funeral_home' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "campaign_payout_designations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"payout_account_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"account_reference" text NOT NULL,
	"status" "designation_status" DEFAULT 'active' NOT NULL,
	"designated_by" uuid NOT NULL,
	"designated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_payout_designations_reference_nonblank" CHECK (length(btrim("campaign_payout_designations"."account_reference")) > 0)
);
--> statement-breakpoint
CREATE TABLE "institution_payout_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"rail" "payout_rail" NOT NULL,
	"account_identifier" text NOT NULL,
	"account_reference_label" text NOT NULL,
	"status" "payout_account_status" DEFAULT 'active' NOT NULL,
	"confirmed_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmation_notes" text NOT NULL,
	"retired_at" timestamp with time zone,
	"retired_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institution_payout_accounts_id_currency_key" UNIQUE("id","currency"),
	CONSTRAINT "institution_payout_accounts_currency_iso4217" CHECK ("institution_payout_accounts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "institution_payout_accounts_identifier_nonblank" CHECK (length(btrim("institution_payout_accounts"."account_identifier")) > 0),
	CONSTRAINT "institution_payout_accounts_notes_substantive" CHECK (length(btrim("institution_payout_accounts"."confirmation_notes")) >= 10)
);
--> statement-breakpoint
ALTER TABLE "campaign_payout_designations" ADD CONSTRAINT "campaign_payout_designations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_payout_designations" ADD CONSTRAINT "campaign_payout_designations_designated_by_users_id_fk" FOREIGN KEY ("designated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_payout_designations" ADD CONSTRAINT "campaign_payout_designations_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_payout_designations" ADD CONSTRAINT "campaign_payout_designations_account_fk" FOREIGN KEY ("payout_account_id") REFERENCES "public"."institution_payout_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_payout_designations" ADD CONSTRAINT "campaign_payout_designations_campaign_currency_fk" FOREIGN KEY ("campaign_id","currency") REFERENCES "public"."campaigns"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_payout_designations" ADD CONSTRAINT "campaign_payout_designations_account_currency_fk" FOREIGN KEY ("payout_account_id","currency") REFERENCES "public"."institution_payout_accounts"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_payout_accounts" ADD CONSTRAINT "institution_payout_accounts_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_payout_accounts" ADD CONSTRAINT "institution_payout_accounts_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."trusted_institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_campaign_payout_designations_account" ON "campaign_payout_designations" USING btree ("payout_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_campaign_payout_designations_one_active" ON "campaign_payout_designations" USING btree ("campaign_id") WHERE "campaign_payout_designations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_institution_payout_accounts_institution" ON "institution_payout_accounts" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "idx_institution_payout_accounts_status" ON "institution_payout_accounts" USING btree ("status");