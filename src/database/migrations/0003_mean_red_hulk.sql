CREATE TYPE "public"."maintenance_priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "property_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"label" varchar(100) NOT NULL,
	"bedrooms" numeric(4, 0),
	"bathrooms" numeric(4, 0),
	"rent_amount" numeric(12, 2) NOT NULL,
	"status" "property_status" DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "upi" varchar(50);--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "terms" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "attributes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "document_url" text;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "deposit" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "momo_number" varchar(30);--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "lease_period_note" text;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD COLUMN "priority" "maintenance_priority" DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "property_units" ADD CONSTRAINT "property_units_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Data migration: give every existing property one default unit (mirroring its own
-- bedrooms/bathrooms/rent/status), and point existing leases at their property's unit.
INSERT INTO "property_units" ("property_id", "label", "bedrooms", "bathrooms", "rent_amount", "status")
SELECT "id", "title", "bedrooms", "bathrooms", "rent_amount", "status" FROM "properties";--> statement-breakpoint
UPDATE "leases" SET "unit_id" = (
	SELECT "id" FROM "property_units" WHERE "property_units"."property_id" = "leases"."property_id" LIMIT 1
);--> statement-breakpoint
ALTER TABLE "leases" ALTER COLUMN "unit_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_unit_id_property_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."property_units"("id") ON DELETE cascade ON UPDATE no action;