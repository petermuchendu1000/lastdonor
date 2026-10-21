CREATE TYPE "public"."payment_provider" AS ENUM('stripe', 'payhero');--> statement-breakpoint
ALTER TABLE "donations" DROP CONSTRAINT "donations_amount_check";--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "provider" "payment_provider" DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
--
-- HAND-REORDERED, 2026-10-21. Do not regenerate this file in place.
--
-- `drizzle-kit generate` emitted the composite FOREIGN KEY on
-- donations (campaign_id, currency) BEFORE the UNIQUE constraint on
-- campaigns (id, currency) that it references. Postgres requires the
-- referenced columns to carry a unique constraint at the moment the FK is
-- created, so the generated order fails outright:
--
--   ERROR: 42830: there is no unique constraint matching given keys for
--          referenced table "campaigns"
--
-- Proven by dry-running the generated file against the production database
-- inside BEGIN … ROLLBACK (the docs/34 procedure) before adopting it. The only
-- change made here is moving the UNIQUE ahead of the FK; every statement is
-- otherwise exactly as generated. Re-running `db:generate` against this schema
-- will reproduce the broken order, so if this migration is ever regenerated the
-- swap has to be redone.
--
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_id_currency_key" UNIQUE("id","currency");--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_campaign_currency_fk" FOREIGN KEY ("campaign_id","currency") REFERENCES "public"."campaigns"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_donations_provider" ON "donations" USING btree ("provider");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_currency_iso4217" CHECK ("campaigns"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_currency_iso4217" CHECK ("donations"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_amount_check" CHECK ("donations"."amount" > 0);
