import { eq, sql } from "drizzle-orm";
import { db } from "../database";
import { suppressedEmails } from "../database/schema";
import { logger } from "../config/logger";

export async function isEmailSuppressed(email: string): Promise<boolean> {
    const [row] = await db
        .select({ id: suppressedEmails.id })
        .from(suppressedEmails)
        .where(eq(suppressedEmails.email, email.toLowerCase()))
        .limit(1);
    return !!row;
}

export async function suppressEmail(email: string, reason: "bounce" | "complaint", detail?: string): Promise<void> {
    const normalized = email.toLowerCase();
    await db
        .insert(suppressedEmails)
        .values({ email: normalized, reason, detail })
        .onConflictDoUpdate({
            target: suppressedEmails.email,
            set: { reason, detail, createdAt: sql`now()` }
        });
    logger.warn({ email: normalized, reason }, "Email address suppressed");
}
