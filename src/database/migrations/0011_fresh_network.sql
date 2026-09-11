DROP INDEX "property_units_property_id_label_idx";--> statement-breakpoint
ALTER TABLE "property_units" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "property_units_property_id_label_idx" ON "property_units" USING btree ("property_id","label") WHERE "property_units"."deleted_at" is null;