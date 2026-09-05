import { JobNames, rentQueue } from "./queue";
import { logger } from "../config/logger";

export async function scheduleRepeatableJobs(): Promise<void> {
    await rentQueue.add(
        JobNames.GENERATE_INVOICES,
        {},
        { repeat: { pattern: "5 0 * * *" }, jobId: JobNames.GENERATE_INVOICES }
    );
    await rentQueue.add(
        JobNames.FLAG_LATE_PAYMENTS,
        {},
        { repeat: { pattern: "10 0 * * *" }, jobId: JobNames.FLAG_LATE_PAYMENTS }
    );
    await rentQueue.add(
        JobNames.SEND_RENT_REMINDERS,
        {},
        { repeat: { pattern: "0 8 * * *" }, jobId: JobNames.SEND_RENT_REMINDERS }
    );
    // Every minute: much tighter than the daily billing jobs above, since
    // this is what makes landlord disbursement feel automatic rather than
    // "sometime tomorrow".
    await rentQueue.add(
        JobNames.PROCESS_PAYOUT_EVENTS,
        {},
        { repeat: { pattern: "* * * * *" }, jobId: JobNames.PROCESS_PAYOUT_EVENTS }
    );
    // Fallback for a dropped MTN webhook — see reconcilePendingMtnTransactions.job.ts.
    await rentQueue.add(
        JobNames.RECONCILE_PENDING_MTN_TRANSACTIONS,
        {},
        { repeat: { pattern: "*/5 * * * *" }, jobId: JobNames.RECONCILE_PENDING_MTN_TRANSACTIONS }
    );
    logger.info("Repeatable rent jobs scheduled");
}
