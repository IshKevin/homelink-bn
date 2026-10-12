import { reconcilePendingMtnTransactionsJob } from "../src/jobs/handlers/reconcilePendingMtnTransactions.job";

reconcilePendingMtnTransactionsJob()
    .then(() => {
        console.log("Reconcile run complete.");
        process.exit(0);
    })
    .catch((err) => {
        console.error("Reconcile failed:", err);
        process.exit(1);
    });
