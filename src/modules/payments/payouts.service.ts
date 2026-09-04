import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../database";
import { payouts, users } from "../../database/schema";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { notify } from "../../services/notification.service";
import { transfer, isMtnMomoConfigured } from "../../services/payments/mtnMomo/client";
import { ADMIN_ROLES } from "../../common/constants/roles";
import type { PaymentSucceededDetail } from "../../services/events/eventBridge.service";

type UserRow = typeof users.$inferSelect;
type PayoutRow = typeof payouts.$inferSelect;

async function notifyAdmins(input: { type: string; title: string; message: string; metadata?: Record<string, unknown> }): Promise<void> {
    const admins = await db.select({ id: users.id }).from(users).where(inArray(users.role, ADMIN_ROLES));
    await Promise.all(admins.map((admin) => notify({ ...input, userId: admin.id, sendEmail: true })));
}

/**
 * Sends (or simulates) the actual MTN transfer for an already-created payout
 * row and updates it with the outcome. Shared by both the first attempt
 * (initiateDisbursement) and a later retry once a held payout's landlord
 * account is reactivated (releaseHeldPayouts).
 */
async function disburseFunds(payout: PayoutRow, owner: UserRow): Promise<void> {
    if (!isMtnMomoConfigured("disbursement")) {
        await db
            .update(payouts)
            .set({
                provider: "MTN MoMo (mock)",
                providerReference: `MOCK-DISBURSE-${crypto.randomUUID()}`,
                status: "success",
                failureReason: null,
                disbursedAt: new Date()
            })
            .where(eq(payouts.id, payout.id));
        await notify({
            userId: payout.ownerId,
            type: "payout.success",
            title: "Rent disbursed",
            message: `A rent payment of ${payout.amount} was automatically sent to your MoMo account.`,
            metadata: { paymentId: payout.paymentId, payoutId: payout.id },
            sendEmail: true
        });
        return;
    }

    if (!owner.payoutMomoNumber) {
        await db
            .update(payouts)
            .set({ status: "failed", failureReason: "No payout mobile money number on file for this landlord" })
            .where(eq(payouts.id, payout.id));
        await notify({
            userId: payout.ownerId,
            type: "payout.failed",
            title: "Rent payout could not be sent",
            message: "Add your MTN MoMo number in your profile so rent payments can be sent to you automatically.",
            metadata: { paymentId: payout.paymentId },
            sendEmail: true
        });
        return;
    }

    const referenceId = crypto.randomUUID();
    await db
        .update(payouts)
        .set({ provider: "MTN MoMo", providerReference: referenceId, status: "pending", failureReason: null })
        .where(eq(payouts.id, payout.id));

    try {
        await transfer({
            referenceId,
            amount: Number(payout.amount).toFixed(2),
            currency: env.momo.currency,
            externalId: `PAYOUT-${payout.id}`,
            payeePhone: owner.payoutMomoNumber,
            payerMessage: "HomeLink rent disbursement",
            payeeNote: `Rent disbursement for lease ${payout.leaseId}`,
            callbackUrl: `${env.momo.callbackBaseUrl}/api/v1/webhooks/mtn/disbursement/${referenceId}`
        });
    } catch (err) {
        logger.error({ err, payoutId: payout.id }, "MTN MoMo transfer call failed");
        await db
            .update(payouts)
            .set({ status: "failed", failureReason: "Could not reach MTN MoMo" })
            .where(eq(payouts.id, payout.id));
    }
}

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
 *
 * If the landlord's account has been deactivated (e.g. admin locked it for
 * violating the platform usage agreement), the payout is held rather than
 * sent — a lock should stop money too, not just app access. Held payouts
 * are released automatically once the account is reactivated, see
 * releaseHeldPayouts below.
 */
export async function initiateDisbursement(detail: PaymentSucceededDetail): Promise<void> {
    const [existing] = await db.select().from(payouts).where(eq(payouts.paymentId, detail.paymentId)).limit(1);
    if (existing) {
        logger.info({ paymentId: detail.paymentId }, "Payout already exists for this payment — skipping");
        return;
    }

    const [owner] = await db.select().from(users).where(eq(users.id, detail.ownerId)).limit(1);

    if (!owner?.isActive) {
        const [payout] = await db
            .insert(payouts)
            .values({
                paymentId: detail.paymentId,
                leaseId: detail.leaseId,
                ownerId: detail.ownerId,
                amount: detail.amount,
                provider: "n/a",
                providerReference: `HELD-${crypto.randomUUID()}`,
                status: "held",
                failureReason: "Landlord account is deactivated — payout held pending admin review"
            })
            .returning();
        await notifyAdmins({
            type: "payout.held",
            title: "Rent payout held",
            message: `A rent payment of ${detail.amount} is on hold because the landlord's account is deactivated.`,
            metadata: { paymentId: detail.paymentId, payoutId: payout!.id, ownerId: detail.ownerId }
        });
        return;
    }

    const [payout] = await db
        .insert(payouts)
        .values({
            paymentId: detail.paymentId,
            leaseId: detail.leaseId,
            ownerId: detail.ownerId,
            amount: detail.amount,
            provider: "pending",
            providerReference: `PENDING-${crypto.randomUUID()}`,
            status: "pending"
        })
        .returning();

    await disburseFunds(payout!, owner);
}

/**
 * Called when an admin reactivates a landlord's account (see
 * admin.service.ts's updateUserStatus) — sends out any payouts that were
 * held while the account was deactivated.
 */
export async function releaseHeldPayouts(ownerId: string): Promise<void> {
    const [owner] = await db.select().from(users).where(eq(users.id, ownerId)).limit(1);
    if (!owner?.isActive) return;

    const heldPayouts = await db
        .select()
        .from(payouts)
        .where(and(eq(payouts.ownerId, ownerId), eq(payouts.status, "held")));

    for (const payout of heldPayouts) {
        await disburseFunds(payout, owner);
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
