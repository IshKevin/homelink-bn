import { addDays, format } from "date-fns";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../../database";
import { invoices, leases } from "../../database/schema";
import { notify } from "../../services/notification.service";
import { logger } from "../../config/logger";

export async function sendRentRemindersJob(): Promise<void> {
    const today = new Date();
    const todayStr = format(today, "yyyy-MM-dd");
    const upcomingStr = format(addDays(today, 3), "yyyy-MM-dd");

    const dueSoon = await db
        .select({ invoice: invoices, lease: leases })
        .from(invoices)
        .innerJoin(leases, eq(invoices.leaseId, leases.id))
        .where(
            and(inArray(invoices.status, ["unpaid", "overdue"]), gte(invoices.dueDate, todayStr), lte(invoices.dueDate, upcomingStr))
        );

    for (const row of dueSoon) {
        await notify({
            userId: row.lease.tenantId,
            type: "payment.reminder",
            title: "Upcoming rent payment",
            message: `Rent of ${row.invoice.amountDue} for period ${row.invoice.period} is due on ${row.invoice.dueDate}.`,
            metadata: { invoiceId: row.invoice.id, leaseId: row.lease.id },
            sendEmail: true
        });
    }

    logger.info({ remindersSent: dueSoon.length }, "sendRentRemindersJob complete");
}
