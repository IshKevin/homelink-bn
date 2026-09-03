import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { initiateDisbursement } from "../../modules/payments/payouts.service";
import type { PaymentSucceededDetail } from "../../services/events/eventBridge.service";

const client = new SQSClient({ region: env.eventBridge.region });

/**
 * Drains the SQS queue an EventBridge rule forwards payment.succeeded
 * events to (see infra/terraform/payments.tf), and disburses rent to the
 * landlord for each one. Scheduled every minute (scheduler.ts) rather than
 * run as a long-lived poll loop, to fit this app's existing BullMQ
 * repeatable-job pattern instead of introducing a second worker model.
 *
 * No-ops when PAYOUT_EVENTS_QUEUE_URL isn't set — same fallback convention
 * as the rest of the payments/EventBridge integration.
 */
export async function processPayoutEventsJob(): Promise<void> {
    if (!env.eventBridge.payoutQueueUrl) return;

    const { Messages } = await client.send(
        new ReceiveMessageCommand({
            QueueUrl: env.eventBridge.payoutQueueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 5
        })
    );

    if (!Messages || Messages.length === 0) return;

    for (const message of Messages) {
        try {
            // EventBridge -> SQS wraps the original PutEvents payload in an
            // envelope; the actual detail we published is JSON-stringified
            // under `.detail`.
            const envelope = JSON.parse(message.Body ?? "{}") as { detail?: PaymentSucceededDetail };
            if (!envelope.detail) {
                logger.warn({ messageId: message.MessageId }, "Payout event message had no detail — dropping");
            } else {
                await initiateDisbursement(envelope.detail);
            }

            if (message.ReceiptHandle) {
                await client.send(
                    new DeleteMessageCommand({ QueueUrl: env.eventBridge.payoutQueueUrl, ReceiptHandle: message.ReceiptHandle })
                );
            }
        } catch (err) {
            logger.error({ err, messageId: message.MessageId }, "Failed to process payout event — leaving for retry");
            // Not deleted: SQS's visibility timeout will make it reappear for
            // another attempt, and its redrive policy sends it to the DLQ
            // after repeated failures (see infra/terraform/payments.tf).
        }
    }
}
