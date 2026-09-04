import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../database";
import { payments as paymentsTable } from "../../database/schema";
import { sendSuccess } from "../../common/utils/response.util";
import { logger } from "../../config/logger";
import { markPaymentFailed, markPaymentSuccess } from "./payments.service";
import { markPayoutFailed, markPayoutSuccess } from "./payouts.service";
import { getRequestToPayStatus, getTransferStatus, isMtnMomoConfigured } from "../../services/payments/mtnMomo/client";

function reasonToString(reason: unknown): string {
    if (typeof reason === "string") return reason;
    if (reason && typeof reason === "object") return JSON.stringify(reason);
    return "MTN MoMo did not provide a reason";
}

/**
 * MTN calls this once a Request to Pay (see mtnMomoProvider.ts) resolves.
 * Public/unauthenticated by necessity — MTN has no way to send our JWTs.
 *
 * MTN's callback payload isn't signed, and the reference ID in the URL is
 * not a secret: the paying tenant sees their own providerReference in the
 * `pay` response. So the callback body is trusted only as a hint to check —
 * never as the verdict itself, or anyone who captured their own referenceId
 * could POST a fake "SUCCESSFUL" here before ever paying and get free rent
 * plus an automatic payout to the landlord. The actual status always comes
 * from calling MTN's own status endpoint with our own credentials.
 */
export async function mtnCollectionCallbackHandler(req: Request, res: Response) {
    const { referenceId } = req.params as { referenceId: string };

    const [payment] = await db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.providerReference, referenceId))
        .limit(1);

    if (!payment) {
        logger.warn({ referenceId }, "MTN collection callback for unknown providerReference");
        return sendSuccess(res, { message: "Acknowledged" });
    }

    if (!isMtnMomoConfigured("collection")) {
        logger.warn({ referenceId }, "MTN collection callback received while collections aren't configured — ignoring");
        return sendSuccess(res, { message: "Acknowledged" });
    }

    let verified;
    try {
        verified = await getRequestToPayStatus(referenceId);
    } catch (err) {
        logger.error({ err, referenceId }, "Failed to verify MTN collection status after callback");
        return sendSuccess(res, { message: "Acknowledged" });
    }

    if (verified.status === "SUCCESSFUL") {
        await markPaymentSuccess(payment.id);
    } else if (verified.status === "FAILED") {
        await markPaymentFailed(payment.id, reasonToString(verified.reason));
    }
    // PENDING is just acknowledged — nothing to change yet.

    return sendSuccess(res, { message: "Acknowledged" });
}

/** Disbursement counterpart of mtnCollectionCallbackHandler — same verify-don't-trust approach. */
export async function mtnDisbursementCallbackHandler(req: Request, res: Response) {
    const { referenceId } = req.params as { referenceId: string };

    if (!isMtnMomoConfigured("disbursement")) {
        logger.warn({ referenceId }, "MTN disbursement callback received while disbursements aren't configured — ignoring");
        return sendSuccess(res, { message: "Acknowledged" });
    }

    let verified;
    try {
        verified = await getTransferStatus(referenceId);
    } catch (err) {
        logger.error({ err, referenceId }, "Failed to verify MTN disbursement status after callback");
        return sendSuccess(res, { message: "Acknowledged" });
    }

    if (verified.status === "SUCCESSFUL") {
        await markPayoutSuccess(referenceId);
    } else if (verified.status === "FAILED") {
        await markPayoutFailed(referenceId, reasonToString(verified.reason));
    }

    return sendSuccess(res, { message: "Acknowledged" });
}
