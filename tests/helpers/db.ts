import { sql } from "drizzle-orm";
import { db, pool } from "../../src/database";

const TABLES = [
    "audit_logs",
    "maintenance_feedback",
    "maintenance_requests",
    "notifications",
    "payments",
    "invoices",
    "move_requests",
    "lease_change_requests",
    "leases",
    "property_images",
    "properties",
    "password_reset_tokens",
    "refresh_tokens",
    "identity_verifications",
    "users",
    "platform_settings"
];

export async function resetDb(): Promise<void> {
    await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`));
}

export async function closeDb(): Promise<void> {
    await pool.end();
}
