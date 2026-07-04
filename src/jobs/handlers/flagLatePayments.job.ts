import { and, eq, lt } from "drizzle-orm";
import { format } from "date-fns";
import { db } from "../../database";
import { invoices, leases } from "../../database/schema";
import { notify } from "../../services/notification.service";
import { logger } from "../../config/logger";

export async function flagLatePaymentsJob(): Promise<void> {
    const todayStr = format(new Date(), "yyyy-MM-dd");

    const overdue = await db
        .select({ invoice: invoices, lease: leases })
        .from(invoices)
        .innerJoin(leases, eq(invoices.leaseId, leases.id))
        .where(and(eq(invoices.status, "unpaid"), lt(invoices.dueDate, todayStr)));

    for (const row of overdue) {
        await db.update(invoices).set({ status: "overdue" }).where(eq(invoices.id, row.invoice.id));

        await notify({
            userId: row.lease.ownerId,
            type: "payment.overdue",
            title: "Rent payment overdue",
            message: `Invoice for period ${row.invoice.period} (amount ${row.invoice.amountDue}) is now overdue.`,
            metadata: { invoiceId: row.invoice.id, leaseId: row.lease.id },
            sendEmail: true
        });
    }

    logger.info({ flagged: overdue.length }, "flagLatePaymentsJob complete");
}
