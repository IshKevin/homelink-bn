CREATE TYPE "public"."property_category" AS ENUM('residential', 'commercial');--> statement-breakpoint
CREATE TYPE "public"."payment_approval_status" AS ENUM('not_required', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."invite_role" AS ENUM('house_manager', 'tenant');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."manager_assignment_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."suspension_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'superadmin';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'house_manager';--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'cash';--> statement-breakpoint
CREATE TABLE "login_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"ip_address" varchar(100),
	"user_agent" varchar(255),
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lease_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" uuid NOT NULL,
	"url" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" "invite_role" NOT NULL,
	"invited_by" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"property_id" uuid,
	"status" "invite_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"manager_id" uuid NOT NULL,
	"status" "manager_assignment_status" DEFAULT 'active' NOT NULL,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid
);
--> statement-breakpoint
CREATE TABLE "suspension_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "suspension_request_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decision_notes" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
UPDATE "users" SET "phone" = '0000000000' WHERE "phone" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "leases" ALTER COLUMN "end_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "ip_address" varchar(100);--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "user_agent" varchar(255);--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "last_used_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "category" "property_category" DEFAULT 'residential' NOT NULL;--> statement-breakpoint
UPDATE "properties" SET "category" = 'commercial' WHERE "type" = 'commercial';--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "size_sqm" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "units_count" integer;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "payment_date" date;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "documents_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "documents_confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "documents_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "approval_status" "payment_approval_status" DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "login_challenges" ADD CONSTRAINT "login_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_documents" ADD CONSTRAINT "lease_documents_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_documents" ADD CONSTRAINT "lease_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_assignments" ADD CONSTRAINT "manager_assignments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_assignments" ADD CONSTRAINT "manager_assignments_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_assignments" ADD CONSTRAINT "manager_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_assignments" ADD CONSTRAINT "manager_assignments_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension_requests" ADD CONSTRAINT "suspension_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension_requests" ADD CONSTRAINT "suspension_requests_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension_requests" ADD CONSTRAINT "suspension_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_documents_confirmed_by_users_id_fk" FOREIGN KEY ("documents_confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;