import { eq } from "drizzle-orm";
import { createAuthedUser, createInvoice, createLease, createProperty } from "../../../../tests/helpers/factories";
import { db } from "../../../database";
import { invoices, payments, payouts } from "../../../database/schema";
import { nextDocumentNumber } from "../../../common/utils/sequence.util";
import { reconcilePendingMtnTransactionsJob } from "../reconcilePendingMtnTransactions.job";

jest.mock("../../../services/email.service", () => ({
    sendMail: jest.fn().mockResolvedValue(undefined)
}));

jest.mock("../../../services/storage.service", () => ({
    buildObjectKey: jest.fn().mockReturnValue("receipts/mock-key.pdf"),
    uploadBuffer: jest.fn().mockResolvedValue("receipts/mock-key.pdf")
}));

jest.mock("../../../services/pdf.service", () => ({
    renderHtmlToPdf: jest.fn().mockResolvedValue(Buffer.from("pdf"))
}));

jest.mock("../../../services/events/eventBridge.service", () => ({
    publishPaymentSucceeded: jest.fn().mockResolvedValue(undefined)
}));

jest.mock("../../../services/payments/mtnMomo/client", () => ({
    isMtnMomoConfigured: jest.fn().mockReturnValue(true),
    getRequestToPayStatus: jest.fn(),
    getTransferStatus: jest.fn()
}));

import * as mtnClient from "../../../services/payments/mtnMomo/client";

const STALE_CREATED_AT = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

async function setupPendingPayment() {
    const { user: owner } = await createAuthedUser({ role: "owner" });
    const { user: tenant } = await createAuthedUser({ role: "tenant" });
    const property = await createProperty({ ownerId: owner.id, status: "occupied", approvalStatus: "approved" });
    const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: owner.id, status: "active" });
    const invoice = await createInvoice({ leaseId: lease.id, amountDue: "1500.00", status: "unpaid" });

    const paymentNumber = await nextDocumentNumber("ACC-PAY");
    const [payment] = await db
        .insert(payments)
        .values({
            paymentNumber,
            invoiceId: invoice.id,
            tenantId: tenant.id,
            amount: "1500.00",
            method: "mobile_money",
            provider: "MTN MoMo",
            providerReference: `test-ref-${paymentNumber}`,
            status: "pending",
            approvalStatus: "not_required",
            createdAt: STALE_CREATED_AT
        })
        .returning();

    return { payment: payment!, invoice, lease, tenant, owner };
}

describe("reconcilePendingMtnTransactionsJob", () => {
    afterEach(() => jest.clearAllMocks());

    it("marks a stale pending payment successful when MTN reports SUCCESSFUL", async () => {
        const { payment, invoice } = await setupPendingPayment();
        (mtnClient.getRequestToPayStatus as jest.Mock).mockResolvedValue({ status: "SUCCESSFUL" });

        await reconcilePendingMtnTransactionsJob();

        const [updated] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
        expect(updated!.status).toBe("success");
        expect(updated!.paidAt).not.toBeNull();

        const [updatedInvoice] = await db.select().from(invoices).where(eq(invoices.id, invoice.id)).limit(1);
        expect(updatedInvoice!.status).toBe("paid");
    });

    it("marks a stale pending payment failed when MTN reports FAILED", async () => {
        const { payment } = await setupPendingPayment();
        (mtnClient.getRequestToPayStatus as jest.Mock).mockResolvedValue({ status: "FAILED", reason: "insufficient funds" });

        await reconcilePendingMtnTransactionsJob();

        const [updated] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
        expect(updated!.status).toBe("failed");
        expect(updated!.failureReason).toBe("insufficient funds");
    });

    it("leaves a still-pending payment alone", async () => {
        const { payment } = await setupPendingPayment();
        (mtnClient.getRequestToPayStatus as jest.Mock).mockResolvedValue({ status: "PENDING" });

        await reconcilePendingMtnTransactionsJob();

        const [updated] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
        expect(updated!.status).toBe("pending");
    });

    it("does not touch a payment created too recently to be considered stale", async () => {
        const { user: owner } = await createAuthedUser({ role: "owner" });
        const { user: tenant } = await createAuthedUser({ role: "tenant" });
        const property = await createProperty({ ownerId: owner.id, status: "occupied", approvalStatus: "approved" });
        const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: owner.id, status: "active" });
        const invoice = await createInvoice({ leaseId: lease.id, amountDue: "1500.00", status: "unpaid" });
        const paymentNumber = await nextDocumentNumber("ACC-PAY");
        const [payment] = await db
            .insert(payments)
            .values({
                paymentNumber,
                invoiceId: invoice.id,
                tenantId: tenant.id,
                amount: "1500.00",
                method: "mobile_money",
                provider: "MTN MoMo",
                providerReference: `test-ref-${paymentNumber}`,
                status: "pending",
                approvalStatus: "not_required"
                // createdAt defaults to now() — not stale yet
            })
            .returning();

        (mtnClient.getRequestToPayStatus as jest.Mock).mockResolvedValue({ status: "SUCCESSFUL" });

        await reconcilePendingMtnTransactionsJob();

        expect(mtnClient.getRequestToPayStatus).not.toHaveBeenCalled();
        const [updated] = await db.select().from(payments).where(eq(payments.id, payment!.id)).limit(1);
        expect(updated!.status).toBe("pending");
    });

    it("marks a stale pending payout successful when MTN reports SUCCESSFUL", async () => {
        const { user: owner } = await createAuthedUser({ role: "owner" });
        const { user: tenant } = await createAuthedUser({ role: "tenant" });
        const property = await createProperty({ ownerId: owner.id, status: "occupied", approvalStatus: "approved" });
        const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: owner.id, status: "active" });
        const invoice = await createInvoice({ leaseId: lease.id, amountDue: "1500.00", status: "paid" });
        const paymentNumber = await nextDocumentNumber("ACC-PAY");
        const [payment] = await db
            .insert(payments)
            .values({
                paymentNumber,
                invoiceId: invoice.id,
                tenantId: tenant.id,
                amount: "1500.00",
                method: "mobile_money",
                provider: "MTN MoMo",
                providerReference: `payment-ref-${paymentNumber}`,
                status: "success",
                approvalStatus: "not_required",
                paidAt: STALE_CREATED_AT
            })
            .returning();

        const [payout] = await db
            .insert(payouts)
            .values({
                paymentId: payment!.id,
                leaseId: lease.id,
                ownerId: owner.id,
                amount: "1350.00",
                provider: "MTN MoMo",
                providerReference: `payout-ref-${paymentNumber}`,
                status: "pending",
                createdAt: STALE_CREATED_AT
            })
            .returning();

        (mtnClient.getTransferStatus as jest.Mock).mockResolvedValue({ status: "SUCCESSFUL" });

        await reconcilePendingMtnTransactionsJob();

        const [updated] = await db.select().from(payouts).where(eq(payouts.id, payout!.id)).limit(1);
        expect(updated!.status).toBe("success");
        expect(updated!.disbursedAt).not.toBeNull();
    });

    it("does nothing when MTN MoMo isn't configured", async () => {
        (mtnClient.isMtnMomoConfigured as jest.Mock).mockReturnValue(false);
        const { payment } = await setupPendingPayment();

        await reconcilePendingMtnTransactionsJob();

        expect(mtnClient.getRequestToPayStatus).not.toHaveBeenCalled();
        const [updated] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
        expect(updated!.status).toBe("pending");
    });
});
