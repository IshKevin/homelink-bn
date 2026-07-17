import { and, eq, isNull, lte, gte, or } from "drizzle-orm";
import { format, startOfMonth } from "date-fns";
import { db } from "../../database";
import { invoices, leases } from "../../database/schema";
import { logger } from "../../config/logger";

export async function generateInvoicesJob(): Promise<void> {
    const today = new Date();
    const period = format(today, "yyyy-MM");
    const dueDate = format(startOfMonth(today), "yyyy-MM-dd");
    const todayStr = format(today, "yyyy-MM-dd");

    const activeLeases = await db
        .select()
        .from(leases)
        .where(
            and(
                eq(leases.status, "active"),
                lte(leases.startDate, todayStr),
                or(gte(leases.endDate, todayStr), isNull(leases.endDate))
            )
        );

    let created = 0;
    for (const lease of activeLeases) {
        const [existing] = await db
            .select()
            .from(invoices)
            .where(and(eq(invoices.leaseId, lease.id), eq(invoices.period, period)))
            .limit(1);

        if (existing) continue;

        await db.insert(invoices).values({
            leaseId: lease.id,
            period,
            amountDue: lease.rentAmount,
            dueDate
        });
        created += 1;
    }

    logger.info({ created, period }, "generateInvoicesJob complete");
}
