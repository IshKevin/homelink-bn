import { createRentWorker } from "./jobs/worker";
import { scheduleRepeatableJobs } from "./jobs/scheduler";
import { logger } from "./config/logger";

async function main() {
    const worker = await createRentWorker();
    await scheduleRepeatableJobs();
    logger.info("HomeLink worker process started");

    const shutdown = async () => {
        logger.info("Shutting down worker...");
        await worker.close();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((err) => {
    logger.error({ err }, "Worker failed to start");
    process.exit(1);
});
