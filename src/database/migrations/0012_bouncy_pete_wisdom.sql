CREATE TABLE "floors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"scale" numeric(10, 2),
	"index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "number_of_floors" integer;--> statement-breakpoint
ALTER TABLE "property_units" ADD COLUMN "floor_id" uuid;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "floors_property_id_index_idx" ON "floors" USING btree ("property_id","index");--> statement-breakpoint
ALTER TABLE "property_units" ADD CONSTRAINT "property_units_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_unit_id_property_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."property_units"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Backfill (hand-written, not generated): every existing property gets a
-- single "Ground" floor absorbing its current units, and its old
-- addressLine/city is preserved as the new `location` field rather than
-- silently dropped. Migration B (a later, separate migration) makes these
-- columns NOT NULL and drops the old address/category/etc. columns, once
-- this backfill has run.
INSERT INTO "floors" ("property_id", "name", "index")
SELECT "id", 'Ground', 0 FROM "properties";
--> statement-breakpoint
UPDATE "properties" SET
    "location" = "address_line" || ', ' || "city",
    "number_of_floors" = 1;
--> statement-breakpoint
UPDATE "property_units" "pu" SET "floor_id" = "f"."id"
FROM "floors" "f"
WHERE "f"."property_id" = "pu"."property_id" AND "f"."index" = 0;