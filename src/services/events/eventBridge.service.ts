import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

const client = new EventBridgeClient({ region: env.eventBridge.region });

export interface PaymentSucceededDetail {
    paymentId: string;
    invoiceId: string;
    leaseId: string;
    ownerId: string;
    tenantId: string;
    amount: string;
}

/**
 * Publishes to the custom EventBridge bus (see infra/terraform/payments.tf)
 * that a rule forwards to an SQS queue — the automated-disbursement job
 * (jobs/handlers/processPayoutEvents.job.ts) polls that queue and reacts.
 * This decouples "tenant payment succeeded" from "pay the landlord": the
 * disbursement isn't triggered inline from the payment request, and no one
 * has to click anything for it to happen.
 *
 * No-ops (logs and returns) when EVENTBRIDGE_BUS_NAME isn't set, same
 * fallback pattern as the mock payment providers — keeps every other
 * environment working without this being configured.
 */
export async function publishPaymentSucceeded(detail: PaymentSucceededDetail): Promise<void> {
    if (!env.eventBridge.busName) {
        logger.warn({ paymentId: detail.paymentId }, "EVENTBRIDGE_BUS_NAME not set — skipping payout event publish");
        return;
    }

    try {
        await client.send(
            new PutEventsCommand({
                Entries: [
                    {
                        EventBusName: env.eventBridge.busName,
                        Source: "homelink.payments",
                        DetailType: "payment.succeeded",
                        Detail: JSON.stringify(detail)
                    }
                ]
            })
        );
        logger.info({ paymentId: detail.paymentId }, "Published payment.succeeded to EventBridge");
    } catch (err) {
        // Deliberately non-fatal: the tenant's payment already succeeded and
        // was recorded — losing an EventBridge publish must not roll that
        // back or fail the request. Worst case, a landlord's payout doesn't
        // auto-fire and needs following up on manually.
        logger.error({ err, paymentId: detail.paymentId }, "Failed to publish payment.succeeded to EventBridge");
    }
}
