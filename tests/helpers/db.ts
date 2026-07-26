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
    "lease_documents",
    "leases",
    "property_images",
    "property_units",
    "properties",
    "password_reset_tokens",
    "refresh_tokens",
    "login_challenges",
    "identity_verifications",
    "invites",
    "manager_assignments",
    "suspension_requests",
    "users",
    "platform_settings",
    "document_sequences",
    "leads"
];

export async function resetDb(): Promise<void> {
    await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`));
}

export async function closeDb(): Promise<void> {
    await pool.end();
}
