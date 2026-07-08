import { eq } from "drizzle-orm";
import { db, pool } from "../database";
import { users } from "../database/schema";
import { hashPassword } from "../common/utils/password.util";
import { logger } from "../config/logger";

async function main() {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
        logger.info("ADMIN_EMAIL / ADMIN_PASSWORD not set, skipping admin seed");
        return;
    }

    const firstName = process.env.ADMIN_FIRST_NAME || "Admin";
    const lastName = process.env.ADMIN_LAST_NAME || "User";
    const passwordHash = await hashPassword(password);

    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (existing) {
        await db
            .update(users)
            .set({ role: "admin", passwordHash, isActive: true, isApproved: true, isVerified: true })
            .where(eq(users.id, existing.id));
        logger.info({ email }, "Existing user promoted to admin and password reset");
    } else {
        await db.insert(users).values({
            email,
            passwordHash,
            firstName,
            lastName,
            role: "admin",
            isApproved: true,
            isVerified: true
        });
        logger.info({ email }, "Admin user created");
    }
}

main()
    .catch((err) => {
        logger.error({ err }, "Failed to seed admin user");
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
