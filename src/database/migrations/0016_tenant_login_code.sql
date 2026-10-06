ALTER TABLE "users" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "login_code" varchar(10);--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique_non_tenant" ON "users" USING btree ("email") WHERE "users"."role" <> 'tenant';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_login_code_unique" UNIQUE("login_code");--> statement-breakpoint
-- Backfill: every existing tenant needs a code before login-by-email is
-- retired for their role, or they'd be locked out with no way to sign in.
-- Collision-safe via retry (id-salted, astronomically unlikely to repeat,
-- but a plain UPDATE can't catch a unique-constraint violation mid-row).
DO $$
DECLARE
    tenant_row RECORD;
    candidate VARCHAR(8);
BEGIN
    FOR tenant_row IN SELECT "id" FROM "users" WHERE "role" = 'tenant' AND "login_code" IS NULL LOOP
        LOOP
            candidate := upper(substr(md5(random()::text || tenant_row."id"::text || clock_timestamp()::text), 1, 8));
            BEGIN
                UPDATE "users" SET "login_code" = candidate WHERE "id" = tenant_row."id";
                EXIT;
            EXCEPTION WHEN unique_violation THEN
                -- Collision against another row's code — retry with a new candidate.
            END;
        END LOOP;
    END LOOP;
END $$;