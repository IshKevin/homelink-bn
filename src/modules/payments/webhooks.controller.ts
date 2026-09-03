import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../database";
import { payments as paymentsTable } from "../../database/schema";
import { sendSuccess } from "../../common/utils/response.util";
import { logger } from "../../config/logger";
import { markPaymentFailed, markPaymentSuccess } from "./payments.service";
import { markPayoutFailed, markPayoutSuccess } from "./payouts.service";

function reasonToString(reason: unknown): string {
    if (typeof reason === "string") return reason;
    if (reason && typeof reason === "object") return JSON.stringify(reason);
    return "MTN MoMo did not provide a reason";
}

/**
 * MTN calls this once a Request to Pay (see mtnMomoProvider.ts) resolves.
 * Public/unauthenticated by necessity — MTN has no way to send our JWTs —
 * the reference ID in the URL is the only thing tying this back to a real
 * payment, and it's a UUID we generated and gave MTN ourselves.
 */
export async function mtnCollectionCallbackHandler(req: Request, res: Response) {
    const { referenceId } = req.params as { referenceId: string };
    const { status, reason } = req.body as { status: "SUCCESSFUL" | "FAILED" | "PENDING"; reason?: unknown };

    const [payment] = await db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.providerReference, referenceId))
        .limit(1);

    if (!payment) {
        logger.warn({ referenceId }, "MTN collection callback for unknown providerReference");
        return sendSuccess(res, { message: "Acknowledged" });
    }

    if (status === "SUCCESSFUL") {
        await markPaymentSuccess(payment.id);
    } else if (status === "FAILED") {
        await markPaymentFailed(payment.id, reasonToString(reason));
    }
    // PENDING callbacks (rare) are just acknowledged — nothing to change yet.

    return sendSuccess(res, { message: "Acknowledged" });
}

/** Disbursement counterpart of mtnCollectionCallbackHandler — see payouts.service.ts. */
export async function mtnDisbursementCallbackHandler(req: Request, res: Response) {
    const { referenceId } = req.params as { referenceId: string };
    const { status, reason } = req.body as { status: "SUCCESSFUL" | "FAILED" | "PENDING"; reason?: unknown };

    if (status === "SUCCESSFUL") {
        await markPayoutSuccess(referenceId);
    } else if (status === "FAILED") {
        await markPayoutFailed(referenceId, reasonToString(reason));
    }

    return sendSuccess(res, { message: "Acknowledged" });
}
