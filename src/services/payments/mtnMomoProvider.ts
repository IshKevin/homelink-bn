import crypto from "node:crypto";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import type { InitiatePaymentInput, PaymentProvider, PaymentResult } from "./payment.provider";
import { requestToPay } from "./mtnMomo/client";

/**
 * Real MTN MoMo Collections integration ("Request to Pay"). Unlike the mock
 * providers, this is genuinely asynchronous: a successful `initiate()` call
 * only means MTN accepted the request, not that the tenant has paid — the
 * actual result arrives at POST /webhooks/mtn/collection/:referenceId
 * (see webhooks.routes.ts), so this always returns status "pending".
 */
export class MtnMomoCollectionProvider implements PaymentProvider {
    readonly name = "MTN MoMo";

    async initiate(input: InitiatePaymentInput): Promise<PaymentResult> {
        const referenceId = crypto.randomUUID();

        if (!input.payerPhone) {
            return {
                providerReference: referenceId,
                status: "failed",
                failureReason: "No mobile money number on file for this tenant"
            };
        }

        try {
            await requestToPay({
                referenceId,
                amount: input.amount.toFixed(2),
                currency: env.momo.currency,
                externalId: input.reference,
                payerPhone: input.payerPhone,
                payerMessage: `HomeLink rent payment ${input.reference}`,
                payeeNote: `Rent payment for ${input.reference}`,
                callbackUrl: `${env.momo.callbackBaseUrl}/api/v1/webhooks/mtn/collection/${referenceId}`
            });
        } catch (err) {
            logger.error({ err, referenceId }, "MTN MoMo requestToPay call failed");
            return {
                providerReference: referenceId,
                status: "failed",
                failureReason: "Could not reach MTN MoMo — please try again"
            };
        }

        return { providerReference: referenceId, status: "pending" };
    }
}
