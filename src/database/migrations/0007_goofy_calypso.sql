CREATE TYPE "public"."unit_status" AS ENUM('available', 'occupied', 'maintenance', 'inactive');--> statement-breakpoint
ALTER TABLE "property_units" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "property_units" ALTER COLUMN "status" SET DATA TYPE "public"."unit_status" USING "status"::text::"public"."unit_status";--> statement-breakpoint
ALTER TABLE "property_units" ALTER COLUMN "status" SET DEFAULT 'available';--> statement-breakpoint
ALTER TABLE "property_units" ADD COLUMN "unit_type" varchar(100);--> statement-breakpoint
ALTER TABLE "property_units" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "property_units" ADD COLUMN "deposit" numeric(12, 2);--> statement-breakpoint
CREATE UNIQUE INDEX "property_units_property_id_label_idx" ON "property_units" USING btree ("property_id","label");