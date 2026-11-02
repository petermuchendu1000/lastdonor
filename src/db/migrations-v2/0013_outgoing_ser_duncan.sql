--
-- Split the CHARGE from the CREDIT on a PayHero collection (docs/168).
--
-- ⛔ HAND-EDITED after `db:generate`, deliberately.
--
-- drizzle emitted `ADD COLUMN ... NOT NULL` with no default for all five
-- columns. That is correct for an empty table and FAILS on this one - there
-- are 6 existing rows [VERIFIED against production] - with
-- `23502 column "credited_amount_minor" contains null values`.
--
-- So the path is: add nullable, backfill, then constrain. The END STATE is
-- byte-identical to what drizzle described in its snapshot, so the snapshot
-- stays the source of truth for future diffs; only the route there changed.
--
-- The backfill is exact, not a guess: every existing row is a same-currency
-- KES charge on a KES campaign [VERIFIED: 6 rows, all currency='KES'], so the
-- credit equals the charge at a rate of exactly 1 and a margin of 0.
--

-- The old FK asserted "charge currency == campaign currency". That assertion
-- is the defect; it must go before the credit columns can carry the guarantee.
ALTER TABLE "payhero_payment_requests" DROP CONSTRAINT "payhero_requests_campaign_currency_fk";--> statement-breakpoint

ALTER TABLE "payhero_payment_requests" ADD COLUMN "credited_amount_minor" integer;--> statement-breakpoint
ALTER TABLE "payhero_payment_requests" ADD COLUMN "credited_currency" text;--> statement-breakpoint
ALTER TABLE "payhero_payment_requests" ADD COLUMN "fx_rate_micro" bigint;--> statement-breakpoint
ALTER TABLE "payhero_payment_requests" ADD COLUMN "fx_margin_bps" integer;--> statement-breakpoint
ALTER TABLE "payhero_payment_requests" ADD COLUMN "fx_quoted_at" timestamp with time zone;--> statement-breakpoint

-- Backfill. `WHERE ... IS NULL` makes this re-runnable and makes it impossible
-- for a re-run to overwrite a real cross-currency row written after this ran.
UPDATE "payhero_payment_requests"
SET "credited_amount_minor" = "amount",
    "credited_currency"     = "currency",
    "fx_rate_micro"         = 1000000,
    "fx_margin_bps"         = 0,
    "fx_quoted_at"          = "created_at"
WHERE "credited_amount_minor" IS NULL;--> statement-breakpoint

ALTER TABLE "payhero_payment_requests" ALTER COLUMN "credited_amount_minor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payhero_payment_requests" ALTER COLUMN "credited_currency" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payhero_payment_requests" ALTER COLUMN "fx_rate_micro" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payhero_payment_requests" ALTER COLUMN "fx_margin_bps" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payhero_payment_requests" ALTER COLUMN "fx_quoted_at" SET NOT NULL;--> statement-breakpoint

-- The guarantee MOVES here: a campaign is only ever CREDITED in its own
-- currency. Unchanged in force, only in which column carries it.
ALTER TABLE "payhero_payment_requests" ADD CONSTRAINT "payhero_requests_campaign_credited_currency_fk" FOREIGN KEY ("campaign_id","credited_currency") REFERENCES "public"."campaigns"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payhero_payment_requests" ADD CONSTRAINT "payhero_requests_credited_amount_positive" CHECK ("payhero_payment_requests"."credited_amount_minor" > 0);--> statement-breakpoint
ALTER TABLE "payhero_payment_requests" ADD CONSTRAINT "payhero_requests_credited_currency_iso4217" CHECK ("payhero_payment_requests"."credited_currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "payhero_payment_requests" ADD CONSTRAINT "payhero_requests_fx_rate_positive" CHECK ("payhero_payment_requests"."fx_rate_micro" > 0);--> statement-breakpoint
ALTER TABLE "payhero_payment_requests" ADD CONSTRAINT "payhero_requests_fx_margin_bounded" CHECK ("payhero_payment_requests"."fx_margin_bps" >= 0 AND "payhero_payment_requests"."fx_margin_bps" <= 10000);
