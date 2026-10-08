ALTER TABLE "property_units" ALTER COLUMN "rent_amount" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "property_units" ADD COLUMN "scale" numeric(10, 2);