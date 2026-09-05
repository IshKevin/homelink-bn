CREATE TYPE "public"."suppression_reason" AS ENUM('bounce', 'complaint');--> statement-breakpoint
CREATE TABLE "suppressed_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppressed_emails_email_unique" UNIQUE("email")
);
