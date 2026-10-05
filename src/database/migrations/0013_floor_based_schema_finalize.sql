ALTER TABLE "properties" ALTER COLUMN "location" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "number_of_floors" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "property_units" ALTER COLUMN "floor_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "size_sqm";--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "units_count";--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "upi";--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "terms";--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "attributes";--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "address_line";--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "city";--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "state";--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "country";--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "postal_code";--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "bedrooms";--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "bathrooms";--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "rent_amount";--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "rent_conditions";--> statement-breakpoint
ALTER TABLE "property_units" DROP COLUMN "floor";--> statement-breakpoint
DROP TYPE "public"."property_category";