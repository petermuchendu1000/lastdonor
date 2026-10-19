ALTER TABLE "donations" ALTER COLUMN "stripe_payment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "provider" text DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "provider_reference" text;--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "currency" text DEFAULT 'usd' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_donations_provider_reference" ON "donations" USING btree ("provider","provider_reference");--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_stripe_id_present" CHECK ("donations"."provider" <> 'stripe' OR "donations"."stripe_payment_id" IS NOT NULL);