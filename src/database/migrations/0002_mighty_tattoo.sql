CREATE TYPE "public"."lead_role_interest" AS ENUM('owner', 'house_manager', 'tenant');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'converted', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."lead_type" AS ENUM('contact', 'get_started');--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"key" varchar(50) PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "lead_type" NOT NULL,
	"full_name" varchar(150) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(30),
	"role_interest" "lead_role_interest",
	"property_count" integer,
	"subject" varchar(255),
	"message" text,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "invoice_number" varchar(30) NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payment_number" varchar(30) NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_number_unique" UNIQUE("payment_number");