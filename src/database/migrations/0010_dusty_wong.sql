ALTER TYPE "public"."invite_role" ADD VALUE 'owner';--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "owner_id" DROP NOT NULL;