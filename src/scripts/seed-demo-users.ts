import { eq } from "drizzle-orm";
import { db, pool } from "../database";
import { users } from "../database/schema";
import { hashPassword } from "../common/utils/password.util";
import { logger } from "../config/logger";

/**
 * Fixed, well-known demo accounts for frontend/manual testing — one per role.
 * Gated behind SEED_DEMO_USERS so it never runs against a real environment by accident.
 */
const DEMO_USERS = [
    {
        email: "tenant.demo@homelink.dev",
        password: "Demo@1234",
        role: "tenant" as const,
        firstName: "Tina",
        lastName: "Tenant",
        phone: "0700000001"
    },
    {
        email: "owner.demo@homelink.dev",
        password: "Demo@1234",
        role: "owner" as const,
        firstName: "Oscar",
        lastName: "Owner",
        phone: "0700000002"
    },
    {
        email: "agent.demo@homelink.dev",
        password: "Demo@1234",
        role: "agent" as const,
        firstName: "Aline",
        lastName: "Agent",
        phone: "0700000003"
    },
    {
        email: "manager.demo@homelink.dev",
        password: "Demo@1234",
        role: "house_manager" as const,
        firstName: "Marc",
        lastName: "Manager",
        phone: "0700000004"
    },
    {
        email: "admin.demo@homelink.dev",
        password: "Demo@1234",
        role: "admin" as const,
        firstName: "Ana",
        lastName: "Admin",
        phone: "0700000005"
    },
    {
        email: "superadmin.demo@homelink.dev",
        password: "Demo@1234",
        role: "superadmin" as const,
        firstName: "Sam",
        lastName: "Superadmin",
        phone: "0700000006"
    }
];

async function main() {
    if (process.env.SEED_DEMO_USERS !== "true") {
        logger.info("SEED_DEMO_USERS is not 'true', skipping demo user seed");
        return;
    }

    for (const demoUser of DEMO_USERS) {
        const passwordHash = await hashPassword(demoUser.password);
        const [existing] = await db.select().from(users).where(eq(users.email, demoUser.email)).limit(1);

        if (existing) {
            await db
                .update(users)
                .set({
                    passwordHash,
                    role: demoUser.role,
                    firstName: demoUser.firstName,
                    lastName: demoUser.lastName,
                    phone: demoUser.phone,
                    isActive: true,
                    isApproved: true,
                    isVerified: true
                })
                .where(eq(users.id, existing.id));
            logger.info({ email: demoUser.email, role: demoUser.role }, "Existing demo user reset");
        } else {
            await db.insert(users).values({
                email: demoUser.email,
                passwordHash,
                firstName: demoUser.firstName,
                lastName: demoUser.lastName,
                phone: demoUser.phone,
                role: demoUser.role,
                isApproved: true,
                isVerified: true
            });
            logger.info({ email: demoUser.email, role: demoUser.role }, "Demo user created");
        }
    }

    logger.info(
        { users: DEMO_USERS.map((u) => ({ email: u.email, password: u.password, role: u.role })) },
        "Demo users ready"
    );
}

main()
    .catch((err) => {
        logger.error({ err }, "Failed to seed demo users");
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
