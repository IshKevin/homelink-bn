import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../database";
import { payouts, users } from "../../database/schema";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { notify } from "../../services/notification.service";
import { transfer, isMtnMomoConfigured } from "../../services/payments/mtnMomo/client";
import type { PaymentSucceededDetail } from "../../services/events/eventBridge.service";

/**
 * Reacts to a payment.succeeded EventBridge event (relayed via SQS — see
 * jobs/handlers/processPayoutEvents.job.ts) by disbursing rent straight to
 * the landlord's own MTN MoMo number, with no manual approval step.
 *
 * Without real MTN Disbursement credentials configured, this simulates an
 * immediate successful payout instead of skipping the step entirely — same
 * "mock now, real provider later" approach as
 * services/payments/mockProviders.ts — so the full automated pipeline
 * (EventBridge -> SQS -> worker -> payout -> notification) is exercisable
 * end-to-end before those credentials exist.
 */
export async function initiateDisbursement(detail: PaymentSucceededDetail): Promise<void> {
    const [existing] = await db.select().from(payouts).where(eq(payouts.paymentId, detail.paymentId)).limit(1);
    if (existing) {
        logger.info({ paymentId: detail.paymentId }, "Payout already exists for this payment — skipping");
        return;
    }

    if (!isMtnMomoConfigured("disbursement")) {
        const referenceId = `MOCK-DISBURSE-${crypto.randomUUID()}`;
        const [payout] = await db
            .insert(payouts)
            .values({
                paymentId: detail.paymentId,
                leaseId: detail.leaseId,
                ownerId: detail.ownerId,
                amount: detail.amount,
                provider: "MTN MoMo (mock)",
                providerReference: referenceId,
                status: "success",
                disbursedAt: new Date()
            })
            .returning();
        await notify({
            userId: detail.ownerId,
            type: "payout.success",
            title: "Rent disbursed",
            message: `A rent payment of ${detail.amount} was automatically sent to your MoMo account.`,
            metadata: { paymentId: detail.paymentId, payoutId: payout!.id },
            sendEmail: true
        });
        return;
    }

    const [owner] = await db.select().from(users).where(eq(users.id, detail.ownerId)).limit(1);
    if (!owner?.payoutMomoNumber) {
        await db.insert(payouts).values({
            paymentId: detail.paymentId,
            leaseId: detail.leaseId,
            ownerId: detail.ownerId,
            amount: detail.amount,
            provider: "MTN MoMo",
            providerReference: `NO-PAYOUT-NUMBER-${crypto.randomUUID()}`,
            status: "failed",
            failureReason: "No payout mobile money number on file for this landlord"
        });
        await notify({
            userId: detail.ownerId,
            type: "payout.failed",
            title: "Rent payout could not be sent",
            message: "Add your MTN MoMo number in your profile so rent payments can be sent to you automatically.",
            metadata: { paymentId: detail.paymentId },
            sendEmail: true
        });
        return;
    }

    const referenceId = crypto.randomUUID();
    const [payout] = await db
        .insert(payouts)
        .values({
            paymentId: detail.paymentId,
            leaseId: detail.leaseId,
            ownerId: detail.ownerId,
            amount: detail.amount,
            provider: "MTN MoMo",
            providerReference: referenceId,
            status: "pending"
        })
        .returning();

    try {
        await transfer({
            referenceId,
            amount: Number(detail.amount).toFixed(2),
            currency: env.momo.currency,
            externalId: `PAYOUT-${payout!.id}`,
            payeePhone: owner.payoutMomoNumber,
            payerMessage: "HomeLink rent disbursement",
            payeeNote: `Rent disbursement for lease ${detail.leaseId}`,
            callbackUrl: `${env.momo.callbackBaseUrl}/api/v1/webhooks/mtn/disbursement/${referenceId}`
        });
    } catch (err) {
        logger.error({ err, payoutId: payout!.id }, "MTN MoMo transfer call failed");
        await db
            .update(payouts)
            .set({ status: "failed", failureReason: "Could not reach MTN MoMo" })
            .where(eq(payouts.id, payout!.id));
    }
}

export async function markPayoutSuccess(providerReference: string): Promise<void> {
    const [payout] = await db.select().from(payouts).where(eq(payouts.providerReference, providerReference)).limit(1);
    if (!payout || payout.status !== "pending") return;

    await db.update(payouts).set({ status: "success", disbursedAt: new Date() }).where(eq(payouts.id, payout.id));
    await notify({
        userId: payout.ownerId,
        type: "payout.success",
        title: "Rent disbursed",
        message: `A rent payment of ${payout.amount} was automatically sent to your MoMo account.`,
        metadata: { payoutId: payout.id },
        sendEmail: true
    });
}

export async function markPayoutFailed(providerReference: string, reason: string): Promise<void> {
    const [payout] = await db.select().from(payouts).where(eq(payouts.providerReference, providerReference)).limit(1);
    if (!payout || payout.status !== "pending") return;

    await db.update(payouts).set({ status: "failed", failureReason: reason }).where(eq(payouts.id, payout.id));
    await notify({
        userId: payout.ownerId,
        type: "payout.failed",
        title: "Rent payout failed",
        message: `We couldn't send your rent payment of ${payout.amount}: ${reason}. Our team has been notified.`,
        metadata: { payoutId: payout.id },
        sendEmail: true
    });
}
