import { Worker } from "bullmq";
import { connection, JobNames, RENT_QUEUE_NAME } from "./queue";
import { generateInvoicesJob } from "./handlers/generateInvoices.job";
import { flagLatePaymentsJob } from "./handlers/flagLatePayments.job";
import { sendRentRemindersJob } from "./handlers/sendRentReminders.job";
import { logger } from "../config/logger";

export function createRentWorker(): Worker {
    const worker = new Worker(
        RENT_QUEUE_NAME,
        async (job) => {
            switch (job.name) {
                case JobNames.GENERATE_INVOICES:
                    return generateInvoicesJob();
                case JobNames.FLAG_LATE_PAYMENTS:
                    return flagLatePaymentsJob();
                case JobNames.SEND_RENT_REMINDERS:
                    return sendRentRemindersJob();
                default:
                    logger.warn({ jobName: job.name }, "Unknown job received");
            }
        },
        { connection }
    );

    worker.on("completed", (job) => logger.info({ jobId: job.id, name: job.name }, "Job completed"));
    worker.on("failed", (job, err) => logger.error({ jobId: job?.id, name: job?.name, err }, "Job failed"));

    return worker;
}
