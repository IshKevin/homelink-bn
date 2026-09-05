import { and, eq, lt } from "drizzle-orm";
import { db } from "../../database";
import { payments, payouts } from "../../database/schema";
import { logger } from "../../config/logger";
import { markPaymentFailed, markPaymentSuccess } from "../../modules/payments/payments.service";
import { markPayoutFailed, markPayoutSuccess } from "../../modules/payments/payouts.service";
import { getRequestToPayStatus, getTransferStatus, isMtnMomoConfigured } from "../../services/payments/mtnMomo/client";

// MTN's webhook resolves collections/disbursements almost instantly in
// practice, but nothing retries a payment/payout that's still "pending" if
// that callback is ever dropped — and MTN MoMo is this app's only payment
// path, so a lost webhook otherwise means stuck rent forever with no way to
// tell tenant or landlord apart from "still processing". This polls MTN's
// own status endpoint (never trusts anything but that) for anything still
// pending a few minutes after it was created, same verify-first logic the
// webhook handlers use.
const STALE_AFTER_MS = 3 * 60 * 1000;

function reasonToString(reason: unknown): string {
    if (typeof reason === "string") return reason;
    if (reason && typeof reason === "object") return JSON.stringify(reason);
    return "MTN MoMo did not provide a reason";
}

export async function reconcilePendingMtnTransactionsJob(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
    let checked = 0;
    let resolved = 0;

    if (isMtnMomoConfigured("collection")) {
        const stalePayments = await db
            .select()
            .from(payments)
            .where(and(eq(payments.status, "pending"), eq(payments.provider, "MTN MoMo"), lt(payments.createdAt, staleBefore)));

        for (const payment of stalePayments) {
            checked++;
            try {
                const verified = await getRequestToPayStatus(payment.providerReference);
                if (verified.status === "SUCCESSFUL") {
                    await markPaymentSuccess(payment.id);
                    resolved++;
                } else if (verified.status === "FAILED") {
                    await markPaymentFailed(payment.id, reasonToString(verified.reason));
                    resolved++;
                }
            } catch (err) {
                logger.error({ err, paymentId: payment.id }, "Failed to reconcile pending MTN collection");
            }
        }
    }

    if (isMtnMomoConfigured("disbursement")) {
        const stalePayouts = await db
            .select()
            .from(payouts)
            .where(and(eq(payouts.status, "pending"), eq(payouts.provider, "MTN MoMo"), lt(payouts.createdAt, staleBefore)));

        for (const payout of stalePayouts) {
            checked++;
            try {
                const verified = await getTransferStatus(payout.providerReference);
                if (verified.status === "SUCCESSFUL") {
                    await markPayoutSuccess(payout.providerReference);
                    resolved++;
                } else if (verified.status === "FAILED") {
                    await markPayoutFailed(payout.providerReference, reasonToString(verified.reason));
                    resolved++;
                }
            } catch (err) {
                logger.error({ err, payoutId: payout.id }, "Failed to reconcile pending MTN disbursement");
            }
        }
    }

    logger.info({ checked, resolved }, "reconcilePendingMtnTransactionsJob complete");
}
