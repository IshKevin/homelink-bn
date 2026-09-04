import { eq } from "drizzle-orm";
import { testRequest } from "../../../../tests/helpers/app";
import { createInvoice, createLease, createProperty, createUser } from "../../../../tests/helpers/factories";
import { db } from "../../../database";
import { payments, payouts } from "../../../database/schema";
import { nextDocumentNumber } from "../../../common/utils/sequence.util";
import * as mtnMomoClient from "../../../services/payments/mtnMomo/client";

jest.mock("../../../services/email.service", () => ({
    sendMail: jest.fn().mockResolvedValue(undefined)
}));

jest.mock("../../../services/pdf.service", () => ({
    renderHtmlToPdf: jest.fn().mockResolvedValue(Buffer.from("pdf"))
}));

jest.mock("../../../services/storage.service", () => ({
    buildObjectKey: jest.fn().mockReturnValue("receipts/mock-key.pdf"),
    uploadBuffer: jest.fn().mockResolvedValue("receipts/mock-key.pdf"),
    getPresignedDownloadUrl: jest.fn().mockResolvedValue("https://example.com/signed"),
    deleteObject: jest.fn().mockResolvedValue(undefined)
}));

async function createPendingPayment() {
    const owner = await createUser({ role: "owner" });
    const tenant = await createUser({ role: "tenant" });
    const property = await createProperty({ ownerId: owner.user.id, status: "occupied", approvalStatus: "approved" });
    const lease = await createLease({ propertyId: property.id, tenantId: tenant.user.id, ownerId: owner.user.id, status: "active" });
    const invoice = await createInvoice({ leaseId: lease.id, amountDue: "1000.00" });

    const referenceId = "11111111-1111-4111-8111-111111111111";
    const paymentNumber = await nextDocumentNumber("ACC-PAY");
    const [payment] = await db
        .insert(payments)
        .values({
            paymentNumber,
            invoiceId: invoice.id,
            tenantId: tenant.user.id,
            amount: "1000.00",
            method: "mobile_money",
            provider: "MTN Mobile Money",
            providerReference: referenceId,
            status: "pending"
        })
        .returning();

    return { payment: payment!, invoice, referenceId };
}

describe("MTN webhooks — verify against MTN's own status API, never trust the callback body", () => {
    beforeEach(() => {
        jest.spyOn(mtnMomoClient, "isMtnMomoConfigured").mockImplementation((product) => product === "collection");
    });

    afterEach(() => jest.restoreAllMocks());

    it("does NOT mark a payment successful just because the callback body claims SUCCESSFUL", async () => {
        const { payment, referenceId } = await createPendingPayment();
        // The real MTN status check disagrees with the forged callback body —
        // this is the exact "tenant fakes their own webhook" attack this fix closes.
        jest.spyOn(mtnMomoClient, "getRequestToPayStatus").mockResolvedValue({
            amount: "1000.00",
            currency: "EUR",
            externalId: "ext",
            status: "PENDING"
        });

        const res = await testRequest()
            .post(`/api/v1/webhooks/mtn/collection/${referenceId}`)
            .send({ status: "SUCCESSFUL" });
        expect(res.status).toBe(200);

        const [updated] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
        expect(updated!.status).toBe("pending");
        expect(updated!.paidAt).toBeNull();
    });

    it("marks the payment successful only once MTN's own status check confirms it", async () => {
        const { payment, referenceId } = await createPendingPayment();
        jest.spyOn(mtnMomoClient, "getRequestToPayStatus").mockResolvedValue({
            amount: "1000.00",
            currency: "EUR",
            externalId: "ext",
            status: "SUCCESSFUL"
        });

        const res = await testRequest()
            .post(`/api/v1/webhooks/mtn/collection/${referenceId}`)
            .send({ status: "SUCCESSFUL" });
        expect(res.status).toBe(200);

        const [updated] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
        expect(updated!.status).toBe("success");
        expect(updated!.paidAt).not.toBeNull();
        expect(updated!.receiptUrl).toBeTruthy();
    });

    it("marks the payment failed when MTN's own status check says FAILED, regardless of the callback body", async () => {
        const { payment, referenceId } = await createPendingPayment();
        jest.spyOn(mtnMomoClient, "getRequestToPayStatus").mockResolvedValue({
            amount: "1000.00",
            currency: "EUR",
            externalId: "ext",
            status: "FAILED",
            reason: "Payer rejected"
        });

        const res = await testRequest()
            .post(`/api/v1/webhooks/mtn/collection/${referenceId}`)
            .send({ status: "SUCCESSFUL" });
        expect(res.status).toBe(200);

        const [updated] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
        expect(updated!.status).toBe("failed");
        expect(updated!.failureReason).toBe("Payer rejected");
    });

    it("acknowledges but takes no action when collections aren't configured", async () => {
        jest.spyOn(mtnMomoClient, "isMtnMomoConfigured").mockReturnValue(false);
        const statusSpy = jest.spyOn(mtnMomoClient, "getRequestToPayStatus");
        const { payment, referenceId } = await createPendingPayment();

        const res = await testRequest()
            .post(`/api/v1/webhooks/mtn/collection/${referenceId}`)
            .send({ status: "SUCCESSFUL" });
        expect(res.status).toBe(200);
        expect(statusSpy).not.toHaveBeenCalled();

        const [updated] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
        expect(updated!.status).toBe("pending");
    });

    it("acknowledges an unknown reference without throwing", async () => {
        const res = await testRequest()
            .post(`/api/v1/webhooks/mtn/collection/22222222-2222-4222-8222-222222222222`)
            .send({ status: "SUCCESSFUL" });
        expect(res.status).toBe(200);
    });
});

describe("MTN disbursement webhook — same verify-don't-trust behavior", () => {
    afterEach(() => jest.restoreAllMocks());

    it("does not mark a payout successful on a forged callback, only on MTN's own verified status", async () => {
        jest.spyOn(mtnMomoClient, "isMtnMomoConfigured").mockImplementation((product) => product === "disbursement");
        const owner = await createUser({ role: "owner" });
        const tenant = await createUser({ role: "tenant" });
        const property = await createProperty({ ownerId: owner.user.id, status: "occupied", approvalStatus: "approved" });
        const lease = await createLease({ propertyId: property.id, tenantId: tenant.user.id, ownerId: owner.user.id, status: "active" });
        const invoice = await createInvoice({ leaseId: lease.id, amountDue: "1000.00" });
        const paymentNumber = await nextDocumentNumber("ACC-PAY");
        const [payment] = await db
            .insert(payments)
            .values({
                paymentNumber,
                invoiceId: invoice.id,
                tenantId: tenant.user.id,
                amount: "1000.00",
                method: "mobile_money",
                provider: "MTN Mobile Money",
                providerReference: "irrelevant",
                status: "success",
                paidAt: new Date()
            })
            .returning();

        const referenceId = "33333333-3333-4333-8333-333333333333";
        const [payout] = await db
            .insert(payouts)
            .values({
                paymentId: payment!.id,
                leaseId: lease.id,
                ownerId: owner.user.id,
                amount: "1000.00",
                provider: "MTN MoMo",
                providerReference: referenceId,
                status: "pending"
            })
            .returning();

        jest.spyOn(mtnMomoClient, "getTransferStatus").mockResolvedValue({
            amount: "1000.00",
            currency: "EUR",
            externalId: "ext",
            status: "PENDING"
        });

        const res = await testRequest().post(`/api/v1/webhooks/mtn/disbursement/${referenceId}`).send({ status: "SUCCESSFUL" });
        expect(res.status).toBe(200);

        const [updated] = await db.select().from(payouts).where(eq(payouts.id, payout!.id)).limit(1);
        expect(updated!.status).toBe("pending");
    });
});
