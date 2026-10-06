import { and, eq, isNull, lte, gte, or } from "drizzle-orm";
import { format, getDaysInMonth, setDate, startOfMonth } from "date-fns";
import { db } from "../../database";
import { invoices, leases } from "../../database/schema";
import { logger } from "../../config/logger";
import { nextDocumentNumber } from "../../common/utils/sequence.util";

function computeDueDate(today: Date, paymentDate: string | null): string {
    if (!paymentDate) return format(startOfMonth(today), "yyyy-MM-dd");
    const day = Number(paymentDate.slice(8, 10));
    const clampedDay = Math.min(day, getDaysInMonth(today));
    return format(setDate(today, clampedDay), "yyyy-MM-dd");
}

// Shared with signLease, which calls this inline on activation so a lease
// has its current-period invoice the moment it goes active, rather than
// waiting for this job's next daily run (up to ~24h later). Same
// existing-invoice check either way, so there's no double-invoice risk.
export async function ensureInvoiceForLease(lease: typeof leases.$inferSelect, today: Date): Promise<boolean> {
    const period = format(today, "yyyy-MM");
    const [existing] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.leaseId, lease.id), eq(invoices.period, period)))
        .limit(1);

    if (existing) return false;

    const invoiceNumber = await nextDocumentNumber("ACC-INV", today);
    await db.insert(invoices).values({
        invoiceNumber,
        leaseId: lease.id,
        period,
        amountDue: lease.rentAmount,
        dueDate: computeDueDate(today, lease.paymentDate)
    });
    return true;
}

export async function generateInvoicesJob(): Promise<void> {
    const today = new Date();
    const period = format(today, "yyyy-MM");
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
        if (await ensureInvoiceForLease(lease, today)) created += 1;
    }

    logger.info({ created, period }, "generateInvoicesJob complete");
}
