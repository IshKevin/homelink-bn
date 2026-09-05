import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../config/env";

export const connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });

export const RENT_QUEUE_NAME = "rent-jobs";

export const rentQueue = new Queue(RENT_QUEUE_NAME, { connection });

export const JobNames = {
    GENERATE_INVOICES: "generate-invoices",
    FLAG_LATE_PAYMENTS: "flag-late-payments",
    SEND_RENT_REMINDERS: "send-rent-reminders",
    PROCESS_PAYOUT_EVENTS: "process-payout-events",
    RECONCILE_PENDING_MTN_TRANSACTIONS: "reconcile-pending-mtn-transactions"
} as const;
